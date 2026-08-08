import { describe, expect, it } from "vitest";
import {
	appendPathSuggestion,
	buildCreateMetadata,
	parseNewlinePathsInput,
	parseSparsePathsInput,
} from "./workspaceMetadata";

describe("parseNewlinePathsInput", () => {
	it("splits lines, trims, and drops empties", () => {
		expect(parseNewlinePathsInput("src\n docs/guide.md \n\n")).toEqual([
			"src",
			"docs/guide.md",
		]);
	});

	it("returns undefined for blank input", () => {
		expect(parseNewlinePathsInput("")).toBeUndefined();
		expect(parseNewlinePathsInput("  \n  ")).toBeUndefined();
	});
});

describe("parseSparsePathsInput", () => {
	it("delegates to parseNewlinePathsInput", () => {
		expect(parseSparsePathsInput("src\ndocs")).toEqual(["src", "docs"]);
	});
});

describe("appendPathSuggestion", () => {
	it("appends a new suggestion on its own line", () => {
		expect(appendPathSuggestion("", "node_modules")).toBe("node_modules");
		expect(appendPathSuggestion("target", "node_modules")).toBe(
			"target\nnode_modules",
		);
	});

	it("does not duplicate an existing suggestion", () => {
		expect(appendPathSuggestion("node_modules\ntarget", "node_modules")).toBe(
			"node_modules\ntarget",
		);
	});
});

describe("buildCreateMetadata", () => {
	it("includes sparse and symlink fields when provided", () => {
		const metadata = JSON.parse(
			buildCreateMetadata({
				title: "T",
				description: "D",
				sparsePaths: "src\ndocs",
				symlinkedDirs: "node_modules\ntarget",
			}),
		);
		expect(metadata).toEqual({
			title: "T",
			description: "D",
			sparse_patterns: ["src", "docs"],
			symlinked_dirs: ["node_modules", "target"],
		});
	});

	it("omits empty fields entirely", () => {
		expect(
			buildCreateMetadata({
				title: " ",
				description: "",
				sparsePaths: "\n",
				symlinkedDirs: "",
			}),
		).toBe("{}");
	});

	it("includes moved_files when given", () => {
		const metadata = JSON.parse(
			buildCreateMetadata({
				title: "",
				description: "",
				movedFiles: ["a.rs"],
				sparsePaths: "",
			}),
		);
		expect(metadata).toEqual({ moved_files: ["a.rs"] });
	});
});
