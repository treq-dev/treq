// What the mobile shell remembers between launches (mobile PRD, "App
// lifecycle"): which endpoint, which repository on it, and which screen the
// user was on. These are identifiers only. They are never trusted as state:
// on start or resume the shell reconnects, gets a fresh certificate, and
// re-reads workspaces, agents and terminal sessions from the VM using them.
//
// Nothing secret is stored here. The certificate and endpoint (host keys,
// key reference) are re-issued by the control plane or re-read from the
// user-managed endpoint registry each time, and the device key stays in the
// OS keystore. `parseMobileSession` copies only known fields so a tampered
// or older record cannot carry anything else back in.

import type { RemoteRepoScreenState } from "../components/RemoteRepoScreen";

export const MOBILE_SESSION_KEY = "treq-mobile-session";

export type MobileEndpointChoice =
  | { kind: "managed" }
  | { kind: "user_managed"; id: string };

export interface MobileSessionSnapshot {
  endpoint: MobileEndpointChoice;
  repoPath: string | null;
  screen: RemoteRepoScreenState | null;
}

const WORKSPACE_SCREENS = new Set([
  "workspace",
  "commits",
  "conflicts",
  "agent",
  "terminal",
]);

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseEndpoint(raw: unknown): MobileEndpointChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === "managed") return { kind: "managed" };
  if (value.kind === "user_managed" && isString(value.id)) {
    return { kind: "user_managed", id: value.id };
  }
  return null;
}

function parseScreen(raw: unknown): RemoteRepoScreenState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.name === "workspaces") return { name: "workspaces" };
  if (!isString(value.workspace)) return null;
  if (value.name === "diff") {
    return isString(value.path)
      ? { name: "diff", workspace: value.workspace, path: value.path }
      : null;
  }
  if (typeof value.name === "string" && WORKSPACE_SCREENS.has(value.name)) {
    return {
      name: value.name as Exclude<
        RemoteRepoScreenState["name"],
        "workspaces" | "diff"
      >,
      workspace: value.workspace,
    };
  }
  return null;
}

export function parseMobileSession(raw: string): MobileSessionSnapshot | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const endpoint = parseEndpoint(value?.endpoint);
  if (!endpoint) return null;
  const repoPath = isString(value.repoPath) ? value.repoPath : null;
  return {
    endpoint,
    repoPath,
    // A screen only means something inside a repository.
    screen: repoPath ? parseScreen(value.screen) : null,
  };
}

// Storage can be missing or throw (private mode, cleared site data); the
// shell then simply starts without a remembered session.
export function loadMobileSession(): MobileSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(MOBILE_SESSION_KEY);
    return raw ? parseMobileSession(raw) : null;
  } catch {
    return null;
  }
}

export function saveMobileSession(snapshot: MobileSessionSnapshot): void {
  try {
    localStorage.setItem(MOBILE_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Not remembering the session is acceptable; see `loadMobileSession`.
  }
}

export function clearMobileSession(): void {
  try {
    localStorage.removeItem(MOBILE_SESSION_KEY);
  } catch {
    // See `loadMobileSession`.
  }
}
