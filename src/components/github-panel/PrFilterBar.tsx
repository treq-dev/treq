import { ListFilter, Search } from "lucide-react";
import type { GhPullRequest } from "../../lib/api-types";
import {
  EMPTY_PR_FILTERS,
  type PrFilters,
  activePrFilterCount,
  prFilterOptions,
} from "../../lib/github-pr-filters";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const OPENED_OPTIONS = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-0 rounded-sm border border-input bg-background px-2 text-base"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const plain = (values: string[]) => values.map((v) => ({ label: v, value: v }));

/** Search box plus a collapsible set of AND-ed filters over the loaded PRs. */
export function PrFilterBar({
  prs,
  filters,
  onChange,
}: {
  prs: GhPullRequest[];
  filters: PrFilters;
  onChange: (filters: PrFilters) => void;
}) {
  const activeCount = activePrFilterCount(filters);
  const options = prFilterOptions(prs);
  const set = <K extends keyof PrFilters>(key: K, value: PrFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="px-4 pb-2 shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search pull requests"
            placeholder="Search pull requests"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-base gap-1",
                activeCount > 0 && "border-primary/40 bg-primary/10",
              )}
            >
              <ListFilter className="w-3.5 h-3.5" />
              Filters
              {activeCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs leading-4 text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[28rem] max-w-[calc(100vw-2rem)] p-3 grid grid-cols-2 gap-2"
          >
            <FilterSelect
              label="Author"
              value={filters.author ?? ""}
              options={plain(options.authors)}
              onChange={(v) => set("author", v || null)}
            />
            <FilterSelect
              label="Label"
              value={filters.label ?? ""}
              options={plain(options.labels)}
              onChange={(v) => set("label", v || null)}
            />
            <FilterSelect
              label="Source branch"
              value={filters.head ?? ""}
              options={plain(options.heads)}
              onChange={(v) => set("head", v || null)}
            />
            <FilterSelect
              label="Target branch"
              value={filters.base ?? ""}
              options={plain(options.bases)}
              onChange={(v) => set("base", v || null)}
            />
            <FilterSelect
              label="Stack level"
              value={filters.stackLevel?.toString() ?? ""}
              options={options.stackLevels.map((n) => ({
                label: n === 1 ? "1 (bottom)" : String(n),
                value: String(n),
              }))}
              onChange={(v) => set("stackLevel", v ? Number(v) : null)}
            />
            <FilterSelect
              label="Opened"
              value={filters.openedWithinDays?.toString() ?? ""}
              options={OPENED_OPTIONS.map((o) => ({
                label: o.label,
                value: String(o.days),
              }))}
              onChange={(v) => set("openedWithinDays", v ? Number(v) : null)}
            />
            <FilterSelect
              label="Merge conflicts"
              value={filters.conflict ?? ""}
              options={[
                { label: "Has conflicts", value: "conflicting" },
                { label: "No conflicts", value: "clean" },
              ]}
              onChange={(v) =>
                set("conflict", (v || null) as PrFilters["conflict"])
              }
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-base w-full"
                disabled={activeCount === 0}
                onClick={() =>
                  onChange({ ...EMPTY_PR_FILTERS, query: filters.query })
                }
              >
                Clear filters
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
