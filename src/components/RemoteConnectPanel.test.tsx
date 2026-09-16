import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteConnectPanel } from "./RemoteConnectPanel";
import * as api from "../lib/api";
import { render, screen } from "../../test/test-utils";

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(alert).toHaveTextContent(
      "Biometrics are not set up on this device",
    );
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
