// @include-parallel
import * as React from "react";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../utils";
import { render, screen } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";
import { ARTIFACTS_BASE_PATH } from "../../src/lib/artifactRoutes";

function seedSendManifest(
  repoPath: string,
  records: Array<{
    id: string;
    media_type: string;
    filename: string;
    contents: string;
    received_at: number;
  }>,
) {
  const dir = path.join(repoPath, ".treq", "send");
  fs.mkdirSync(dir, { recursive: true });
  const lines = records.map((record) => {
    const filePath = path.join(dir, record.filename);
    fs.writeFileSync(filePath, record.contents);
    return JSON.stringify({
      id: record.id,
      repo: repoPath,
      media_type: record.media_type,
      path: filePath,
      title: record.filename,
      received_at: record.received_at,
    });
  });
  fs.writeFileSync(path.join(dir, "manifest.jsonl"), `${lines.join("\n")}\n`);
}

describe("artifacts page", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("opens from the sidebar button and shows a thumbnail grid", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    seedSendManifest(repoPath, [
      {
        id: "send-100",
        media_type: "text",
        filename: "note.txt",
        contents: "hello from treq send",
        received_at: 100,
      },
      {
        id: "send-200",
        media_type: "image",
        filename: "shot.svg",
        contents: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>`,
        received_at: 200,
      },
    ]);

    render(<Dashboard />);

    await user.click(await screen.findByRole("button", { name: "Artifacts" }));

    expect(await screen.findByTestId("artifacts-grid")).toBeTruthy();
    expect(screen.getByTestId("artifact-thumb-send-200")).toBeTruthy();
    expect(screen.getByTestId("artifact-thumb-send-100")).toBeTruthy();
    expect(window.location.hash).toContain(ARTIFACTS_BASE_PATH);

    expect(
      screen.getByTestId("artifact-thumb-send-100").getAttribute("draggable"),
    ).toBe("true");

    await user.click(screen.getByTestId("artifact-thumb-send-100"));
    expect(
      await screen.findByTestId("treq-send-preview-lightbox"),
    ).toBeTruthy();
  });

  it("shows an empty state when nothing has been sent", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    render(<Dashboard />);

    await user.click(await screen.findByRole("button", { name: "Artifacts" }));
    expect(await screen.findByTestId("artifacts-empty")).toBeTruthy();
    expect(screen.getByText("No artifacts yet")).toBeTruthy();
  });
});
