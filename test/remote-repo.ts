import { saveUserManagedEndpoint } from "../src/lib/remote-endpoints";
import {
  rememberLastOpenedRemoteRepository,
  upsertSavedRemoteRepository,
} from "../src/lib/remote-repository";
import { LOOPBACK_SSH_HOSTNAME } from "./loopback-ssh";

/**
 * Saves `repoPath` as the last-opened remote repository on a loopback
 * endpoint, so the Dashboard restores it through the real descriptor and
 * trust sequence.
 */
export async function openSavedRemoteRepo(
  repoPath: string,
  options?: { endpointId?: string; generation?: number },
) {
  const endpointId = options?.endpointId ?? "endpoint-test";
  await saveUserManagedEndpoint({
    id: endpointId,
    display_name: "testhost",
    hostname: LOOPBACK_SSH_HOSTNAME,
    port: 22,
    username: "treq",
    host_key_fingerprint: "SHA256:loopback",
    auth_identity_reference: "id_ed25519",
    alias: null,
    created_at: new Date().toISOString(),
  });
  const descriptor = await upsertSavedRemoteRepository({
    endpoint_id: endpointId,
    endpoint_generation: options?.generation ?? 0,
    remote_path: repoPath,
  });
  await rememberLastOpenedRemoteRepository(descriptor.id);
}
