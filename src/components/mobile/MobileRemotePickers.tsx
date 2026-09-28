import { useState } from "react";
import useSWR from "swr";
import type { SshEndpoint } from "../../lib/api-types-remote";
import {
  listUserManagedEndpoints,
  type UserManagedEndpointRecord,
} from "../../lib/remote-endpoints";
import { listSavedRepositoriesForEndpoint } from "../../lib/remote-repository";

/**
 * First step of the mobile flow: pick where to connect. The Treq-managed
 * instance needs a signed-in account; user-managed SSH endpoints saved on
 * this device do not go through the control plane, so they are listed
 * either way.
 */
export function MobileEndpointPicker({
  signedIn,
  connecting,
  onConnectManaged,
  onConnectUserManaged,
}: {
  signedIn: boolean;
  connecting: boolean;
  onConnectManaged: () => void;
  onConnectUserManaged: (record: UserManagedEndpointRecord) => void;
}) {
  const { data: userManaged } = useSWR(
    ["mobile-user-managed-endpoints"],
    listUserManagedEndpoints,
  );

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onConnectManaged}
        disabled={!signedIn || connecting}
        className="rounded-md border px-3 py-2 text-left text-sm disabled:opacity-60"
      >
        Connect to managed instance
      </button>
      {!signedIn && (
        <p className="text-xs text-muted-foreground">
          Sign in to connect to your Treq-managed instance.
        </p>
      )}
      {userManaged && userManaged.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">
            SSH hosts on this device
          </p>
          <ul className="flex flex-col gap-2">
            {userManaged.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => onConnectUserManaged(record)}
                  className="w-full rounded-md border px-3 py-2 text-left text-sm"
                >
                  <div className="font-medium">{record.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {record.username}@{record.hostname}:{record.port}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Second step: pick a repository on the connected endpoint. Lists the
 * repositories already opened on this endpoint (the device's saved
 * repository registry, `lib/remote-repository.ts`), with a free-text path
 * for anything else.
 */
export function MobileRepoPicker({
  endpoint,
  busy,
  error,
  onOpen,
}: {
  endpoint: SshEndpoint;
  busy: boolean;
  error: string | null;
  onOpen: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const generation =
    endpoint.source.type === "managed" ? endpoint.source.generation : 0;
  const { data: saved } = useSWR(
    ["mobile-saved-remote-repos", endpoint.id, generation],
    () => listSavedRepositoriesForEndpoint(endpoint.id, generation),
  );

  return (
    <div className="flex flex-col gap-2">
      {saved && saved.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">
            Repositories on this host
          </p>
          <ul className="flex flex-col gap-2">
            {saved.map((repo) => (
              <li key={repo.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(repo.canonical_remote_path)}
                  className="w-full rounded-md border px-3 py-2 text-left text-sm"
                >
                  <div className="font-medium">{repo.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {repo.canonical_remote_path}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Repository path on the instance"
        aria-label="Repository path"
        className="rounded-md border px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={() => onOpen(path.trim())}
        disabled={!path.trim() || busy}
        className="rounded-md border px-3 py-2 text-sm"
      >
        {busy ? "Inspecting..." : "Inspect repository"}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
