import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/toast";
import { resetAllStores } from "../stores/resetStores";
import { useWhatsNew } from "./useWhatsNew";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));

/** In-memory stand-in for the app settings table behind get/set_setting. */
let settings: Map<string, string>;

function WhatsNew() {
  useWhatsNew();
  return null;
}

/** Simulates one app launch on `version`, then lets the hook settle. */
async function launch(version: string) {
  vi.mocked(getVersion).mockResolvedValue(version);
  // A fresh SWR cache per render, as each app launch starts with one.
  const view = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ToastProvider>
        <WhatsNew />
      </ToastProvider>
    </SWRConfig>,
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("get_setting", {
      key: "last_seen_app_version",
    }),
  );
  // Flush the rest of the hook's promise chain (write, then toast).
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return view;
}

describe("useWhatsNew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings = new Map();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      const { key, value } = (args ?? {}) as { key: string; value?: string };
      if (cmd === "get_setting") return settings.get(key) ?? null;
      if (cmd === "set_setting") settings.set(key, value ?? "");
      return null;
    });
  });

  it("records the version silently on a fresh install", async () => {
    await launch("0.3.0");

    expect(settings.get("last_seen_app_version")).toBe("0.3.0");
    expect(screen.queryByText(/Updated to/)).toBeNull();
  });

  it("shows nothing when the version has not changed", async () => {
    settings.set("last_seen_app_version", "0.3.0");

    await launch("0.3.0");

    expect(screen.queryByText(/Updated to/)).toBeNull();
    expect(settings.get("last_seen_app_version")).toBe("0.3.0");
  });

  it("shows the toast once after an update", async () => {
    settings.set("last_seen_app_version", "0.2.0");

    const first = await launch("0.3.0");
    expect(await screen.findByText("Updated to v0.3.0")).toBeInTheDocument();
    expect(settings.get("last_seen_app_version")).toBe("0.3.0");
    first.unmount();
    resetAllStores();
    vi.mocked(invoke).mockClear();

    await launch("0.3.0");
    expect(screen.queryByText(/Updated to/)).toBeNull();
  });

  it("shows nothing after a downgrade and keeps the newer version", async () => {
    settings.set("last_seen_app_version", "0.10.0");

    await launch("0.9.0");

    expect(screen.queryByText(/Updated to/)).toBeNull();
    expect(settings.get("last_seen_app_version")).toBe("0.10.0");
  });

  it("opens the changelog from the What's new action", async () => {
    settings.set("last_seen_app_version", "0.2.0");
    const user = userEvent.setup();

    await launch("0.3.0");
    await user.click(await screen.findByRole("button", { name: "What's new" }));

    expect(openUrl).toHaveBeenCalledWith("https://treq.dev/changelog");
  });
});
