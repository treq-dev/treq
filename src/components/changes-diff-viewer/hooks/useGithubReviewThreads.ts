import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ghListPrReviewThreads } from "../../../lib/api";
import type { GhReviewThread } from "../../../lib/api-types";
import {
	useGitRemoteInfo,
	usePrInfoViaGh,
} from "../../../hooks/useMergeQueueStatus";
import { placeGithubReviewThreads } from "../placeGithubReviewThreads";
import type { CommentLineQuery, FileHunksData } from "../types";

interface UseGithubReviewThreadsParams {
	repoPath: string | undefined;
	branchName: string | undefined;
	allFileHunks: Map<string, FileHunksData>;
	/** Committed PR/workspace hunks shown in the Review tab. */
	committedFileHunks?: Map<string, FileHunksData>;
}

/**
 * Read-only GitHub PR review comment threads for the current workspace's
 * branch. Threads are matched onto the *current* local diff (uncommitted and
 * committed Review-tab hunks) so they can render inline at the right line --
 * a thread that no longer matches any visible line is reported as "unplaced".
 */
export function useGithubReviewThreads({
	repoPath,
	branchName,
	allFileHunks,
	committedFileHunks,
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
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const { threadsByLineKey, unplacedThreadsByFile } = useMemo(() => {
		const hunkMaps: Array<Map<string, FileHunksData>> = [allFileHunks];
		if (committedFileHunks && committedFileHunks.size > 0) {
			hunkMaps.push(committedFileHunks);
		}
		return placeGithubReviewThreads(threads, hunkMaps);
	}, [threads, allFileHunks, committedFileHunks]);

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
