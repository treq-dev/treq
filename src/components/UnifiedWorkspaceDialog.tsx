import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import {
	type BranchStatus,
	type JjDiffHunk,
	type JjFileChange,
	type Workspace,
	type WorkspaceStatus,
	listGitignoredPathSuggestions,
} from "../lib/api";
import type { BranchListItem } from "./TargetBranchSelector";
import {
	type TreeLine,
	buildStackTreePreview,
	buildTreePreview,
} from "../lib/workspace-tree";
import { WorkspaceLeftPanel } from "./WorkspaceLeftPanel";
import { WorkspaceRightPanel } from "./WorkspaceRightPanel";
import { useWorkspaceDialogEffects } from "../hooks/useWorkspaceDialogEffects";
import { useWorkspaceDialogSubmit } from "../hooks/useWorkspaceDialogSubmit";

export interface WorkspaceDialogDefaults {
	/** Branch the new workspace should stack on */
	targetBranch?: string;
	/** Source workspace; null = home repo context; undefined = plain create */
	sourceWorkspace?: Workspace | null;
	/** Pre-selected commit change_ids for the Commits tab */
	preSelectedCommits?: string[];
	/** Pre-selected file paths for the Changes tab */
	preSelectedFiles?: string[];
	/** Pre-filled description text */
	description?: string;
	/** Pre-filled title text */
	title?: string;
	/** Pre-filled branch name */
	branchName?: string;
	/** Which right-panel tab to show by default */
	activeTab?: "commits" | "changes";
}

export interface UnifiedWorkspaceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	repoPath: string;
	onSuccess: (workspaceId: number) => void;
	defaults: WorkspaceDialogDefaults;
}

