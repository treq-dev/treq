import { Bot, CheckSquare, Square } from "lucide-react";
import { Button } from "./ui/button";
import type { LogRecordView } from "../lib/api-types";
import { cn } from "../lib/utils";
import { useLineSelection } from "../hooks/useLineSelection";

/** Info stays uncolored so warnings and errors are what draw the eye. */
export function severityClass(severityText: string): string {
	if (severityText === "ERROR") return "text-red-600 dark:text-red-400";
	if (severityText === "WARN") return "text-amber-600 dark:text-amber-400";
	return "text-foreground";
}

export function formatTimestamp(timestamp: string): string {
	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) return timestamp;
	return parsed.toISOString().slice(11, 23);
}

/** Timestamps render as fixed HH:MM:SS.sss (12 chars), so the column can be sized exactly to fit. */
const TIMESTAMP_COL_CLASS = "w-[12ch] shrink-0 whitespace-nowrap";
/** Longest severity name (e.g. "ERROR") plus a hair of padding. */
const LEVEL_COL_CLASS = "w-[6ch] shrink-0 whitespace-nowrap";

export interface PrefixColumn {
	header: string;
	/** Fixed-width class shared between the header cell and each row's cell. */
	className: string;
	render: (record: LogRecordView) => React.ReactNode;
}

interface Props {
	records: LogRecordView[];
	/** Extra fixed-width columns shown before the message; e.g. run/job ids. */
	prefixColumns?: PrefixColumn[];
	testId: string;
	lineTestId: string;
	emptyMessage: React.ReactNode;
	/** Called with the chosen records when the user sends them to an agent. */
	onSendToAgent: (records: LogRecordView[]) => void;
}

/**
 * Selectable log feed shared by the run and repo-wide browsers.
 *
 * Dragging across lines selects a range; multi-select mode turns clicks into
 * individual toggles so non-adjacent lines can be gathered.
 */
export function LogFeed({
	records,
	prefixColumns = [],
	testId,
	lineTestId,
	emptyMessage,
	onSendToAgent,
}: Props) {
	const {
		selected,
		multiSelect,
		onLineMouseDown,
		onLineMouseEnter,
		clear,
		toggleMultiSelect,
		selectAll,
	} = useLineSelection(records.length);

	function handleSend() {
		const chosen = Array.from(selected)
			.sort((a, b) => a - b)
			.map((index) => records[index])
			.filter(Boolean);
		if (chosen.length > 0) onSendToAgent(chosen);
	}

	if (records.length === 0) {
		return (
			<div
				data-testid={testId}
				className="flex-1 overflow-auto font-mono text-xs p-3 text-muted-foreground"
			>
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs">
				<Button
					size="sm"
					variant={multiSelect ? "secondary" : "ghost"}
					data-testid="multi-select-toggle"
					aria-pressed={multiSelect}
					onClick={toggleMultiSelect}
				>
					{multiSelect ? (
						<CheckSquare className="h-3 w-3 mr-1" />
					) : (
						<Square className="h-3 w-3 mr-1" />
					)}
					Multi-select
				</Button>
				<Button size="sm" variant="ghost" onClick={selectAll}>
					Select all
				</Button>
				{selected.size > 0 && (
					<>
						<span
							data-testid="selection-count"
							className="text-muted-foreground"
						>
							{selected.size} selected
						</span>
						<Button size="sm" variant="ghost" onClick={clear}>
							Clear
						</Button>
					</>
				)}
				<div className="flex-1" />
				<Button
					size="sm"
					variant="outline"
					data-testid="send-to-agent"
					disabled={selected.size === 0}
					onClick={handleSend}
				>
					<Bot className="h-3 w-3 mr-1" />
					Send to agent
				</Button>
			</div>

			<div
				className="flex w-full gap-3 px-3 py-1 border-b bg-muted/20 font-mono text-[10px] uppercase tracking-wide text-muted-foreground select-none"
			>
				<span className={TIMESTAMP_COL_CLASS}>Timestamp</span>
				{prefixColumns.map((col) => (
					<span key={col.header} className={cn(col.className, "truncate")}>
						{col.header}
					</span>
				))}
				<span className={LEVEL_COL_CLASS}>Level</span>
				<span className="flex-1 min-w-0">Message</span>
			</div>

			<div
				data-testid={testId}
				// Drag-select would otherwise paint the browser's own text selection.
				className="flex-1 overflow-auto font-mono text-xs leading-relaxed p-3 select-none"
			>
				{records.map((record, index) => (
					<button
						type="button"
						key={`${record.run_id}-${record.job_id}-${record.timestamp}-${index}`}
						data-testid={lineTestId}
						data-level={record.severity_text}
						data-selected={selected.has(index) ? "true" : undefined}
						aria-pressed={selected.has(index)}
						onMouseDown={() => onLineMouseDown(index)}
						onMouseEnter={() => onLineMouseEnter(index)}
						className={cn(
							"flex w-full gap-3 text-left whitespace-pre-wrap break-all",
							selected.has(index) ? "bg-primary/20" : "hover:bg-muted/50",
						)}
					>
						<span
							className={cn(
								TIMESTAMP_COL_CLASS,
								"select-none text-muted-foreground tabular-nums",
							)}
						>
							{formatTimestamp(record.timestamp)}
						</span>
						{prefixColumns.map((col) => (
							<span
								key={col.header}
								className={cn(col.className, "shrink-0 select-none truncate")}
							>
								{col.render(record)}
							</span>
						))}
						<span
							className={cn(
								LEVEL_COL_CLASS,
								"select-none",
								severityClass(record.severity_text),
							)}
						>
							{record.severity_text}
						</span>
						<span
							className={cn("flex-1 min-w-0", severityClass(record.severity_text))}
						>
							{record.body}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
