import { BookOpen, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  installSkill,
  listInstalledSkills,
  listSkillCatalog,
  setSkillInstallScope,
  uninstallSkill,
  type SkillCatalogSkill,
  type SkillInstallScope,
} from "../lib/api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useToast } from "./ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

type ScopeFilter = "all" | SkillInstallScope;

interface SkillLibrarySettingsProps {
  repoPath: string;
  catalogUrl?: string | null;
}

function skillMatches(skill: SkillCatalogSkill, query: string): boolean {
  if (!query.trim()) return true;
  const haystack =
    `${skill.name} ${skill.description ?? ""} ${skill.source} ${skill.category ?? ""}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function skillMatchesScope(
  skill: SkillCatalogSkill,
  filter: ScopeFilter,
): boolean {
  if (filter === "all") return true;
  return skill.installed?.scope === filter;
}

export function SkillLibrarySettings({
  repoPath,
  catalogUrl,
}: SkillLibrarySettingsProps) {
  const { addToast } = useToast();
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR(
    ["skill-catalog", repoPath, catalogUrl ?? ""],
    () => listSkillCatalog(repoPath, catalogUrl),
  );
  const { data: installed, mutate: mutateInstalled } = useSWR(
    ["installed-skills", repoPath],
    () => listInstalledSkills(repoPath),
  );

  const skills = useMemo(() => {
    const list = data?.skills ?? [];
    return list.filter(
      (skill) =>
        skillMatches(skill, query) && skillMatchesScope(skill, scopeFilter),
    );
  }, [data?.skills, query, scopeFilter]);

  async function runAction(skillId: string, action: () => Promise<unknown>) {
    setPendingId(skillId);
    try {
      await action();
      await Promise.all([mutate(), mutateInstalled()]);
    } catch (err) {
      addToast({
        title: "Skill library",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="skill-library-settings">
      <div>
        <h2 className="text-base font-semibold">Skill library</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Browse the Treq skill registry and install skills into this
          application or the current repository. Installed skills are copied
          into new workspaces after checksum verification.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {installed?.length ?? 0} installed
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="skill-library-search">Search skills</Label>
          <Input
            id="skill-library-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or description"
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="skill-library-scope-filter">Install level</Label>
          <select
            id="skill-library-scope-filter"
            aria-label="Filter by install level"
            className="mt-2 block w-full min-w-[10rem] px-2 py-1.5 border rounded-md bg-background text-sm"
            value={scopeFilter}
            onChange={(event) =>
              setScopeFilter(event.target.value as ScopeFilter)
            }
          >
            <option value="all">All</option>
            <option value="application">Application</option>
            <option value="repository">Repository</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading skill registry…
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {!isLoading && !error && skills.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No skills match this search.
        </p>
      )}

      <ul className="space-y-3">
        {skills.map((skill) => (
          <SkillRow
            key={skill.id}
            skill={skill}
            busy={pendingId === skill.id}
            onInstall={(scope) =>
              runAction(skill.id, () =>
                installSkill(skill.id, scope, repoPath, catalogUrl),
              )
            }
            onUninstall={() =>
              runAction(skill.id, () => uninstallSkill(skill.id, repoPath))
            }
            onScope={(scope) =>
              runAction(skill.id, () =>
                setSkillInstallScope(skill.id, scope, repoPath),
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}

function SkillRow({
  skill,
  busy,
  onInstall,
  onUninstall,
  onScope,
}: {
  skill: SkillCatalogSkill;
  busy: boolean;
  onInstall: (scope: SkillInstallScope) => void;
  onUninstall: () => void;
  onScope: (scope: SkillInstallScope) => void;
}) {
  const { installed } = skill;
  const [installOpen, setInstallOpen] = useState(false);

  function chooseScope(scope: SkillInstallScope) {
    setInstallOpen(false);
    onInstall(scope);
  }

  return (
    <li className="relative border rounded-md p-3 pr-12 space-y-2">
      {installed && (
        <div className="absolute top-2 right-2">
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={onUninstall}
                  aria-label={`Uninstall ${skill.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Uninstall</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{skill.name}</p>
            <span className="text-xs text-muted-foreground">
              {skill.source}
            </span>
          </div>
          {skill.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {skill.description}
            </p>
          )}
        </div>
        {skill.url && (
          <a
            href={skill.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground mr-6"
            aria-label={`Open ${skill.name} source`}
          >
            <BookOpen className="h-4 w-4" />
          </a>
        )}
      </div>
      {skill.proprietary ? (
        <p className="text-sm text-muted-foreground">
          Proprietary skills cannot be installed from the registry.
        </p>
      ) : installed ? (
        <div className="flex items-center justify-end gap-2">
          <Label htmlFor={`scope-${skill.id}`} className="text-sm">
            Install level
          </Label>
          <select
            id={`scope-${skill.id}`}
            aria-label={`Install level for ${skill.name}`}
            className="px-2 py-1 border rounded-md bg-background text-sm"
            value={installed.scope}
            disabled={busy}
            onChange={(event) =>
              onScope(event.target.value as SkillInstallScope)
            }
          >
            <option value="application">Application</option>
            <option value="repository">Repository</option>
          </select>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => setInstallOpen(true)}
            >
              Install…
            </Button>
          </div>
          <Dialog open={installOpen} onOpenChange={setInstallOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Install {skill.name}</DialogTitle>
                <DialogDescription>
                  Choose whether this skill is stored for every repository on
                  this machine, or only for the current repository.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm py-2">
                <p>
                  <span className="font-medium">Repository</span> writes the
                  skill under <code className="text-xs">.treq/skills/</code> in
                  this repository. Only this repository uses it.
                </p>
                <p>
                  <span className="font-medium">Application</span> writes the
                  skill into Treq application data. Every repository on this
                  machine can use it.
                </p>
              </div>
              <div className="flex flex-nowrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInstallOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => chooseScope("application")}
                >
                  Install for application
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => chooseScope("repository")}
                >
                  Install for repository
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </li>
  );
}
