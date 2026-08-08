import {
	type BranchStatus,
	type Workspace,
	type WorkspaceMoveRequest,
	createWorkspace,
	getWorkspaces,
	moveWorkspaceChanges,
	setWorkspaceTargetBranch,
} from "../lib/api";
import { getFullWorkspacePath } from "../lib/utils";
import { buildCreateMetadata } from "../lib/workspaceMetadata";
import { useCreateStackedWorkspace } from "./useCreateStackedWorkspace";
import { useToast } from "../components/ui/toast";

export interface UseWorkspaceDialogSubmitParams {
	repoPath: string;
	title: string;
	description: string;
	sparsePaths: string;
	symlinkedDirs: string;
	branchName: string;
	moveToExisting: boolean;
	isHomeRepo: boolean;
	hasSourceWorkspace: boolean;
	sourceWorkspace: Workspace | null;
	position: "before" | "after";
	targetBranch: string | null;
	allWorkspaces: Workspace[];
	branchStatusData: BranchStatus | null;
	activeRightTab: "commits" | "changes";
	selectedCommits: Set<string>;
	selectedHunks: Set<string>;
	selectedFilePaths: string[];
	targetWorkspaceId: number | null;
	canSubmit: boolean;
	setLoading: (v: boolean) => void;
	setError: (v: string) => void;
	onSuccess: (workspaceId: number) => void;
	onOpenChange: (open: boolean) => void;
}

