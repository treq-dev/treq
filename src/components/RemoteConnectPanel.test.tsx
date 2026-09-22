import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteConnectPanel,
  SECURE_STORAGE_UNAVAILABLE_PREFIX,
} from "./RemoteConnectPanel";
import * as api from "../lib/api";
import { render, screen } from "../../test/test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SECURE_STORAGE_UNAVAILABLE_PREFIX", () => {
  it("stays byte-for-byte in sync with the Rust constant of the same name", () => {
    // `SECURE_STORAGE_UNAVAILABLE_PREFIX` is hand-duplicated on the TS side
    // because `ensure_mobile_device_key`'s Tauri command returns a plain
    // `Result<_, String>` (shared with other `remote_*` commands - see the
    // doc comment on the Rust constant), so there's no generated binding to
    // pull the value from. This test is the enforcement that would
    // otherwise be missing: it fails loudly if either literal changes
    // without the other, instead of silently breaking the
    // "set up biometrics" UI state.
    const rustSourcePath = resolve(
      process.cwd(),
      "src-tauri/src/core/remote_device_key.rs",
    );
    const rustSource = readFileSync(rustSourcePath, "utf-8");
    const match = rustSource.match(
      /pub const SECURE_STORAGE_UNAVAILABLE_PREFIX: &str = "([^"]*)";/,
    );
    expect(
      match,
      "could not find `SECURE_STORAGE_UNAVAILABLE_PREFIX` const in remote_device_key.rs - has it moved or been renamed?",
    ).not.toBeNull();
    expect(SECURE_STORAGE_UNAVAILABLE_PREFIX).toBe(match?.[1]);
  });
});

describe("RemoteConnectPanel", () => {
  it("shows a dedicated state when secure storage / biometrics isn't set up", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "ensureMobileDeviceKey").mockRejectedValue(
      new Error(
        "secure_storage_unavailable:Biometrics are not set up on this device; the device key cannot be stored securely.",
      ),
    );

    render(<RemoteConnectPanel />);
    await user.click(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Secure storage isn't set up on this device",
    );
    expect(alert).toHaveTextContent("Biometrics are not set up on this device");
    // The generic connect button is replaced by the dedicated retry action.
    expect(
      screen.queryByRole("button", { name: "Connect to managed instance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("shows a generic error for non-secure-storage failures", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "ensureMobileDeviceKey").mockRejectedValue(
      new Error("network unreachable"),
    );

    render(<RemoteConnectPanel />);
    await user.click(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    );

    expect(await screen.findByText("network unreachable")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    ).toBeInTheDocument();
  });
});
