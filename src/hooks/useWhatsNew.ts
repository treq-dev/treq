import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";
import useSWR from "swr";
import { useToast } from "../components/ui/toast";
import { getSetting, setSetting } from "../lib/api";
import { useMutation } from "./useMutation";

// Kept in the app settings database rather than localStorage: it is the store
// the other app-wide settings use, and it outlives a cleared WebView cache.
const LAST_SEEN_VERSION_KEY = "last_seen_app_version";
const CHANGELOG_URL = "https://treq.dev/changelog";

type SeenVersions = { version: string; lastSeen: string | null };

/** True when dotted version `a` is newer than `b` ("0.10.0" > "0.9.0"). */
function isNewerVersion(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { numeric: true }) > 0;
}

/**
 * On the first launch after an update, shows "Updated to vX.Y.Z" with a link
 * to the changelog. A fresh install records its version and shows nothing.
 */
export function useWhatsNew(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const { addToast } = useToast();

  const { data, mutate } = useSWR<SeenVersions>(
    enabled ? ["whats-new", LAST_SEEN_VERSION_KEY] : null,
    async () => {
      const [version, lastSeen] = await Promise.all([
        getVersion(),
        getSetting(LAST_SEEN_VERSION_KEY),
      ]);
      return { version, lastSeen };
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const recordVersion = useMutation({
    mutationFn: (version: string) => setSetting(LAST_SEEN_VERSION_KEY, version),
    // Mark the cached read as seen so a remount cannot repeat the toast.
    onSuccess: (_, version) => {
      void mutate({ version, lastSeen: version }, { revalidate: false });
    },
  });

  useEffect(() => {
    if (!data) return;
    const { version, lastSeen } = data;
    if (lastSeen && !isNewerVersion(version, lastSeen)) return;
    recordVersion.mutate(version);
    if (!lastSeen) return;
    addToast({
      type: "info",
      title: `Updated to v${version}`,
      action: {
        label: "What's new",
        onClick: () => void openUrl(CHANGELOG_URL),
      },
    });
    // React to each read only: recordVersion is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}
