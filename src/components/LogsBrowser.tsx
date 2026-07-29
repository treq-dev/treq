import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { exportRunLogs, getRunLogs } from "../lib/api";
import type { LogLine } from "../lib/api-types";
import { cn } from "../lib/utils";
import { LogLevelFilter } from "./LogLevelFilter";

interface Props {
	repoPath: string;
	runId: number;
	jobId: string;
	/** Scopes the initial view to a single step when opened from a step row. */
	initialStepIndex?: number;
	onBack: () => void;
}

export { levelClass, formatTimestamp };

/** Info stays uncolored so warnings and errors are what draw the eye. */
function levelClass(level: string): string {
	if (level === "error") return "text-red-600 dark:text-red-400";
	if (level === "warning") return "text-amber-600 dark:text-amber-400";
	return "text-foreground";
}

function formatTimestamp(ts: string): string {
	const parsed = new Date(ts);
	if (Number.isNaN(parsed.getTime())) return ts;
	return parsed.toISOString().slice(11, 23);
}

export function LogsBrowser({
	repoPath,
	runId,
	jobId,
	initialStepIndex,
	onBack,
}: Props) {
	const [levels, setLevels] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [stepIndex, setStepIndex] = useState<number | undefined>(
		initialStepIndex,
	);
	const [exportedTo, setExportedTo] = useState<string | null>(null);

	const { data: lines = [], isLoading } = useQuery({
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
		for (const line of lines) {
			if (!seen.has(line.step_index)) seen.set(line.step_index, line.step_name);
		}
		return [...seen.entries()].sort((a, b) => a[0] - b[0]);
	}, [lines]);

	async function handleExport() {
		const dest = `${repoPath}/.treq/runs/${runId}/${jobId}.log`;
		const written = await exportRunLogs(repoPath, runId, jobId, dest);
		setExportedTo(written);
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

			<div
				data-testid="logs-output"
				className="flex-1 overflow-auto bg-background font-mono text-xs leading-relaxed p-3"
			>
				{isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading logs…
					</div>
				) : lines.length === 0 ? (
					<div className="text-muted-foreground">
						No log lines match the current filters.
					</div>
				) : (
					lines.map((line: LogLine, idx: number) => (
						<div
							key={`${line.ts}-${idx}`}
							data-testid="log-line"
							data-level={line.level}
							className="flex gap-3 whitespace-pre-wrap break-all hover:bg-muted/50"
						>
							<span className="shrink-0 select-none text-muted-foreground tabular-nums">
								{formatTimestamp(line.ts)}
							</span>
							<span className={cn("min-w-0", levelClass(line.level))}>
								{line.message}
							</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
