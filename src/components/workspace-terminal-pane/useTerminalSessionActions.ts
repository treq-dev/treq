import { useCallback } from "react";
import {
	TERMINAL_IDLE_THRESHOLD_MS,
	type ClaudeSessionData,
	type TerminalSessionSummary,
} from "../terminal/types";
import { type ShellTerminalData } from "./types";

interface UseTerminalSessionActionsOptions {
	claudeSessions: ClaudeSessionData[];
	shellTerminals: ShellTerminalData[];
	workspaceBranchByPath?: Map<string, string>;
	terminalSummariesRef: React.MutableRefObject<TerminalSessionSummary[]>;
	setCollapsed: (collapsed: boolean) => void;
	setMountedClaudeSessions: React.Dispatch<React.SetStateAction<Set<number>>>;
	setTerminalOrder: React.Dispatch<React.SetStateAction<string[]>>;
	setActivePtySessionId: React.Dispatch<React.SetStateAction<string | null>>;
	onActiveSessionChange?: (sessionId: number | null) => void;
	onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
	scrollToTerminal: (terminalId: string) => void;
	handleCloseClaudeSession: (sessionId: number) => void;
	handleCloseShell: (terminalId: string) => void;
}

/**
 * Focus/close actions driven by the sidebar's terminal sessions list, keyed
 * by the same composite ids used in `terminalOrder` ("shell-..." / "claude-<id>").
 */
export function useTerminalSessionActions({
	claudeSessions,
	shellTerminals,
	workspaceBranchByPath,
	terminalSummariesRef,
	setCollapsed,
	setMountedClaudeSessions,
	setTerminalOrder,
	setActivePtySessionId,
	onActiveSessionChange,
	onNavigateToWorkspace,
	scrollToTerminal,
	handleCloseClaudeSession,
	handleCloseShell,
}: UseTerminalSessionActionsOptions) {
	const handleFocusTerminalById = useCallback(
		(id: string) => {
			setCollapsed(false);
			if (id.startsWith("claude-")) {
				const sessionId = Number(id.slice("claude-".length));
				const sessionData = claudeSessions.find(
					(s) => s.sessionId === sessionId,
				);
				if (!sessionData) return;
				setMountedClaudeSessions((prev) =>
					prev.has(sessionId) ? prev : new Set(prev).add(sessionId),
				);
				setTerminalOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
				setActivePtySessionId(sessionData.ptySessionId);
				onActiveSessionChange?.(sessionId);
			} else {
				const shellData = shellTerminals.find((s) => s.id === id);
				if (!shellData) return;
				setActivePtySessionId(id);
				onNavigateToWorkspace?.(
					shellData.workingDirectory,
					!workspaceBranchByPath?.has(shellData.workingDirectory),
				);
			}
			scrollToTerminal(id);
		},
		[
			claudeSessions,
			shellTerminals,
			onActiveSessionChange,
			onNavigateToWorkspace,
			workspaceBranchByPath,
			scrollToTerminal,
			setCollapsed,
			setMountedClaudeSessions,
			setTerminalOrder,
			setActivePtySessionId,
		],
	);

	const handleCloseTerminalById = useCallback(
		(id: string) => {
			if (id.startsWith("claude-")) {
				handleCloseClaudeSession(Number(id.slice("claude-".length)));
			} else {
				handleCloseShell(id);
			}
		},
		[handleCloseClaudeSession, handleCloseShell],
	);

	const handleCloseIdleTerminals = useCallback(() => {
		const now = Date.now();
		for (const summary of terminalSummariesRef.current) {
			if (now - summary.lastActivityAt >= TERMINAL_IDLE_THRESHOLD_MS) {
				handleCloseTerminalById(summary.id);
			}
		}
	}, [handleCloseTerminalById, terminalSummariesRef]);

	const handleCloseAllTerminals = useCallback(() => {
		for (const summary of terminalSummariesRef.current) {
			handleCloseTerminalById(summary.id);
		}
	}, [handleCloseTerminalById, terminalSummariesRef]);

	return {
		handleFocusTerminalById,
		handleCloseTerminalById,
		handleCloseIdleTerminals,
		handleCloseAllTerminals,
	};
}
