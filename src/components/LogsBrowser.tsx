import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { exportRunLogs, getRunLogs } from "../lib/api";
import type { LogBucket, LogRecordView } from "../lib/api-types";
import { LogLevelFilter } from "./LogLevelFilter";
import { LogFeed } from "./LogFeed";
import { LogsTimeseriesChart } from "./LogsTimeseriesChart";
import { buildLogLinesPrompt } from "../lib/logs-prompt";

interface Props {
	repoPath: string;
	runId: number;
	jobId: string;
	/** Scopes the initial view to a single step when opened from a step row. */
	initialStepIndex?: number;
	onBack: () => void;
	onSendToAgent?: (prompt: string) => void;
}

export function LogsBrowser({
	repoPath,
	runId,
	jobId,
	initialStepIndex,
	onBack,
	onSendToAgent,
}: Props) {
	const [levels, setLevels] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [stepIndex, setStepIndex] = useState<number | undefined>(
		initialStepIndex,
	);
	const [exportedTo, setExportedTo] = useState<string | null>(null);

	const { data: records = [], isLoading } = useQuery({
		queryKey: ["run-logs", repoPath, runId, jobId, levels, search, stepIndex],
		queryFn: () =>
			getRunLogs(repoPath, runId, jobId, {
				levels: levels.length > 0 ? levels : undefined,
				search: search || undefined,
				stepIndex,
			}),
	});

	// Step names for the step filter, in first-seen order.
	const steps = useMemo(() => {
		const seen = new Map<number, string>();
		for (const record of records) {
			if (!seen.has(record.step_index)) {
				seen.set(record.step_index, record.step_name);
			}
		}
		return [...seen.entries()].sort((a, b) => a[0] - b[0]);
	}, [records]);

	// This job's records are already loaded, so bucket them here rather than
	// paying for a second round trip.
	const buckets = useMemo<LogBucket[]>(() => {
		const counts = new Map<string, LogBucket>();
		for (const record of records) {
			const bucket = `${record.timestamp.slice(0, 19)}Z`;
			const key = `${bucket}|${record.severity_text}`;
			const existing = counts.get(key);
			if (existing) {
				existing.count += 1;
			} else {
				counts.set(key, {
					bucket,
					severity_text: record.severity_text,
					count: 1,
				});
			}
		}
		return [...counts.values()];
	}, [records]);

	async function handleExport() {
		const dest = `${repoPath}/.treq/runs/${runId}/${jobId}.log`;
		setExportedTo(await exportRunLogs(repoPath, runId, jobId, dest));
	}

	function handleSendToAgent(chosen: LogRecordView[]) {
		onSendToAgent?.(
			buildLogLinesPrompt(chosen, `job "${jobId}" of check run #${runId}`),
		);
	}

	return (
		<div data-testid="logs-browser" className="flex flex-col h-full">
			<div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
				<div className="flex items-center gap-2 min-w-0">
					<Button size="sm" variant="ghost" onClick={onBack}>
						<ArrowLeft className="h-4 w-4 mr-1" />
						Back
					</Button>
					<div className="min-w-0">
						<div className="text-sm font-medium truncate">{jobId}</div>
						<div className="text-xs text-muted-foreground">Run #{runId}</div>
					</div>
				</div>
				<Button size="sm" variant="outline" onClick={handleExport}>
					<Download className="h-3 w-3 mr-1" />
					Export
				</Button>
			</div>

			<div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/30">
				<LogLevelFilter value={levels} onChange={setLevels} />

				{steps.length > 1 && (
					<select
						aria-label="Filter by step"
						className="h-8 rounded-md border bg-background px-2 text-sm"
						value={stepIndex ?? ""}
						onChange={(e) =>
							setStepIndex(
								e.target.value === "" ? undefined : Number(e.target.value),
							)
						}
					>
						<option value="">All steps</option>
						{steps.map(([idx, name]) => (
							<option key={idx} value={idx}>
								{name}
							</option>
						))}
					</select>
				)}

				<input
					aria-label="Search logs"
					placeholder="Search logs…"
					className="h-8 flex-1 min-w-[160px] rounded-md border bg-background px-2 text-sm"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{exportedTo && (
				<div className="px-4 py-2 text-xs text-muted-foreground border-b">
					Exported to <code className="font-mono">{exportedTo}</code>
				</div>
			)}

			{records.length > 0 && (
				<div className="px-2 pt-2 border-b">
					<LogsTimeseriesChart buckets={buckets} />
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
					testId="logs-output"
					lineTestId="log-line"
					emptyMessage="No log lines match the current filters."
					onSendToAgent={handleSendToAgent}
				/>
			)}
		</div>
	);
}
