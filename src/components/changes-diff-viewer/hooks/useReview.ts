import React, { useCallback, useEffect, useState } from "react";
import {
	type ConflictRegion,
	clearPendingReview,
	loadPendingReview,
	markFileViewed,
	savePendingReview,
	unmarkFileViewed,
} from "../../../lib/api";
import type { ParsedFileChange } from "../../../lib/git-utils";
import {
	FILE_COMMENT_HUNK_ID,
	formatReviewMarkdown as formatReviewMarkdownShared,
} from "../../../lib/review";
import { useDebounce } from "../../../hooks/useDebounce";
import type { useToast } from "../../ui/toast";
import type { ConflictComment, FileHunksData, LineComment } from "../types";
import {
	computeHunksHash,
	toApiLineComment,
	toLocalLineComment,
} from "../utils";

interface UseReviewParams {
	comments: LineComment[];
	setComments: (comments: LineComment[]) => void;
	conflictComments: Map<string, ConflictComment>;
	setConflictComments: (comments: Map<string, ConflictComment>) => void;
	setHasUserAddedComments: (v: boolean) => void;
	allFileHunks: Map<string, FileHunksData>;
	setAllFileHunks: React.Dispatch<
		React.SetStateAction<Map<string, FileHunksData>>
	>;
	files: ParsedFileChange[];
	workspacePath: string;
	repoPath: string | undefined;
	workspaceId: number | undefined;
	conflictRegionsByFile: Map<string, ConflictRegion[]>;
	actualConflictedFiles: string[];
	setCollapsedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
	// Filled with applyChangedFiles once isInReviewMode is known
	applyChangedFilesRef: React.MutableRefObject<
		(parsed: ParsedFileChange[], forceApply?: boolean) => void
	>;
	isReloadingRef: React.MutableRefObject<boolean>;
	onCreateAgentWithReview:
		| ((review: string, mode: "plan" | "acceptEdits") => Promise<void>)
		| undefined;
	onReviewSubmitted: (() => void) | undefined;
	addToast: ReturnType<typeof useToast>["addToast"];
}

