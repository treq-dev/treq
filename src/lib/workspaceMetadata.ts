// Helpers for building the workspace-creation metadata JSON sent to the
// create_workspace command (parsed by core::parse_workspace_metadata).

export function parseNewlinePathsInput(input: string): string[] | undefined {
	const paths = input
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return paths.length > 0 ? paths : undefined;
}

/** @deprecated Prefer parseNewlinePathsInput — kept for existing sparse callers. */
export function parseSparsePathsInput(input: string): string[] | undefined {
	return parseNewlinePathsInput(input);
}

export function appendPathSuggestion(
	current: string,
	suggestion: string,
): string {
	const existing = new Set(
		current
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0),
	);
	if (existing.has(suggestion)) {
		return current;
	}
	if (current.trim()) {
		return `${current.replace(/\s+$/, "")}\n${suggestion}`;
	}
	return suggestion;
}

export function buildCreateMetadata(fields: {
	title: string;
	description: string;
	movedFiles?: string[];
	sparsePaths: string;
	symlinkedDirs?: string;
}): string {
	return JSON.stringify({
		title: fields.title.trim() || undefined,
		description: fields.description.trim() || undefined,
		moved_files: fields.movedFiles,
		sparse_patterns: parseNewlinePathsInput(fields.sparsePaths),
		symlinked_dirs: parseNewlinePathsInput(fields.symlinkedDirs ?? ""),
	});
}
