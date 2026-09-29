import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ptyClose } from "../../lib/api";
import { useTerminalSessionActions } from "./useTerminalSessionActions";

vi.mock("../../lib/api", () => ({ ptyClose: vi.fn() }));

describe("useTerminalSessionActions close paths", () => {
  it("routes workspace agent closure through the single shared close callback", () => {
    const handleCloseClaudeSession = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionActions({
        claudeSessions: [
          {
            sessionId: 1,
            ptySessionId: "pty-1",
            repoPath: "/repo",
            workspacePath: "/repo/ws",
            sessionName: "agent",
            agent: "claude",
          },
        ],
        shellTerminals: [],
        setCollapsed: vi.fn(),
        setMountedClaudeSessions: vi.fn(),
        setTerminalOrder: vi.fn(),
        setActivePtySessionId: vi.fn(),
        scrollToTerminal: vi.fn(),
        handleCloseClaudeSession,
        handleCloseShell: vi.fn(),
      }),
    );

    result.current.closeTerminalsForWorkspace("/repo/ws");

    expect(handleCloseClaudeSession).toHaveBeenCalledOnce();
    expect(ptyClose).not.toHaveBeenCalled();
  });
});
