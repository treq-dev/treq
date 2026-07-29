import { useState } from "react";
import {
	Bot,
	ChevronDown,
	FileCode2,
	Loader2,
	Play,
	TriangleAlert,
} from "lucide-react";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { runLogsSql } from "../lib/api";
import type { SqlResult } from "../lib/api-types";
import { buildSqlResultPrompt } from "../lib/logs-prompt";

interface Props {
	repoPath: string;
	onSendToAgent?: (prompt: string) => void;
}

const DEFAULT_QUERY = `SELECT timestamp, severityText, attributes.job_id AS job_id,
       body.message AS message
FROM logs
ORDER BY timestamp DESC
LIMIT 50`;

const TEMPLATES: { label: string; description: string; sql: string }[] = [
	{
		label: "Recent lines",
		description: "Newest records across every run",
		sql: DEFAULT_QUERY,
	},
	{
		label: "Errors by job",
		description: "Which jobs produce the most ERROR records",
		sql: `SELECT attributes.job_id AS job_id, count(*) AS errors
FROM logs
WHERE severityText = 'ERROR'
GROUP BY job_id
ORDER BY errors DESC`,
	},
	{
		label: "Severity by run",
		description: "Record counts per run, split by severity",
		sql: `SELECT attributes.run_id AS run_id, severityText, count(*) AS records
FROM logs
GROUP BY run_id, severityText
ORDER BY run_id DESC, severityText`,
	},
	{
		label: "Slowest steps",
		description: "Wall-clock span of each step, longest first",
		sql: `SELECT attributes.job_id AS job_id, attributes.step_name AS step_name,
       datediff('millisecond', min(CAST(timestamp AS TIMESTAMP)),
                max(CAST(timestamp AS TIMESTAMP))) AS duration_ms
FROM logs
GROUP BY job_id, step_name
ORDER BY duration_ms DESC`,
	},
	{
		label: "Trace overview",
		description: "One row per trace and span, with severity counts",
		sql: `SELECT traceId, spanId, attributes.job_id AS job_id,
       count(*) AS records,
       count(*) FILTER (WHERE severityText = 'ERROR') AS errors
FROM logs
GROUP BY traceId, spanId, job_id
ORDER BY errors DESC, records DESC`,
	},
];

/**
 * Ad-hoc SQL over the OpenTelemetry `logs` view. The backend only accepts
 * read-only statements, so this is a browser rather than a general SQL console.
 */
export function LogsSqlExplorer({ repoPath, onSendToAgent }: Props) {
	const [sql, setSql] = useState(DEFAULT_QUERY);
	const [result, setResult] = useState<SqlResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);

	async function execute() {
		setRunning(true);
		setError(null);
		try {
			setResult(await runLogsSql(repoPath, sql));
		} catch (e) {
			setResult(null);
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
		}
	}

	return (
		<div data-testid="logs-sql-explorer" className="flex flex-col h-full">
			<div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/30">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="sm" variant="outline" data-testid="template-menu">
							<FileCode2 className="h-3 w-3 mr-1" />
							Templates
							<ChevronDown className="h-3 w-3 ml-1 opacity-60" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-72">
						{TEMPLATES.map((template) => (
							<DropdownMenuItem
								key={template.label}
								onSelect={() => setSql(template.sql)}
								className="flex flex-col items-start gap-0.5 py-2"
							>
								<span className="font-medium">{template.label}</span>
								<span className="text-xs text-muted-foreground">
									{template.description}
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<span className="text-xs text-muted-foreground">
					Read-only queries against the <code className="font-mono">logs</code>{" "}
					view.
				</span>
			</div>

			<div className="p-3 border-b">
				<textarea
					aria-label="SQL query"
					data-testid="sql-editor"
					spellCheck={false}
					value={sql}
					onChange={(e) => setSql(e.target.value)}
					rows={6}
					className="w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed resize-y"
				/>
				<div className="flex items-center justify-end gap-2 mt-2">
					{result && !error && (
						<Button
							size="sm"
							variant="outline"
							data-testid="send-resultset-to-agent"
							onClick={() => onSendToAgent?.(buildSqlResultPrompt(result, sql))}
						>
							<Bot className="h-3 w-3 mr-1" />
							Send results to agent
						</Button>
					)}
					<Button size="sm" onClick={execute} disabled={running}>
						{running ? (
							<Loader2 className="h-3 w-3 animate-spin mr-1" />
						) : (
							<Play className="h-3 w-3 mr-1" />
						)}
						Run query
					</Button>
				</div>
			</div>

			<div className="flex-1 overflow-auto">
				{error && (
					<div
						data-testid="sql-error"
						className="flex items-start gap-2 m-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
					>
						<TriangleAlert className="h-4 w-4 shrink-0 mt-px" />
						<span className="font-mono break-all">{error}</span>
					</div>
				)}

				{result && !error && (
					<>
						<div className="px-4 py-2 text-xs text-muted-foreground border-b">
							{result.row_count} row{result.row_count === 1 ? "" : "s"}
						</div>
						{result.row_count === 0 ? (
							<div className="p-4 text-sm text-muted-foreground">
								Query returned no rows.
							</div>
						) : (
							<table
								data-testid="sql-results"
								className="w-full text-left font-mono text-xs"
							>
								<thead className="sticky top-0 bg-muted">
									<tr>
										{result.columns.map((column) => (
											<th
												key={column}
												className="px-3 py-2 font-medium border-b whitespace-nowrap"
											>
												{column}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{result.rows.map((row, rowIdx) => (
										// Row order is the query's; nothing else identifies a row.
										<tr key={rowIdx} className="hover:bg-muted/50">
											{row.map((cell, cellIdx) => (
												<td
													key={`${rowIdx}-${result.columns[cellIdx] ?? cellIdx}`}
													className="px-3 py-1.5 border-b align-top whitespace-pre-wrap break-all"
												>
													{cell ?? (
														<span className="text-muted-foreground italic">
															NULL
														</span>
													)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						)}
					</>
				)}

				{!result && !error && (
					<div className="p-4 text-sm text-muted-foreground">
						Run a query to see results.
					</div>
				)}
			</div>
		</div>
	);
}
