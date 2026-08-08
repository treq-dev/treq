import React from "react";
import {
	Bot,
	ChevronDown,
	ChevronUp,
	GitBranch,
	Home,
	Maximize2,
	Minimize2,
	Terminal,
} from "lucide-react";
import { type ConsolidatedTerminalHandle } from "./ConsolidatedTerminal";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { cn } from "../lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";
import { AgentTerminalPanel } from "./terminal/AgentTerminalPanel";
import { ResizeDivider } from "./terminal/ResizeDivider";
import { ShellTerminalPanel } from "./terminal/ShellTerminalPanel";
import { type ClaudeSessionData } from "./terminal/types";

interface ShellTerminalData {
	id: string;
	workingDirectory: string;
}

interface WorkspaceGroup {
	workspaceKey: string;
	workspaceName: string;
	isMainRepo: boolean;
	terminals: Array<
		| { type: "shell"; data: ShellTerminalData }
		| { type: "claude"; data: ClaudeSessionData }
	>;
}

interface WorkspaceTerminalPaneViewProps {
	paneRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	collapsed: boolean;
	maximized: boolean;
	height: number;
	isResizingHeight: boolean;
	handleHeightResizeMouseDown: (e: React.MouseEvent) => void;
	totalTerminals: number;
	handleCreateAgentSession: () => void;
	handleAddShell: () => void;
	setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
	setMaximized: React.Dispatch<React.SetStateAction<boolean>>;
	scrollContainerRef: React.RefObject<HTMLDivElement | null>;
	workspaceGroups: WorkspaceGroup[];
	containerWidth: number;
	onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
	currentBranch?: string | null;
	activePtySessionId: string | null;
	setActivePtySessionId: React.Dispatch<React.SetStateAction<string | null>>;
	handleCloseShell: (terminalId: string) => void | Promise<void>;
	onSessionError?: (message: string) => void;
	terminalRefs: React.RefObject<Map<string, ConsolidatedTerminalHandle | null>>;
	terminalWidths: Map<string, number | null>;
	handleTerminalResize: (
		leftId: string,
		rightId: string,
		deltaX: number,
	) => void;
	handleCloseClaudeSession: (sessionId: number) => void | Promise<void>;
	onTerminalOutput?: (terminalId: string) => void;
	onTerminalIdle?: (terminalId: string) => void;
}

export const WorkspaceTerminalPaneView: React.FC<
	WorkspaceTerminalPaneViewProps
