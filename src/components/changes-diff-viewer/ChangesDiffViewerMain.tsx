/* eslint-disable max-lines */

import React, {
	forwardRef,
	memo,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { type ParsedFileChange } from "../../lib/git-utils";
import { useDiffSettings } from "../../hooks/useDiffSettings";
import { useDiffSearch } from "./hooks/useDiffSearch";
import { useLineSelection } from "./hooks/useLineSelection";
import { useComments } from "./hooks/useComments";
import { useGithubReviewThreads } from "./hooks/useGithubReviewThreads";
import { useFileStaging } from "./hooks/useFileStaging";
import { useFileLoading } from "./hooks/useFileLoading";
import { useReview } from "./hooks/useReview";
import { useConflicts } from "./hooks/useConflicts.ts";
import { useFileActions } from "./hooks/useFileActions";
import { useToast } from "../ui/toast";
import { ContextMenu } from "./ContextMenu";
import { ReviewActionBar } from "./ReviewActionBar";
import { DiffContentArea } from "./DiffContentArea";
import { FileSidebar } from "./FileSidebar";
import { filesEqual } from "./utils";
import type {
	ChangesDiffViewerHandle,
	ChangesDiffViewerProps,
	CommitInputHandle,
	FileHunksData,
} from "./types";

export const ChangesDiffViewer = memo(
	forwardRef<ChangesDiffViewerHandle, ChangesDiffViewerProps>(
		(
			{
				workspacePath,
				repoPath,
				workspaceId,
				branchName,
				readOnly = false,
				onStagedFilesChange,
				onChangedFilesChange,
				onRefreshingChange,
				initialSelectedFile,
				onReviewSubmitted,
				onCreateAgentWithReview,
				conflictedFiles = [],
				showCommittedChanges = false,
				onMoveFilesToNewWorkspace,
				workspace,
				baseBranch,
			},
			ref,
		) => {
			void conflictedFiles;
			const { addToast } = useToast();
			const { fontSize: diffFontSize } = useDiffSettings();

			const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
			const [committedSectionCollapsed, setCommittedSectionCollapsed] =
				useState(false);
			const conflictFileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
			const commitInputRef = useRef<CommitInputHandle>(null);
			const diffContainerRef = useRef<HTMLDivElement>(null);
			const isReloadingRef = useRef<boolean>(false);
			const applyChangedFilesRef = useRef<
				(parsed: ParsedFileChange[], forceApply?: boolean) => void
			>(() => {});
			const isInReviewModeRef = useRef<boolean>(false);
			const setStaleFilesRef = useRef<
				React.Dispatch<React.SetStateAction<Set<string>>>
			>(() => {});
			const setPendingHunksDataRef = useRef<
				React.Dispatch<React.SetStateAction<Map<string, FileHunksData> | null>>
			>(() => {});
			const setLargeChangesetExpandedRef = useRef<
				React.Dispatch<React.SetStateAction<boolean>>
			>(() => {});

			const {
				files,
				setFiles,
				allFileHunks,
				setAllFileHunks,
				committedFileHunks,
				loadingAllHunks,
				initialLoading,
				committedFiles,
				invalidateCache,
				refresh,
				loadChangedFiles,
				refreshCommittedChanges,
			} = useFileLoading({
				workspacePath,
				repoPath,
				workspaceId,
				showCommittedChanges,
				onRefreshingChange,
				setLargeChangesetExpandedRef,
				applyChangedFilesRef,
				isInReviewModeRef,
				setStaleFilesRef,
				setPendingHunksDataRef,
				isReloadingRef,
				addToast,
			});
			const {
				actualConflictedFiles,
				conflictRegionsByFile,
				conflictLineLookups,
				firstConflictRegionIdByFile,
			} = useConflicts({
				allFileHunks,
				committedFileHunks,
				conflictedFilesHint: conflictedFiles,
			});

			const {
				stagedFiles,
				setStagedFiles,
				selectedUnstagedFiles,
				setSelectedUnstagedFiles,
				lastSelectedFileIndex,
				selectedStagedFiles,
				setSelectedStagedFiles,
				lastSelectedStagedIndex,
				collapsedFiles,
				setCollapsedFiles,
				collapsedSections,
				expandedLargeDiffs,
				setExpandedLargeDiffs,
				largeChangesetExpanded,
				setLargeChangesetExpanded,
				unstagedFiles,
				stagedFilesList,
				scrollToFileIfNeeded,
				handleFileSelect,
				handleStageFile,
				handleUnstageFile,
				handleUnstageAllFiles,
				handleStagedFileSelect,
				toggleFileCollapse,
				toggleLargeDiff,
				toggleSectionCollapse,
				handleStageAllFiles,
				handleSelectAllUnstaged,
				handleSelectAllStaged,
			} = useFileStaging({ files, diffContainerRef });
			setLargeChangesetExpandedRef.current = setLargeChangesetExpanded;

			const {
				isSearchOpen,
				searchQuery,
				setSearchQuery,
				searchData,
				debouncedSearchQuery,
				currentMatchIndex,
				setCurrentMatchIndex,
				searchFocusTrigger,
				handleSearchNext,
				handleSearchPrevious,
				handleSearchClose,
			} = useDiffSearch({
				files,
				allFileHunks,
				collapsedFiles,
				expandedLargeDiffs,
				showCommittedChanges: showCommittedChanges ?? false,
				committedFiles,
				committedFileHunks,
				conflictRegionsByFile,
				conflictLineLookups,
				workspacePath,
				diffContainerRef,
			});

			const {
				diffLineSelection,
				contextMenuPosition,
				setContextMenuPosition,
				clearSelection,
				handleLineMouseDown,
				handleLineMouseEnter,
				handleLineMouseUp,
				handleBackgroundClick,
				handleContextMenu,
				isLineSelected,
			} = useLineSelection({
				allFileHunks,
				onClearFileSelections: () => {
					setSelectedUnstagedFiles(new Set());
					setSelectedStagedFiles(new Set());
				},
			});

			const {
				comments,
				setComments,
				conflictComments,
				setConflictComments,
				openConflictComments,
				setOpenConflictComments,
				editingConflictCommentId,
				showCommentInput,
				setShowCommentInput,
				pendingComment,
				setPendingComment,
				editingCommentId,
				hasUserAddedComments,
				setHasUserAddedComments,
				addComment,
				handleAddCommentFromSelection,
				cancelComment,
				deleteComment,
				startEditComment,
				cancelEditComment,
				saveEditComment,
				saveConflictComment,
				clearConflictComment,
				startEditConflictComment,
				cancelEditConflictComment,
				saveEditConflictComment,
				toggleConflictComment,
				getOutdatedCommentsForFile,
				getFileCommentsForFile,
				getAllOutdatedComments,
				handleCopyOutdatedComments,
				getCommentsForLine,
			} = useComments({
				allFileHunks,
				diffLineSelection,
				clearSelection,
				setContextMenuPosition,
				addToast,
			});

			const {
				getThreadsForLine,
				getUnplacedThreadsForFile,
				collapsedThreadIds,
				toggleThreadCollapse,
				expandedOutdatedGroups,
				toggleOutdatedGroup,
			} = useGithubReviewThreads({
				repoPath,
				branchName,
				allFileHunks,
				committedFileHunks,
			});

			const {
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
				setPendingFilesData,
				setPendingHunksData,
				viewedFiles,
				handleRequestChanges,
				handleCancelReview,
				handleCopyReview,
				handleReloadWithPendingChanges,
				handleMarkFileViewed,
				handleUnmarkFileViewed,
			} = useReview({
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
			});

			const isInReviewMode = useMemo(
				() =>
					hasUserAddedComments ||
					showCommentInput ||
					reviewPopoverOpen ||
					finalReviewComment.trim().length > 0,
				[
					hasUserAddedComments,
					showCommentInput,
					reviewPopoverOpen,
					finalReviewComment,
				],
			);

			isInReviewModeRef.current = isInReviewMode;
			setStaleFilesRef.current = setStaleFiles;
			setPendingHunksDataRef.current = setPendingHunksData;

			const applyChangedFiles = useCallback(
				(parsed: ParsedFileChange[], forceApply = false) => {
					onChangedFilesChange?.(parsed);
					if (isInReviewMode && !forceApply) {
						setFiles((prev) => {
							if (filesEqual(prev, parsed)) return prev;
							const prevPaths = new Set(prev.map((f) => f.path));
							const newPaths = new Set(parsed.map((f) => f.path));
							const changedFiles = new Set<string>();
							for (const path of newPaths) {
								if (!prevPaths.has(path)) changedFiles.add(path);
							}
							for (const path of prevPaths) {
								if (!newPaths.has(path)) changedFiles.add(path);
							}
							for (const newFile of parsed) {
								const oldFile = prev.find((f) => f.path === newFile.path);
								if (
									oldFile &&
									(oldFile.stagedStatus !== newFile.stagedStatus ||
										oldFile.workspaceStatus !== newFile.workspaceStatus)
								) {
									changedFiles.add(newFile.path);
								}
							}
							if (changedFiles.size > 0) {
								setStaleFiles(
									(prevStale) => new Set([...prevStale, ...changedFiles]),
								);
								setPendingFilesData(parsed);
							}
							return prev;
						});
						return;
					}
					setFiles((prev) => (filesEqual(prev, parsed) ? prev : parsed));
					setStaleFiles(new Set());
					setPendingFilesData(null);
					setPendingHunksData(null);
					if (
						initialSelectedFile &&
						parsed.some((f) => f.path === initialSelectedFile)
					) {
						setSelectedUnstagedFiles(new Set([initialSelectedFile]));
					}
					if (onStagedFilesChange) {
						const staged = parsed
							.filter((f) => f.stagedStatus && f.stagedStatus !== " ")
							.map((f) => f.path);
						onStagedFilesChange(Array.from(new Set(staged)));
					}
				},
				[
					initialSelectedFile,
					onStagedFilesChange,
					onChangedFilesChange,
					isInReviewMode,
					setFiles,
					setStaleFiles,
					setPendingFilesData,
					setPendingHunksData,
					setSelectedUnstagedFiles,
				],
			);
			applyChangedFilesRef.current = applyChangedFiles;

			useImperativeHandle(
				ref,
				() => ({
					focusCommitInput: () => {
						commitInputRef.current?.focus();
					},
					refresh: () => {
						loadChangedFiles();
					},
				}),
				[loadChangedFiles],
			);

			const {
				fileActionTarget,
				expandedContext,
				commitPending,
				pendingAction,
				canCreatePr,
				hasPr,
				handleDiscardAll,
				handleDiscardFiles,
				handleCopyLineLocation,
				handleCopyLines,
				handleCommit,
				handleCommitAndPush,
				handleCommitAndCreatePR,
				handleExpandContext,
			} = useFileActions({
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
				refresh,
				loadChangedFiles,
				refreshCommittedChanges,
				setCommittedSectionCollapsed,
				addToast,
			});

			const hasConflicts = actualConflictedFiles.length > 0;
			const totalComments = comments.length + conflictComments.size;
			const showActionBar = hasConflicts || comments.length > 0;

			return (
				<div
					className="flex h-full overflow-hidden"
					onClick={handleBackgroundClick}
				>
					<FileSidebar
						commitInputRef={commitInputRef}
						handleCommit={handleCommit}
						handleCommitAndPush={handleCommitAndPush}
						handleCommitAndCreatePR={handleCommitAndCreatePR}
						pendingAction={pendingAction}
						canCreatePr={canCreatePr}
						hasPr={hasPr}
						readOnly={readOnly}
						files={files}
						commitPending={commitPending}
						stagedFiles={stagedFiles}
						initialLoading={initialLoading}
						actualConflictedFiles={actualConflictedFiles}
						collapsedSections={collapsedSections}
						toggleSectionCollapse={toggleSectionCollapse}
						activeFilePath={activeFilePath}
						setActiveFilePath={setActiveFilePath}
						setLargeChangesetExpanded={setLargeChangesetExpanded}
						setCollapsedFiles={setCollapsedFiles}
						setExpandedLargeDiffs={setExpandedLargeDiffs}
						conflictFileRefs={conflictFileRefs}
						showCommittedChanges={showCommittedChanges}
						committedFiles={committedFiles}
						committedSectionCollapsed={committedSectionCollapsed}
						setCommittedSectionCollapsed={setCommittedSectionCollapsed}
						scrollToFileIfNeeded={scrollToFileIfNeeded}
						stagedFilesList={stagedFilesList}
						selectedStagedFiles={selectedStagedFiles}
						lastSelectedStagedIndex={lastSelectedStagedIndex}
						handleStagedFileSelect={handleStagedFileSelect}
						handleSelectAllStaged={handleSelectAllStaged}
						handleUnstageFile={handleUnstageFile}
						handleUnstageAllFiles={handleUnstageAllFiles}
						setSelectedStagedFiles={setSelectedStagedFiles}
						unstagedFiles={unstagedFiles}
						selectedUnstagedFiles={selectedUnstagedFiles}
						lastSelectedFileIndex={lastSelectedFileIndex}
						handleFileSelect={handleFileSelect}
						onMoveFilesToNewWorkspace={onMoveFilesToNewWorkspace}
						handleDiscardAll={handleDiscardAll}
						handleDiscardFiles={handleDiscardFiles}
						setSelectedUnstagedFiles={setSelectedUnstagedFiles}
						handleSelectAllUnstaged={handleSelectAllUnstaged}
						handleStageFile={handleStageFile}
						handleStageAllFiles={handleStageAllFiles}
						fileActionTarget={fileActionTarget}
						workspacePath={workspacePath}
					/>

					<div className="flex-1 flex flex-col min-w-0">
						<ReviewActionBar
							showActionBar={showActionBar}
							hasConflicts={hasConflicts}
							totalComments={totalComments}
							comments={comments}
							staleFiles={staleFiles}
							reviewPopoverOpen={reviewPopoverOpen}
							setReviewPopoverOpen={setReviewPopoverOpen}
							finalReviewComment={finalReviewComment}
							setFinalReviewComment={setFinalReviewComment}
							showCancelDialog={showCancelDialog}
							setShowCancelDialog={setShowCancelDialog}
							copiedReview={copiedReview}
							sendingReview={sendingReview}
							handleCopyReview={handleCopyReview}
							handleCancelReview={handleCancelReview}
							handleRequestChanges={handleRequestChanges}
							handleReloadWithPendingChanges={handleReloadWithPendingChanges}
							getAllOutdatedComments={getAllOutdatedComments}
							handleCopyOutdatedComments={handleCopyOutdatedComments}
						/>
						<DiffContentArea
							isSearchOpen={isSearchOpen}
							searchQuery={searchQuery}
							setSearchQuery={setSearchQuery}
							currentMatchIndex={currentMatchIndex}
							setCurrentMatchIndex={setCurrentMatchIndex}
							handleSearchNext={handleSearchNext}
							handleSearchPrevious={handleSearchPrevious}
							handleSearchClose={handleSearchClose}
							searchFocusTrigger={searchFocusTrigger}
							searchData={searchData}
							debouncedSearchQuery={debouncedSearchQuery}
							initialLoading={initialLoading}
							loadingAllHunks={loadingAllHunks}
							files={files}
							allFileHunks={allFileHunks}
							committedFiles={committedFiles}
							committedFileHunks={committedFileHunks}
							showCommittedChanges={showCommittedChanges}
							largeChangesetExpanded={largeChangesetExpanded}
							setLargeChangesetExpanded={setLargeChangesetExpanded}
							actualConflictedFiles={actualConflictedFiles}
							conflictLineLookups={conflictLineLookups}
							firstConflictRegionIdByFile={firstConflictRegionIdByFile}
							expandedContext={expandedContext}
							conflictComments={conflictComments}
							openConflictComments={openConflictComments}
							editingConflictCommentId={editingConflictCommentId}
							diffLineSelection={diffLineSelection}
							showCommentInput={showCommentInput}
							pendingComment={pendingComment}
							editingCommentId={editingCommentId}
							comments={comments}
							conflictFileRefs={conflictFileRefs}
							diffFontSize={diffFontSize}
							handleExpandContext={handleExpandContext}
							handleLineMouseDown={handleLineMouseDown}
							handleLineMouseEnter={handleLineMouseEnter}
							handleLineMouseUp={handleLineMouseUp}
							handleAddCommentFromSelection={handleAddCommentFromSelection}
							isLineSelected={isLineSelected}
							saveConflictComment={saveConflictComment}
							clearConflictComment={clearConflictComment}
							toggleConflictComment={toggleConflictComment}
							setOpenConflictComments={setOpenConflictComments}
							startEditConflictComment={startEditConflictComment}
							cancelEditConflictComment={cancelEditConflictComment}
							saveEditConflictComment={saveEditConflictComment}
							addComment={addComment}
							cancelComment={cancelComment}
							deleteComment={deleteComment}
							startEditComment={startEditComment}
							cancelEditComment={cancelEditComment}
							saveEditComment={saveEditComment}
							setPendingComment={setPendingComment}
							setShowCommentInput={setShowCommentInput}
							getCommentsForLine={getCommentsForLine}
							getThreadsForLine={getThreadsForLine}
							getUnplacedThreadsForFile={getUnplacedThreadsForFile}
							collapsedThreadIds={collapsedThreadIds}
							toggleThreadCollapse={toggleThreadCollapse}
							expandedOutdatedGroups={expandedOutdatedGroups}
							toggleOutdatedGroup={toggleOutdatedGroup}
							collapsedFiles={collapsedFiles}
							viewedFiles={viewedFiles}
							expandedLargeDiffs={expandedLargeDiffs}
							readOnly={readOnly}
							fileActionTarget={fileActionTarget}
							selectedUnstagedFiles={selectedUnstagedFiles}
							workspacePath={workspacePath}
							toggleFileCollapse={toggleFileCollapse}
							toggleLargeDiff={toggleLargeDiff}
							handleMarkFileViewed={handleMarkFileViewed}
							handleUnmarkFileViewed={handleUnmarkFileViewed}
							handleDiscardFiles={handleDiscardFiles}
							handleContextMenu={handleContextMenu}
							addToast={addToast}
							getOutdatedCommentsForFile={getOutdatedCommentsForFile}
							getFileCommentsForFile={getFileCommentsForFile}
							diffContainerRef={diffContainerRef}
						/>
					</div>

					{contextMenuPosition &&
						diffLineSelection &&
						diffLineSelection.lines.length > 0 && (
							<ContextMenu
								position={contextMenuPosition}
								onAddComment={handleAddCommentFromSelection}
								onCopyLocation={handleCopyLineLocation}
								onCopyLines={handleCopyLines}
							/>
						)}
				</div>
			);
		},
	),
);

ChangesDiffViewer.displayName = "ChangesDiffViewer";

export default ChangesDiffViewer;
