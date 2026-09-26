import type {
  ManagedInstanceState,
  RegionCode,
  SizePreset,
} from "../../lib/api-types-remote";

export const REGION_LABELS: Record<RegionCode, string> = {
  us_east: "US East",
  us_west: "US West",
  eu_west: "Europe West",
  ap_southeast: "Asia Pacific Southeast",
};

export const SIZE_LABELS: Record<SizePreset, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export const STAGE_LABELS: Record<ManagedInstanceState, string> = {
  unprovisioned: "Not provisioned",
  provisioning: "Creating cloud workspace...",
  bootstrapping: "Installing Treq, JJ, Git, and agents...",
  installing_access: "Configuring access...",
  verifying: "Verifying readiness...",
  ready: "Ready",
  suspended: "Suspended (idle)",
  waking: "Waking...",
  reprovisioning: "Reprovisioning...",
  degraded: "Degraded",
  failed: "Failed",
  deleting: "Deleting...",
  deleted: "Deleted",
};

export interface LocalKeyIdentity {
  reference: string;
  label: string;
  fingerprint: string;
}

export interface UserManagedFormValues {
  display_name: string;
  hostname: string;
  port: number;
  username: string;
  host_key_fingerprint: string;
  auth_identity_reference: string;
  alias: string | null;
}
