/**
 * Verifies that the GitHub panel's New Pull Request form prefills the base
 * branch with the repo's real default branch (read through the Rust
 * backend) instead of a hardcoded "main".
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
}, 60000);
