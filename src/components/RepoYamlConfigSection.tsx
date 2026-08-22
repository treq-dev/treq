import { useRepoYamlConfig } from "../hooks/useRepoYamlConfig";
import type { RepoYamlConfig } from "../lib/api-extra";
import { Button } from "./ui/button";

interface RepoYamlConfigSectionProps {
  repoPath: string;
}

const FIELD_LABELS: Record<
  keyof Omit<RepoYamlConfig, "included_copy_files">,
  string
> = {
  branch_name_pattern: "Branch Name Pattern",
  default_model: "Default Model",
  default_agent: "Default Agent",
  target_branch: "Target Branch",
};

function hasAnyValue(config: RepoYamlConfig): boolean {
  return (
    config.branch_name_pattern != null ||
    config.default_model != null ||
    config.default_agent != null ||
    config.target_branch != null ||
    (config.included_copy_files != null &&
      config.included_copy_files.length > 0)
  );
}

export function RepoYamlConfigSection({
  repoPath,
}: RepoYamlConfigSectionProps) {
  const { config, loading, error, reload } = useRepoYamlConfig(repoPath);

  return (
    <div
      className="space-y-3 border-t border-border pt-6"
      data-testid="repo-yaml-config-section"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">YAML Configuration</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          disabled={loading}
        >
          {loading ? "Reloading..." : "Reload"}
        </Button>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {config && hasAnyValue(config) ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Synced from .treq/config.yaml
          </p>
          <dl className="space-y-1 text-sm">
            {(
              Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>
            ).map((field) =>
              config[field] != null ? (
                <div key={field} className="flex gap-2">
                  <dt className="text-muted-foreground min-w-[160px]">
                    {FIELD_LABELS[field]}
                  </dt>
                  <dd className="font-mono">{config[field]}</dd>
                </div>
              ) : null,
            )}
            {config.included_copy_files != null &&
              config.included_copy_files.length > 0 && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground min-w-[160px]">
                    Included Copy Files
                  </dt>
                  <dd className="font-mono">
                    {config.included_copy_files.join(", ")}
                  </dd>
                </div>
              )}
          </dl>
        </div>
      ) : (
        !error && (
          <p className="text-sm text-muted-foreground">
            No .treq/config.yaml found in this repository.
          </p>
        )
      )}
    </div>
  );
}
