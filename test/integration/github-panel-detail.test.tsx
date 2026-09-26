import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailPanel } from "../../src/components/github-panel/IssueDetail";
import { PrDetailPanel } from "../../src/components/github-panel/PrDetail";
import { render, screen, waitFor } from "../test-utils";

const api = vi.hoisted(() => ({
  ghViewIssue: vi.fn(),
  ghCreateIssueComment: vi.fn(),
  ghViewPr: vi.fn(),
  ghSetPrDraft: vi.fn(),
  ghClosePr: vi.fn(),
  getWorkspaces: vi.fn(),
  openOrCreateWorkspaceFromPr: vi.fn(),
}));

vi.mock("../../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api")>();
  return {
    ...original,
    ghViewIssue: api.ghViewIssue,
    ghCreateIssueComment: api.ghCreateIssueComment,
    ghViewPr: api.ghViewPr,
    ghSetPrDraft: api.ghSetPrDraft,
    ghClosePr: api.ghClosePr,
    getWorkspaces: api.getWorkspaces,
    openOrCreateWorkspaceFromPr: api.openOrCreateWorkspaceFromPr,
  };
});

function makeDetailPr(overrides: {
  is_draft?: boolean;
  state?: string;
  title?: string;
}) {
  return {
    number: 42,
    title: overrides.title ?? "Feature PR",
    state: overrides.state ?? "OPEN",
    url: "https://github.com/acme/treq/pull/42",
    body: "Body",
    author: { login: "alice" },
    labels: [],
    head_ref_name: "feat",
    base_ref_name: "main",
    merge_state_status: "CLEAN",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    comments: null,
    is_draft: overrides.is_draft ?? false,
  };
}

describe("IssueDetailPanel markdown", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    api.ghViewIssue.mockResolvedValue({
      number: 42,
      title: "Fix markdown",
      state: "OPEN",
      url: "https://github.com/acme/treq/issues/42",
      body: "Hello **world** and a `code` span",
      author: { login: "alice" },
      created_at: "2026-01-01T00:00:00Z",
      labels: [],
      comments: [
        {
          id: "1",
          author: { login: "bob" },
          body: "Looks *good*",
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    });
  });

  it("renders issue body and comments with markdown", async () => {
    render(
      <IssueDetailPanel
        repoFullName="acme/treq"
        issueNumber={42}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("world").tagName).toBe("STRONG");
    });
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByText("good").tagName).toBe("EM");
  });

  it("submits a comment with Ctrl+Enter", async () => {
    api.ghCreateIssueComment.mockResolvedValue(undefined);

    render(
      <IssueDetailPanel
        repoFullName="acme/treq"
        issueNumber={42}
        onClose={() => {}}
      />,
    );

    await screen.findByText("world");
    const textarea = screen.getByPlaceholderText(/leave a comment/i);
    await user.type(textarea, "Hello from test");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(api.ghCreateIssueComment).toHaveBeenCalled();
    });
  });
});

describe("PrDetailPanel draft toggle", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    api.ghSetPrDraft.mockReset().mockResolvedValue(undefined);
    api.getWorkspaces.mockResolvedValue([]);
    api.openOrCreateWorkspaceFromPr.mockReset();
  });

  it("marks a draft PR ready for review", async () => {
    api.ghViewPr
      .mockResolvedValueOnce(makeDetailPr({ is_draft: true }))
      .mockResolvedValueOnce(makeDetailPr({ is_draft: false }));

    render(
      <PrDetailPanel
        repoPath="/tmp/repo"
        repoFullName="acme/treq"
        prNumber={42}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("Draft")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /ready for review/i }));

    await waitFor(() => {
      expect(api.ghSetPrDraft).toHaveBeenCalledWith("acme/treq", 42, false);
    });
    expect(await screen.findByText("Open")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /convert to draft/i }),
    ).toBeVisible();
  });

  it("converts an open PR to draft", async () => {
    api.ghViewPr
      .mockResolvedValueOnce(makeDetailPr({ is_draft: false }))
      .mockResolvedValueOnce(makeDetailPr({ is_draft: true }));

    render(
      <PrDetailPanel
        repoPath="/tmp/repo"
        repoFullName="acme/treq"
        prNumber={42}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("Open")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /convert to draft/i }));

    await waitFor(() => {
      expect(api.ghSetPrDraft).toHaveBeenCalledWith("acme/treq", 42, true);
    });
    expect(await screen.findByText("Draft")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /ready for review/i }),
    ).toBeVisible();
  });
});

describe("PrDetailPanel close PR", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    api.getWorkspaces.mockResolvedValue([]);
    api.ghClosePr.mockReset();
  });

  it("shows a loading state on the Close PR button while the request is in flight", async () => {
    let resolveClose: () => void = () => {};
    api.ghViewPr.mockResolvedValue(makeDetailPr({ is_draft: false }));
    api.ghClosePr.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );

    render(
      <PrDetailPanel
        repoPath="/tmp/repo"
        repoFullName="acme/treq"
        prNumber={42}
        onClose={() => {}}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /close pr/i }));

    const closing = await screen.findByRole("button", { name: /closing/i });
    expect(closing).toBeDisabled();
    expect(closing).toHaveAttribute("aria-busy", "true");

    resolveClose();
    await waitFor(() => {
      expect(api.ghClosePr).toHaveBeenCalledWith("acme/treq", 42);
    });
  });
});

describe("GitHub detail load failures", () => {
  it("shows the gh error when a PR fails to load", async () => {
    api.getWorkspaces.mockResolvedValue([]);
    api.ghViewPr.mockRejectedValue("gh: Could not resolve to a PullRequest");

    render(
      <PrDetailPanel
        repoPath="/tmp/repo"
        repoFullName="acme/treq"
        prNumber={404}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("Could not load pull request #404"),
    ).toBeVisible();
    expect(
      screen.getByText("gh: Could not resolve to a PullRequest"),
    ).toBeVisible();
  });

  it("shows the gh error when an issue fails to load", async () => {
    api.ghViewIssue.mockRejectedValue(new Error("gh: HTTP 404"));

    render(
      <IssueDetailPanel
        repoFullName="acme/treq"
        issueNumber={404}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("Could not load issue #404")).toBeVisible();
    expect(screen.getByText("gh: HTTP 404")).toBeVisible();
  });
});
