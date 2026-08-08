import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { getRepoSetting, setRepoSetting } from "../lib/api";
import { useToast } from "./ui/toast";

interface RepositorySettingsContentProps {
	repoPath: string;
	onSavingChange?: (saving: boolean) => void;
}

export interface RepositorySettingsContentHandle {
	save: () => Promise<void>;
}

export const RepositorySettingsContent = forwardRef<
	RepositorySettingsContentHandle,
	RepositorySettingsContentProps
>(({ repoPath, onSavingChange }, ref) => {
	const [branchNamePattern, setBranchNamePattern] = useState("treq/{name}");
	const [includedFiles, setIncludedFiles] = useState("");
	const [symlinkedDirs, setSymlinkedDirs] = useState("");
	const [defaultModel, setDefaultModel] = useState<string>("");
	const [defaultAgent, setDefaultAgent] = useState<string>("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [availableFiles, setAvailableFiles] = useState<string[]>([]);
	const { addToast } = useToast();

	// Load settings and available gitignored files when repo path changes
	useEffect(() => {
		if (repoPath) {
			setLoading(true);
			setError(null);

			Promise.all([
				getRepoSetting(repoPath, "branch_name_pattern"),
				getRepoSetting(repoPath, "included_copy_files"),
				getRepoSetting(repoPath, "symlinked_dirs"),
				getRepoSetting(repoPath, "default_model"),
				getRepoSetting(repoPath, "default_agent"),
			])
				.then(
					([
						branchPattern,
						includedPatterns,
						symlinkedPatterns,
						model,
						agent,
					]) => {
						setBranchNamePattern(branchPattern || "treq/{name}");
						setIncludedFiles(includedPatterns || "");
						setSymlinkedDirs(symlinkedPatterns || "");
						setDefaultModel(model || "");
						setDefaultAgent(agent || "");
						// Note: gitignored files listing removed - was git-specific
						setAvailableFiles([]);
					},
				)
				.catch((err) => {
					setError(`Failed to load settings: ${err}`);
					setBranchNamePattern("treq/{name}");
					setIncludedFiles("");
					setSymlinkedDirs("");
					setDefaultModel("");
					setDefaultAgent("");
					setAvailableFiles([]);
				})
				.finally(() => {
					setLoading(false);
				});
		}
	}, [repoPath]);

	const handleSave = async () => {
		onSavingChange?.(true);
		setError(null);

		try {
			await Promise.all([
				setRepoSetting(repoPath, "branch_name_pattern", branchNamePattern),
				setRepoSetting(repoPath, "included_copy_files", includedFiles),
				setRepoSetting(repoPath, "symlinked_dirs", symlinkedDirs),
				setRepoSetting(repoPath, "default_model", defaultModel),
				setRepoSetting(repoPath, "default_agent", defaultAgent),
			]);
			addToast({
				title: "Settings saved",
				description: "Repository settings have been updated successfully.",
				type: "success",
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			setError(`Failed to save settings: ${errorMsg}`);
			addToast({
				title: "Error",
				description: `Failed to save settings: ${errorMsg}`,
				type: "error",
			});
		} finally {
			onSavingChange?.(false);
		}
	};

	useImperativeHandle(ref, () => ({ save: handleSave }));

	const addPattern = (pattern: string) => {
		if (includedFiles.trim()) {
			setIncludedFiles(`${includedFiles}\n${pattern}`);
		} else {
			setIncludedFiles(pattern);
		}
	};

	if (loading) {
		return (
			<div className="py-8 text-center text-muted-foreground">
				Loading settings...
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<Label htmlFor="branch-name-pattern">Branch Name Pattern</Label>
				<Input
					id="branch-name-pattern"
					value={branchNamePattern}
					onChange={(e) => setBranchNamePattern(e.target.value)}
					placeholder="treq/{name}"
					className="mt-2 font-mono"
				/>
				<p className="text-sm text-muted-foreground mt-1">
					treq/{"{name}"} → treq/add-dark-mode
				</p>
			</div>

			<div>
				<Label htmlFor="included-files">Included Files/Directories</Label>
				<Textarea
					id="included-files"
					value={includedFiles}
					onChange={(e) => setIncludedFiles(e.target.value)}
					placeholder="e.g., .env&#10;.env.local"
					rows={4}
					className="font-mono text-sm mt-2"
				/>
				<p className="text-sm text-muted-foreground mt-1">
					Paths to copy into each new workspace (e.g. .env). Prefer symlinks
					below for large directories.
				</p>
				{availableFiles.length > 0 && (
					<div className="flex flex-wrap gap-2 mt-2">
						{availableFiles.map((file) => (
							<Button
								key={file}
								type="button"
								variant="outline"
								size="sm"
								onClick={() => addPattern(file)}
								className="text-sm h-7"
							>
								+ {file}
							</Button>
						))}
					</div>
				)}
				{availableFiles.length === 0 && !loading && (
					<p className="text-sm text-muted-foreground italic mt-2">
						No .gitignored files found in repository root
					</p>
				)}
			</div>

			<div>
				<Label htmlFor="symlinked-dirs">Symlinked Directories</Label>
				<Textarea
					id="symlinked-dirs"
					value={symlinkedDirs}
					onChange={(e) => setSymlinkedDirs(e.target.value)}
					placeholder="e.g., node_modules&#10;target&#10;.venv"
					rows={4}
					className="font-mono text-sm mt-2"
				/>
				<p className="text-sm text-muted-foreground mt-1">
					Heavy directories to symlink from the home repo into each new
					workspace instead of copying (e.g. node_modules, target, .venv).
				</p>
			</div>

			<div>
				<Label htmlFor="repo-default-model">Claude Code Model</Label>
				<select
					id="repo-default-model"
					value={defaultModel}
					onChange={(e) => setDefaultModel(e.target.value)}
					className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
				>
					<option value="">Use Application Default</option>
					<option value="sonnet">Sonnet</option>
					<option value="opus">Opus</option>
					<option value="haiku">Haiku</option>
					<option value="sonnet[1m]">Sonnet (1M)</option>
					<option value="opusplan">Opus Plan</option>
				</select>
				<p className="text-sm text-muted-foreground mt-1">
					Default model for new Claude Code sessions in this repository
					(overrides application default)
				</p>
			</div>

			<div>
				<Label htmlFor="repo-default-agent">Default Agent</Label>
				<select
					id="repo-default-agent"
					value={defaultAgent}
					onChange={(e) => setDefaultAgent(e.target.value)}
					className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-foreground"
				>
					<option value="">Use Application Default</option>
					<option value="claude">Claude</option>
					<option value="codex">Codex</option>
					<option value="cursor">Cursor</option>
				</select>
				<p className="text-sm text-muted-foreground mt-1">
					Default agent for new sessions in this repository (overrides
					application default)
				</p>
			</div>

			{error && <div className="text-sm text-destructive">{error}</div>}
		</div>
	);
});

RepositorySettingsContent.displayName = "RepositorySettingsContent";
