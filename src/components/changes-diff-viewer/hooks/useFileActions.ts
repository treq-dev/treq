import {
	useIsMutating,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState } from "react";
import {
	createPrMutationKey,
	useGitRemoteInfo,
	usePrInfoViaGh,
} from "../../../hooks/useMergeQueueStatus";
import {
	createCommit,
	discardWorkspaceChanges,
	discardWorkspaceFile,
	getWorkspaceFileLines,
	ghCreatePr,
	jjRestoreSnapshot,
	jjSnapshotWorkingCopy,
	jjSplit,
	pushWorkspaceToRemote,
} from "../../../lib/api";
import type { Workspace } from "../../../lib/api-types";
import type { useToast } from "../../ui/toast";
import type { CommitAction, DiffLineSelection, FileHunksData } from "../types";
import { computeHunkLineNumbers, parseHunkHeader } from "../utils";

interface UseFileActionsParams {
	workspacePath: string;
	repoPath: string | undefined;
	workspaceId: number | undefined;
	workspace: Workspace | null | undefined;
	baseBranch: string | undefined;
	readOnly: boolean;
	selectedUnstagedFiles: Set<string>;
	stagedFiles: Set<string>;
	setStagedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
	setSelectedUnstagedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
	allFileHunks: Map<string, FileHunksData>;
	diffLineSelection: DiffLineSelection | null;
	setContextMenuPosition: (pos: { x: number; y: number } | null) => void;
	invalidateCache: () => Promise<void>;
	loadChangedFiles: () => Promise<void>;
	refreshCommittedChanges: () => void;
	setCommittedSectionCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
	addToast: ReturnType<typeof useToast>["addToast"];
}