export function useReview({
	comments,
	setComments,
	conflictComments,
	setConflictComments,
	setHasUserAddedComments,
	allFileHunks,
	setAllFileHunks,
	files,
	workspacePath,
	repoPath,
	workspaceId,
	conflictRegionsByFile,
	actualConflictedFiles,
	setCollapsedFiles,
	applyChangedFilesRef,
	isReloadingRef,
	onCreateAgentWithReview,
	onReviewSubmitted,
	addToast,
}: UseReviewParams) {
	const [reviewPopoverOpen, setReviewPopoverOpen] = useState(false);
	const [finalReviewComment, setFinalReviewComment] = useState("");
	const [showCancelDialog, setShowCancelDialog] = useState(false);
	const [copiedReview, setCopiedReview] = useState(false);
	const [sendingReview, setSendingReview] = useState(false);
	const [staleFiles, setStaleFiles] = useState<Set<string>>(new Set());
	const [pendingFilesData, setPendingFilesData] = useState<
		ParsedFileChange[] | null
	>(null);
	const [pendingHunksData, setPendingHunksData] = useState<Map<
		string,
		FileHunksData
	> | null>(null);
	const [viewedFiles, setViewedFiles] = useState<
		Map<string, { viewedAt: string; contentHash: string }>
	>(new Map());

	useEffect(() => {
		const loadReview = async () => {
			if (repoPath && workspaceId !== undefined) {
				try {
					const pendingReview = await loadPendingReview(repoPath, workspaceId);
					if (pendingReview) {
						setComments(pendingReview.comments.map(toLocalLineComment));
						if (pendingReview.summary_text)
							setFinalReviewComment(pendingReview.summary_text);
						setHasUserAddedComments(pendingReview.comments.length > 0);
						const loadedComments = await loadPendingReview(
							repoPath,
							workspaceId,
						);
						if (loadedComments && loadedComments.comments.length > 0) {
							setComments(loadedComments.comments.map(toLocalLineComment));
						}
					}
				} catch (error) {
					console.error("Failed to load pending review:", error);
				}
			}
		};
		loadReview();
	}, [repoPath, workspaceId]);

	const debouncedComments = useDebounce(comments, 500);
	const debouncedSummary = useDebounce(finalReviewComment, 500);

	useEffect(() => {
		const saveReview = async () => {
			if (!repoPath || workspaceId === undefined) return;
			if (debouncedComments.length === 0 && !debouncedSummary.trim()) return;
			try {
				await savePendingReview(
					repoPath,
					workspaceId,
					debouncedComments.map(toApiLineComment),
					undefined,
					debouncedSummary.trim() || undefined,
				);
			} catch (error) {
				console.error("Failed to auto-save review:", error);
			}
		};
		saveReview();
	}, [debouncedComments, debouncedSummary, repoPath, workspaceId]);

	useEffect(() => {
		if (files.length === 0) return;
		const currentFilePaths = new Set(files.map((f) => f.path));
		const staleViewedFiles: string[] = [];
		setViewedFiles((prev) => {
			let hasChanges = false;
			const next = new Map(prev);
			for (const [filePath, viewData] of prev.entries()) {
				if (!currentFilePaths.has(filePath)) {
					next.delete(filePath);
					hasChanges = true;
					continue;
				}
				const fileData = allFileHunks.get(filePath);
				if (fileData && !fileData.isLoading && fileData.hunks.length > 0) {
					const currentHash = computeHunksHash(fileData.hunks);
					if (viewData.contentHash && currentHash !== viewData.contentHash) {
						next.delete(filePath);
						staleViewedFiles.push(filePath);
						hasChanges = true;
					}
				}
			}
			return hasChanges ? next : prev;
		});
		for (const filePath of staleViewedFiles) {
			unmarkFileViewed(workspacePath, filePath).catch(() => {});
		}
	}, [files, allFileHunks, workspacePath]);

	const handleMarkFileViewed = useCallback(
		async (filePath: string) => {
			const fileData = allFileHunks.get(filePath);
			const contentHash = fileData?.hunks
				? computeHunksHash(fileData.hunks)
				: "";
			try {
				await markFileViewed(workspacePath, filePath, contentHash);
				const now = new Date().toISOString();
				setViewedFiles((prev) =>
					new Map(prev).set(filePath, { contentHash, viewedAt: now }),
				);
				setCollapsedFiles((prev) => new Set(prev).add(filePath));
			} catch {
				void 0; // mark-viewed best-effort
			}
		},
		[workspacePath, allFileHunks, setCollapsedFiles],
	);

	const handleUnmarkFileViewed = useCallback(
		async (filePath: string) => {
			try {
				await unmarkFileViewed(workspacePath, filePath);
				setViewedFiles((prev) => {
					const next = new Map(prev);
					next.delete(filePath);
					return next;
				});
				setCollapsedFiles((prev) => {
					const next = new Set(prev);
					next.delete(filePath);
					return next;
				});
			} catch {
				void 0; // unmark-viewed best-effort
			}
		},
		[workspacePath, setCollapsedFiles],
	);

	const formatReviewMarkdown = useCallback(
		() =>
			formatReviewMarkdownShared({
				comments,
				finalReviewComment,
				conflictComments,
				conflictRegionsByFile,
				actualConflictedFiles,
			}),
		[
			comments,
			conflictComments,
			finalReviewComment,
			conflictRegionsByFile,
			actualConflictedFiles,
		],
	);

	const handleRequestChanges = useCallback(
		async (mode: "plan" | "acceptEdits") => {
			setSendingReview(true);
			try {
				const markdown = formatReviewMarkdown();
				if (onCreateAgentWithReview) {
					await onCreateAgentWithReview(markdown, mode);
				} else {
					addToast({
						title: "No handler provided",
						description: "onCreateAgentWithReview callback not available",
						type: "error",
					});
					return;
				}
				if (pendingFilesData)
					applyChangedFilesRef.current(pendingFilesData, true);
				if (pendingHunksData) setAllFileHunks(pendingHunksData);
				setPendingFilesData(null);
				setPendingHunksData(null);
				setStaleFiles(new Set());
				setComments([]);
				setConflictComments(new Map());
				setHasUserAddedComments(false);
				setFinalReviewComment("");
				setReviewPopoverOpen(false);
				if (repoPath && workspaceId !== undefined)
					await clearPendingReview(repoPath, workspaceId);
				onReviewSubmitted?.();
			} catch (error) {
				addToast({
					description: error instanceof Error ? error.message : String(error),
					title: "Failed to send review",
					type: "error",
				});
			} finally {
				setSendingReview(false);
			}
		},
		[
			onCreateAgentWithReview,
			formatReviewMarkdown,
			addToast,
			onReviewSubmitted,
			repoPath,
			workspaceId,
			pendingFilesData,
			pendingHunksData,
			applyChangedFilesRef,
			setComments,
			setConflictComments,
			setHasUserAddedComments,
			setAllFileHunks,
		],
	);

	const handleCancelReview = useCallback(async () => {
		try {
			setComments([]);
			setConflictComments(new Map());
			setHasUserAddedComments(false);
			setFinalReviewComment("");
			setShowCancelDialog(false);
			setReviewPopoverOpen(false);
			if (repoPath && workspaceId !== undefined)
				await clearPendingReview(repoPath, workspaceId);
			addToast({
				title: "Review canceled",
				description: "All comments have been discarded",
				type: "success",
			});
		} catch (error) {
			addToast({
				description: error instanceof Error ? error.message : String(error),
				title: "Failed to cancel review",
				type: "error",
			});
		}
	}, [
		repoPath,
		workspaceId,
		addToast,
		setComments,
		setConflictComments,
		setHasUserAddedComments,
	]);

	const handleCopyReview = useCallback(async () => {
		try {
			const markdown = formatReviewMarkdown();
			await navigator.clipboard.writeText(markdown);
			setCopiedReview(true);
			setTimeout(() => setCopiedReview(false), 2000);
		} catch (error) {
			addToast({
				description: error instanceof Error ? error.message : String(error),
				title: "Failed to copy",
				type: "error",
			});
		}
	}, [formatReviewMarkdown, addToast]);

	const handleReloadWithPendingChanges = useCallback(() => {
		isReloadingRef.current = true;
		if (pendingFilesData) {
			const orphanedComments: LineComment[] = [];
			const validComments: LineComment[] = [];
			for (const comment of comments) {
				const newFileData = pendingHunksData?.get(comment.filePath);
				const fileStillExists = pendingFilesData.some(
					(f) => f.path === comment.filePath,
				);
				if (!fileStillExists || !newFileData) {
					orphanedComments.push(comment);
					continue;
				}
				if (comment.hunkId === FILE_COMMENT_HUNK_ID) {
					validComments.push(comment);
					continue;
				}
				const hunkStillExists = newFileData.hunks.some(
					(h) => h.id === comment.hunkId,
				);
				if (!hunkStillExists) {
					orphanedComments.push(comment);
					continue;
				}
				validComments.push(comment);
			}
			if (orphanedComments.length > 0) {
				addToast({
					description: `${orphanedComments.length} outdated comment${orphanedComments.length > 1 ? "s" : ""} discarded (lines changed)`,
					title: "Comments discarded",
					type: "info",
				});
			}
			setComments(validComments);
			applyChangedFilesRef.current(pendingFilesData, true);
		}
		if (pendingHunksData) {
			setAllFileHunks(pendingHunksData);
			setPendingHunksData(null);
		}
		setStaleFiles(new Set());
		setPendingFilesData(null);
		setTimeout(() => {
			isReloadingRef.current = false;
		}, 100);
	}, [
		pendingFilesData,
		pendingHunksData,
		comments,
		applyChangedFilesRef,
		isReloadingRef,
		addToast,
		setComments,
		setAllFileHunks,
	]);

	return {
		reviewPopoverOpen,
		setReviewPopoverOpen,
		finalReviewComment,
		setFinalReviewComment,
		showCancelDialog,
		setShowCancelDialog,
		copiedReview,
		sendingReview,
		staleFiles,
		setStaleFiles,
		pendingFilesData,
		setPendingFilesData,
		pendingHunksData,
		setPendingHunksData,
		viewedFiles,
		formatReviewMarkdown,
		handleRequestChanges,
		handleCancelReview,
		handleCopyReview,
		handleReloadWithPendingChanges,
		handleMarkFileViewed,
		handleUnmarkFileViewed,
	};
}
