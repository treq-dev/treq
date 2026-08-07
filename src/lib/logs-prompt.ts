import type { LogRecordView, SqlResult } from "./api-types";

/** Cap so a huge selection can't blow past the agent's context. */
const MAX_PROMPT_LINES = 500;

function fence(body: string): string {
	return `\`\`\`\n${body}\n\`\`\``;
}

function truncationNote(total: number, shown: number): string {
	return total > shown ? `\n\n_(${total - shown} further rows omitted.)_` : "";
}

/** Prompt for a set of log records picked out of a logs feed. */
export function buildLogLinesPrompt(
	records: LogRecordView[],
	context: string,
): string {
	const shown = records.slice(0, MAX_PROMPT_LINES);
	const body = shown
		.map(
			(r) =>
				`${r.timestamp}  [${r.severity_text}]  ${r.job_id}/${r.step_name}  ${r.body}`,
		)
		.join("\n");

	return [
		`Here are ${records.length} log line${records.length === 1 ? "" : "s"} from ${context}.`,
		"",
		fence(body),
		truncationNote(records.length, shown.length),
		"",
		"Please help me understand what went wrong and how to fix it.",
	].join("\n");
}

/** Prompt for a whole result set from the logs explorer. */
export function buildSqlResultPrompt(result: SqlResult, sql: string): string {
	const shown = result.rows.slice(0, MAX_PROMPT_LINES);
	const header = result.columns.join("\t");
	const body = shown
		.map((row) => row.map((cell) => cell ?? "NULL").join("\t"))
		.join("\n");

	return [
		"Here is the result of a query against my check logs.",
		"",
		"Query:",
		`\`\`\`sql\n${sql.trim()}\n\`\`\``,
		"",
		`Result (${result.row_count} row${result.row_count === 1 ? "" : "s"}):`,
		fence(`${header}\n${body}`),
		truncationNote(result.rows.length, shown.length),
		"",
		"Please help me interpret these results.",
	].join("\n");
}
