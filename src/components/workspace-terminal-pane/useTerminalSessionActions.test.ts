import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ptyClose } from "../../lib/api";
import { useTerminalSessionActions } from "./useTerminalSessionActions";

vi.mock("../../lib/api", () => ({ ptyClose: vi.fn() }));

describe("useTerminalSessionActions close paths", () => {
  it("routes workspace agent closure through the single shared close callback", () => {
    const handleCloseAgentSession = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionActions({
        agentSessions: [
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
        setMountedAgentSessions: vi.fn(),
        setTerminalOrder: vi.fn(),
        setActivePtySessionId: vi.fn(),
        scrollToTerminal: vi.fn(),
        handleCloseAgentSession,
        handleCloseShell: vi.fn(),
      }),
    );

    result.current.closeTerminalsForWorkspace("/repo/ws");

    expect(handleCloseAgentSession).toHaveBeenCalledOnce();
    expect(ptyClose).not.toHaveBeenCalled();
  });
});
