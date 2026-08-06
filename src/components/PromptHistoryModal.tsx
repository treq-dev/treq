import { useQuery } from "@tanstack/react-query";
import { Copy, History } from "lucide-react";
import { getPromptHistory, type PromptHistoryEntry } from "../lib/api";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { useToast } from "./ui/toast";

interface PromptHistoryModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	repoPath: string;
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
}) => {
	const { addToast } = useToast();

	const { data: entries = [], isPending } = useQuery({
		queryKey: ["prompt-history", repoPath],
		enabled: open && Boolean(repoPath),
		queryFn: () => getPromptHistory(repoPath),
	});

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
				className="flex w-[40vw] max-w-none max-h-[80vh] flex-col gap-y-4"
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

				<div className="flex-1 min-h-0 overflow-y-auto space-y-3">
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
					{entries.map((entry) => (
						<div
							key={entry.id}
							className="border border-border rounded-lg p-3 space-y-2"
							data-testid="prompt-history-entry"
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
									<span className="font-mono font-medium text-foreground truncate">
										{workspaceLabelFor(entry)}
									</span>
									<span>
										{new Date(entry.created_at).toLocaleString()}
									</span>
									{entry.agent && (
										<span className="rounded-full bg-muted px-2 py-0.5">
											{entry.agent}
										</span>
									)}
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-xs flex-shrink-0"
									onClick={() =>
										handleCopy(entry.prompt_text, "Prompt copied to clipboard")
									}
								>
									<Copy className="w-3 h-3 mr-1" />
									Copy
								</Button>
							</div>
							<p className="text-sm whitespace-pre-wrap break-words">
								{entry.prompt_text}
							</p>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
};