export const UnifiedWorkspaceDialog: React.FC<UnifiedWorkspaceDialogProps> = ({
	open,
	onOpenChange,
	repoPath,
	onSuccess,
	defaults,
}) => {
	// ── form state ──────────────────────────────────────────────────────────────
	const [description, setIntent] = useState("");
	const [title, setTitle] = useState("");
	const [sparsePaths, setSparsePaths] = useState("");
	const [symlinkedDirs, setSymlinkedDirs] = useState("");
	const [gitignoreSuggestions, setGitignoreSuggestions] = useState<string[]>(
		[],
	);
	const [branchName, setBranchName] = useState("");
	const [branchPattern, setBranchPattern] = useState("treq/{name}");
	const [isEditingBranch, setIsEditingBranch] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [branchStatusData, setBranchStatusData] = useState<BranchStatus | null>(
		null,
	);
	const [isCheckingBranch, setIsCheckingBranch] = useState(false);

	// ── target branch selector (create mode only) ────────────────────────────
	const [targetBranch, setTargetBranch] = useState<string | null>(null);
	const [availableBranches, setAvailableBranches] = useState<BranchListItem[]>(
		[],
	);
	const [branchesLoading, setBranchesLoading] = useState(false);

	// ── position toggle ──────────────────────────────────────────────────────
	const [position, setPosition] = useState<"before" | "after">("after");

	// ── right panel ──────────────────────────────────────────────────────────
	const [activeRightTab, setActiveRightTab] = useState<"commits" | "changes">(
		"commits",
	);
	const [changedFiles, setChangedFiles] = useState<JjFileChange[]>([]);
	const [fileHunksMap, setFileHunksMap] = useState<
		Map<string, { hunks: JjDiffHunk[]; isLoading: boolean }>
	>(new Map());
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
	const [selectedHunks, setSelectedHunks] = useState<Set<string>>(new Set());
	const [workspaceStatus, setWorkspaceStatus] =
		useState<WorkspaceStatus | null>(null);
	const [selectedCommits, setSelectedCommits] = useState<Set<string>>(
		new Set(),
	);
	const [dataLoading, setDataLoading] = useState(false);
	const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);

	// ── move to existing workspace ────────────────────────────────────────────
	const [moveToExisting, setMoveToExisting] = useState(false);
	const [targetWorkspaceId, setTargetWorkspaceId] = useState<number | null>(
		null,
	);

	// ── derived ──────────────────────────────────────────────────────────────
	const isHomeRepo = defaults.sourceWorkspace === null;
	const hasSourceWorkspace = defaults.sourceWorkspace !== undefined;
	const sourceWorkspace = defaults.sourceWorkspace ?? null;
	const showRightPanel = hasSourceWorkspace || isHomeRepo;
	const commitsAhead = workspaceStatus?.commits_ahead_of_target ?? [];

	const branchStatus: "new" | "local" | "remote" | "checking" | null =
		isCheckingBranch
			? "checking"
			: branchStatusData
				? branchStatusData.local_exists
					? "local"
					: branchStatusData.remote_exists
						? "remote"
						: "new"
				: null;

	// ── selections ───────────────────────────────────────────────────────────
	const toggleCommit = useCallback((changeId: string) => {
		setSelectedCommits((prev) => {
			const next = new Set(prev);
			if (next.has(changeId)) next.delete(changeId);
			else next.add(changeId);
			return next;
		});
	}, []);

	// ── hunk helpers ─────────────────────────────────────────────────────────
	const hunkKey = (filePath: string, hunkId: string) =>
		`${filePath}::${hunkId}`;

	const handleToggleFileExpand = useCallback((filePath: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) next.delete(filePath);
			else next.add(filePath);
			return next;
		});
		setFileHunksMap((prev) => {
			if (prev.has(filePath)) return prev;
			const next = new Map(prev);
			next.set(filePath, { hunks: [], isLoading: true });
			return next;
		});
	}, []);

	const getFileSelectionState = useCallback(
		(filePath: string): "all" | "some" | "none" => {
			const hunkData = fileHunksMap.get(filePath);
			if (!hunkData || hunkData.hunks.length === 0) return "none";
			const keys = hunkData.hunks.map((h) => hunkKey(filePath, h.id));
			const count = keys.filter((k) => selectedHunks.has(k)).length;
			if (count === 0) return "none";
			if (count === keys.length) return "all";
			return "some";
		},
		[fileHunksMap, selectedHunks],
	);

	const toggleFileHunks = useCallback(
		(filePath: string) => {
			const hunkData = fileHunksMap.get(filePath);
			if (!hunkData || hunkData.isLoading) {
				handleToggleFileExpand(filePath);
				return;
			}
			const allKeys = hunkData.hunks.map((h) => hunkKey(filePath, h.id));
			const allSelected =
				allKeys.length > 0 && allKeys.every((k) => selectedHunks.has(k));
			setSelectedHunks((prev) => {
				const next = new Set(prev);
				if (allSelected) allKeys.forEach((k) => next.delete(k));
				else allKeys.forEach((k) => next.add(k));
				return next;
			});
		},
		[fileHunksMap, selectedHunks, handleToggleFileExpand],
	);

	const toggleHunk = useCallback((key: string) => {
		setSelectedHunks((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const selectAllHunks = useCallback(() => {
		const allKeys: string[] = [];
		for (const [path, data] of fileHunksMap) {
			for (const hunk of data.hunks) allKeys.push(hunkKey(path, hunk.id));
		}
		setSelectedHunks(new Set(allKeys));
	}, [fileHunksMap]);

	// ── selected file paths (derived from selectedHunks) ─────────────────────
	const selectedFilePaths = useMemo(() => {
		const paths = new Set<string>();
		for (const key of selectedHunks) {
			const idx = key.indexOf("::");
			if (idx !== -1) paths.add(key.slice(0, idx));
		}
		return Array.from(paths);
	}, [selectedHunks]);

	// ── isStackOnRoot ────────────────────────────────────────────────────────
	const isStackOnRoot =
		hasSourceWorkspace &&
		sourceWorkspace !== null &&
		(!sourceWorkspace.target_branch ||
			!allWorkspaces.some(
				(w) => w.branch_name === sourceWorkspace.target_branch,
			));

	// ── tree preview ─────────────────────────────────────────────────────────
	const treePreview: TreeLine[] = (() => {
		if (sourceWorkspace) {
			if (workspaceStatus) {
				return buildTreePreview(
					workspaceStatus.dag_nodes ?? [],
					sourceWorkspace,
					{ position, newLabel: branchName || "[New Workspace]" },
				);
			}
			return buildStackTreePreview(allWorkspaces, sourceWorkspace, {
				newLabel: branchName || "[New Workspace]",
				parentBranch: sourceWorkspace.branch_name,
				position,
			});
		}
		if (targetBranch) {
			return buildStackTreePreview(allWorkspaces, null, {
				newLabel: branchName || "[New Workspace]",
				parentBranch: targetBranch,
				position,
			});
		}
		return [];
	})();

	// ── canSubmit ────────────────────────────────────────────────────────────
	const canSubmit = (() => {
		if (loading) return false;
		if (moveToExisting) {
			const hasSelection =
				activeRightTab === "commits"
					? selectedCommits.size > 0
					: selectedHunks.size > 0;
			return hasSelection && targetWorkspaceId !== null;
		}
		if (!branchName.trim()) return false;
		return true;
	})();

	// ── submitLabel ──────────────────────────────────────────────────────────
	const submitLabel = (() => {
		if (loading) return "Creating...";
		if (moveToExisting) {
			const count =
				activeRightTab === "commits"
					? selectedCommits.size
					: selectedHunks.size;
			return count > 0
				? `Move ${count} to Existing Workspace`
				: "Move to Existing Workspace";
		}
		if (
			sourceWorkspace &&
			(selectedCommits.size > 0 || selectedHunks.size > 0)
		) {
			const count = selectedCommits.size + selectedFilePaths.length;
			return `Split ${count} item${count !== 1 ? "s" : ""}`;
		}
		if (isHomeRepo && selectedHunks.size > 0) {
			return `Create with ${selectedFilePaths.length} file(s)`;
		}
		return "Create Workspace";
	})();

	const otherWorkspaces = allWorkspaces.filter(
		(w) => w.id !== sourceWorkspace?.id,
	);

	// Load gitignore suggestions for symlink chips when the create dialog opens.
	useEffect(() => {
		if (!open || sourceWorkspace) {
			setGitignoreSuggestions([]);
			return;
		}
		let cancelled = false;
		listGitignoredPathSuggestions(repoPath)
			.then((suggestions) => {
				if (!cancelled) setGitignoreSuggestions(suggestions);
			})
			.catch(() => {
				if (!cancelled) setGitignoreSuggestions([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, repoPath, sourceWorkspace]);

	// Reset advanced overlay fields when the dialog closes/reopens.
	useEffect(() => {
		if (open) {
			setSparsePaths("");
			setSymlinkedDirs("");
		}
	}, [open]);

	// ── effects (extracted to hook) ──────────────────────────────────────────
	useWorkspaceDialogEffects({
		open,
		repoPath,
		defaults,
		sourceWorkspace,
		isHomeRepo,
		description,
		title,
		branchName,
		branchPattern,
		isEditingBranch,
		moveToExisting,
		isStackOnRoot,
		position,
		fileHunksMap,
		setIntent,
		setTitle,
		setBranchName,
		setBranchPattern,
		setIsEditingBranch,
		setLoading,
		setError,
		setBranchStatusData,
		setIsCheckingBranch,
		setTargetBranch,
		setAvailableBranches,
		setBranchesLoading,
		setPosition,
		setActiveRightTab,
		setChangedFiles,
		setFileHunksMap,
		setExpandedFiles,
		setSelectedHunks,
		setWorkspaceStatus,
		setSelectedCommits,
		setDataLoading,
		setAllWorkspaces,
		setMoveToExisting,
		setTargetWorkspaceId,
	});

	// ── submit (extracted to hook) ────────────────────────────────────────────
	const { handleSubmit } = useWorkspaceDialogSubmit({
		repoPath,
		description,
		title,
		sparsePaths,
		symlinkedDirs,
		branchName,
		moveToExisting,
		isHomeRepo,
		hasSourceWorkspace,
		sourceWorkspace,
		position,
		targetBranch,
		allWorkspaces,
		branchStatusData,
		activeRightTab,
		selectedCommits,
		selectedHunks,
		selectedFilePaths,
		targetWorkspaceId,
		canSubmit,
		setLoading,
		setError,
		onSuccess,
		onOpenChange,
	});

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			handleSubmit();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			onOpenChange(false);
		}
	};

	// ── render ───────────────────────────────────────────────────────────────
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"overflow-hidden",
					showRightPanel
						? "md:min-w-[800px] md:max-w-[900px]"
						: "md:min-w-[500px]",
				)}
				onKeyDown={handleKeyDown}
			>
				<DialogHeader>
					<DialogTitle>Stack a new Workspace</DialogTitle>
					<DialogDescription>
						{sourceWorkspace
							? `Create a new workspace stacked on ${sourceWorkspace.branch_name}. Optionally move commits or file changes.`
							: isHomeRepo
								? "Create a new workspace from the current branch. Optionally move file changes."
								: "Create a new workspace for parallel development."}
					</DialogDescription>
				</DialogHeader>

				<div
					className={cn(
						"flex gap-4 mt-2",
						showRightPanel ? "min-h-[320px]" : "",
					)}
				>
					<WorkspaceLeftPanel
						showRightPanel={showRightPanel}
						sourceWorkspace={sourceWorkspace}
						hasSourceWorkspace={hasSourceWorkspace}
						isStackOnRoot={isStackOnRoot}
						availableBranches={availableBranches}
						branchesLoading={branchesLoading}
						targetBranch={targetBranch}
						onSelectTargetBranch={setTargetBranch}
						position={position}
						onSetPosition={setPosition}
						treePreview={treePreview}
						moveToExisting={moveToExisting}
						onSetMoveToExisting={setMoveToExisting}
						otherWorkspaces={otherWorkspaces}
						targetWorkspaceId={targetWorkspaceId}
						onSetTargetWorkspaceId={(id) => setTargetWorkspaceId(id)}
						description={description}
						onSetDescription={setIntent}
						title={title}
						onSetTitle={setTitle}
						sparsePaths={sparsePaths}
						onSetSparsePaths={setSparsePaths}
						symlinkedDirs={symlinkedDirs}
						onSetSymlinkedDirs={setSymlinkedDirs}
						gitignoreSuggestions={gitignoreSuggestions}
						branchName={branchName}
						onSetBranchName={setBranchName}
						onSetIsEditingBranch={setIsEditingBranch}
						branchPattern={branchPattern}
						branchStatus={branchStatus}
						loading={loading}
						allWorkspaces={allWorkspaces}
					/>

					{showRightPanel && (
						<WorkspaceRightPanel
							dataLoading={dataLoading}
							activeRightTab={activeRightTab}
							onTabChange={setActiveRightTab}
							workspaceStatus={workspaceStatus}
							changedFiles={changedFiles}
							fileHunksMap={fileHunksMap}
							expandedFiles={expandedFiles}
							selectedHunks={selectedHunks}
							selectedCommits={selectedCommits}
							onToggleCommit={toggleCommit}
							onSelectAllCommits={() =>
								setSelectedCommits(new Set(commitsAhead.map((c) => c.hash)))
							}
							onClearCommits={() => setSelectedCommits(new Set())}
							onToggleFileExpand={handleToggleFileExpand}
							onToggleFileHunks={toggleFileHunks}
							onToggleHunk={toggleHunk}
							onSelectAllHunks={selectAllHunks}
							onClearHunks={() => setSelectedHunks(new Set())}
							getFileSelectionState={getFileSelectionState}
							hunkKey={hunkKey}
						/>
					)}
				</div>

				{error && <div className="text-sm text-destructive mt-2">{error}</div>}

				<div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						{loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
						{submitLabel}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
