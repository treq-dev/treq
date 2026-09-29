// @include-parallel
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { Dashboard } from "../../src/components/Dashboard";
import { render, screen } from "../test-utils";
import { createTestRepo, openRepo } from "../utils";
import { setSetting } from "../../src/lib/api";

const setWebviewZoom = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: setWebviewZoom }),
}));

describe("UI zoom settings", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    await setSetting("ui_zoom", "100");
    user = userEvent.setup();
    document.documentElement.style.zoom = "";
    document.documentElement.style.removeProperty("--ui-zoom");
    setWebviewZoom.mockClear();
  });

  it("defaults to 100% zoom", async () => {
    render(<Dashboard />);
    await waitFor(() => expect(setWebviewZoom).toHaveBeenCalledWith(1));
    expect(document.documentElement.style.getPropertyValue("--ui-zoom")).toBe(
      "",
    );
    expect(document.documentElement.style.zoom).toBe("");
  });

  it("zooms in with Ctrl+= and out with Ctrl+-", async () => {
    render(<Dashboard />);
    await screen.findByLabelText("Settings");

    await user.keyboard("{Control>}{=}{/Control}");
    await waitFor(() => {
      expect(setWebviewZoom).toHaveBeenCalledWith(1.05);
    });

    await user.keyboard("{Control>}-{/Control}");
    await waitFor(() => {
      expect(setWebviewZoom).toHaveBeenCalledWith(1);
    });
  });

  it("shows a zoom slider in application settings and saves the value", async () => {
    render(<Dashboard />);

    await user.click(await screen.findByLabelText("Settings"));
    await user.click(await screen.findByRole("tab", { name: /application/i }));

    const thumb = await screen.findByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "100");

    thumb.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(thumb).toHaveAttribute("aria-valuenow", "110");

    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await screen.findByText("Settings Saved");

    expect(setWebviewZoom).toHaveBeenCalledWith(1.1);
  });
});
