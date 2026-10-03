import { invoke } from "@tauri-apps/api/core";
import type { ResolvedSshAlias } from "./api-types";

/**
 * Resolves an explicitly-selected `~/.ssh/config` alias into its hostname,
 * port, username, and identity fields. Autocomplete only: this performs no
 * network I/O and never grants trust by itself. The user still supplies and
 * confirms the expected host-key fingerprint before the endpoint is
 * registered.
 */
export const resolveSshConfigAlias = (
  alias: string,
): Promise<ResolvedSshAlias> => invoke("resolve_ssh_config_alias", { alias });