> = ({
	paneRef,
	className,
	collapsed,
	maximized,
	height,
	isResizingHeight,
	handleHeightResizeMouseDown,
	totalTerminals,
	handleCreateAgentSession,
	handleAddShell,
	setCollapsed,
	setMaximized,
	scrollContainerRef,
	workspaceGroups,
	containerWidth,
	onNavigateToWorkspace,
	currentBranch,
	activePtySessionId,
	setActivePtySessionId,
	handleCloseShell,
	onSessionError,
	terminalRefs,
	terminalWidths,
	handleTerminalResize,
	handleCloseClaudeSession,
	onTerminalOutput,
	onTerminalIdle,
}) => (
	<div
		ref={paneRef as React.Ref<HTMLDivElement>}
		className={className}
		style={{ display: "contents" }}
	>
		{!collapsed && !maximized && (
			<div
				className="relative flex-shrink-0 h-1 group"
				onMouseDown={handleHeightResizeMouseDown}
			>
				<div
					className={cn(
						"absolute inset-x-0 top-0 h-1 bg-border transition-colors",
						"group-hover:bg-primary/50",
						isResizingHeight && "bg-primary",
					)}
				/>
				<div className="absolute inset-x-0 -top-1 h-3 cursor-ns-resize" />
			</div>
		)}

		<div
			className="flex flex-col border-t bg-background flex-shrink-0 overflow-hidden"
			style={{
				height: collapsed ? 32 : maximized ? "100%" : `${height}%`,
				maxHeight: collapsed ? 32 : maximized ? "100%" : "60%",
			}}
		>
			<div className="h-8 min-h-[32px] flex items-center justify-between px-2 border-b bg-muted/30 flex-shrink-0">
				<div className="flex items-center gap-2 font-medium text-muted-foreground">
					<span>Terminals</span>
					{totalTerminals > 0 && (
						<span className="text-xs bg-muted px-1.5 py-0.5 rounded">
							{totalTerminals}
						</span>
					)}
				</div>

				<div className="flex items-center gap-2">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									onClick={() => handleCreateAgentSession()}
									variant={totalTerminals === 0 ? "default" : "ghost"}
									className={cn(
										"h-6 px-2 rounded-sm gap-1",
										totalTerminals === 0
											? ""
											: "text-muted-foreground hover:text-foreground",
									)}
									aria-label="New Agent"
								>
									<Bot className="w-4 h-4" />
									Agent
								</Button>
							</TooltipTrigger>
							<TooltipContent className="flex items-center gap-1.5">
								New Agent Session
								<KbdGroup>
									<Kbd>⌘ + ]</Kbd>
								</KbdGroup>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									onClick={() => handleAddShell()}
									variant="ghost"
									className="h-6 px-2 rounded-sm gap-1 text-muted-foreground hover:text-foreground"
									aria-label="New Shell"
								>
									<Terminal className="w-4 h-4" /> Shell
								</Button>
							</TooltipTrigger>
							<TooltipContent className="flex items-center gap-1.5">
								New Shell
								<KbdGroup>
									<Kbd>⌘ + \</Kbd>
								</KbdGroup>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					{collapsed && totalTerminals > 0 && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={() => setCollapsed(false)}
										variant="ghost"
										className="h-5 w-5 rounded-sm p-0"
										aria-label="Expand terminal"
									>
										<ChevronUp className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									Expand
									<KbdGroup>
										<Kbd>⌘ + J</Kbd>
									</KbdGroup>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{!collapsed && maximized && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={() => setMaximized(false)}
										variant="ghost"
										className="h-5 w-5 rounded-sm p-0"
										aria-label="Restore terminal"
									>
										<Minimize2 className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									Restore
									<KbdGroup>
										<Kbd>⌘ + ^ + J</Kbd>
									</KbdGroup>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{!collapsed && !maximized && totalTerminals > 0 && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={() => setMaximized(true)}
										variant="ghost"
										className="h-5 w-5 rounded-sm p-0"
										aria-label="Maximize terminal"
									>
										<Maximize2 className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									Maximize
									<KbdGroup>
										<Kbd>⌘ + Ctrl+ J</Kbd>
									</KbdGroup>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{!collapsed && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={() => {
											setCollapsed(true);
											setMaximized(false);
										}}
										variant="ghost"
										className="h-5 w-5 rounded-sm p-0"
										aria-label="Collapse terminal"
									>
										<ChevronDown className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									Collapse
									<KbdGroup>
										<Kbd>⌘ + J</Kbd>
									</KbdGroup>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
				</div>
			</div>

			{!collapsed && (
				<div
					ref={scrollContainerRef as React.Ref<HTMLDivElement>}
					className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex"
					style={{ backgroundColor: "#1e1e1e" }}
				>
					{workspaceGroups.map((group, groupIndex) => {
						const minTerminalPx = containerWidth * 0.4 || 300;
						const groupMinWidth = group.terminals.length * minTerminalPx;
						const groupMaxWidth =
							workspaceGroups.length > 1 && group.terminals.length === 1
								? containerWidth * 0.5
								: undefined;
						return (
							<div
								key={group.workspaceKey}
								data-workspace-group={group.workspaceKey}
								className={cn(
									"flex flex-col min-h-0 flex-shrink-0",
									groupIndex > 0 && "border-l-2 border-border",
								)}
								style={{
									minWidth: groupMinWidth,
									maxWidth: groupMaxWidth,
									flex: "1 0 auto",
								}}
							>
								<div
									className="h-8 flex items-center gap-2 px-2 border-b border-border bg-gray-700/100 flex-shrink-0 sticky left-0 z-10 overflow-hidden cursor-pointer hover:bg-muted/40 transition-colors"
									style={{
										width: containerWidth > 0 ? containerWidth : undefined,
									}}
									onClick={() =>
										onNavigateToWorkspace?.(
											group.workspaceKey,
											group.isMainRepo,
										)
									}
								>
									{group.isMainRepo ? (
										<Home className="w-4 h-4 text-gray-200 flex-shrink-0" />
									) : (
										<GitBranch className="w-4 h-4 text-gray-200 flex-shrink-0" />
									)}
									<span
										className="text-sm text-gray-200 truncate font-mono"
										title={
											group.isMainRepo
												? currentBranch || "main"
												: group.workspaceName
										}
									>
										{group.isMainRepo
											? currentBranch || "main"
											: group.workspaceName}
									</span>
								</div>
								<div className="flex min-h-0 flex-1">
									{group.terminals.map((terminal, index) => {
										const isLastInGroup = index === group.terminals.length - 1;
										const nextTerminal = group.terminals[index + 1];

										if (terminal.type === "shell") {
											const terminalId = terminal.data.id;
											return (
												<React.Fragment key={terminalId}>
													<ShellTerminalPanel
														terminalData={terminal.data}
														collapsed={collapsed}
														isActive={activePtySessionId === terminalId}
														onFocus={() => setActivePtySessionId(terminalId)}
														onClose={() => handleCloseShell(terminalId)}
														canClose={true}
														onSessionError={onSessionError}
														onTerminalOutput={() =>
															onTerminalOutput?.(terminalId)
														}
														onTerminalIdle={() => onTerminalIdle?.(terminalId)}
														terminalRefs={
															terminalRefs as React.MutableRefObject<
																Map<string, ConsolidatedTerminalHandle | null>
															>
														}
														width={terminalWidths.get(terminalId)}
													/>
													{!isLastInGroup && nextTerminal && (
														<ResizeDivider
															onResize={(deltaX) => {
																const nextId =
																	nextTerminal.type === "shell"
																		? nextTerminal.data.id
																		: `claude-${nextTerminal.data.sessionId}`;
																handleTerminalResize(
																	terminalId,
																	nextId,
																	deltaX,
																);
															}}
														/>
													)}
												</React.Fragment>
											);
										}

										const terminalId = `claude-${terminal.data.sessionId}`;
										const ptyId = terminal.data.ptySessionId;
										return (
											<React.Fragment key={terminalId}>
												<AgentTerminalPanel
													sessionData={terminal.data}
													collapsed={collapsed}
													isActive={activePtySessionId === ptyId}
													onFocus={() => setActivePtySessionId(ptyId)}
													onClose={() =>
														handleCloseClaudeSession(terminal.data.sessionId)
													}
													onSessionError={onSessionError}
													onTerminalOutput={() =>
														onTerminalOutput?.(terminalId)
													}
													onTerminalIdle={() => onTerminalIdle?.(terminalId)}
													terminalRefs={
														terminalRefs as React.MutableRefObject<
															Map<string, ConsolidatedTerminalHandle | null>
														>
													}
													width={terminalWidths.get(terminalId)}
												/>
												{!isLastInGroup && nextTerminal && (
													<ResizeDivider
														onResize={(deltaX) => {
															const nextId =
																nextTerminal.type === "shell"
																	? nextTerminal.data.id
																	: `claude-${nextTerminal.data.sessionId}`;
															handleTerminalResize(terminalId, nextId, deltaX);
														}}
													/>
												)}
											</React.Fragment>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	</div>
);
