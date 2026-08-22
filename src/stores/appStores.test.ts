import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffSettingsStore } from "./diffSettingsStore";
import { useEditorAppsStore } from "./editorAppsStore";
import { resetAllStores } from "./resetStores";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { useThemeStore } from "./themeStore";
import { useToastStore } from "./toastStore";
import { useTreqSendStore } from "./treqSendStore";
import { MAX_ZOOM, MIN_ZOOM, useZoomSettingsStore } from "./zoomSettingsStore";
import { applySettingsRecord } from "./settingsHydration";

vi.mock("../lib/api", () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  getSettingsBatch: vi.fn().mockResolvedValue({}),
  detectEditorApps: vi.fn(),
}));

describe("client zustand stores", () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
  });

  it("computes actual theme from system preference", () => {
    useThemeStore.getState().setSystemTheme("dark");
    expect(useThemeStore.getState().actualTheme()).toBe("dark");
    useThemeStore.setState({ theme: "light" });
    expect(useThemeStore.getState().actualTheme()).toBe("light");
  });

  it("clamps zoom to the allowed range", async () => {
    await useZoomSettingsStore.getState().setZoom(999);
    expect(useZoomSettingsStore.getState().zoom).toBe(MAX_ZOOM);
    await useZoomSettingsStore.getState().setZoom(1);
    expect(useZoomSettingsStore.getState().zoom).toBe(MIN_ZOOM);
  });

  it("rejects out-of-range diff font sizes", async () => {
    await expect(
      useDiffSettingsStore.getState().setFontSize(3),
    ).rejects.toThrow(/between 8 and 16/);
    expect(useDiffSettingsStore.getState().fontSize).toBe(11);
  });

  it("defaults terminal font size to 14", () => {
    expect(useTerminalSettingsStore.getState().fontSize).toBe(14);
  });

  it("rejects out-of-range terminal font sizes", async () => {
    await expect(
      useTerminalSettingsStore.getState().setFontSize(99),
    ).rejects.toThrow(/between 8 and 32/);
    expect(useTerminalSettingsStore.getState().fontSize).toBe(14);
  });

  it("hydrates persisted settings in one pass", () => {
    applySettingsRecord({
      theme: "dark",
      terminal_font_size: "18",
      diff_font_size: "13",
      ui_zoom: "125",
    });
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(useTerminalSettingsStore.getState().fontSize).toBe(18);
    expect(useDiffSettingsStore.getState().fontSize).toBe(13);
    expect(useZoomSettingsStore.getState().zoom).toBe(125);
  });

  it("dedupes treq send assets by id", () => {
    const asset = {
      id: "send-1",
      repo: "/tmp/repo",
      ptySessionId: "pty-1",
      mediaType: "text" as const,
      path: "/tmp/note.txt",
      title: "note.txt",
      receivedAt: 1,
    };
    useTreqSendStore.getState().ingestPayload(asset);
    useTreqSendStore.getState().ingestPayload({ ...asset, title: "other" });
    expect(useTreqSendStore.getState().assets).toHaveLength(1);
  });

  it("adds and removes toasts", () => {
    const id = useToastStore.getState().addToast({
      title: "Saved",
      type: "success",
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("resets editor apps and toasts together", () => {
    useEditorAppsStore.setState({
      cursor: true,
      vscode: true,
      zed: false,
      isLoading: false,
    });
    useToastStore.getState().addToast({ title: "x", type: "info" });
    resetAllStores();
    expect(useEditorAppsStore.getState()).toMatchObject({
      cursor: false,
      vscode: false,
      zed: false,
      isLoading: true,
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
