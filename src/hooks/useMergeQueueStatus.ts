import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
	getCachedPrInfo,
	getCachedPrCiStatus,
	getGitRemoteUrl,
	getPrChecksForPr,
	getPrChecksViaGh,
	getPrInfoViaGh,
	listCachedPrCiStatuses,
	listCachedPrStatuses,
	refreshPrStatuses,
	startPrStatusPolling,
	stopPrStatusPolling,
} from "../lib/api";
import type {
	PrCiStatus,
	PrInfo,
	WorkspaceQueueStatus,
} from "../lib/api-types";
import { FEATURES } from "../lib/features";
import { supabase } from "../lib/supabase";

/** Query key for the per-repo merge queue opt-in. */
export const mergeQueueEnabledKey = (repoFullName: string | undefined) => [
	"merge-queue-enabled",
	repoFullName,
];

/** Query key for the Rust-side cached PR statuses map for a repo. */
export const cachedPrStatusesKey = (repoPath: string | undefined) => [
	"cached-pr-statuses",
	repoPath,
];

/** Query key for the Rust-side cached CI statuses map for a repo. */
export const cachedPrCiStatusesKey = (repoPath: string | undefined) => [
	"cached-pr-ci-statuses",
	repoPath,
];

/**
 * Shared mutation key for "create a PR for this workspace" actions. Multiple
 * surfaces can trigger PR creation for the same workspace (the header's
 * Create PR button, the Review tab's "Commit and create PR" dropdown item);
 * tagging each `useMutation` with this key lets every surface detect via
 * `useIsMutating` that a create-PR request is in flight, regardless of which
 * one started it, so they can all render a loading state together.
 */
export const createPrMutationKey = (
	repoPath: string | undefined,
	workspaceId: number | null | undefined,
) => ["create-pr", repoPath, workspaceId ?? null] as const;

type PrStatusesPayload = {
	repo_path: string;
	statuses: Record<string, PrInfo | null>;
	ci_statuses?: Record<string, PrCiStatus | null>;
};

function applyPrStatusesToQueryCache(
	queryClient: ReturnType<typeof useQueryClient>,
	payload: {
		repoPath: string;
		statuses: Record<string, PrInfo | null>;
		ciStatuses?: Record<string, PrCiStatus | null>;
	},
) {
	const { repoPath, statuses, ciStatuses } = payload;
	queryClient.setQueryData(cachedPrStatusesKey(repoPath), statuses);
	for (const [branch, info] of Object.entries(statuses)) {
		queryClient.setQueryData(["pr-info-gh", repoPath, branch], info);
	}
	if (ciStatuses) {
		queryClient.setQueryData(cachedPrCiStatusesKey(repoPath), ciStatuses);
		for (const [branch, status] of Object.entries(ciStatuses)) {
			queryClient.setQueryData(["pr-ci-status", repoPath, branch], status);
		}
	}
}

export function useGitRemoteInfo(repoPath: string | undefined) {
	return useQuery({
		queryKey: ["git-remote-info", repoPath],
		queryFn: () => getGitRemoteUrl(repoPath!),
		enabled: !!repoPath,
		staleTime: 5 * 60 * 1000,
	});
}

/**
 * Ensure the Rust background poller is watching this repo, and keep the
 * React Query cache in sync via `pr-statuses-updated` events. Cache reads
 * never shell out to `gh`, so the sidebar can refresh without UI stutter.
 */
export function usePrStatusPolling(repoPath: string | undefined) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!repoPath) return;
		void startPrStatusPolling(repoPath);
		return () => {
			void stopPrStatusPolling(repoPath);
		};
	}, [repoPath]);

	useEffect(() => {
		if (!repoPath) return;
		let unlisten: (() => void) | undefined;
		void listen<PrStatusesPayload>("pr-statuses-updated", (event) => {
			if (event.payload.repo_path !== repoPath) return;
			applyPrStatusesToQueryCache(queryClient, {
				repoPath,
				statuses: event.payload.statuses,
				ciStatuses: event.payload.ci_statuses,
			});
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			unlisten?.();
		};
	}, [repoPath, queryClient]);

	return useQuery({
		queryKey: cachedPrStatusesKey(repoPath),
		queryFn: async () => {
			const [statuses, ciStatuses] = await Promise.all([
				listCachedPrStatuses(repoPath!),
				listCachedPrCiStatuses(repoPath!),
			]);
			applyPrStatusesToQueryCache(queryClient, {
				repoPath: repoPath!,
				statuses,
				ciStatuses,
			});
			return statuses;
		},
		enabled: !!repoPath,
		// Cheap cache read only — the Rust poller owns the refresh cadence.
		staleTime: 5_000,
		refetchInterval: 15_000,
	});
}

/**
 * PR info for a branch, served from the Rust background cache.
 * Starts the poller if needed; never invokes `gh` from the UI thread.
 */
