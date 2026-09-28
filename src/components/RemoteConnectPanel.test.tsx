import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteConnectPanel,
  SECURE_STORAGE_UNAVAILABLE_PREFIX,
} from "./RemoteConnectPanel";
import * as api from "../lib/api";
import { DEVICE_KEYSTORE_KEY_REFERENCE } from "../lib/api-types-remote";
import * as controlPlane from "../lib/remote-control-plane";
import * as remoteDispatch from "../lib/remote-dispatch";
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

describe("DEVICE_KEYSTORE_KEY_REFERENCE", () => {
  it("matches the reserved reference the Rust transport resolves", () => {
    const rustSource = readFileSync(
      resolve(process.cwd(), "src-tauri/src/core/remote_ssh_transport.rs"),
      "utf-8",
    );
    const match = rustSource.match(
      /pub const DEVICE_KEYSTORE_KEY_REFERENCE: &str = "([^"]*)";/,
    );
    expect(match).not.toBeNull();
    expect(DEVICE_KEYSTORE_KEY_REFERENCE).toBe(match?.[1]);
  });
});

describe("RemoteConnectPanel", () => {
  it("dispatches over SSH with the device keystore key and the issued certificate", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "ensureMobileDeviceKey").mockResolvedValue({
      public_key: "ssh-ed25519 AAAA device",
      fingerprint_sha256: "SHA256:device",
    });
    vi.spyOn(controlPlane, "registerClientKey").mockResolvedValue({
      id: "key-1",
      algorithm: "ssh-ed25519",
      fingerprint_sha256: "SHA256:device",
      comment: "treq-mobile-device",
      created_at: "2024-01-01T00:00:00Z",
      revoked_at: null,
    });
    vi.spyOn(controlPlane, "getInstanceStatus").mockResolvedValue({
      instance: { instance_id: "inst-1" },
      endpoint: null,
    } as never);
    vi.spyOn(controlPlane, "issueCertificate").mockResolvedValue({
      certificate: "ssh-ed25519-cert-v01@openssh.com AAAA issued",
      serial: "1",
      expires_at: "2099-01-01T00:00:00Z",
      endpoint: {
        id: "endpoint-1",
        instance_id: "inst-1",
        source: { type: "managed", provider: "fly_sprites", generation: 1 },
        hostname: "inst-1.example",
        port: 22,
        username: "treq",
        host_keys: [],
        authentication: { type: "certificate", key_reference: "key-1" },
      },
    });
    // `exists: false` keeps the repository screen (and its own dispatches)
    // out of this test; only the endpoint shape matters here.
    const dispatch = vi
      .spyOn(remoteDispatch, "dispatchOverSsh")
      .mockResolvedValue({
        host: "inst-1.example",
        path: "/home/treq/repo",
        exists: false,
        is_repo: false,
        needs_clone: true,
      });

    render(<RemoteConnectPanel />);
    await user.click(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    );
    await user.type(
      await screen.findByPlaceholderText("Repository path on the instance"),
      "/home/treq/repo",
    );
    await user.click(
      screen.getByRole("button", { name: "Inspect repository" }),
    );

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    const [[endpoint]] = dispatch.mock.calls;
    expect(endpoint.authentication).toEqual({
      type: "certificate",
      key_reference: DEVICE_KEYSTORE_KEY_REFERENCE,
      certificate: "ssh-ed25519-cert-v01@openssh.com AAAA issued",
    });
  });

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
