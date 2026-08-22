import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepo, openRepo, writeRepoFile } from "../utils";
import { render, screen } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

describe("Repository YAML config sync", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("loads and displays settings synced from .treq/config.yaml", async () => {
    const { repoPath } = createTestRepo(false);
    await writeRepoFile(
      repoPath,
      ".treq/config.yaml",
      [
        "target_branch: main",
        "default_model: opus",
        "default_agent: claude",
      ].join("\n"),
    );
    openRepo(repoPath);

    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /repository/i }));

    await screen.findByText(/synced from \.treq\/config\.yaml/i);
    expect(await screen.findByText("Target Branch")).toBeVisible();
    expect(screen.getByText("opus")).toBeVisible();
    expect(screen.getByText("claude")).toBeVisible();
    const targetBranchRow = screen.getByText("Target Branch").closest("div");
    expect(targetBranchRow).toHaveTextContent("main");
  });

  it("shows a message when no .treq/config.yaml file exists", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /repository/i }));

    await screen.findByText(/no \.treq\/config\.yaml found/i);
  });

  it("disables repository setting inputs that are set via .treq/config.yaml", async () => {
    const { repoPath } = createTestRepo(false);
    await writeRepoFile(repoPath, ".treq/config.yaml", "default_model: opus\n");
    openRepo(repoPath);

    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /repository/i }));

    const modelSelect = await screen.findByLabelText(/claude code model/i);
    expect(modelSelect).toBeDisabled();
    expect(modelSelect).toHaveValue("opus");
    await screen.findByText(/configured by \.treq\/config\.yaml/i);

    const branchPatternInput = screen.getByLabelText(/branch name pattern/i);
    expect(branchPatternInput).not.toBeDisabled();

    const agentSelect = screen.getByLabelText(/default agent/i);
    expect(agentSelect).not.toBeDisabled();
  });

  it("keeps repository setting inputs enabled when no .treq/config.yaml overrides them", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /repository/i }));

    expect(
      await screen.findByLabelText(/branch name pattern/i),
    ).not.toBeDisabled();
    expect(screen.getByLabelText(/claude code model/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/default agent/i)).not.toBeDisabled();
    expect(
      screen.queryByText(/configured by \.treq\/config\.yaml/i),
    ).not.toBeInTheDocument();
  });

  it("re-syncs from disk when Reload is clicked", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /repository/i }));

    await screen.findByText(/no \.treq\/config\.yaml found/i);

    await writeRepoFile(
      repoPath,
      ".treq/config.yaml",
      "target_branch: develop\n",
    );

    await user.click(await screen.findByRole("button", { name: /reload/i }));

    expect(await screen.findByText("develop")).toBeVisible();
  });
});
