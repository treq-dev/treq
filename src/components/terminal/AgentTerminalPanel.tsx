import React, {
	type KeyboardEvent as ReactKeyboardEvent,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	ConsolidatedTerminal,
	type ConsolidatedTerminalHandle,
} from "../ConsolidatedTerminal";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../ui/tooltip";
import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import { cn } from "../../lib/utils";
import {
	getSessionModel,
	getTreqBinDir,
	ptyClose,
	setSessionModel,
} from "../../lib/api";
import {
	ArrowDownToLine,
	Bot,
	ChevronDown,
	ChevronUp,
	Loader2,
	MousePointer2,
	RotateCw,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { ModelSelector } from "../ModelSelector";
import { Input } from "../ui/input";
import { useToast } from "../ui/toast";
import { shellQuote } from "../../lib/shellQuote";
import {
	appendAgentPrompt,
	treqAgentSystemPrompt,
} from "../../lib/agentCommand";
import { type ClaudeSessionData } from "./types";

export interface AgentTerminalPanelProps {
	sessionData: ClaudeSessionData;
	collapsed: boolean;
	isActive?: boolean;
	onFocus?: () => void;
	onClose?: () => void;
	onSessionError?: (message: string) => void;
	onTerminalOutput?: (output: string) => void;
	onTerminalIdle?: () => void;
	terminalRefs: React.MutableRefObject<
		Map<string, ConsolidatedTerminalHandle | null>
	>;
	width?: number | null;
}

export const AgentTerminalPanel = memo<AgentTerminalPanelProps>(
	({
		sessionData,
		collapsed,
		isActive,
		onFocus,
		onClose,
		onSessionError,
		onTerminalOutput,
		onTerminalIdle,
		terminalRefs,
		width,
	}) => {
		const { addToast } = useToast();
		const searchInputRef = useRef<HTMLInputElement>(null);
		const [searchVisible, setSearchVisible] = useState(false);
		const [searchQuery, setSearchQuery] = useState("");
		const [isResetting, setIsResetting] = useState(false);
		const [sessionModel, setSessionModelState] = useState<string | null>(null);
		const [isChangingModel, setIsChangingModel] = useState(false);
		const [isModelLoaded, setIsModelLoaded] = useState(false);
		const [terminalInstanceKey, setTerminalInstanceKey] = useState(0);
		const [pendingModelReset, setPendingModelReset] = useState(false);
		const [treqBinDir, setTreqBinDir] = useState<string | null>(null);

		const terminalId = `claude-${sessionData.sessionId}`;
		const isHidden = collapsed;

		// Capture pendingPrompt and permissionMode in refs so they survive
		// the race condition where sessions refetch clears pendingClaudeSession
		// before isModelLoaded becomes true and ConsolidatedTerminal mounts.
		const pendingPromptRef = useRef(sessionData.pendingPrompt);
		const permissionModeRef = useRef(sessionData.permissionMode);

		// Load session model and treq bin dir on mount
		useEffect(() => {
			const loadModel = async () => {
				try {
					const model = await getSessionModel(
						sessionData.repoPath,
						sessionData.sessionId,
					);
					setSessionModelState(model);
				} catch (error) {
					console.error("Failed to load session model:", error);
				} finally {
					setIsModelLoaded(true);
				}
			};
			loadModel();
			getTreqBinDir()
				.then(setTreqBinDir)
				.catch(() => {});
		}, [sessionData.repoPath, sessionData.sessionId]);

		// Handle terminal output
		const handleTerminalOutput = useCallback(
			(output: string) => {
				// Forward to parent callback
				onTerminalOutput?.(output);
			},
			[onTerminalOutput],
		);

		// Search handlers
		const openSearchPanel = useCallback(() => {
			setSearchVisible(true);
			requestAnimationFrame(() => {
				searchInputRef.current?.focus();
				searchInputRef.current?.select();
			});
		}, []);

		const closeSearchPanel = useCallback(() => {
			setSearchVisible(false);
			setSearchQuery("");
			terminalRefs.current.get(terminalId)?.clearSearch();
		}, [terminalRefs, terminalId]);

		const runSearch = useCallback(
			(direction: "next" | "previous") => {
				if (!searchQuery.trim()) return;
				const terminal = terminalRefs.current.get(terminalId);
				if (!terminal) return;
				if (direction === "next") {
					terminal.findNext(searchQuery);
				} else {
					terminal.findPrevious(searchQuery);
				}
			},
			[searchQuery, terminalRefs, terminalId],
		);

		const handleSearchKeyDown = useCallback(
			(e: ReactKeyboardEvent<HTMLInputElement>) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (e.shiftKey) {
						runSearch("previous");
					} else {
						runSearch("next");
					}
				} else if (e.key === "Escape") {
					closeSearchPanel();
				}
			},
			[runSearch, closeSearchPanel],
		);

		// Reset handler - silent option used when reset is triggered by model change
		const handleReset = useCallback(
			async (options?: { silent?: boolean }) => {
				setIsResetting(true);
				try {
					await ptyClose(sessionData.ptySessionId).catch(console.error);
					setTerminalInstanceKey((prev) => prev + 1);
					if (!options?.silent) {
						addToast({
							title: "Terminal Reset",
							description: `Starting new ${sessionData.agent === "codex" ? "Codex" : sessionData.agent === "cursor" ? "Cursor" : "Claude"} session`,
							type: "info",
						});
					}
				} catch (error) {
					addToast({
						title: "Reset Failed",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				} finally {
					setIsResetting(false);
				}
			},
			[sessionData.ptySessionId, addToast],
		);

		// Model change handler
		const handleModelChange = useCallback(
			async (newModel: string) => {
				setIsChangingModel(true);
				try {
					const modelToSave = newModel === "default" ? null : newModel;
					await setSessionModel(
						sessionData.repoPath,
						sessionData.sessionId,
						modelToSave,
					);
					setSessionModelState(modelToSave);
					setPendingModelReset(true);
				} catch (error) {
					addToast({
						title: "Failed to change model",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
					setIsChangingModel(false);
				}
			},
			[sessionData.repoPath, sessionData.sessionId, addToast],
		);

		// Reset terminal when model changes
		useEffect(() => {
			if (!pendingModelReset) return;
			const performReset = async () => {
				await handleReset({ silent: true });
				addToast({
					title: "Terminal Restarting",
					description: `Using model: ${sessionModel || "default"}`,
					type: "info",
				});
				setIsChangingModel(false);
				setPendingModelReset(false);
			};
			performReset();
		}, [pendingModelReset, handleReset, sessionModel, addToast]);

		// Shared treq CLI documentation injected as system prompt for any agent.
		// Join with literal \n so shell-quoted single-line args expand correctly
		// for Claude/Codex; cursor-agent receives real newlines via the prompt.
		const treqSystemPromptForShell = treqAgentSystemPrompt.replace(
			/\n/g,
			"\\n",
		);

		let autoCommand: string;

		if (sessionData.agent === "codex") {
			// Codex CLI: pass system prompt via -c instructions override, then prompt as positional arg
			autoCommand = `codex -c ${shellQuote(`instructions="${treqSystemPromptForShell}"`)}`;
			if (pendingPromptRef.current) {
				autoCommand = appendAgentPrompt(autoCommand, pendingPromptRef.current);
			}
		} else if (sessionData.agent === "cursor") {
			// cursor-agent: no system-prompt flag; prepend treq instructions into the prompt arg.
			// --plan engages cursor's plan mode; omit when in edit mode.
			const combined = pendingPromptRef.current
				? `${treqAgentSystemPrompt}\n\n${pendingPromptRef.current}`
				: treqAgentSystemPrompt;
			const planFlag = permissionModeRef.current === "plan" ? " --plan" : "";
			autoCommand = appendAgentPrompt(`cursor-agent${planFlag}`, combined);
		} else {
			// Claude Code: permission mode, model, system prompt, then prompt after --
			const permissionModeArg =
				permissionModeRef.current === "plan"
					? " --permission-mode plan"
					: " --permission-mode acceptEdits";
			autoCommand = `claude${permissionModeArg}`;
			if (sessionModel) {
				autoCommand += ` --model=${shellQuote(sessionModel)}`;
			}
			autoCommand += ` --append-system-prompt ${shellQuote(treqSystemPromptForShell)}`;
			if (pendingPromptRef.current) {
				autoCommand += ` -- ${shellQuote(pendingPromptRef.current)}`;
			}
		}

		// Prepend PATH export so treq CLI is available inside all agent sessions
		if (treqBinDir) {
			autoCommand = `export PATH=${shellQuote(treqBinDir)}:$PATH; ${autoCommand}`;
		}

		return (
			<div
				data-terminal-id={terminalId}
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
						isActive ? "bg-primary/40" : "bg-gray-700",
					)}
				>
					<div className="flex items-center gap-1 text-sm font-medium text-gray-200">
						{sessionData.agent === "codex" ? (
							<Sparkles className="w-4 h-4" />
						) : sessionData.agent === "cursor" ? (
							<MousePointer2 className="w-4 h-4" />
						) : (
							<Bot className="w-4 h-4" />
						)}
						<span className="truncate">{sessionData.sessionName}</span>
					</div>
					<div className="flex items-center gap-1">
						{/* Model selector — Claude only */}
						{sessionData.agent !== "codex" &&
							sessionData.agent !== "cursor" && (
								<ModelSelector
									currentModel={sessionModel}
									onModelChange={handleModelChange}
									disabled={isChangingModel || isResetting}
								/>
							)}
						{/* Scroll to bottom */}
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={() =>
											terminalRefs.current.get(terminalId)?.scrollToBottom()
										}
										variant="ghost"
										size="xs"
										className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
										aria-label="Scroll to bottom"
									>
										<ArrowDownToLine className="w-4 h-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Scroll to bottom</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{/* Reset button */}
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										onClick={() => handleReset()}
										disabled={isResetting}
										variant="ghost"
										size="xs"
										className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
										aria-label="Reset terminal"
									>
										{isResetting ? (
											<Loader2 className="w-4 h-4 animate-spin" />
										) : (
											<RotateCw className="w-4 h-4" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>Reset</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{/* Search button */}
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										onClick={openSearchPanel}
										variant="ghost"
										className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
										size="xs"
										aria-label="Search"
									>
										<Search className="w-4 h-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Search (⌘+F)</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{/* Close button */}
						{onClose && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											onClick={onClose}
											variant="ghost"
											size="xs"
											className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
											aria-label="Close session"
										>
											<X className="w-4 h-4" />
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
				</div>

				{/* Terminal with search overlay */}
				<div
					className="flex-1 min-h-0 overflow-hidden relative border-r border-border"
					style={{ backgroundColor: "#1e1e1e" }}
				>
					{/* Search overlay */}
					{searchVisible && !collapsed && (
						<div className="absolute top-2 right-2 z-20 bg-background border border-border rounded-md shadow-lg p-0.5 flex items-center gap-0.5">
							<Input
								ref={searchInputRef}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Find"
								onKeyDown={handleSearchKeyDown}
								className="h-6 w-48 text-sm !outline-none !ring-0"
							/>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											className="h-5 w-5 rounded-sm p-0 bg-background text-muted-foreground hover:text-foreground"
											onClick={() => runSearch("previous")}
											disabled={!searchQuery.trim()}
											aria-label="Find previous"
										>
											<ChevronUp className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Previous (Shift+Enter)</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											className="h-5 w-5 rounded-sm p-0 bg-background text-muted-foreground hover:text-foreground"
											onClick={() => runSearch("next")}
											disabled={!searchQuery.trim()}
											aria-label="Find next"
										>
											<ChevronDown className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Next (Enter)</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											className="h-5 w-5 rounded-sm p-0 bg-background text-muted-foreground hover:text-foreground"
											onClick={closeSearchPanel}
											aria-label="Close search"
										>
											<X className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Close (Esc)</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					)}

					{/* Terminal */}
					{isModelLoaded ? (
						<ConsolidatedTerminal
							key={`${sessionData.ptySessionId}-${terminalInstanceKey}`}
							ref={(el) => {
								if (el) {
									terminalRefs.current.set(terminalId, el);
								} else {
									terminalRefs.current.delete(terminalId);
								}
							}}
							sessionId={sessionData.ptySessionId}
							workingDirectory={
								sessionData.workspacePath || sessionData.repoPath
							}
							autoCommand={autoCommand}
							onSessionError={onSessionError}
							onClose={onClose}
							onTerminalOutput={handleTerminalOutput}
							onTerminalIdle={onTerminalIdle}
							containerClassName="h-full w-full overflow-hidden"
							terminalPaneClassName="w-full h-full"
							isHidden={isHidden}
						/>
					) : (
						<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
							Loading...
						</div>
					)}
				</div>
			</div>
		);
	},
);
