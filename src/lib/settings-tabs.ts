export const SETTINGS_TABS = [
  "repository",
  "application",
  "account",
  "integrations",
  "skills",
  "preview",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "repository";

/**
 * The tab to open for a requested id: a known tab that is shown (Skills only
 * with its preview flag on), otherwise the default tab.
 */
export function resolveSettingsTab(
  requested: string | undefined,
  flags: { skillsInstallation: boolean },
): SettingsTab {
  const tab = SETTINGS_TABS.find((t) => t === requested);
  if (!tab || (tab === "skills" && !flags.skillsInstallation)) {
    return DEFAULT_SETTINGS_TAB;
  }
  return tab;
}
