import {
  MAX_DIFF_FONT_SIZE,
  MIN_DIFF_FONT_SIZE,
  useDiffSettingsStore,
} from "./diffSettingsStore";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  useTerminalSettingsStore,
} from "./terminalSettingsStore";
import { type Theme, useThemeStore } from "./themeStore";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  useSidebarWidthStore,
} from "./sidebarWidthStore";
import { MAX_ZOOM, MIN_ZOOM, useZoomSettingsStore } from "./zoomSettingsStore";

function parseIntInRange(
  raw: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function applySettingsRecord(
  settings: Record<string, string | null | undefined>,
) {
  const { theme } = settings;
  if (theme === "light" || theme === "dark" || theme === "system") {
    useThemeStore.getState().hydrateTheme(theme as Theme);
  }

  const terminalFont = parseIntInRange(
    settings.terminal_font_size,
    MIN_TERMINAL_FONT_SIZE,
    MAX_TERMINAL_FONT_SIZE,
  );
  if (terminalFont != null) {
    useTerminalSettingsStore.getState().hydrateFontSize(terminalFont);
  }

  const diffFont = parseIntInRange(
    settings.diff_font_size,
    MIN_DIFF_FONT_SIZE,
    MAX_DIFF_FONT_SIZE,
  );
  if (diffFont != null) {
    useDiffSettingsStore.getState().hydrateFontSize(diffFont);
  }

  const zoom = parseIntInRange(settings.ui_zoom, MIN_ZOOM, MAX_ZOOM);
  if (zoom != null) {
    useZoomSettingsStore.getState().hydrateZoom(zoom);
  }

  const sidebarWidth = parseIntInRange(
    settings.workspace_sidebar_width,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
  );
  if (sidebarWidth != null) {
    useSidebarWidthStore.getState().hydrateWidth(sidebarWidth);
  }
}
