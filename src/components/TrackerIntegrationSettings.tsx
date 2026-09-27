import { Loader2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { getRepoSetting, setRepoSetting } from "../lib/api";
import { trackerStartAutoKickoffPolling } from "../lib/api-tracker";
import {
  TRACKER_PROVIDERS,
  type TrackerProvider,
  type TrackerSettingField,
  trackerSettingKey,
} from "../lib/trackers";
import { useToastStore } from "../stores/toastStore";
import { TRACKER_ICONS } from "./trackerIcons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface TrackerIntegrationSettingsProps {
  provider: TrackerProvider;
  repoPath?: string;
}

export const TrackerIntegrationSettings: React.FC<
  TrackerIntegrationSettingsProps
> = ({ provider, repoPath }) => {
  const config = TRACKER_PROVIDERS[provider];
  const Icon = TRACKER_ICONS[provider];

  if (!repoPath) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Select a repository to configure {config.label} integration
      </div>
    );
  }

  return (
    <section data-testid={`${provider}-integration-settings`}>
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Icon className="w-5 h-5" />
        <h3 className="font-semibold">{config.label}</h3>
        <span className="text-base text-muted-foreground">
          Issue tracker integration
        </span>
      </div>
      <div className="divide-y divide-border">
        {config.settings.map((field) => (
          <TrackerSettingRow
            key={field.key}
            provider={provider}
            repoPath={repoPath}
            field={field}
          />
        ))}
      </div>
    </section>
  );
};

const TrackerSettingRow: React.FC<{
  provider: TrackerProvider;
  repoPath: string;
  field: TrackerSettingField;
}> = ({ provider, repoPath, field }) => {
  const { addToast } = useToastStore();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const settingKey = trackerSettingKey(provider, field.key);
  const { data: stored, mutate } = useSWR(
    ["tracker-setting", repoPath, settingKey],
    async () => await getRepoSetting(repoPath, settingKey),
    // dedupingInterval: 0 so a quick remount reads the persisted value
    // instead of reusing a stale empty result.
    { revalidateOnFocus: false, dedupingInterval: 0 },
  );
  const hasValue = Boolean(stored?.trim());

  const handleSave = async () => {
    const value = draft.trim();
    try {
      setSaving(true);
      await setRepoSetting(repoPath, settingKey, value);
      await mutate(value, { revalidate: false });
      setEditing(false);
      if (field.key === "auto_kickoff_label" && value) {
        void trackerStartAutoKickoffPolling(provider, repoPath).catch(
          () => undefined,
        );
      }
      addToast({ title: `${field.title} saved`, type: "success" });
    } catch (err) {
      addToast({
        title: `Error saving ${field.title.toLowerCase()}`,
        description: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const summary = !hasValue
    ? field.description
    : field.secret
      ? "Configured"
      : stored!;

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{field.title}</p>
        <p className="text-base text-muted-foreground truncate">{summary}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {editing ? (
          <>
            <Input
              aria-label={`${TRACKER_PROVIDERS[provider].label} ${field.title}`}
              type={field.secret ? "password" : "text"}
              placeholder={field.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-64"
              disabled={saving}
            />
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : null}
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${hasValue ? "Update" : "Add"} ${TRACKER_PROVIDERS[provider].label} ${field.title}`}
            onClick={() => {
              setDraft(field.secret ? "" : (stored ?? ""));
              setEditing(true);
            }}
          >
            {hasValue ? "Update" : "Add"}
          </Button>
        )}
      </div>
    </div>
  );
};