export function useWorkspaceDialogSubmit(
	params: UseWorkspaceDialogSubmitParams,
) {
	const {
		repoPath,
		title,
		description,
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
	} = params;

	const { addToast } = useToast();
	const { createStackedWorkspace } = useCreateStackedWorkspace();

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setLoading(true);
		setError("");

		try {
			if (moveToExisting && targetWorkspaceId !== null && sourceWorkspace) {
				const targetWs = allWorkspaces.find((w) => w.id === targetWorkspaceId);
				if (!targetWs) {
					setError("Target workspace not found");
					setLoading(false);
					return;
				}
				if (activeRightTab === "commits" && selectedCommits.size > 0) {
					const request: WorkspaceMoveRequest = {
						files: [],
						hunks: [],
						commits: Array.from(selectedCommits),
					};
					await moveWorkspaceChanges(
						repoPath,
						sourceWorkspace.branch_name,
						targetWs.branch_name,
						request,
					);
					addToast({
						title: "Commits moved",
						description: `Moved to workspace: ${targetWs.branch_name}`,
						type: "success",
					});
					onSuccess(targetWorkspaceId);
					onOpenChange(false);
					return;
				} else if (activeRightTab === "changes" && selectedHunks.size > 0) {
					const request: WorkspaceMoveRequest = {
						files: selectedFilePaths,
						hunks: [],
						commits: [],
					};
					await moveWorkspaceChanges(
						repoPath,
						sourceWorkspace.branch_name,
						targetWs.branch_name,
						request,
					);
					addToast({
						title: "Files moved",
						description: `Moved ${selectedFilePaths.length} file(s) to ${targetWs.branch_name}`,
						type: "success",
					});
					onSuccess(targetWorkspaceId);
					onOpenChange(false);
					return;
				}
				setError("Please select commits or files to move");
				setLoading(false);
				return;
			}

			if (
				sourceWorkspace &&
				selectedCommits.size > 0 &&
				activeRightTab === "commits"
			) {
				const stackOnBranch =
					position === "before"
						? (sourceWorkspace.target_branch ?? "main")
						: sourceWorkspace.branch_name;
				const metadata = JSON.stringify({
					title: title.trim() || undefined,
					description: description.trim() || undefined,
				});
				const newWorkspaceId = await createWorkspace(
					repoPath,
					branchName,
					stackOnBranch,
					metadata,
				);
				const request: WorkspaceMoveRequest = {
					files: [],
					hunks: [],
					commits: Array.from(selectedCommits),
				};
				await moveWorkspaceChanges(
					repoPath,
					sourceWorkspace.branch_name,
					branchName,
					request,
				);
				if (position === "before") {
					const updatedWorkspaces = await getWorkspaces(repoPath);
					const sourceWs = updatedWorkspaces.find(
						(w) => w.id === sourceWorkspace.id,
					);
					if (sourceWs) {
						const fullPath = getFullWorkspacePath(sourceWs);
						await setWorkspaceTargetBranch(
							repoPath,
							fullPath,
							sourceWorkspace.id,
							branchName,
						);
					}
				}
				addToast({
					title: "Workspace created",
					description: `Moved ${selectedCommits.size} commit(s) to ${branchName}`,
					type: "success",
				});
				onSuccess(newWorkspaceId);
				onOpenChange(false);
				return;
			}

			if (
				sourceWorkspace &&
				selectedHunks.size > 0 &&
				activeRightTab === "changes"
			) {
				const stackOnBranch =
					position === "before"
						? (sourceWorkspace.target_branch ?? "main")
						: sourceWorkspace.branch_name;
				const metadata = JSON.stringify({
					title: title.trim() || undefined,
					description: description.trim() || undefined,
				});
				const newWorkspaceId = await createWorkspace(
					repoPath,
					branchName,
					stackOnBranch,
					metadata,
				);
				const request: WorkspaceMoveRequest = {
					files: selectedFilePaths,
					hunks: [],
					commits: [],
				};
				await moveWorkspaceChanges(
					repoPath,
					sourceWorkspace.branch_name,
					branchName,
					request,
				);
				if (position === "before") {
					const updatedWorkspaces = await getWorkspaces(repoPath);
					const sourceWs = updatedWorkspaces.find(
						(w) => w.id === sourceWorkspace.id,
					);
					if (sourceWs) {
						const fullPath = getFullWorkspacePath(sourceWs);
						await setWorkspaceTargetBranch(
							repoPath,
							fullPath,
							sourceWorkspace.id,
							branchName,
						);
					}
				}
				addToast({
					title: "Workspace split",
					description: `Moved ${selectedFilePaths.length} file(s) to ${branchName}`,
					type: "success",
				});
				onSuccess(newWorkspaceId);
				onOpenChange(false);
				return;
			}

			if (isHomeRepo && selectedHunks.size > 0) {
				// The backend rejects moved files outside sparse_patterns; that error surfaces verbatim.
				const metadata = buildCreateMetadata({
					title,
					description,
					movedFiles: selectedFilePaths,
					sparsePaths,
					symlinkedDirs,
				});
				const workspaceId = await createWorkspace(
					repoPath,
					branchName,
					undefined,
					metadata,
				);
				addToast({
					title: "Workspace created",
					description: `Created ${branchName} with ${selectedFilePaths.length} file(s) moved`,
					type: "success",
				});
				onSuccess(workspaceId);
				onOpenChange(false);
				return;
			}

			if (hasSourceWorkspace && sourceWorkspace) {
				const workspaceId = await createStackedWorkspace({
					repoPath,
					parentBranch: sourceWorkspace.branch_name,
					parentWorkspace: sourceWorkspace,
					branchName,
					description: description.trim() || undefined,
					position,
				});
				onSuccess(workspaceId);
				onOpenChange(false);
				return;
			}

			{
				let targetWorkspacePath: string | undefined;
				if (targetBranch) {
					const existingTarget = allWorkspaces.find(
						(w) => w.branch_name === targetBranch,
					);
					if (!existingTarget) {
						const targetWsId = await createWorkspace(
							repoPath,
							targetBranch,
							undefined,
							JSON.stringify({ description: `Workspace for ${targetBranch}` }),
						);
						const updatedWorkspaces = await getWorkspaces(repoPath);
						const createdTarget = updatedWorkspaces.find(
							(w) => w.id === targetWsId,
						);
						if (createdTarget)
							targetWorkspacePath = createdTarget.workspace_path;
					} else {
						targetWorkspacePath = existingTarget.workspace_path;
					}
				}

				const metadata = buildCreateMetadata({
					title,
					description,
					sparsePaths,
					symlinkedDirs,
				});

				let effectiveSourceBranch: string | undefined;
				if (branchStatusData?.remote_exists && branchStatusData.remote_ref) {
					effectiveSourceBranch = branchStatusData.remote_ref;
				}

				const workspaceId = await createWorkspace(
					repoPath,
					branchName,
					effectiveSourceBranch,
					metadata,
				);

				if (targetBranch && targetWorkspacePath) {
					const updatedWorkspaces = await getWorkspaces(repoPath);
					const createdWorkspace = updatedWorkspaces.find(
						(w) => w.id === workspaceId,
					);
					if (createdWorkspace) {
						const fullPath = getFullWorkspacePath(createdWorkspace);
						await setWorkspaceTargetBranch(
							repoPath,
							fullPath,
							workspaceId,
							targetBranch,
						);
					}
				}

				addToast({
					title: "Workspace created",
					description: `Created workspace for branch ${branchName}`,
					type: "success",
				});
				onSuccess(workspaceId);
				onOpenChange(false);
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			setError(errorMsg);
			addToast({
				title: "Failed to create workspace",
				description: errorMsg,
				type: "error",
			});
		} finally {
			setLoading(false);
		}
	};

	return { handleSubmit };
}
