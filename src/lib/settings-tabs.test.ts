import { describe, expect, it } from "vitest";
import { resolveSettingsTab } from "./settings-tabs";

describe("resolveSettingsTab", () => {
  it("keeps a known tab", () => {
    expect(
      resolveSettingsTab("integrations", { skillsInstallation: false }),
    ).toBe("integrations");
  });
  it("falls back to the default for unknown or missing tabs", () => {
    expect(resolveSettingsTab("bogus", { skillsInstallation: true })).toBe(
      "repository",
    );
    expect(resolveSettingsTab(undefined, { skillsInstallation: true })).toBe(
      "repository",
    );
  });
  it("respects the Skills preview flag", () => {
    expect(resolveSettingsTab("skills", { skillsInstallation: false })).toBe(
      "repository",
    );
    expect(resolveSettingsTab("skills", { skillsInstallation: true })).toBe(
      "skills",
    );
  });
});
