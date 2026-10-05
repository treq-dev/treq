import { ask } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef } from "react";
import {
  type AppUpdateCheckResult,
  checkForAppUpdate,
  installAppUpdate,
} from "../lib/api";
import { useToast } from "../components/ui/toast";

type UseAutoUpdateOptions = {
  /** When false, skip the one-time automatic startup check. */
  autoCheck?: boolean;
  /** When false, do not subscribe to Help → Check for Updates…. */
  listenMenu?: boolean;
};

function isAutoUpdateDisabledInTests(): boolean {
  return (
    import.meta.env.MODE === "test" ||
    (typeof process !== "undefined" &&
      process.env.TREQ_DISABLE_AUTO_UPDATE === "1")
  );
}

/** App setting the backend reads before the check. `"false"` turns it off. */
export const CHECK_FOR_UPDATES_SETTING_KEY = "check_for_updates";

/** Release page for builds that cannot install an update in place. */
export const LATEST_RELEASE_URL =
  "https://github.com/treq-dev/treq/releases/latest";

/**
 * Checks `/version` once on startup and from Help → Check for Updates…, then
 * shows a toast when a newer release exists. macOS installs the GitHub
 * `.app.tar.gz` artifact on confirm. Windows and Linux open the release page.
 * The backend skips the request when the "Check for updates" setting is off.
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}) {
  const { autoCheck = true, listenMenu = true } = options;
  const { addToast } = useToast();
  const checkingRef = useRef(false);
  const promptedVersionRef = useRef<string | null>(null);

  const promptUpdate = (result: AppUpdateCheckResult) => {
    if (!result.available || !result.latestVersion) {
      return;
    }
    const latest = result.latestVersion;
    if (promptedVersionRef.current === latest) {
      return;
    }
    promptedVersionRef.current = latest;

    const { downloadUrl } = result;
    if (!result.installSupported || !downloadUrl) {
      addToast({
        type: "info",
        title: `Update available: v${latest}`,
        description: `You're on v${result.currentVersion}. Download the latest release from GitHub.`,
        action: {
          label: "Download",
          onClick: () => void openUrl(LATEST_RELEASE_URL),
        },
      });
      return;
    }

    addToast({
      type: "info",
      title: `Update available: v${latest}`,
      description: `You're on v${result.currentVersion}. Install the latest release?`,
      action: {
        label: "Install and restart",
        onClick: () => {
          void (async () => {
            const confirmed = await ask(
              `Download and install treq v${latest}? The app will restart when finished.`,
              {
                title: "Install update",
                kind: "info",
                okLabel: "Install",
                cancelLabel: "Later",
              },
            );
            if (!confirmed) {
              return;
            }
            addToast({
              type: "info",
              title: "Installing update…",
              description: `Downloading treq v${latest}`,
            });
            try {
              await installAppUpdate(downloadUrl);
            } catch (error) {
              addToast({
                type: "error",
                title: "Update failed",
                description:
                  error instanceof Error ? error.message : String(error),
              });
            }
          })();
        },
      },
    });
  };

  const runCheck = async (opts?: { manual?: boolean }) => {
    if (checkingRef.current) {
      return;
    }
    checkingRef.current = true;
    try {
      const result = await checkForAppUpdate();
      if (!result.checked) {
        if (opts?.manual) {
          addToast({
            type: "info",
            title: "Update checks are off",
            description:
              "Turn on Check for updates in Settings → Application to check treq.dev for a newer release.",
          });
        }
        return;
      }
      if (!result.available) {
        if (opts?.manual) {
          addToast({
            type: "success",
            title: "You're up to date",
            description: `treq v${result.currentVersion} is the latest release.`,
          });
        }
        return;
      }
      promptUpdate(result);
    } catch (error) {
      if (opts?.manual) {
        addToast({
          type: "error",
          title: "Update check failed",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // Ref mutex: reset after the awaited check completes. Not React state.
      // eslint-disable-next-line require-atomic-updates -- intentional gate unlock
      checkingRef.current = false;
    }
  };

  const runCheckRef = useRef(runCheck);
  runCheckRef.current = runCheck;

  // Automatic check once on app startup (Dashboard only).
  useEffect(() => {
    if (!autoCheck || isAutoUpdateDisabledInTests()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void runCheckRef.current();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [autoCheck]);

  // Help → Check for Updates… (manual, with feedback toasts).
  useEffect(() => {
    if (!listenMenu || isAutoUpdateDisabledInTests()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    void listen("menu-check-for-updates", () => {
      void runCheckRef.current({ manual: true });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [listenMenu]);

  return { checkForUpdate: () => runCheck({ manual: true }) };
}
