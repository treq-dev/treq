import { afterEach, describe, expect, it, vi } from "vitest";
import { isMobileBuild, shouldUseMobileShell } from "./mobile-platform";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isMobileBuild", () => {
  it.each(["android", "ios"])("is true for a %s build", (platform) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    expect(isMobileBuild()).toBe(true);
  });

  it.each([
    "darwin",
    "linux",
    "windows",
    "",
  ])("is false for a desktop build (%s)", (platform) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    expect(isMobileBuild()).toBe(false);
  });
});

describe("shouldUseMobileShell", () => {
  it("always uses the mobile shell on a mobile build", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "android");
    expect(shouldUseMobileShell("")).toBe(true);
  });

  it("keeps the desktop shell on desktop whatever the window size", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "linux");
    expect(shouldUseMobileShell("?repo=/tmp/repo")).toBe(false);
  });

  it("lets a desktop dev build preview the mobile shell", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "linux");
    vi.stubEnv("DEV", true);
    expect(shouldUseMobileShell("?shell=mobile")).toBe(true);
  });

  it("ignores the preview parameter in a release build", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "linux");
    vi.stubEnv("DEV", false);
    expect(shouldUseMobileShell("?shell=mobile")).toBe(false);
  });
});
