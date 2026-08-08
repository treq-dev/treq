import { useState } from "react";
import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Cloud,
	Loader2,
} from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
	TargetBranchSelector,
	type BranchListItem,
} from "./TargetBranchSelector";
import { getValidTargets, type TreeLine } from "../lib/workspace-tree";
import { type Workspace } from "../lib/api";
import { cn } from "../lib/utils";
import { appendPathSuggestion } from "../lib/workspaceMetadata";
import { Button } from "./ui/button";

export interface WorkspaceLeftPanelProps {
	showRightPanel: boolean;
	sourceWorkspace: Workspace | null;
	hasSourceWorkspace: boolean;
	isStackOnRoot: boolean;
	availableBranches: BranchListItem[];
	branchesLoading: boolean;
	targetBranch: string | null;
	onSelectTargetBranch: (branch: string) => void;
	position: "before" | "after";
	onSetPosition: (pos: "before" | "after") => void;
	treePreview: TreeLine[];
	moveToExisting: boolean;
	onSetMoveToExisting: (val: boolean) => void;
	otherWorkspaces: Workspace[];
	targetWorkspaceId: number | null;
	onSetTargetWorkspaceId: (id: number) => void;
	description: string;
	onSetDescription: (val: string) => void;
	title: string;
	onSetTitle: (val: string) => void;
	sparsePaths: string;
	onSetSparsePaths: (val: string) => void;
	symlinkedDirs: string;
	onSetSymlinkedDirs: (val: string) => void;
	gitignoreSuggestions: string[];
	branchName: string;
	onSetBranchName: (val: string) => void;
	onSetIsEditingBranch: (val: boolean) => void;
	branchPattern: string;
	branchStatus: "new" | "local" | "remote" | "checking" | null;
	loading: boolean;
	allWorkspaces: Workspace[];
}

