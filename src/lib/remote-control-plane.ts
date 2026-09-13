// Client for the `remote-instance` and `remote-ssh-trust` Supabase Edge
// Functions (prds/remote-ssh.md, Phases 2-3). This is the only place the
// frontend talks to the managed-VM control plane; UI components go through
// the hooks in `src/hooks/useRemoteInstance.ts` instead of calling these
// directly, so caching/query-key rules stay in one place.
//
// Provider credentials and the SSH CA private key never reach this file or
// any response it receives - see the edge functions themselves.

import { supabase } from "./supabase";
import type {
  ClientKeyResponse,
  DeleteInstanceRequest,
  InstanceStatusResponse,
  IssueCertificateRequest,
  IssueCertificateResponse,
  ListRegionsResponse,
  ListSizePresetsResponse,
  OperationResponse,
  ProvisionInstanceRequest,
  RegionCode,
  RegisterClientKeyRequest,
  RegisterClientKeyResponse,
  ReprovisionInstanceRequest,
  RevokeClientKeyRequest,
  SizePreset,
  WakeInstanceRequest,
} from "./api-types-remote";

async function invokeRemoteInstance<T>(
  action: string,
  body: object = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("remote-instance", {
    body: { action, ...body },
  });
  if (error) throw error;
  return data as T;
}

async function invokeRemoteTrust<T>(
  action: string,
  body: object = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("remote-ssh-trust", {
    body: { action, ...body },
  });
  if (error) throw error;
  return data as T;
}

// -- Instance lifecycle (remote-instance) -----------------------------------

export const listRegions = (): Promise<RegionCode[]> =>
  invokeRemoteInstance<ListRegionsResponse>("list_regions").then(
    (r) => r.regions,
  );

export const listSizePresets = (): Promise<SizePreset[]> =>
  invokeRemoteInstance<ListSizePresetsResponse>("list_sizes").then(
    (r) => r.presets,
  );

export const getInstanceStatus = (): Promise<InstanceStatusResponse> =>
  invokeRemoteInstance<InstanceStatusResponse>("status");

export const ensureInstance = (
  request: Omit<ProvisionInstanceRequest, "idempotency_key"> & {
    idempotency_key: string;
  },
): Promise<OperationResponse> => invokeRemoteInstance("ensure", request);

export const wakeInstance = (
  request: WakeInstanceRequest,
): Promise<OperationResponse> => invokeRemoteInstance("wake", request);

export const reprovisionInstance = (
  request: ReprovisionInstanceRequest,
): Promise<OperationResponse> => invokeRemoteInstance("reprovision", request);

export const deleteInstance = (
  request: DeleteInstanceRequest,
): Promise<OperationResponse> => invokeRemoteInstance("delete", request);

// -- SSH trust and authentication (remote-ssh-trust) ------------------------

export const revokeClientKey = (
  request: RevokeClientKeyRequest,
): Promise<OperationResponse> =>
  invokeRemoteTrust("revoke_client_key", request);

/**
 * Registers a device's public key with the control plane, normalizing the
 * edge function's two response shapes (a freshly registered `key`, or a
 * `keys` list on an idempotent replay) down to the single matching key.
 */
export const registerClientKey = async (
  request: RegisterClientKeyRequest,
): Promise<ClientKeyResponse> => {
  const response = await invokeRemoteTrust<RegisterClientKeyResponse>(
    "register_client_key",
    request,
  );
  if (response.key) return response.key;
  const match = response.keys?.find((key) => key.comment === request.comment);
  const fallback = match ?? response.keys?.[0];
  if (!fallback) {
    throw new Error("register_client_key returned no key");
  }
  return fallback;
};

// Issues (or, called again for the same instance/key, silently renews) a
// short-lived certificate. See `src/lib/remote-cert-lifecycle.ts`, which
// calls this on a timer while the Supabase session stays valid so a
// certificate never lapses under a legitimately logged-in user (PRD "Silent
// renewal while the session is active").
export const issueCertificate = (
  request: IssueCertificateRequest,
): Promise<IssueCertificateResponse> =>
  invokeRemoteTrust("issue_certificate", request);

// Best-effort audit report for a client-side hard cutoff (PRD "Hard cutoff
// on revocation or expiry"). The cutoff itself already happened locally
// (see `src/lib/remote-cert-lifecycle.ts`); this only makes the forced
// cutoff correlatable in the server-side audit trail.
export const reportCutoff = (request: {
  instance_id: string | null;
  endpoint_id: string | null;
  reason: string;
}): Promise<{ status: string }> => invokeRemoteTrust("report_cutoff", request);

// User-managed endpoints and their repositories are not control-plane
// resources: the PRD's user-managed mode does not require control-plane
// certificate issuance, and there is no `remote_instance_endpoints` /
// `remote_repositories` write path in the current edge functions for them.
// They are persisted locally instead - see `src/lib/remote-endpoints.ts`.
