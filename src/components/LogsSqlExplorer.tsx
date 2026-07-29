import { useState } from "react";
import { Loader2, Play, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { runLogsSql } from "../lib/api";
import type { SqlResult } from "../lib/api-types";

interface Props {
	repoPath: string;
}

const DEFAULT_QUERY = "SELECT * FROM logs ORDER BY run_id DESC, ts LIMIT 50";

const SAMPLE_QUERIES: { label: string; sql: string }[] = [
	{
		label: "Recent lines",
		sql: DEFAULT_QUERY,
	},
	{
		label: "Errors by job",
		sql: "SELECT job_id, count(*) AS errors\nFROM logs\nWHERE level = 'error'\nGROUP BY job_id\nORDER BY errors DESC",
	},
	{
		label: "Lines per run",
		sql: "SELECT run_id, level, count(*) AS lines\nFROM logs\nGROUP BY run_id, level\nORDER BY run_id DESC, level",
	},
];

/**
 * Ad-hoc SQL over the checks `logs` view. The backend only accepts read-only
 * statements, so this is a browser rather than a general SQL console.
 */
export function LogsSqlExplorer({ repoPath }: Props) {
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
				<span className="text-xs text-muted-foreground">Templates:</span>
				{SAMPLE_QUERIES.map((sample) => (
					<Button
						key={sample.label}
						size="sm"
						variant="ghost"
						onClick={() => setSql(sample.sql)}
					>
						{sample.label}
					</Button>
				))}
			</div>

			<div className="p-3 border-b">
				<textarea
					aria-label="SQL query"
					data-testid="sql-editor"
					spellCheck={false}
					value={sql}
					onChange={(e) => setSql(e.target.value)}
					rows={5}
					className="w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed resize-y"
				/>
				<div className="flex items-center justify-between mt-2">
					<span className="text-xs text-muted-foreground">
						Read-only queries against the{" "}
						<code className="font-mono">logs</code> view.
					</span>
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
