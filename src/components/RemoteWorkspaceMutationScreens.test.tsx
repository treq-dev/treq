import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../test/test-utils";
import { WorkspaceDetailScreen } from "./RemoteWorkspaceMutationScreens";
import * as remoteDispatch from "../lib/remote-dispatch";
import type { SshEndpoint } from "../lib/api-types-remote";

vi.mock("../lib/remote-dispatch", async () => {
  const actual = await vi.importActual("../lib/remote-dispatch");
  return {
    ...actual,
    dispatchOverSsh: vi.fn(),
    dispatchMutationOverSsh: vi.fn(),
  };
});

const endpoint: SshEndpoint = {
  id: "ep1",
  instance_id: null,
  source: { type: "user_managed" },
  hostname: "vm.example.com",
  port: 22,
  username: "treq",
  host_keys: [],
  authentication: { type: "public_key", key_reference: "key1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(remoteDispatch.dispatchOverSsh).mockImplementation(
    async (_endpoint, request) => {
      if (request.kind === "InspectWorkspace") {
        return { has_changes: true, has_conflicts: false } as never;
      }
      if (request.kind === "ListChanges") return [] as never;
      if (request.kind === "WorkspaceChangeMarker") {
        return { operation_id: "op123456789" } as never;
      }
      throw new Error(`unexpected dispatch: ${request.kind}`);
    },
  );
});

describe("WorkspaceDetailScreen mutations", () => {
  it("requires a second confirming tap before dispatching a rebase", async () => {
    const user = userEvent.setup();
    vi.mocked(remoteDispatch.dispatchMutationOverSsh).mockResolvedValue({
      status: "applied",
      value: null,
    });

    render(
      <WorkspaceDetailScreen
        endpoint={endpoint}
        repo="/repo"
        workspace="ws1"
        onOpenDiff={() => {}}
        onOpenCommits={() => {}}
        onOpenConflicts={() => {}}
        onOpenAgent={() => {}}
        onOpenTerminal={() => {}}
      />,
    );

    await screen.findByText("ws1");
    await user.type(screen.getByPlaceholderText("Rebase onto branch"), "main");

    const rebaseButton = screen.getByRole("button", { name: "Rebase" });
    await user.click(rebaseButton);
    expect(remoteDispatch.dispatchMutationOverSsh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm rebase" }));
    expect(remoteDispatch.dispatchMutationOverSsh).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        kind: "RebaseWorkspace",
        target_branch: "main",
      }),
    );
  });
});
