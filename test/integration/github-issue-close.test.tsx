import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel } from "../../src/components/github-panel/IssueDetail";
import { render, screen, waitFor } from "../test-utils";

const api = vi.hoisted(() => ({
  ghViewIssue: vi.fn(),
  ghCloseIssue: vi.fn(),
  ghReopenIssue: vi.fn(),
}));

vi.mock("../../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...original, ...api };
});

function makeIssue(state: string) {
  return {
    number: 7,
    title: "Broken thing",
    state,
    url: "https://github.com/acme/treq/issues/7",
    body: null,
    author: { login: "alice" },
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    comments: null,
  };
}

function renderIssue() {
  render(
    <IssueDetailPanel
      repoFullName="acme/treq"
      issueNumber={7}
      onClose={() => {}}
    />,
  );
}

describe("IssueDetailPanel close issue", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("closes the issue as completed on one click", async () => {
    let closed = false;
    api.ghViewIssue.mockImplementation(async () =>
      makeIssue(closed ? "CLOSED" : "OPEN"),
    );
    api.ghCloseIssue.mockImplementation(async () => {
      closed = true;
    });
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /^close issue$/i }),
    );

    expect(
      await screen.findByRole("button", { name: /reopen issue/i }),
    ).toBeVisible();
    expect(api.ghCloseIssue).toHaveBeenCalledWith("acme/treq", 7, "completed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the issue as not planned from the close options", async () => {
    api.ghViewIssue.mockResolvedValue(makeIssue("OPEN"));
    api.ghCloseIssue.mockResolvedValue(undefined);
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /close options/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /close as not planned/i }),
    );

    await waitFor(() =>
      expect(api.ghCloseIssue).toHaveBeenCalledWith(
        "acme/treq",
        7,
        "not planned",
      ),
    );
  });

  it("shows a loading state on Close issue while the request is in flight", async () => {
    let resolveClose: () => void = () => {};
    api.ghViewIssue.mockResolvedValue(makeIssue("OPEN"));
    api.ghCloseIssue.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /^close issue$/i }),
    );

    const closing = await screen.findByRole("button", { name: /closing/i });
    expect(closing).toBeDisabled();
    expect(closing).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: /close options/i }),
    ).toBeDisabled();

    resolveClose();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^close issue$/i }),
      ).toBeEnabled(),
    );
  });

  it("shows a loading state on Reopen issue while the request is in flight", async () => {
    let resolveReopen: () => void = () => {};
    api.ghViewIssue.mockResolvedValue(makeIssue("CLOSED"));
    api.ghReopenIssue.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReopen = resolve;
        }),
    );
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /reopen issue/i }),
    );

    const reopening = await screen.findByRole("button", {
      name: /reopening/i,
    });
    expect(reopening).toBeDisabled();
    expect(reopening).toHaveAttribute("aria-busy", "true");
    resolveReopen();
    await waitFor(() =>
      expect(api.ghReopenIssue).toHaveBeenCalledWith("acme/treq", 7),
    );
  });
});
