import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { commitRepoFile, createTestRepo, openRepo } from "../../utils";
import { createWorkspace } from "../../../src/lib/api";
import { Dashboard } from "../../../src/components/Dashboard";

vi.mock("../../../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api")>();
  return {
    ...actual,
    jjGetChangedFiles: vi.fn().mockResolvedValue([]),
  };
});

describe("ShowWorkspace - Code tab", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("shows Code tab", async () => {
    await createWorkspace(repoPath, "feat/code-tab-test");
    render(<Dashboard />);

    await screen.findByText("Code");
    await screen.findByText("README.md", { selector: "div,span,a" });
    await screen.findByText("Initial commit");
  });

  it("renders README.md content in the Code tab overview", async () => {
    await createWorkspace(repoPath, "feat/readme-render-test");
    render(<Dashboard />);

    await screen.findByRole("heading", { name: "README.md" });
    await screen.findByRole("heading", { name: "Test Repository" });
  });

  it("clicking a non-readme file opens FileBrowser and allows line comments to start an agent", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    await commitRepoFile(repoPath, "main.ts", "const x = 1;", "add main.ts");

    render(<Dashboard />);

    await screen.findByText("Code");

    const mainTsText = await screen.findByText("main.ts");
    const mainTsButton = mainTsText.closest("button")!;
    expect(mainTsButton).toBeTruthy();

    await user.click(mainTsButton);

    const backButton = await screen.findByRole("button", { name: /back/i });
    expect(backButton).toBeTruthy();

    const [codeLineDiv] = await screen.findAllByTestId("code-line");
    fireEvent.mouseOver(codeLineDiv);
    fireEvent.mouseEnter(codeLineDiv);

    const addCommentButton = await screen.findByTitle("Add comment");
    await user.click(addCommentButton);

    const textarea = await screen.findByPlaceholderText("Add a comment...");
    await user.type(textarea, "Fix this line");

    const submitButton = screen.getByRole("button", { name: "Add Comment" });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Add a comment...")).toBeNull();
    });
  });
});
