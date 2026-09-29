// @include-parallel
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIssueForm } from "../../src/components/github-panel/IssueDetail";
import { render, screen, waitFor } from "../test-utils";

const api = vi.hoisted(() => ({
  ghCreateIssue: vi.fn(),
}));

vi.mock("../../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...original, ...api };
});

describe("CreateIssueForm", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    api.ghCreateIssue.mockReset();
  });

  function renderForm(onSuccess = vi.fn()) {
    render(
      <CreateIssueForm
        repoFullName="acme/treq"
        onSuccess={onSuccess}
        onCancel={() => {}}
      />,
    );
    return onSuccess;
  }

  it("creates the issue and hands back its number", async () => {
    api.ghCreateIssue.mockResolvedValue(12);
    const onSuccess = renderForm();

    await user.type(screen.getByPlaceholderText("Title"), "Crash on save");
    await user.type(
      screen.getByPlaceholderText(/description/i),
      "Steps to reproduce",
    );
    await user.click(screen.getByRole("button", { name: /submit issue/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(12));
    expect(api.ghCreateIssue).toHaveBeenCalledWith(
      "acme/treq",
      "Crash on save",
      "Steps to reproduce",
    );
  });

  it("shows the gh error message without an Error prefix", async () => {
    api.ghCreateIssue.mockRejectedValue(
      new Error("gh: could not create issue: HTTP 410"),
    );
    renderForm();

    await user.type(screen.getByPlaceholderText("Title"), "Crash on save");
    await user.click(screen.getByRole("button", { name: /submit issue/i }));

    expect(
      await screen.findByText("gh: could not create issue: HTTP 410"),
    ).toBeVisible();
    expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit issue/i })).toBeEnabled();
  });

  it("shows a string rejection from the Tauri command as is", async () => {
    api.ghCreateIssue.mockRejectedValue("gh exited with error: HTTP 404");
    renderForm();

    await user.type(screen.getByPlaceholderText("Title"), "Crash on save");
    await user.click(screen.getByRole("button", { name: /submit issue/i }));

    expect(
      await screen.findByText("gh exited with error: HTTP 404"),
    ).toBeVisible();
  });
});
