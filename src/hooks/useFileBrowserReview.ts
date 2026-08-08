import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
	clearFileBrowserReview,
	loadFileBrowserReview,
	saveFileBrowserReview,
} from "../lib/api-extra";
import {
	formatReviewMarkdown,
	type LineComment,
	type PendingComment,
	toApiLineComment,
	toLocalLineComment,
} from "../lib/review";
import type { useToast } from "../components/ui/toast";
import { useDebounce } from "./useDebounce";

interface UseFileBrowserReviewParams {
	repoPath: string | null;
	workspaceId: number | undefined;
	onCreateAgentWithReview:
		| ((review: string, mode: "plan" | "acceptEdits") => Promise<void>)
		| undefined;
	addToast: ReturnType<typeof useToast>["addToast"];
}

/**
 * Owns the FileBrowser's own review session (comments accumulated while browsing
 * arbitrary files, batched and sent once). Kept independent from the Review/Changes
 * tab's session — see file_browser_reviews in local_db.rs.
 */
export function useFileBrowserReview({
	repoPath,
	workspaceId,
	onCreateAgentWithReview,
	addToast,
}: UseFileBrowserReviewParams) {
	const [comments, setComments] = useState<LineComment[]>([]);
	const [finalReviewComment, setFinalReviewComment] = useState("");
	const [reviewPopoverOpen, setReviewPopoverOpen] = useState(false);
	const [showCancelDialog, setShowCancelDialog] = useState(false);
	const [copiedReview, setCopiedReview] = useState(false);
	const [sendingReview, setSendingReview] = useState(false);

	useEffect(() => {
		const load = async () => {
			if (!repoPath || workspaceId === undefined) return;
			try {
				const review = await loadFileBrowserReview(repoPath, workspaceId);
				if (review) {
					setComments(review.comments.map(toLocalLineComment));
					if (review.summary_text) setFinalReviewComment(review.summary_text);
				}
			} catch (error) {
				console.error("Failed to load file browser review:", error);
			}
		};
		load();
	}, [repoPath, workspaceId]);

	const debouncedComments = useDebounce(comments, 500);
	const debouncedSummary = useDebounce(finalReviewComment, 500);

	useEffect(() => {
		const save = async () => {
			if (!repoPath || workspaceId === undefined) return;
			if (debouncedComments.length === 0 && !debouncedSummary.trim()) return;
			try {
				await saveFileBrowserReview(
					repoPath,
					workspaceId,
					debouncedComments.map(toApiLineComment),
					debouncedSummary.trim() || undefined,
				);
			} catch (error) {
				console.error("Failed to auto-save file browser review:", error);
			}
		};
		save();
	}, [debouncedComments, debouncedSummary, repoPath, workspaceId]);

	const addComment = useCallback(
		(pendingComment: PendingComment, text: string) => {
			if (!text.trim()) return;
			const newComment: LineComment = {
				id: uuidv4(),
				filePath: pendingComment.filePath,
				hunkId: pendingComment.hunkId,
				startLine: pendingComment.startLine,
				endLine: pendingComment.endLine,
				lineContent: pendingComment.lineContent,
				text: text.trim(),
				createdAt: new Date().toISOString(),
			};
			setComments((prev) => [...prev, newComment]);
		},
		[],
	);

	const deleteComment = useCallback((commentId: string) => {
		setComments((prev) => prev.filter((c) => c.id !== commentId));
	}, []);

	const formatMarkdown = useCallback(
		() => formatReviewMarkdown({ comments, finalReviewComment }),
		[comments, finalReviewComment],
	);

	const handleRequestChanges = useCallback(
		async (mode: "plan" | "acceptEdits") => {
			setSendingReview(true);
			try {
				const markdown = formatMarkdown();
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
				setComments([]);
				setFinalReviewComment("");
				setReviewPopoverOpen(false);
				if (repoPath && workspaceId !== undefined)
					await clearFileBrowserReview(repoPath, workspaceId);
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
		[onCreateAgentWithReview, formatMarkdown, addToast, repoPath, workspaceId],
	);

	const handleCancelReview = useCallback(async () => {
		try {
			setComments([]);
			setFinalReviewComment("");
			setShowCancelDialog(false);
			setReviewPopoverOpen(false);
			if (repoPath && workspaceId !== undefined)
				await clearFileBrowserReview(repoPath, workspaceId);
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
	}, [repoPath, workspaceId, addToast]);

	const handleCopyReview = useCallback(async () => {
		try {
			const markdown = formatMarkdown();
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
	}, [formatMarkdown, addToast]);

	return {
		comments,
		addComment,
		deleteComment,
		finalReviewComment,
		setFinalReviewComment,
		reviewPopoverOpen,
		setReviewPopoverOpen,
		showCancelDialog,
		setShowCancelDialog,
		copiedReview,
		sendingReview,
		handleRequestChanges,
		handleCancelReview,
		handleCopyReview,
	};
}
