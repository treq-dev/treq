import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "./AccountSettings";
import { defaultAuthState, useAuthStore } from "../stores/authStore";

vi.mock("../lib/api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("AccountSettings", () => {
  beforeEach(() => {
    useAuthStore.setState({
      ...defaultAuthState,
      loading: false,
      user: {
        id: "user-1",
        email: "dev@example.com",
        user_metadata: {},
      } as never,
    });
  });

  it("opens remote environment setup from the account page", async () => {
    const onOpenRemoteSetup = vi.fn();
    render(<AccountSettings onOpenRemoteSetup={onOpenRemoteSetup} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Manage remote environment" }),
    );

    expect(onOpenRemoteSetup).toHaveBeenCalledOnce();
  });
});
