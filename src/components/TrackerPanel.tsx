import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  type TrackerItem,
  trackerGetViewer,
  trackerListContainers,
  trackerListItems,
} from "../lib/api-tracker";
import type { TrackerItemAttachment } from "../lib/promptAttachments";
import { TRACKER_PROVIDERS, type TrackerProvider } from "../lib/trackers";
import { cn } from "../lib/utils";
import { TRACKER_ICONS } from "./trackerIcons";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

type ItemView = "all" | "active" | "mine";

const ITEM_VIEWS: { value: ItemView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "mine", label: "Mine" },
];

export function filterTrackerItems(
  items: TrackerItem[],
  view: ItemView,
  viewerId: string | undefined,
): TrackerItem[] {
  switch (view) {
    case "active":
      return items.filter((item) => item.status.category !== "done");
    case "mine":
      return viewerId
        ? items.filter((item) => item.assignees.some((a) => a.id === viewerId))
        : [];
    case "all":
    default:
      return items;
  }
}

/** Groups items by status name, keeping the order statuses first appear in. */
export function groupTrackerItemsByStatus(
  items: TrackerItem[],
): [string, TrackerItem[]][] {
  const groups = new Map<string, TrackerItem[]>();
  for (const item of items) {
    const name = item.status.name || "No status";
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return Array.from(groups);
}

interface TrackerPanelProps {
  provider: TrackerProvider;
  repoPath: string;
  onStartPromptFromItem?: (item: TrackerItemAttachment) => void;
}

export const TrackerPanel: React.FC<TrackerPanelProps> = ({
  provider,
  repoPath,
  onStartPromptFromItem,
}) => {
  const config = TRACKER_PROVIDERS[provider];
  const Icon = TRACKER_ICONS[provider];
  const [view, setView] = useState<ItemView>("all");
  const [containerId, setContainerId] = useState<string | undefined>(undefined);

  const {
    data: containers,
    isLoading: containersLoading,
    error: containersError,
  } = useSWR(
    repoPath ? ["tracker-containers", provider, repoPath] : null,
    async () => await trackerListContainers(provider, repoPath),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Providers without an "all" view (Trello) need a concrete container, so
  // default to the first one and hold the item fetch until the list arrives.
  const needsContainer = !config.allContainersLabel;
  const effectiveContainerId =
    containerId ?? (needsContainer ? containers?.[0]?.id : undefined);
  const itemsReady = !needsContainer || effectiveContainerId !== undefined;

  const { data: viewer } = useSWR(
    repoPath ? ["tracker-viewer", provider, repoPath] : null,
    async () => await trackerGetViewer(provider, repoPath),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const {
    data: items = [],
    isLoading: itemsLoading,
    error: itemsError,
    mutate: refetch,
  } = useSWR(
    repoPath && itemsReady
      ? ["tracker-items", provider, repoPath, effectiveContainerId]
      : null,
    async () =>
      await trackerListItems(provider, repoPath, effectiveContainerId),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const isLoading = itemsLoading || (needsContainer && containersLoading);
  const error: unknown = itemsError ?? containersError;

  const visibleItems = useMemo(
    () => filterTrackerItems(items, view, viewer?.id),
    [items, view, viewer?.id],
  );
  const groups = useMemo(
    () => groupTrackerItemsByStatus(visibleItems),
    [visibleItems],
  );

  const selectedContainer = containers?.find(
    (c) => c.id === effectiveContainerId,
  );
  const containerLabel =
    selectedContainer?.name ??
    config.allContainersLabel ??
    config.containerLabel;

  const handleKickoff = (item: TrackerItem) =>
    onStartPromptFromItem?.({
      provider,
      id: item.id,
      key: item.key,
      url: item.url,
      title: item.title,
      includeSubItems: item.sub_item_ids.length > 0,
      subItemIds: item.sub_item_ids,
    });

  return (
    <div
      className="flex h-full bg-background flex-col"
      data-testid={`${provider}-panel`}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-base font-semibold leading-tight">
            {config.label}
          </h1>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-sm"
              data-testid={`${provider}-container-selector`}
            >
              {containerLabel}
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{config.containerLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={effectiveContainerId ?? ""}>
              {config.allContainersLabel && (
                <DropdownMenuRadioItem
                  value=""
                  onSelect={() => setContainerId(undefined)}
                >
                  {config.allContainersLabel}
                </DropdownMenuRadioItem>
              )}
              {(containers ?? []).map((container) => (
                <DropdownMenuRadioItem
                  key={container.id}
                  value={container.id}
                  onSelect={() => setContainerId(container.id)}
                >
                  {container.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
        <Tabs value={view} onValueChange={(v) => setView(v as ItemView)}>
          <TabsList className="text-base">
            {ITEM_VIEWS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void refetch()}
          title="Refresh"
          aria-label="Refresh"
          disabled={isLoading}
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", isLoading && "animate-spin")}
          />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && error !== undefined && error !== null && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
            <p className="text-base text-destructive">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        )}

        {!isLoading && error == null && visibleItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
            <p className="text-base text-muted-foreground">
              No {config.itemNoun}s found
            </p>
          </div>
        )}

        {!isLoading &&
          error == null &&
          groups.map(([status, groupItems]) => (
            <section key={status}>
              <div className="flex items-baseline gap-2 px-4 pt-4 pb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                <h2>{status}</h2>
                <span>{groupItems.length}</span>
              </div>
              <div className="divide-y divide-border">
                {groupItems.map((item) => (
                  <TrackerItemRow
                    key={item.id}
                    item={item}
                    subItemNoun={config.subItemNoun}
                    showContainer={effectiveContainerId === undefined}
                    onKickoff={handleKickoff}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
};

const TrackerItemRow: React.FC<{
  item: TrackerItem;
  subItemNoun: string;
  showContainer: boolean;
  onKickoff: (item: TrackerItem) => void;
}> = ({ item, subItemNoun, showContainer, onKickoff }) => (
  <div
    className="flex items-start gap-2 px-4 py-3 hover:bg-muted/50 transition-colors"
    data-testid="tracker-item-row"
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {item.key}
        </a>
        {showContainer && item.container && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {item.container.key ?? item.container.name}
          </span>
        )}
        {item.assignees.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {item.assignees.map((a) => a.name).join(", ")}
          </span>
        )}
      </div>
      <p className="text-base mt-1 truncate">{item.title}</p>
      {item.description && (
        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
          {item.description}
        </p>
      )}
      {item.labels.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {item.labels.map((label) => (
            <span
              key={label}
              className="text-xs px-1.5 py-0.5 rounded-md border border-border text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
    <Button
      size="sm"
      variant="outline"
      className="shrink-0"
      onClick={() => onKickoff(item)}
      title={
        item.sub_item_ids.length > 0
          ? `Open a workspace for ${item.key} and its ${subItemNoun}`
          : `Open a workspace for ${item.key}`
      }
    >
      Kick off
    </Button>
  </div>
);
