// @include-parallel
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel } from "../../src/components/github-panel/IssueDetail";
import { render, screen } from "../test-utils";

const api = vi.hoisted(() => ({
  ghViewIssue: vi.fn(),
  ghEditIssue: vi.fn(),
}));

vi.mock("../../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...original, ...api };
});

function makeIssue(title: string, body: string | null) {
  return {
    number: 7,
    title,
    state: "OPEN",
    url: "https://github.com/acme/treq/issues/7",
    body,
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

describe("IssueDetailPanel edit issue", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let current: ReturnType<typeof makeIssue>;

  beforeEach(() => {
    user = userEvent.setup();
    for (const fn of Object.values(api)) fn.mockReset();
    current = makeIssue("Old title", "Old body");
    api.ghViewIssue.mockImplementation(async () => current);
    api.ghEditIssue.mockImplementation(
      async (...args: [string, number, string, string]) => {
        current = makeIssue(args[2], args[3]);
      },
    );
  });

  it("saves a new title and body", async () => {
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /edit issue/i }),
    );
    const title = screen.getByRole("textbox", { name: /issue title/i });
    const body = screen.getByRole("textbox", { name: /issue description/i });
    expect(title).toHaveValue("Old title");
    expect(body).toHaveValue("Old body");

    await user.clear(title);
    await user.type(title, "New title");
    await user.clear(body);
    await user.type(body, "New body");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByRole("heading", { name: "New title" }),
    ).toBeVisible();
    expect(await screen.findByText("New body")).toBeVisible();
    expect(api.ghEditIssue).toHaveBeenCalledWith(
      "acme/treq",
      7,
      "New title",
      "New body",
    );
    expect(
      screen.queryByRole("textbox", { name: /issue title/i }),
    ).not.toBeInTheDocument();
  });

  it("starts from an empty description when the issue has no body", async () => {
    current = makeIssue("Old title", null);
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /edit issue/i }),
    );

    expect(
      screen.getByRole("textbox", { name: /issue description/i }),
    ).toHaveValue("");
  });

  it("discards edits on Cancel", async () => {
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /edit issue/i }),
    );
    const title = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(title);
    await user.type(title, "Throwaway");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.getByRole("heading", { name: "Old title" })).toBeVisible();
    expect(api.ghEditIssue).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /edit issue/i }));
    expect(screen.getByRole("textbox", { name: /issue title/i })).toHaveValue(
      "Old title",
    );
  });

  it("disables Save while the title is empty", async () => {
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /edit issue/i }),
    );
    await user.clear(screen.getByRole("textbox", { name: /issue title/i }));

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("keeps the edits and shows the gh error when saving fails", async () => {
    api.ghEditIssue.mockRejectedValue("gh: HTTP 403: Must have push access");
    renderIssue();

    await user.click(
      await screen.findByRole("button", { name: /edit issue/i }),
    );
    const title = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(title);
    await user.type(title, "New title");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Failed to update issue")).toBeVisible();
    expect(
      screen.getByText("gh: HTTP 403: Must have push access"),
    ).toBeVisible();
    expect(title).toHaveValue("New title");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });
});
