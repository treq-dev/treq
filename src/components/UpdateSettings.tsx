import { useState } from "react";
import useSWR from "swr";
import {
  CHECK_FOR_UPDATES_SETTING_KEY,
  useAutoUpdate,
} from "../hooks/useAutoUpdate";
import { getSetting, setSetting } from "../lib/api";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { useToast } from "./ui/toast";

/** The "Check for updates" toggle and "Check now" button in Settings. */
export const UpdateSettings: React.FC = () => {
  const { addToast } = useToast();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const { checkForUpdate } = useAutoUpdate({
    autoCheck: false,
    listenMenu: false,
  });
  const { data: savedCheckForUpdates, mutate: mutateCheckForUpdates } = useSWR(
    ["setting", CHECK_FOR_UPDATES_SETTING_KEY],
    () => getSetting(CHECK_FOR_UPDATES_SETTING_KEY),
  );
  // On unless the user turned it off. The backend reads the same key.
  const checkForUpdatesEnabled = savedCheckForUpdates !== "false";
  const handleCheckForUpdatesChange = async (enabled: boolean) => {
    const value = enabled ? "true" : "false";
    try {
      await mutateCheckForUpdates(
        async () => {
          await setSetting(CHECK_FOR_UPDATES_SETTING_KEY, value);
          return value;
        },
        { optimisticData: value, rollbackOnError: true },
      );
    } catch (error) {
      addToast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="check-for-updates">Check for updates</Label>
        <Switch
          id="check-for-updates"
          aria-label="Check for updates"
          checked={checkForUpdatesEnabled}
          onCheckedChange={(checked) =>
            void handleCheckForUpdatesChange(checked)
          }
        />
      </div>
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        When a window opens, treq asks treq.dev/version for the latest release.
        The request sends only the app version, OS, and CPU architecture. macOS
        installs updates in place. Windows and Linux link to the release page.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={checkingUpdate || !checkForUpdatesEnabled}
        onClick={async () => {
          setCheckingUpdate(true);
          try {
            await checkForUpdate();
          } finally {
            setCheckingUpdate(false);
          }
        }}
      >
        {checkingUpdate ? "Checking…" : "Check now"}
      </Button>
    </div>
  );
};
