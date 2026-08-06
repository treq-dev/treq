import React, { memo, useEffect, useState } from "react";
import { Terminal, X } from "lucide-react";
import { ConsolidatedTerminal } from "../ConsolidatedTerminal";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../ui/tooltip";
import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import { cn } from "../../lib/utils";
import { getTreqBinDir } from "../../lib/api";
import { type ShellTerminalData, type TerminalRefsMap } from "./types";

interface ShellTerminalPanelProps {
	terminalData: ShellTerminalData;
	collapsed: boolean;
	isActive?: boolean;
	onFocus?: () => void;
	onClose?: () => void;
	canClose: boolean;
	onSessionError?: (message: string) => void;
	onTerminalOutput?: (output: string) => void;
	onTerminalIdle?: () => void;
	terminalRefs: React.MutableRefObject<TerminalRefsMap>;
	width?: number | null;
}

export const ShellTerminalPanel = memo<ShellTerminalPanelProps>(
	({
		terminalData,
		collapsed,
		isActive,
		onFocus,
		onClose,
		canClose,
		onSessionError,
		onTerminalOutput,
		onTerminalIdle,
		terminalRefs,
		width,
	}) => {
		const isHidden = collapsed;
		const [pathAutoCommand, setPathAutoCommand] = useState<string | undefined>(
			undefined,
		);

		useEffect(() => {
			getTreqBinDir()
				.then((binDir) => {
					setPathAutoCommand(`export PATH="${binDir}:$PATH"`);
				})
				.catch(() => {
					// silently ignore — treq PATH injection is best-effort
				});
		}, []);

		return (
			<div
				data-terminal-id={terminalData.id}
				className={cn(
					"flex flex-col min-h-0 overflow-hidden flex-shrink-0",
					width == null && "flex-1",
				)}
				style={{
					width: width != null ? width : undefined,
				}}
				onMouseDown={onFocus}
			>
				{/* Header */}
				<div
					className={cn(
						"h-7 min-h-[28px] flex items-center justify-between px-2 border-b border-r border-border flex-shrink-0",
						isActive ? "bg-primary/20" : "bg-background",
					)}
				>
					<div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground min-w-0">
						<Terminal className="w-3 h-3 flex-shrink-0" />
						<span className="truncate">Shell</span>
					</div>
					{canClose && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={onClose}
										variant="ghost"
										className="h-4 w-4 rounded-sm p-0 opacity-60 hover:opacity-100"
										aria-label="Close shell"
									>
										<X className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									Close
									<KbdGroup>
										<Kbd>⌘ + W</Kbd>
									</KbdGroup>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
				</div>

				{/* Terminal */}
				<div
					className="flex-1 min-h-0 overflow-hidden border-r border-border"
					style={{ backgroundColor: "#1e1e1e" }}
				>
					<ConsolidatedTerminal
						ref={(el) => {
							if (el) {
								terminalRefs.current.set(terminalData.id, el);
							} else {
								terminalRefs.current.delete(terminalData.id);
							}
						}}
						sessionId={terminalData.id}
						workingDirectory={terminalData.workingDirectory}
						autoCommand={pathAutoCommand}
						onSessionError={onSessionError}
						onTerminalOutput={onTerminalOutput}
						onTerminalIdle={onTerminalIdle}
						onClose={onClose}
						containerClassName="h-full w-full overflow-hidden"
						terminalPaneClassName="w-full h-full"
						isHidden={isHidden}
					/>
				</div>
			</div>
		);
	},
);
