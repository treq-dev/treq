import { vi } from "vitest";

// Shared DOM polyfills, browser API stubs, Tauri plugin mocks, and hook mocks
import "./setup.common";

// Unit tests use a no-op invoke mock — all backend calls return null by default
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  isTauri: () => true,
}));