export const WorkspaceLeftPanel: React.FC<WorkspaceLeftPanelProps> = ({
	showRightPanel,
	sourceWorkspace,
	hasSourceWorkspace,
	isStackOnRoot,
	availableBranches,
	branchesLoading,
	targetBranch,
	onSelectTargetBranch,
	position,
	onSetPosition,
	treePreview,
	moveToExisting,
	onSetMoveToExisting,
	otherWorkspaces,
	targetWorkspaceId,
	onSetTargetWorkspaceId,
	description,
	onSetDescription,
	title,
	onSetTitle,
	sparsePaths,
	onSetSparsePaths,
	symlinkedDirs,
	onSetSymlinkedDirs,
	gitignoreSuggestions,
	branchName,
	onSetBranchName,
	onSetIsEditingBranch,
	branchPattern,
	branchStatus,
	loading,
	allWorkspaces,
}) => {
	const [advancedOpen, setAdvancedOpen] = useState(false);
	return (
		<div
			className={cn(
				"flex flex-col gap-3",
				showRightPanel ? "w-[280px] flex-shrink-0" : "w-full",
			)}
		>
			{/* Stacking On - always show */}
			<div className="grid gap-1.5">
				<Label className="text-xs">Stacking On</Label>
				{sourceWorkspace ? (
					<Input
						value={
							position === "before" && sourceWorkspace.target_branch
								? sourceWorkspace.target_branch
								: sourceWorkspace.branch_name
						}
						disabled
						className="text-xs text-muted-foreground h-8"
					/>
				) : (
					<TargetBranchSelector
						branches={
							!branchName
								? availableBranches
								: availableBranches.filter((b) =>
										getValidTargets(allWorkspaces, branchName).includes(b.name),
									)
						}
						loading={branchesLoading}
						targetBranch={targetBranch}
						onSelect={onSelectTargetBranch}
						disabled={loading}
					/>
				)}
			</div>

			{/* Position toggle - show when sourceWorkspace (not root) or when targetBranch chosen */}
			{((sourceWorkspace && !isStackOnRoot) ||
				(!sourceWorkspace && targetBranch)) && (
				<div className="flex items-center gap-2">
					<Label className="text-xs whitespace-nowrap">Position:</Label>
					<div className="flex gap-1 bg-muted p-0.5 rounded-md">
						{(["before", "after"] as const).map((pos) => (
							<button
								key={pos}
								type="button"
								onClick={() => onSetPosition(pos)}
								className={cn(
									"px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize",
									position === pos
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{pos}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Stack tree preview */}
			{treePreview.length > 0 && (
				<div className="bg-muted/50 rounded-md p-2 text-xs font-mono flex-shrink-0">
					{treePreview.map((line, i) => (
						<div
							key={i}
							className={cn(
								"leading-5",
								line.isNew && "text-green-500 font-semibold",
								line.isCurrent && "text-foreground font-semibold",
								!line.isNew && !line.isCurrent && "text-muted-foreground",
							)}
							style={{ paddingLeft: `${line.depth * 12}px` }}
						>
							{line.depth > 0 && (
								<span className="text-muted-foreground">{"└─ "}</span>
							)}
							{line.label}
							{line.isCurrent && (
								<span className="text-muted-foreground font-normal">
									{" "}
									(current)
								</span>
							)}
							{line.isNew && (
								<span className="text-green-500/70 font-normal"> (new)</span>
							)}
						</div>
					))}
				</div>
			)}

			{/* Move to existing workspace toggle */}
			{hasSourceWorkspace && sourceWorkspace && (
				<div className="border-t border-border/50 pt-3">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={moveToExisting}
							onChange={(e) => onSetMoveToExisting(e.target.checked)}
							className="rounded"
						/>
						<span className="text-xs text-muted-foreground">
							Move to existing workspace instead
						</span>
					</label>
				</div>
			)}

			{/* Existing workspace dropdown (when moveToExisting is on) */}
			{moveToExisting && (
				<div className="grid gap-1.5">
					<Label className="text-xs">Target Workspace</Label>
					{otherWorkspaces.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No other workspaces available.
						</p>
					) : (
						<select
							className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={targetWorkspaceId ?? ""}
							onChange={(e) => onSetTargetWorkspaceId(Number(e.target.value))}
						>
							{otherWorkspaces.map((w) => (
								<option key={w.id} value={w.id}>
									{w.branch_name}
								</option>
							))}
						</select>
					)}
				</div>
			)}

			{!moveToExisting && (
				<div className="grid gap-1.5">
					<Label htmlFor="title" className="text-xs">
						Title (optional)
					</Label>
					<Input
						id="title"
						value={title}
						onChange={(e) => onSetTitle(e.target.value)}
						placeholder="e.g., Settings Dark Mode"
						className="text-sm h-8"
					/>
				</div>
			)}

			{/* Description (hidden when moveToExisting) */}
			{!moveToExisting && (
				<div className="grid gap-1.5">
					<Label htmlFor="description" className="text-xs">
						Description (optional)
					</Label>
					<Textarea
						id="description"
						value={description}
						onChange={(e) => onSetDescription(e.target.value)}
						placeholder="e.g., Add dark mode to settings"
						rows={2}
						className="resize-none text-sm"
						autoFocus={!hasSourceWorkspace}
						tabIndex={1}
					/>
				</div>
			)}

			{/* Advanced options: sparse checkout + symlink dirs (plain creation only) */}
			{!moveToExisting && !sourceWorkspace && (
				<div className="grid gap-1.5">
					<button
						type="button"
						onClick={() => setAdvancedOpen(!advancedOpen)}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
					>
						{advancedOpen ? (
							<ChevronDown className="w-3 h-3" />
						) : (
							<ChevronRight className="w-3 h-3" />
						)}
						<span>Advanced</span>
					</button>
					{advancedOpen && (
						<div className="grid gap-3">
							<div className="grid gap-1.5">
								<Label htmlFor="sparse-paths" className="text-xs">
									Sparse paths (optional, one per line)
								</Label>
								<Textarea
									id="sparse-paths"
									value={sparsePaths}
									onChange={(e) => onSetSparsePaths(e.target.value)}
									placeholder={"e.g., src/api\ndocs"}
									rows={2}
									className="resize-none text-sm"
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="symlinked-dirs" className="text-xs">
									Symlink from home repo (optional, one per line)
								</Label>
								<Textarea
									id="symlinked-dirs"
									value={symlinkedDirs}
									onChange={(e) => onSetSymlinkedDirs(e.target.value)}
									placeholder={"e.g., node_modules\ntarget"}
									rows={2}
									className="resize-none text-sm"
								/>
								<p className="text-xs text-muted-foreground">
									Heavy dirs are linked instead of copied so each workspace
									shares the home tree.
								</p>
								{gitignoreSuggestions.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{gitignoreSuggestions.map((suggestion) => (
											<Button
												key={suggestion}
												type="button"
												variant="outline"
												size="sm"
												className="h-6 text-xs"
												onClick={() =>
													onSetSymlinkedDirs(
														appendPathSuggestion(symlinkedDirs, suggestion),
													)
												}
											>
												+ {suggestion}
											</Button>
										))}
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Branch name (hidden when moveToExisting) */}
			{!moveToExisting && (
				<div className="grid gap-1.5">
					<Label htmlFor="branch" className="text-xs">
						Branch Name
					</Label>
					<div className="relative max-w-[220px]">
						<Input
							id="branch"
							value={branchName}
							onChange={(e) => {
								onSetBranchName(e.target.value);
								onSetIsEditingBranch(true);
							}}
							placeholder={branchPattern.replace("{name}", "example")}
							className="pr-8 text-sm h-8"
							tabIndex={2}
						/>
						{branchStatus && (
							<div className="absolute right-2 top-1/2 -translate-y-1/2">
								{branchStatus === "checking" && (
									<Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
								)}
								{branchStatus === "new" && (
									<Check className="w-3.5 h-3.5 text-green-500" />
								)}
								{branchStatus === "local" && (
									<AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
								)}
								{branchStatus === "remote" && (
									<Cloud className="w-3.5 h-3.5 text-blue-500" />
								)}
							</div>
						)}
					</div>
					{branchStatus === "local" && (
						<p className="text-xs text-yellow-500">
							Branch already exists locally
						</p>
					)}
					{branchStatus === "remote" && (
						<p className="text-xs text-blue-500">
							Branch exists on remote — will check out
						</p>
					)}
				</div>
			)}
		</div>
	);
};
