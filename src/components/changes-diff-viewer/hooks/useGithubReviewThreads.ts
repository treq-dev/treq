import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ghListPrReviewThreads } from "../../../lib/api";
import type { GhReviewThread } from "../../../lib/api-types";
import {
	useGitRemoteInfo,
	usePrInfoViaGh,
} from "../../../hooks/useMergeQueueStatus";
import { computeHunkLineNumbers } from "../utils";
import type { CommentLineQuery, FileHunksData } from "../types";

interface UseGithubReviewThreadsParams {
	repoPath: string | undefined;
	branchName: string | undefined;
	allFileHunks: Map<string, FileHunksData>;
}

function pushToMap<K>(
	map: Map<K, GhReviewThread[]>,
	key: K,
	thread: GhReviewThread,
) {
	const existing = map.get(key);
	if (existing) existing.push(thread);
	else map.set(key, [thread]);
}

/**
 * Read-only GitHub PR review comment threads for the current workspace's
 * branch. Threads are matched onto the *current* local diff so they can
 * render inline at the right line -- a thread that no longer matches any
 * line (GitHub reports it outdated, or the local diff has simply since
 * diverged from the PR's diff) is reported as "unplaced" instead.
 */
export function useGithubReviewThreads({
	repoPath,
	branchName,
	allFileHunks,
}: UseGithubReviewThreadsParams) {
	const { data: remoteInfo } = useGitRemoteInfo(repoPath);
	const { data: prInfo } = usePrInfoViaGh(repoPath, branchName);

	const enabled = Boolean(remoteInfo) && Boolean(prInfo);

	const { data: threads = [] } = useQuery<GhReviewThread[]>({
		queryKey: ["gh-pr-review-threads", remoteInfo?.full_name, prInfo?.number],
		queryFn: () =>
			ghListPrReviewThreads(
				remoteInfo!.owner,
				remoteInfo!.repo,
				prInfo!.number,
			),
		enabled,
		staleTime: 60_000,
		// Low-urgency read; keep off the ShowWorkspace hot path cadence.
		refetchInterval: 2 * 60_000,
	});

	const { threadsByLineKey, unplacedThreadsByFile } = useMemo(() => {
		const byLineKey = new Map<string, GhReviewThread[]>();
		const unplaced = new Map<string, GhReviewThread[]>();

		for (const thread of threads) {
			if (thread.is_outdated || thread.line == null) {
				pushToMap(unplaced, thread.path, thread);
				continue;
			}

			const fileData = allFileHunks.get(thread.path);
			const expectedSide: "old" | "new" =
				thread.diff_side === "LEFT" ? "old" : "new";
			let placed = false;

			if (fileData?.hunks) {
				for (const hunk of fileData.hunks) {
					const lineNumbers = computeHunkLineNumbers(hunk);
					const hasMatch = lineNumbers.some((ln) => {
						const actualLineNum = ln.new ?? ln.old ?? 0;
						const side: "old" | "new" =
							ln.old !== undefined && ln.new === undefined ? "old" : "new";
						return actualLineNum === thread.line && side === expectedSide;
					});
					if (hasMatch) {
						const key = `${thread.path}:${hunk.id}:${thread.line}:${expectedSide}`;
						pushToMap(byLineKey, key, thread);
						placed = true;
						break;
					}
				}
			}

			if (!placed) pushToMap(unplaced, thread.path, thread);
		}

		return { threadsByLineKey: byLineKey, unplacedThreadsByFile: unplaced };
	}, [threads, allFileHunks]);

	const getThreadsForLine = useCallback(
		({
			filePath,
			hunkId,
			lineNumber,
			side,
		}: CommentLineQuery): GhReviewThread[] =>
			threadsByLineKey.get(`${filePath}:${hunkId}:${lineNumber}:${side}`) ?? [],
		[threadsByLineKey],
	);

	const getUnplacedThreadsForFile = useCallback(
		(filePath: string): GhReviewThread[] =>
			unplacedThreadsByFile.get(filePath) ?? [],
		[unplacedThreadsByFile],
	);

	// Resolved threads start collapsed; unresolved start expanded. Only seed
	// collapse state the first time a thread is seen, so manual toggles survive
	// background refetches.
	const [collapsedThreadIds, setCollapsedThreadIds] = useState<Set<string>>(
		new Set(),
	);
	const seenThreadIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const newlyResolved: string[] = [];
		for (const thread of threads) {
			if (!seenThreadIdsRef.current.has(thread.id)) {
				seenThreadIdsRef.current.add(thread.id);
				if (thread.is_resolved) newlyResolved.push(thread.id);
			}
		}
		if (newlyResolved.length > 0) {
			setCollapsedThreadIds((prev) => new Set([...prev, ...newlyResolved]));
		}
	}, [threads]);

	const toggleThreadCollapse = useCallback((threadId: string) => {
		setCollapsedThreadIds((prev) => {
			const next = new Set(prev);
			if (next.has(threadId)) next.delete(threadId);
			else next.add(threadId);
			return next;
		});
	}, []);

	// Unplaced/outdated groups are collapsed by default, per-file.
	const [expandedOutdatedGroups, setExpandedOutdatedGroups] = useState<
		Set<string>
	>(new Set());

	const toggleOutdatedGroup = useCallback((filePath: string) => {
		setExpandedOutdatedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) next.delete(filePath);
			else next.add(filePath);
			return next;
		});
	}, []);

	return {
		threads,
		getThreadsForLine,
		getUnplacedThreadsForFile,
		collapsedThreadIds,
		toggleThreadCollapse,
		expandedOutdatedGroups,
		toggleOutdatedGroup,
	};
}
