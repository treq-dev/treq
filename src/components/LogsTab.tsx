import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Loader2, Table2 } from "lucide-react";
import { Button } from "./ui/button";
import { getRepoLogs } from "../lib/api";
import type { RepoLogLine } from "../lib/api-types";
import { cn } from "../lib/utils";
import { LogLevelFilter } from "./LogLevelFilter";
import { LogsSqlExplorer } from "./LogsSqlExplorer";
import { formatTimestamp, levelClass } from "./LogsBrowser";

interface Props {
	repoPath: string;
}

type View = "browse" | "sql";

/**
 * Repo-level view of the checks log data source: browse every run's lines, or
 * drop into SQL for ad-hoc questions across runs.
 */
export function LogsTab({ repoPath }: Props) {
	const [view, setView] = useState<View>("browse");
	const [levels, setLevels] = useState<string[]>([]);
	const [search, setSearch] = useState("");

	const { data: lines = [], isLoading } = useQuery({
		queryKey: ["repo-logs", repoPath, levels, search],
		queryFn: () =>
			getRepoLogs(repoPath, {
				levels: levels.length > 0 ? levels : undefined,
				search: search || undefined,
			}),
		enabled: view === "browse",
	});

	return (
		<div data-testid="logs-tab" className="flex flex-col h-full">
			<div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
				<div className="flex items-center gap-2 min-w-0">
					<Database className="h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<div className="text-sm font-medium">Checks logs</div>
						<div className="text-xs text-muted-foreground font-mono truncate">
							.treq/runs/**/*.jsonl
						</div>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant={view === "browse" ? "secondary" : "ghost"}
						onClick={() => setView("browse")}
					>
						<Table2 className="h-3 w-3 mr-1" />
						Browse
					</Button>
					<Button
						size="sm"
						variant={view === "sql" ? "secondary" : "ghost"}
						onClick={() => setView("sql")}
					>
						<Database className="h-3 w-3 mr-1" />
						SQL Explorer
					</Button>
				</div>
			</div>

			{view === "sql" ? (
				<LogsSqlExplorer repoPath={repoPath} />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/30">
						<LogLevelFilter value={levels} onChange={setLevels} />
						<input
							aria-label="Search logs"
							placeholder="Search all runs…"
							className="h-8 flex-1 min-w-[160px] rounded-md border bg-background px-2 text-sm"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					<div
						data-testid="repo-logs-output"
						className="flex-1 overflow-auto font-mono text-xs leading-relaxed p-3"
					>
						{isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading logs…
							</div>
						) : lines.length === 0 ? (
							<div className="text-muted-foreground">
								No check logs recorded yet. Run a workflow check from the Checks
								tab of any workspace to populate this table.
							</div>
						) : (
							lines.map((line: RepoLogLine, idx: number) => (
								<div
									key={`${line.run_id}-${line.job_id}-${line.ts}-${idx}`}
									data-testid="repo-log-line"
									data-level={line.level}
									className="flex gap-3 whitespace-pre-wrap break-all hover:bg-muted/50"
								>
									<span className="shrink-0 select-none text-muted-foreground tabular-nums">
										{formatTimestamp(line.ts)}
									</span>
									<span className="shrink-0 select-none text-muted-foreground">
										#{line.run_id}
									</span>
									<span className="shrink-0 select-none text-blue-600 dark:text-blue-400">
										{line.job_id}
									</span>
									<span className={cn("min-w-0", levelClass(line.level))}>
										{line.message}
									</span>
								</div>
							))
						)}
					</div>
				</>
			)}
		</div>
	);
}
