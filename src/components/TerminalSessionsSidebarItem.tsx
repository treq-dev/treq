import {
	Bot,
	Loader2,
	Moon,
	MousePointer2,
	Sparkles,
	Terminal,
	X,
} from "lucide-react";
import {
	TERMINAL_IDLE_THRESHOLD_MS,
	type TerminalSessionSummary,
} from "./terminal/types";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface TerminalSessionsSidebarItemProps {
	session: TerminalSessionSummary;
	now: number;
	onFocus?: (id: string) => void;
	onClose?: (id: string) => void;
}

function getSessionIcon(session: TerminalSessionSummary) {
	if (session.kind === "shell") return Terminal;
	if (session.agent === "codex") return Sparkles;
	if (session.agent === "cursor") return MousePointer2;
	return Bot;
}

export const TerminalSessionsSidebarItem: React.FC<
	TerminalSessionsSidebarItemProps
> = ({ session, now, onFocus, onClose }) => {
	const Icon = getSessionIcon(session);
	const isIdle =
		!session.isStreaming &&
		now - session.lastActivityAt >= TERMINAL_IDLE_THRESHOLD_MS;
	const branchLabel = session.isMainRepo
		? session.branchName || "main"
		: session.branchName || "unknown";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					data-flip-id={session.id}
					data-testid={`terminal-session-item-${session.id}`}
					className="group/terminal relative flex items-center gap-1.5 px-1.5 py-1 rounded-sm cursor-pointer hover:bg-muted/50 transition-colors"
					onClick={() => onFocus?.(session.id)}
				>
					<Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
					<div className="flex-1 min-w-0 flex items-center gap-1.5">
						<span className="truncate max-w-[104px] text-xs font-medium text-foreground">
							{session.name}
						</span>
						<span className="truncate max-w-[86px] text-[11px] text-muted-foreground font-mono">
							{branchLabel}
						</span>
					</div>
					<div className="flex items-center shrink-0 gap-0.5">
						{session.isStreaming ? (
							<Loader2
								className="w-3 h-3 text-primary animate-spin shrink-0"
								aria-label="Active changes"
							/>
						) : isIdle ? (
							<Moon
								className="w-3 h-3 text-muted-foreground shrink-0"
								aria-label="Idle"
							/>
						) : null}
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className="h-4 w-4 opacity-0 group-hover/terminal:opacity-100 transition-opacity text-foreground"
							aria-label="Close terminal"
							onClick={(e) => {
								e.stopPropagation();
								onClose?.(session.id);
							}}
						>
							<X className="w-3 h-3" />
						</Button>
					</div>
				</div>
			</TooltipTrigger>
			<TooltipContent side="right" className="font-mono">
				<div className="flex items-center gap-1.5">
					<Icon className="w-3 h-3 shrink-0" />
					<span>{session.name}</span>
				</div>
				<div className="font-sans mt-1 text-muted-foreground">
					{branchLabel}
					{isIdle && " · Idle"}
					{session.isStreaming && " · Active changes"}
				</div>
			</TooltipContent>
		</Tooltip>
	);
};
