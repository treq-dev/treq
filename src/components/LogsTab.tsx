import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Loader2, Table2 } from "lucide-react";
import { Button } from "./ui/button";
import { getLogTimeseries, getRepoLogs } from "../lib/api";
import type { LogRecordView } from "../lib/api-types";
import { LogLevelFilter } from "./LogLevelFilter";
import { LogsSqlExplorer } from "./LogsSqlExplorer";
import { LogFeed } from "./LogFeed";
import { LogsTimeseriesChart } from "./LogsTimeseriesChart";
import { buildLogLinesPrompt } from "../lib/logs-prompt";

interface Props {
	repoPath: string;
	onSendToAgent?: (prompt: string) => void;
}

type View = "browse" | "explorer";

/**
 * Repo-level view of the checks log data source: browse every run's records, or
 * drop into SQL for ad-hoc questions across runs.
 */
export function LogsTab({ repoPath, onSendToAgent }: Props) {
	const [view, setView] = useState<View>("browse");
	const [levels, setLevels] = useState<string[]>([]);
	const [search, setSearch] = useState("");

	const browsing = view === "browse";
	const filters = {
		levels: levels.length > 0 ? levels : undefined,
		search: search || undefined,
	};

	const { data: records = [], isLoading } = useQuery({
		queryKey: ["repo-logs", repoPath, levels, search],
		queryFn: () => getRepoLogs(repoPath, filters),
		enabled: browsing,
	});

	const { data: buckets = [] } = useQuery({
		queryKey: ["repo-logs-timeseries", repoPath, levels, search],
		queryFn: () => getLogTimeseries(repoPath, { ...filters, bucketSeconds: 1 }),
		enabled: browsing,
	});

	function handleSendToAgent(chosen: LogRecordView[]) {
		onSendToAgent?.(buildLogLinesPrompt(chosen, "my check logs"));
	}

	return (
		<div data-testid="logs-tab" className="flex flex-col h-full">
			<div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
				<div className="flex items-center gap-2 min-w-0">
					<Database className="h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<div className="text-sm font-medium">Checks logs</div>
						<div className="text-xs text-muted-foreground font-mono truncate">
							OpenTelemetry records · .treq/runs/**/*.jsonl
						</div>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant={browsing ? "secondary" : "ghost"}
						onClick={() => setView("browse")}
					>
						<Table2 className="h-3 w-3 mr-1" />
						Browse
					</Button>
					<Button
						size="sm"
						variant={browsing ? "ghost" : "secondary"}
						onClick={() => setView("explorer")}
					>
						<Database className="h-3 w-3 mr-1" />
						Logs Explorer
					</Button>
				</div>
			</div>

			{browsing ? (
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

					{buckets.length > 0 && (
						<div className="px-2 pt-2 border-b">
							<LogsTimeseriesChart buckets={buckets} bucketSeconds={1} />
						</div>
					)}

					{isLoading ? (
						<div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading logs…
						</div>
					) : (
						<LogFeed
							records={records}
							testId="repo-logs-output"
							lineTestId="repo-log-line"
							emptyMessage="No check logs recorded yet. Run a workflow check from the Checks tab of any workspace to populate this table."
							onSendToAgent={handleSendToAgent}
							prefixColumns={[
								{
									header: "Run",
									className: "w-[5ch] text-muted-foreground",
									render: (record) => `#${record.run_id}`,
								},
								{
									header: "Job",
									className: "w-[10ch] text-blue-600 dark:text-blue-400",
									render: (record) => record.job_id,
								},
							]}
						/>
					)}
				</>
			) : (
				<LogsSqlExplorer repoPath={repoPath} onSendToAgent={onSendToAgent} />
			)}
		</div>
	);
}
