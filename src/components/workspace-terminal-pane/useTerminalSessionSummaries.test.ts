import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTerminalSessionSummaries } from "./useTerminalSessionSummaries";
import type { TerminalEntry } from "./types";
import { REFRESH_WORKSPACE_CHANGES_EVENT } from "../../lib/change-file-drag";

const allTerminals: TerminalEntry[] = [
  { type: "shell", data: { id: "shell-1", workingDirectory: "/tmp/ws" } },
];

const latestSummaries = (onTerminalsChange: ReturnType<typeof vi.fn>) =>
  onTerminalsChange.mock.calls.at(-1)?.[0] as Array<{
    id: string;
    isStreaming: boolean;
  }>;

describe("useTerminalSessionSummaries streaming state", () => {
  it("marks a terminal streaming when process output arrives", () => {
    const onTerminalsChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionSummaries({
        allTerminals,
        workspaceBranchByPath: new Map([["/tmp/ws", "feat/demo"]]),
        onTerminalsChange,
      }),
    );

    act(() => {
      result.current.handleTerminalOutput("shell-1");
    });

    expect(latestSummaries(onTerminalsChange)[0].isStreaming).toBe(true);
  });

  it("does not mark a terminal streaming for local echo of user input", () => {
    const onTerminalsChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionSummaries({ allTerminals, onTerminalsChange }),
    );

    act(() => {
      result.current.handleTerminalOutput("shell-1", false);
    });

    expect(latestSummaries(onTerminalsChange)[0].isStreaming).toBe(false);
  });

  it("clears streaming on idle without dispatching a filesystem refresh", () => {
    const onRefresh = vi.fn();
    window.addEventListener(REFRESH_WORKSPACE_CHANGES_EVENT, onRefresh);
    const onTerminalsChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionSummaries({ allTerminals, onTerminalsChange }),
    );

    act(() => {
      result.current.handleTerminalOutput("shell-1");
    });
    act(() => {
      result.current.handleTerminalIdlePulse("shell-1");
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(latestSummaries(onTerminalsChange)[0].isStreaming).toBe(false);
    window.removeEventListener(REFRESH_WORKSPACE_CHANGES_EVENT, onRefresh);
  });

  it("publishes once for a burst of output", () => {
    const onTerminalsChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSessionSummaries({ allTerminals, onTerminalsChange }),
    );
    const callsBeforeOutput = onTerminalsChange.mock.calls.length;

    act(() => {
      result.current.handleTerminalOutput("shell-1");
      result.current.handleTerminalOutput("shell-1");
      result.current.handleTerminalOutput("shell-1");
    });

    expect(onTerminalsChange.mock.calls.length - callsBeforeOutput).toBe(1);
  });
});
