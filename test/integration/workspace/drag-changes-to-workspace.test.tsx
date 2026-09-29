import fs from "node:fs";
import path from "node:path";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import * as api from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  runSerially,
  writeWorkspaceFile,
} from "../../utils";

runSerially();

async function createTwoWorkspacesWithDirtySource() {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const sourceId = await api.createWorkspace(repoPath, "feat/source");
  const destId = await api.createWorkspace(repoPath, "feat/dest");
  const workspaces = await api.getWorkspaces(repoPath);
  const source = workspaces.find((w) => w.id === sourceId)!;
  const dest = workspaces.find((w) => w.id === destId)!;
  expect(source).toBeTruthy();
  expect(dest).toBeTruthy();

  const sourcePath = resolveWorkspacePath(repoPath, source.workspace_path);
  const destPath = resolveWorkspacePath(repoPath, dest.workspace_path);
  const fileName = "move-me.txt";
  writeWorkspaceFile(sourcePath, fileName, "content to move\n");

  return { repoPath, source, dest, sourcePath, destPath, fileName };
}

async function openReviewForBranch(
  user: ReturnType<typeof userEvent.setup>,
  branchName: string,
) {
  render(<Dashboard />);
  await user.click(await findSidebarBranchElement(branchName));
  const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
  await user.click(reviewTab);
  await screen.findByRole("tab", { name: /^Changes/, selected: true });
}

async function waitForChangedFile(fileName: string) {
  await screen.findAllByText(fileName);
}

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const types: string[] = [];
  return {
    dropEffect: "move",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types,
    clearData: (format?: string) => {
      if (format) {
        store.delete(format);
        const idx = types.indexOf(format);
        if (idx >= 0) types.splice(idx, 1);
      } else {
        store.clear();
        types.length = 0;
      }
    },
    getData: (format: string) => store.get(format) ?? "",
    setData: (format: string, data: string) => {
      store.set(format, data);
      if (!types.includes(format)) types.push(format);
    },
    setDragImage: () => {},
  } as DataTransfer;
}

function dragAndDrop(sourceEl: HTMLElement, dropTarget: HTMLElement) {
  const dataTransfer = createDataTransfer();
  fireEvent.dragStart(sourceEl, { dataTransfer });
  fireEvent.dragEnter(dropTarget, { dataTransfer });
  fireEvent.dragOver(dropTarget, { dataTransfer });
  fireEvent.drop(dropTarget, { dataTransfer });
  fireEvent.dragEnd(sourceEl, { dataTransfer });
}

describe("Review tab - drag changes to workspace sidebar", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("asks for confirmation then moves the file to the dropped workspace", async () => {
    const { source, dest, sourcePath, destPath, fileName } =
      await createTwoWorkspacesWithDirtySource();
    await openReviewForBranch(user, source.branch_name);

    await waitForChangedFile(fileName);

    const [sidebarFile] = screen.getAllByText(fileName);
    const dragRow = sidebarFile.closest("[draggable='true']") as HTMLElement;
    expect(dragRow).toBeTruthy();
    const destRow = await findSidebarBranchElement(dest.branch_name);

    dragAndDrop(dragRow, destRow);

    await screen.findByText(/Move 1 file to feat\/dest\?/);
    await user.click(await screen.findByRole("button", { name: /^Move$/ }));

    await waitFor(() => {
      expect(fs.existsSync(path.join(sourcePath, fileName))).toBe(false);
      expect(fs.existsSync(path.join(destPath, fileName))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(fileName)).toHaveLength(0);
    });

    expect(fs.existsSync(path.join(sourcePath, fileName))).toBe(false);
    expect(fs.existsSync(path.join(destPath, fileName))).toBe(true);
    expect(fs.readFileSync(path.join(destPath, fileName), "utf8")).toContain(
      "content to move",
    );
  });

  it("keeps changes when the confirmation is cancelled", async () => {
    const { source, dest, sourcePath, fileName } =
      await createTwoWorkspacesWithDirtySource();
    await openReviewForBranch(user, source.branch_name);

    await waitForChangedFile(fileName);

    const [sidebarFile] = screen.getAllByText(fileName);
    const dragRow = sidebarFile.closest("[draggable='true']") as HTMLElement;
    const destRow = await findSidebarBranchElement(dest.branch_name);

    dragAndDrop(dragRow, destRow);

    await screen.findByText(/Move 1 file to feat\/dest\?/);
    await user.click(await screen.findByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Move 1 file to feat\/dest\?/)).toBeNull();
    });

    expect(fs.existsSync(path.join(sourcePath, fileName))).toBe(true);
    expect(screen.getAllByText(fileName).length).toBeGreaterThan(0);
  });

  it("moves the full selection when dragging one selected file", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const sourceId = await api.createWorkspace(repoPath, "feat/multi-src");
    const destId = await api.createWorkspace(repoPath, "feat/multi-dest");
    const workspaces = await api.getWorkspaces(repoPath);
    const source = workspaces.find((w) => w.id === sourceId)!;
    const dest = workspaces.find((w) => w.id === destId)!;
    const sourcePath = resolveWorkspacePath(repoPath, source.workspace_path);
    const destPath = resolveWorkspacePath(repoPath, dest.workspace_path);

    writeWorkspaceFile(sourcePath, "a.txt", "aaa\n");
    writeWorkspaceFile(sourcePath, "b.txt", "bbb\n");

    await openReviewForBranch(user, source.branch_name);

    await waitForChangedFile("a.txt");
    await waitForChangedFile("b.txt");

    await user.click(screen.getByTitle(/Select all/i));

    const [bFile] = screen.getAllByText("b.txt");
    const dragRow = bFile.closest("[draggable='true']") as HTMLElement;
    const destRow = await findSidebarBranchElement(dest.branch_name);

    dragAndDrop(dragRow, destRow);

    await screen.findByText(/Move 2 files to feat\/multi-dest\?/);
    await user.click(await screen.findByRole("button", { name: /^Move$/ }));

    await waitFor(() => {
      expect(fs.existsSync(path.join(sourcePath, "a.txt"))).toBe(false);
      expect(fs.existsSync(path.join(sourcePath, "b.txt"))).toBe(false);
      expect(fs.existsSync(path.join(destPath, "a.txt"))).toBe(true);
      expect(fs.existsSync(path.join(destPath, "b.txt"))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryAllByText("a.txt")).toHaveLength(0);
      expect(screen.queryAllByText("b.txt")).toHaveLength(0);
    });

    expect(fs.existsSync(path.join(sourcePath, "a.txt"))).toBe(false);
    expect(fs.existsSync(path.join(sourcePath, "b.txt"))).toBe(false);
    expect(fs.existsSync(path.join(destPath, "a.txt"))).toBe(true);
    expect(fs.existsSync(path.join(destPath, "b.txt"))).toBe(true);
  });
});
