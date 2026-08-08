import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, GitBranch, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import { getArchivedWorkspaceCommits, getArchivedWorkspaces, restoreWorkspace } from "../lib/api";

interface ArchivedWorkspacesModalProps { open: boolean; onOpenChange: (open: boolean) => void; repoPath: string; }

const formatTime = (value?: string | null) => {
	if (!value) return "Unknown";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export const ArchivedWorkspacesModal: React.FC<ArchivedWorkspacesModalProps> = ({ open, onOpenChange, repoPath }) => {
	const queryClient = useQueryClient();
	const { addToast } = useToast();
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const { data: archivedWorkspaces = [], isPending } = useQuery({
		queryKey: ["archived-workspaces", repoPath], queryFn: () => getArchivedWorkspaces(repoPath), enabled: open && !!repoPath,
	});
	useEffect(() => {
		if (!archivedWorkspaces.some((workspace) => workspace.id === selectedId)) setSelectedId(archivedWorkspaces[0]?.id ?? null);
	}, [archivedWorkspaces, selectedId]);
	const selected = archivedWorkspaces.find((workspace) => workspace.id === selectedId) ?? null;
	const { data: commits = [], isPending: commitsPending } = useQuery({
		queryKey: ["archived-workspace-commits", repoPath, selectedId],
		queryFn: () => getArchivedWorkspaceCommits(repoPath, selectedId!), enabled: open && selectedId !== null,
	});
	const restoreMutation = useMutation({
		mutationFn: (workspaceId: number) => restoreWorkspace(repoPath, workspaceId),
		onSuccess: (workspace) => {
			queryClient.invalidateQueries({ queryKey: ["workspaces", repoPath] });
			queryClient.invalidateQueries({ queryKey: ["workspace-statuses", repoPath] });
			queryClient.invalidateQueries({ queryKey: ["archived-workspaces", repoPath] });
			addToast({ title: "Workspace Restored", description: `${workspace.branch_name} is back in your sidebar`, type: "success" });
		},
		onError: (error) => addToast({ title: "Restore Failed", description: error instanceof Error ? error.message : String(error), type: "error" }),
	});
	return <Dialog open={open} onOpenChange={onOpenChange}>
		<DialogContent className="sm:max-w-[900px]">
			<DialogHeader><DialogTitle>Archived Workspaces</DialogTitle><DialogDescription>Select a workspace to review its details and restore it.</DialogDescription></DialogHeader>
			<div className="grid min-h-[420px] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-md border">
				<div className="overflow-y-auto border-r bg-muted/20 p-2">
					{isPending && <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}
					{!isPending && !archivedWorkspaces.length && <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground"><Archive className="h-6 w-6" />No archived workspaces</div>}
					{archivedWorkspaces.map((workspace) => <button key={workspace.id} type="button" onClick={() => setSelectedId(workspace.id)} className={`w-full rounded-md px-3 py-2 text-left ${workspace.id === selectedId ? "bg-muted" : "hover:bg-muted/50"}`}>
						<div className="truncate text-sm font-medium">{workspace.title || workspace.branch_name}</div>
						<div className="mt-1 truncate text-xs text-muted-foreground">Updated {formatTime(workspace.refreshed_at ?? workspace.created_at)}</div>
					</button>)}
				</div>
				<div className="overflow-y-auto p-6">{selected && <div className="space-y-6">
					<div><h3 className="text-lg font-semibold">{selected.title || selected.branch_name}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.description || "No description"}</p></div>
					<div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target branch</div><div className="mt-1 flex items-center gap-2 font-mono text-sm"><GitBranch className="h-4 w-4" />{selected.target_branch || "Default branch"}</div></div>
					<div><div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Commit history</div>
						{commitsPending ? <p className="text-sm text-muted-foreground">Loading commits…</p> : commits.length ? <ul className="divide-y rounded-md border">{commits.map((commit) => <li key={commit.commit_id ?? commit.short_id} className="flex gap-3 px-3 py-2 text-sm"><code className="text-muted-foreground">{commit.short_id}</code><span className="min-w-0 flex-1 truncate">{commit.description || "No description"}</span><time className="text-xs text-muted-foreground">{formatTime(commit.timestamp)}</time></li>)}</ul> : <p className="text-sm text-muted-foreground">No commits</p>}
					</div>
					<Button size="sm" variant="outline" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate(selected.id)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{restoreMutation.isPending ? "Restoring…" : "Restore"}</Button>
				</div>}</div>
			</div>
			<div className="flex justify-end"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
		</DialogContent>
	</Dialog>;
};