export function usePrInfoViaGh(
	repoPath: string | undefined,
	branchName: string | undefined,
) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!repoPath) return;
		void startPrStatusPolling(repoPath);
	}, [repoPath]);

	useEffect(() => {
		if (!repoPath) return;
		let unlisten: (() => void) | undefined;
		void listen<PrStatusesPayload>("pr-statuses-updated", (event) => {
			if (event.payload.repo_path !== repoPath) return;
			applyPrStatusesToQueryCache(queryClient, {
				repoPath,
				statuses: event.payload.statuses,
				ciStatuses: event.payload.ci_statuses,
			});
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			unlisten?.();
		};
	}, [repoPath, queryClient]);

	return useQuery<PrInfo | null>({
		queryKey: ["pr-info-gh", repoPath, branchName],
		queryFn: () => getCachedPrInfo(repoPath!, branchName!),
		enabled: !!repoPath && !!branchName,
		staleTime: 5_000,
		// Cache-only refetch; Rust owns the `gh` polling.
		refetchInterval: 15_000,
	});
}

/** Force-refresh PR statuses after mutations (create PR, etc.). */
export async function invalidatePrStatuses(
	queryClient: ReturnType<typeof useQueryClient>,
	repoPath: string,
	branchName?: string,
) {
	try {
		if (branchName) {
			// Single-branch force-fetch warms the Rust cache without re-polling
			// every workspace. Failures must not fail the caller (e.g. create PR
			// already succeeded and still needs its success toast).
			await Promise.all([
				getPrInfoViaGh(repoPath, branchName),
				getPrChecksViaGh(repoPath, branchName),
			]);
		} else {
			await refreshPrStatuses(repoPath);
		}
	} catch {
		// Cache warm is best-effort; background poller will catch up.
	}
	await queryClient.invalidateQueries({
		queryKey: cachedPrStatusesKey(repoPath),
	});
	await queryClient.invalidateQueries({ queryKey: ["pr-info-gh", repoPath] });
	await queryClient.invalidateQueries({
		queryKey: cachedPrCiStatusesKey(repoPath),
	});
	await queryClient.invalidateQueries({ queryKey: ["pr-ci-status", repoPath] });
}

/**
 * CI status for the branch's PR, served from the Rust background cache.
 * Starts the poller if needed; never invokes `gh` from the UI thread.
 * Rust refreshes CI every 30s; the UI only reads the cache (and pauses
 * automatically once the tab/window loses focus).
 */
export function usePrCiStatus(
	repoPath: string | undefined,
	branchName: string | undefined,
) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!repoPath) return;
		void startPrStatusPolling(repoPath);
	}, [repoPath]);

	useEffect(() => {
		if (!repoPath) return;
		let unlisten: (() => void) | undefined;
		void listen<PrStatusesPayload>("pr-statuses-updated", (event) => {
			if (event.payload.repo_path !== repoPath) return;
			applyPrStatusesToQueryCache(queryClient, {
				repoPath,
				statuses: event.payload.statuses,
				ciStatuses: event.payload.ci_statuses,
			});
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			unlisten?.();
		};
	}, [repoPath, queryClient]);

	return useQuery<PrCiStatus | null>({
		queryKey: ["pr-ci-status", repoPath, branchName],
		queryFn: () => getCachedPrCiStatus(repoPath!, branchName!),
		enabled: !!repoPath && !!branchName,
		staleTime: 10_000,
		// Cache-only; Rust owns the 30s `gh pr checks` cadence.
		refetchInterval: 30_000,
	});
}

/**
 * CI status for a specific PR, rolled up from `gh pr checks`. Used by the
 * GitHub panel's PR detail view, which browses PRs by number rather than by
 * a locally checked-out branch. Cadence matches the branch-based cache (30s);
 * runs via spawn_blocking on the command side so it does not stall IPC.
 */
export function usePrChecksForPr(
	repoFullName: string | undefined,
	prNumber: number | undefined,
) {
	return useQuery<PrCiStatus | null>({
		queryKey: ["pr-ci-status-for-pr", repoFullName, prNumber],
		queryFn: () => getPrChecksForPr(repoFullName!, prNumber!),
		enabled: !!repoFullName && prNumber !== undefined,
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
}

/**
 * Whether the merge queue is switched on for this repo, as stored in Postgres.
 * A repo with no config row has never opted in, so this resolves to false --
 * the user has to turn the queue on before anything can be enqueued.
 */
export function useMergeQueueEnabled(repoPath: string | undefined) {
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);

	return useQuery<boolean>({
		queryKey: mergeQueueEnabledKey(remoteInfo?.full_name),
		queryFn: async () => {
			const { data, error } = await supabase.rpc("get_merge_queue_enabled", {
				p_repo_full_name: remoteInfo!.full_name,
			});
			if (error) throw error;
			return data === true;
		},
		enabled: FEATURES.mergeQueue && !!remoteInfo,
		staleTime: 60_000,
	});
}

export function useSetMergeQueueEnabled(repoPath: string | undefined) {
	const queryClient = useQueryClient();
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);

	return useMutation({
		mutationFn: async (enabled: boolean) => {
			if (!remoteInfo) throw new Error("No GitHub remote detected");
			const { error } = await supabase.rpc("set_merge_queue_enabled", {
				p_repo_full_name: remoteInfo.full_name,
				p_enabled: enabled,
			});
			if (error) throw error;
			return enabled;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: mergeQueueEnabledKey(remoteInfo?.full_name),
			});
		},
	});
}