export function useFileActions({
	workspacePath,
	repoPath,
	workspaceId,
	workspace,
	baseBranch,
	readOnly,
	selectedUnstagedFiles,
	stagedFiles,
	setStagedFiles,
	setSelectedUnstagedFiles,
	allFileHunks,
	diffLineSelection,
	setContextMenuPosition,
	invalidateCache,
	loadChangedFiles,
	refreshCommittedChanges,
	setCommittedSectionCollapsed,
	addToast,
}: UseFileActionsParams) {
	const [fileActionTarget, setFileActionTarget] = useState<string | null>(null);
	const [expandedContext, setExpandedContext] = useState<Map<string, string[]>>(
		new Map(),
	);
	const [localPendingAction, setPendingAction] = useState<
		"commit" | "push" | null
	>(null);
	const queryClient = useQueryClient();
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);
	const { data: prInfo } = usePrInfoViaGh(repoPath, workspace?.branch_name);
	const canCreatePr = !!remoteInfo && !prInfo && !!workspace && !!baseBranch;

	// Shared across surfaces (this dropdown item and the header's Create PR
	// button) so either one's in-flight PR creation shows as pending here too.
	const createPrActive =
		useIsMutating({ mutationKey: createPrMutationKey(repoPath, workspaceId) }) >
		0;
	const pendingAction: CommitAction | null = createPrActive
		? "pr"
		: localPendingAction;

	const handleUndoDiscard = useCallback(
		async (snapshotId: string) => {
			try {
				await jjRestoreSnapshot(workspacePath, snapshotId);
				await invalidateCache();
				await loadChangedFiles();
				addToast({
					description: "Discarded changes have been restored",
					title: "Restored",
					type: "success",
				});
			} catch (error) {
				addToast({
					description: error instanceof Error ? error.message : String(error),
					title: "Undo Failed",
					type: "error",
				});
			}
		},
		[workspacePath, addToast, invalidateCache, loadChangedFiles],
	);

	const handleDiscardAll = useCallback(async () => {
		if (readOnly) return;
		try {
			const snapshotId = await jjSnapshotWorkingCopy(workspacePath);
			await discardWorkspaceChanges(workspacePath);
			addToast({
				description: "All changes discarded",
				title: "Discarded",
				type: "success",
				action: {
					label: "Undo",
					onClick: () => handleUndoDiscard(snapshotId),
				},
			});
			await invalidateCache();
			await loadChangedFiles();
		} catch (error) {
			addToast({
				description: error instanceof Error ? error.message : String(error),
				title: "Discard All Failed",
				type: "error",
			});
		}
	}, [
		workspacePath,
		readOnly,
		addToast,
		invalidateCache,
		loadChangedFiles,
		handleUndoDiscard,
	]);

	const handleDiscardFiles = useCallback(
		async (filePath: string) => {
			if (readOnly || !filePath) return;
			const filesToDiscard =
				selectedUnstagedFiles.has(filePath) && selectedUnstagedFiles.size > 0
					? Array.from(selectedUnstagedFiles)
					: [filePath];
			setFileActionTarget(filePath);
			try {
				const snapshotId = await jjSnapshotWorkingCopy(workspacePath);
				await Promise.all(
					filesToDiscard.map((file) =>
						discardWorkspaceFile(workspacePath, file),
					),
				);
				const count = filesToDiscard.length;
				addToast({
					description:
						count === 1
							? `${filesToDiscard[0]} discarded`
							: `${count} files discarded`,
					title: "Discarded",
					type: "success",
					action: {
						label: "Undo",
						onClick: () => handleUndoDiscard(snapshotId),
					},
				});
				setSelectedUnstagedFiles(new Set());
				await invalidateCache();
				await loadChangedFiles();
			} catch (error) {
				addToast({
					description: error instanceof Error ? error.message : String(error),
					title: "Discard Failed",
					type: "error",
				});
			} finally {
				setFileActionTarget(null);
			}
		},
		[
			readOnly,
			selectedUnstagedFiles,
			addToast,
			invalidateCache,
			loadChangedFiles,
			workspacePath,
			setSelectedUnstagedFiles,
			handleUndoDiscard,
		],
	);

	const handleCopyLineLocation = useCallback(async () => {
		try {
			if (!diffLineSelection || diffLineSelection.lines.length === 0) return;
			const { filePath } = diffLineSelection;
			const fileData = allFileHunks.get(filePath);
			if (!fileData) return;
			let minLineNum = Infinity;
			let maxLineNum = -Infinity;
			for (const line of diffLineSelection.lines) {
				const hunk = fileData.hunks[line.hunkIndex];
				if (!hunk) continue;
				const lineNumbers = computeHunkLineNumbers(hunk);
				const lineNum =
					lineNumbers[line.lineIndex]?.new ??
					lineNumbers[line.lineIndex]?.old ??
					line.lineIndex + 1;
				minLineNum = Math.min(minLineNum, lineNum);
				maxLineNum = Math.max(maxLineNum, lineNum);
			}
			const locationStr =
				minLineNum === maxLineNum
					? `${filePath}:${minLineNum}`
					: `${filePath}:${minLineNum}-${maxLineNum}`;
			await navigator.clipboard.writeText(locationStr);
			setContextMenuPosition(null);
			addToast({
				title: "Copied",
				description: "Line location copied to clipboard",
				type: "success",
			});
		} catch (error) {
			setContextMenuPosition(null);
			addToast({
				description: error instanceof Error ? error.message : String(error),
				title: "Failed to copy",
				type: "error",
			});
		}
	}, [diffLineSelection, allFileHunks, addToast, setContextMenuPosition]);

	const handleCopyLines = useCallback(async () => {
		try {
			const lineContents =
				diffLineSelection?.lines?.map((l) => l.content).join("\n") || "";
			if (!lineContents) {
				setContextMenuPosition(null);
				return;
			}
			await navigator.clipboard.writeText(lineContents);
			setContextMenuPosition(null);
			addToast({
				title: "Copied",
				description: "Lines copied to clipboard",
				type: "success",
			});
		} catch (error) {
			setContextMenuPosition(null);
			addToast({
				description: error instanceof Error ? error.message : String(error),
				title: "Failed to copy",
				type: "error",
			});
		}
	}, [diffLineSelection, addToast, setContextMenuPosition]);

	const performCommit = useCallback(
		async (commitMsg: string): Promise<boolean> => {
			if (!commitMsg) {
				addToast({
					title: "Commit message",
					description: "Enter a commit message.",
					type: "error",
				});
				return false;
			}
			if (commitMsg.length > 500) {
				addToast({
					title: "Commit message",
					description: "Please keep the message under 500 characters.",
					type: "error",
				});
				return false;
			}
			try {
				const stagedPaths = Array.from(stagedFiles);
				let result: string;
				if (stagedPaths.length > 0) {
					result = await jjSplit(workspacePath, commitMsg, stagedPaths);
					setStagedFiles(new Set());
				} else {
					result = await createCommit(
						repoPath!,
						workspaceId ?? null,
						commitMsg,
					);
				}
				await invalidateCache();
				addToast({
					title: "Commit created",
					description: result.trim() || "Commit successful",
					type: "success",
				});
				setCommittedSectionCollapsed(true);
				await Promise.all([
					loadChangedFiles(),
					refreshCommittedChanges(),
					// A commit changes the ahead count the header and sidebar render.
					queryClient.invalidateQueries({
						queryKey: ["workspace-status", repoPath, workspaceId ?? null],
					}),
					queryClient.invalidateQueries({
						queryKey: ["workspace-statuses", repoPath],
					}),
					// The stack panel's per-workspace line-change counts.
					queryClient.invalidateQueries({
						queryKey: ["workspace-commits", repoPath, workspaceId ?? null],
					}),
				]);
				return true;
			} catch (error) {
				addToast({
					title: "Commit failed",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
				return false;
			}
		},
		[
			workspacePath,
			addToast,
			invalidateCache,
			stagedFiles,
			setStagedFiles,
			loadChangedFiles,
			refreshCommittedChanges,
			setCommittedSectionCollapsed,
			repoPath,
			workspaceId,
			queryClient,
		],
	);

	const handleCommit = useCallback(
		async (commitMsg: string) => {
			setPendingAction("commit");
			try {
				await performCommit(commitMsg);
			} finally {
				setPendingAction(null);
			}
		},
		[performCommit],
	);

	const handleCommitAndPush = useCallback(
		async (commitMsg: string) => {
			setPendingAction("push");
			try {
				const committed = await performCommit(commitMsg);
				if (!committed) return;
				await pushWorkspaceToRemote(repoPath!, workspaceId ?? null);
				await queryClient.invalidateQueries();
				addToast({
					title: "Pushed to remote",
					type: "success",
				});
			} catch (error) {
				addToast({
					title: "Failed to push",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			} finally {
				setPendingAction(null);
			}
		},
		[performCommit, repoPath, workspaceId, queryClient, addToast],
	);

	const createPrMutation = useMutation({
		mutationKey: createPrMutationKey(repoPath, workspaceId),
		mutationFn: async (commitMsg: string) => {
			if (!remoteInfo || !workspace || !baseBranch) return null;
			const committed = await performCommit(commitMsg);
			if (!committed) return null;
			await pushWorkspaceToRemote(repoPath!, workspaceId ?? null);
			return ghCreatePr(
				remoteInfo.full_name,
				workspace.title || workspace.branch_name,
				workspace.description ?? "",
				baseBranch,
				workspace.branch_name,
				false,
			);
		},
	});

	const handleCommitAndCreatePR = useCallback(
		async (commitMsg: string) => {
			if (!remoteInfo || !workspace || !baseBranch) return;
			try {
				const number = await createPrMutation.mutateAsync(commitMsg);
				if (number == null) return;
				await queryClient.invalidateQueries();
				const prUrl = `https://github.com/${remoteInfo.full_name}/pull/${number}`;
				addToast({
					title: "Pull request created",
					description: `#${number}`,
					type: "success",
					action: {
						label: "Open in Web",
						onClick: () => openUrl(prUrl),
					},
				});
			} catch (error) {
				addToast({
					title: "Failed to create PR",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			}
		},
		[
			createPrMutation,
			remoteInfo,
			workspace,
			baseBranch,
			queryClient,
			addToast,
		],
	);

	const handleExpandContext = useCallback(
		async (
			filePath: string,
			hunkIndex: number,
			direction: "before" | "after",
		) => {
			const hunk = allFileHunks.get(filePath)?.hunks[hunkIndex];
			if (!hunk) return;
			const key = `${filePath}:${hunkIndex}:${direction}`;
			const existing = expandedContext.get(key) || [];
			const LINES_TO_FETCH = 20;
			const { newStart, newCount } = parseHunkHeader(hunk.header);
			let startLine: number;
			let endLine: number;
			if (direction === "before") {
				const hunkStartLine = newStart;
				endLine = hunkStartLine - 1 - existing.length;
				startLine = Math.max(1, endLine - LINES_TO_FETCH + 1);
				if (startLine > endLine) return;
			} else {
				const hunkEndLine = newStart + newCount - 1;
				startLine = hunkEndLine + 1 + existing.length;
				endLine = startLine + LINES_TO_FETCH - 1;
			}
			try {
				const result = await getWorkspaceFileLines(
					repoPath ?? "",
					workspaceId ?? null,
					filePath,
					false,
					startLine,
					endLine,
				);
				if (result.lines.length > 0) {
					setExpandedContext((prev) => {
						const next = new Map(prev);
						const prevLines = prev.get(key) || [];
						next.set(
							key,
							direction === "before"
								? [...result.lines, ...prevLines]
								: [...prevLines, ...result.lines],
						);
						return next;
					});
				}
			} catch {
				/* context expansion non-critical */
			}
		},
		[repoPath, workspaceId, expandedContext, allFileHunks],
	);

	return {
		fileActionTarget,
		expandedContext,
		commitPending: pendingAction !== null,
		pendingAction,
		canCreatePr,
		hasPr: !!prInfo,
		handleDiscardAll,
		handleDiscardFiles,
		handleCopyLineLocation,
		handleCopyLines,
		handleCommit,
		handleCommitAndPush,
		handleCommitAndCreatePR,
		handleExpandContext,
	};
}
