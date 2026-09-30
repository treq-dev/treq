import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { InstanceStatusResponse } from "../../lib/api-types-remote";
import { CloudWorkspaceCard } from "./CloudWorkspaceCard";

function statusWith(status: string): InstanceStatusResponse {
  return {
    instance: {
      instance_id: "instance-1",
      status,
      provider_resource_id: "treq-user-1",
      generation: 0,
      disk_quota_gb: 5,
    },
    endpoint: null,
  } as never;
}

function renderCard(instanceStatus: InstanceStatusResponse) {
  const onProvision = vi.fn().mockResolvedValue(undefined);
  render(
    <CloudWorkspaceCard
      instanceStatus={instanceStatus}
      onProvision={onProvision}
      onWake={vi.fn()}
      onRepair={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return onProvision;
}

describe("CloudWorkspaceCard", () => {
  it("offers to create a new cloud workspace after the old one was deleted", async () => {
    const user = userEvent.setup();
    const onProvision = renderCard(statusWith("deleted"));

    expect(
      screen.queryByRole("button", { name: "Delete cloud workspace" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create cloud workspace" }),
    );
    expect(onProvision).toHaveBeenCalledOnce();
  });

  it("manages a live cloud workspace instead of offering to create one", () => {
    renderCard(statusWith("suspended"));

    expect(
      screen.getByRole("button", { name: "Delete cloud workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create cloud workspace" }),
    ).not.toBeInTheDocument();
  });
});
