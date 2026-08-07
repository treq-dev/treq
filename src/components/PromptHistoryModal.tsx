import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, History, Play } from "lucide-react";
import { getPromptHistory, type PromptHistoryEntry } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { useToast } from "./ui/toast";

interface PromptHistoryModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	repoPath: string;
	/** Pre-select this prompt's entry when the modal opens (e.g. from "View full prompt"). */
	initialSelectedId?: number | null;
	/** Called with a prompt's text and originating workspace when "Run prompt..." is clicked. */
	onRunPrompt?: (prompt: string, workspaceId: number | null) => void;
}

function workspaceLabelFor(entry: PromptHistoryEntry): string {
	if (entry.workspace_label) return entry.workspace_label;
	return entry.workspace_id === null ? "Home repo" : "Deleted workspace";
}

function formatPromptsForCopy(entries: PromptHistoryEntry[]): string {
	return entries
		.map(
			(entry) =>
				`[${workspaceLabelFor(entry)}] ${new Date(entry.created_at).toLocaleString()}\n${entry.prompt_text}`,
		)
		.join("\n\n---\n\n");
}

export const PromptHistoryModal: React.FC<PromptHistoryModalProps> = ({
	open,
	onOpenChange,
	repoPath,
	initialSelectedId = null,
	onRunPrompt,
}) => {
	const { addToast } = useToast();
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const wasOpenRef = useRef(false);

	const { data: entries = [], isPending } = useQuery({
		queryKey: ["prompt-history", repoPath],
		enabled: open && Boolean(repoPath),
		queryFn: () => getPromptHistory(repoPath),
	});

	// On the closed -> open transition, jump to the requested entry (or clear
	// the selection so the "entries loaded" effect below defaults to the
	// most recent one).
	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setSelectedId(initialSelectedId);
		}
		wasOpenRef.current = open;
	}, [open, initialSelectedId]);

	// Default to the most recent entry once entries load, unless something
	// (the effect above, or a user click) has already picked one.
	useEffect(() => {
		if (!open || selectedId !== null || entries.length === 0) return;
		setSelectedId(entries[0].id);
	}, [open, entries, selectedId]);

	const selectedEntry =
		entries.find((entry) => entry.id === selectedId) ?? null;

	const handleCopy = async (text: string, description: string) => {
		try {
			await navigator.clipboard.writeText(text);
			addToast({ title: "Copied", description, type: "success" });
		} catch (error) {
			addToast({
				title: "Failed to copy",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex w-[65vw] max-w-none h-[75vh] flex-col gap-y-4"
				data-testid="prompt-history-modal"
			>
				<DialogHeader className="flex-shrink-0">
					<div className="flex items-center justify-between gap-2">
						<DialogTitle className="flex items-center gap-2">
							<History className="w-4 h-4" />
							Prompt History
						</DialogTitle>
						{entries.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									handleCopy(
										formatPromptsForCopy(entries),
										"All prompts copied to clipboard",
									)
								}
							>
								<Copy className="w-4 h-4 mr-1.5" />
								Copy all
							</Button>
						)}
					</div>
				</DialogHeader>

				{isPending && (
					<p className="text-sm text-muted-foreground py-8 text-center">
						Loading prompt history...
					</p>
				)}
				{!isPending && entries.length === 0 && (
					<p className="text-sm text-muted-foreground py-8 text-center">
						No prompts sent yet.
					</p>
				)}
				{!isPending && entries.length > 0 && (
					<div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
						<div
							className="w-64 flex-shrink-0 overflow-y-auto space-y-1 pr-2 border-r border-border"
							data-testid="prompt-history-list"
						>
							{entries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									data-testid="prompt-history-list-item"
									aria-current={entry.id === selectedId}
									onClick={() => setSelectedId(entry.id)}
									className={cn(
										"w-full text-left rounded-md px-2 py-2 text-xs transition-colors",
										entry.id === selectedId
											? "bg-accent text-accent-foreground"
											: "hover:bg-accent/50",
									)}
								>
									<div className="font-mono font-medium truncate">
										{workspaceLabelFor(entry)}
									</div>
									<div className="text-muted-foreground truncate">
										{new Date(entry.created_at).toLocaleString()}
									</div>
									<div className="mt-1 truncate text-muted-foreground">
										{entry.prompt_text}
									</div>
								</button>
							))}
						</div>

						<div
							className="flex-1 min-w-0 overflow-y-auto"
							data-testid="prompt-history-detail"
						>
							{selectedEntry ? (
								<div className="space-y-2">
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
											<span className="font-mono font-medium text-foreground truncate">
												{workspaceLabelFor(selectedEntry)}
											</span>
											<span>
												{new Date(selectedEntry.created_at).toLocaleString()}
											</span>
											{selectedEntry.agent && (
												<span className="rounded-full bg-muted px-2 py-0.5">
													{selectedEntry.agent}
												</span>
											)}
										</div>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 px-2 text-xs flex-shrink-0"
											onClick={() =>
												handleCopy(
													selectedEntry.prompt_text,
													"Prompt copied to clipboard",
												)
											}
										>
											<Copy className="w-3 h-3 mr-1" />
											Copy
										</Button>
									</div>
									<p
										className="text-sm whitespace-pre-wrap break-words"
										data-testid="prompt-history-detail-text"
									>
										{selectedEntry.prompt_text}
									</p>
									{onRunPrompt && (
										<Button
											variant="default"
											size="sm"
											onClick={() =>
												onRunPrompt(
													selectedEntry.prompt_text,
													selectedEntry.workspace_id,
												)
											}
										>
											<Play className="w-3.5 h-3.5 mr-1.5" />
											Run prompt...
										</Button>
									)}
								</div>
							) : (
								<p className="text-sm text-muted-foreground py-8 text-center">
									Select a prompt to view its full text.
								</p>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};