/**
 * Remove one or more branches from the queue, used by the GitHub panel's queue
 * list. Stacks are removed top-down so a branch is never left queued on top of
 * a parent that has already gone.
 */
export function useDequeueBranches(repoPath: string | undefined) {
	const queryClient = useQueryClient();
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);

	return useMutation({
		mutationFn: async (branchNames: string[]) => {
			if (!remoteInfo) throw new Error("No GitHub remote detected");
			const fullName = remoteInfo.full_name;
			// Sequential top-down: never dequeue a branch before what's stacked above it.
			await [...branchNames].reverse().reduce(
				(prev, branchName) =>
					prev.then(async () => {
						const { error } = await supabase.functions.invoke(
							"enqueue-workspace",
							{
								body: {
									repo_full_name: fullName,
									branch_name: branchName,
									action: "dequeue",
								},
							},
						);
						if (error) throw error;
					}),
				Promise.resolve(),
			);
			return branchNames;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["repo-branch-queue-statuses-panel", remoteInfo?.full_name],
			});
			void queryClient.invalidateQueries({
				queryKey: ["repo-branch-queue-statuses", remoteInfo?.full_name],
			});
			void queryClient.invalidateQueries({ queryKey: ["merge-queue-status"] });
		},
	});
}

export function useMergeQueueStatus(
	repoPath: string | undefined,
	branchName: string | undefined,
) {
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);
	const { data: queueEnabled } = useMergeQueueEnabled(repoPath);

	return useQuery<WorkspaceQueueStatus | null>({
		queryKey: ["merge-queue-status", remoteInfo?.full_name, branchName],
		queryFn: async () => {
			if (!remoteInfo || !branchName) return null;
			const { data, error } = await supabase.rpc("get_workspace_queue_status", {
				p_repo_full_name: remoteInfo.full_name,
				p_branch_name: branchName,
			});
			if (error) throw error;
			return (data as WorkspaceQueueStatus[] | null)?.[0] ?? null;
		},
		// Never poll when off, whether by the build flag or the per-repo opt-in.
		enabled:
			FEATURES.mergeQueue &&
			queueEnabled === true &&
			!!remoteInfo &&
			!!branchName,
		refetchInterval: 30_000,
	});
}

export function useEnqueueWorkspace(
	repoPath: string | undefined,
	branchName: string | undefined,
) {
	const queryClient = useQueryClient();
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);
	const { data: prInfoGh, error: prInfoGhError } = usePrInfoViaGh(
		repoPath,
		branchName,
	);
	const { data: queueEnabled } = useMergeQueueEnabled(repoPath);

	const mutate = useCallback(
		async (action: "enqueue" | "dequeue") => {
			if (!remoteInfo || !branchName)
				throw new Error("Repository or branch not detected");
			if (action === "enqueue" && !queueEnabled)
				throw new Error(
					"The merge queue is not enabled for this repository. Turn it on in the GitHub panel's Merge Queue tab.",
				);
			if (action === "enqueue" && prInfoGhError) throw prInfoGhError;

			if (prInfoGh !== undefined && prInfoGh !== null) {
				if (prInfoGh.state !== "OPEN" && action === "enqueue") {
					throw new Error(
						`No open PR found for branch '${branchName}' (gh reports: ${prInfoGh.state})`,
					);
				}
			}

			const { error } = await supabase.functions.invoke("enqueue-workspace", {
				body: {
					repo_full_name: remoteInfo.full_name,
					branch_name: branchName,
					action,
				},
			});
			if (error) throw error;

			// Refresh every view of the queue, not just this workspace's button.
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["merge-queue-status", remoteInfo.full_name, branchName],
				}),
				queryClient.invalidateQueries({
					queryKey: ["repo-branch-queue-statuses", remoteInfo.full_name],
				}),
				queryClient.invalidateQueries({
					queryKey: ["repo-branch-queue-statuses-panel", remoteInfo.full_name],
				}),
			]);
		},
		[
			remoteInfo,
			branchName,
			prInfoGh,
			prInfoGhError,
			queueEnabled,
			queryClient,
		],
	);

	const enqueue = useMutation({ mutationFn: () => mutate("enqueue") });
	const dequeue = useMutation({ mutationFn: () => mutate("dequeue") });

	return { enqueue, dequeue, remoteInfo, prInfoGh, prInfoGhError };
}
