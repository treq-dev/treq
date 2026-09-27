/**
 * Verifies that the GitHub panel's New Pull Request form prefills the base
 * branch with the repo's real default branch (read through the Rust
 * backend) instead of a hardcoded "main", and that the split-button
 * dropdown switches the form to creating a draft PR, as on GitHub.
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import { render, screen, waitFor } from "../../../test/test-utils";
import { createTestRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

// No gh in the sandbox: stub only the GitHub remote and list calls. The
// default branch comes from the real get_repo_default_branch command.
vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return {
    ...actual,
    getGitRemoteUrl: vi.fn().mockResolvedValue({
      owner: "acme",
      repo: "treq",
      full_name: "acme/treq",
    }),
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
});

it("prefills the New Pull Request base with the repo default branch", async () => {
  const { repoPath, defaultBranch } = createTestRepo(false);

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await user.click(await screen.findByRole("button", { name: /new/i }));

  const base = screen.getByPlaceholderText("Base branch");
  await waitFor(() => expect(base).toHaveValue(defaultBranch));

  await captureDocument(document, {
    name: "create-pr-form-default-base-01-prefilled",
    expectations: [
      `The New Pull Request form's base field (right of the arrow) shows the repo default branch "${defaultBranch}", not "main".`,
      "The head branch field on the left is empty, showing its placeholder.",
    ],
  });

  await user.type(screen.getByPlaceholderText("Title"), "Add dark mode");
  await user.type(screen.getByPlaceholderText("Head branch"), "feat/dark-mode");
  await user.click(screen.getByRole("button", { name: /pull request type/i }));
  const draftOption = await screen.findByRole("menuitemradio", {
    name: /create draft pull request/i,
  });

  await captureDocument(document, {
    name: "create-pr-form-default-base-02-type-menu",
    expectations: [
      'A "Create Pull Request" button with an attached chevron sits below the description, and the type menu is open (jsdom has no layout, so it renders at the top-left).',
      'The menu lists "Create pull request" (selected, with a dot) and "Create draft pull request", each with a one-line description.',
    ],
  });

  await user.click(draftOption);
  expect(
    await screen.findByRole("button", { name: /^draft pull request$/i }),
  ).toBeEnabled();
  expect(screen.queryByRole("menu")).toBeNull();

  await captureDocument(document, {
    name: "create-pr-form-default-base-03-draft-selected",
    expectations: [
      "The menu is closed.",
      'The main button now reads "Draft Pull Request", still joined to its chevron.',
    ],
  });
}, 60000);
