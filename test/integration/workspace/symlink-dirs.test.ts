import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepo, resolveWorkspacePath } from "../../utils";
import * as api from "../../../src/lib/api";

describe("Symlink dirs workspace creation", () => {
	let repoPath: string;

	beforeEach(() => {
		({ repoPath } = createTestRepo(false));
		fs.mkdirSync(path.join(repoPath, "node_modules", "pkg"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(repoPath, "node_modules", "pkg", "index.js"),
			"module.exports = 1;\n",
		);
		const gitignore = path.join(repoPath, ".gitignore");
		const existing = fs.existsSync(gitignore)
			? fs.readFileSync(gitignore, "utf8")
			: "";
		if (!existing.includes("node_modules")) {
			fs.appendFileSync(gitignore, "\nnode_modules/\n");
		}
	});

	it("lists gitignored path suggestions from ignore rules and disk", async () => {
		const suggestions = await api.listGitignoredPathSuggestions(repoPath);
		expect(suggestions).toContain("node_modules");
	});

	it("symlinks configured dirs from create metadata", async () => {
		await api.createWorkspace(
			repoPath,
			"feat/symlink-int",
			undefined,
			JSON.stringify({ symlinked_dirs: ["node_modules"] }),
		);

		const workspace = (await api.getWorkspaces(repoPath)).find(
			(candidate) => candidate.branch_name === "feat/symlink-int",
		);
		expect(workspace).toBeTruthy();

		const linkPath = path.join(
			resolveWorkspacePath(repoPath, workspace!.workspace_path),
			"node_modules",
		);
		expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
		expect(fs.realpathSync(linkPath)).toBe(
			fs.realpathSync(path.join(repoPath, "node_modules")),
		);
	});
});
