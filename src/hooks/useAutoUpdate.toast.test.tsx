import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/toast";
import type { AppUpdateCheckResult } from "../lib/api";
import { useAutoUpdate } from "./useAutoUpdate";

function CheckButton() {
  const { checkForUpdate } = useAutoUpdate({
    autoCheck: false,
    listenMenu: false,
  });
  return (
    <button type="button" onClick={() => void checkForUpdate()}>
      Check now
    </button>
  );
}

function mockCheckResult(result: AppUpdateCheckResult) {
  vi.mocked(invoke).mockImplementation(async (command: string) =>
    command === "check_for_app_update" ? result : null,
  );
}

async function runManualCheck() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <CheckButton />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Check now" }));
  return user;
}

describe("useAutoUpdate toasts", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(openUrl).mockReset();
  });

  it("links Windows and Linux builds to the latest release page", async () => {
    mockCheckResult({
      checked: true,
      installSupported: false,
      available: true,
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
      downloadUrl: null,
    });

    const user = await runManualCheck();

    expect(
      await screen.findByText("Update available: v0.4.0"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install and restart" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/treq-dev/treq/releases/latest",
    );
  });

  it("offers install on builds that can install in place", async () => {
    mockCheckResult({
      checked: true,
      installSupported: true,
      available: true,
      currentVersion: "0.3.0",
      latestVersion: "0.4.0",
      downloadUrl:
        "https://github.com/treq-dev/treq/releases/download/v0.4.0/treq_aarch64.app.tar.gz",
    });

    await runManualCheck();

    expect(
      await screen.findByRole("button", { name: "Install and restart" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("says update checks are off when the setting skipped the check", async () => {
    mockCheckResult({
      checked: false,
      installSupported: false,
      available: false,
      currentVersion: "0.3.0",
      latestVersion: null,
      downloadUrl: null,
    });

    await runManualCheck();

    expect(
      await screen.findByText("Update checks are off"),
    ).toBeInTheDocument();
  });
});
