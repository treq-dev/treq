import * as React from "react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import type {
  InstanceStatusResponse,
  ManagedInstanceRecord,
} from "../../../src/lib/api-types-remote";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { captureDocument } from "../capture";

// Sprite lifecycle lives behind the `remote-instance` Supabase Edge Function,
// which the desktop harness cannot reach. Only that boundary is stubbed; the
// dialog, Dashboard handlers, and `remote-control-plane` error decoding are
// real. `server` is mutated by the spec to walk the flow through each state
// the edge function can report.
const { server } = vi.hoisted(() => ({
  server: {
    status: { instance: null, endpoint: null } as InstanceStatusResponse,
    nextEnsure: "fail" as "fail" | "defer",
    releaseEnsure: null as null | (() => void),
    actions: [] as string[],
  },
}));

function sprite(
  overrides: Partial<ManagedInstanceRecord>,
): ManagedInstanceRecord {
  return {
    instance_id: "inst-qa",
    owner_user_id: "user-qa",
    provider_kind: "fly_sprites",
    provider_resource_id: "treq-user-qa",
    region: "us_east",
    size_preset: "small",
    status: "provisioning",
    generation: 1,
    endpoint_id: null,
    image_manifest_version: 1,
    created_at: "2026-09-26T00:00:00Z",
    ready_at: null,
    disk_quota_gb: 20,
    vcpu_quota: 2,
    ram_quota_gb: 4,
    ...overrides,
  };
}

vi.mock("../../../src/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: [], error: null })),
    functions: {
      invoke: vi.fn(
        async (_fn: string, { body }: { body: { action: string } }) => {
          server.actions.push(body.action);
          if (body.action === "status") {
            return { data: server.status, error: null };
          }
          if (body.action === "ensure" && server.nextEnsure === "fail") {
            return {
              data: null,
              error: {
                message: "Edge Function returned a non-2xx status code",
                context: new Response(
                  JSON.stringify({
                    error: "Sprites API rejected the create request",
                    code: "provider_error",
                    correlation_id: "corr-7f3a",
                  }),
                  { status: 502 },
                ),
              },
            };
          }
          if (body.action === "ensure") {
            await new Promise<void>((resolve) => {
              server.releaseEnsure = resolve;
            });
            server.status = {
              instance: sprite({ status: "bootstrapping" }),
              endpoint: null,
            };
            return {
              data: { operation_id: "op-1", status: "running" },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      ),
    },
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon",
  WEB_URL: "http://localhost:3000",
}));

it("captures creating a Treq-managed Sprite from onboarding", async () => {
  window.history.replaceState({}, "", "/");
  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await screen.findByRole("button", { name: "Open via SSH" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Connect a remote repository",
  });
  await captureDocument(document, {
    name: "remote-sprite-creation-01-choice",
    expectations: [
      "A modal titled 'Connect a remote repository' offers two cards: 'Treq-managed Sprite' and 'Your own VM'.",
      "Each card has a one-line description under its title.",
    ],
  });

  await user.click(
    within(dialog).getByRole("button", { name: /Treq-managed Sprite/ }),
  );
  await screen.findByRole("button", { name: "Create Sprite" });
  expect(screen.queryByLabelText("Region")).toBeNull();
  await captureDocument(document, {
    name: "remote-sprite-creation-02-managed-empty",
    expectations: [
      "The dialog title is 'Treq-managed Sprite' with copy explaining Treq creates one Sprite per account.",
      "There are no Region, Size, or SSH identity inputs.",
      "A 'Back' ghost button sits bottom-left and a primary 'Create Sprite' button bottom-right.",
    ],
  });

  // First attempt: the provider rejects the create call.
  await user.click(screen.getByRole("button", { name: "Create Sprite" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("[provider_error]");
  expect(alert.textContent).toContain("corr-7f3a");
  await captureDocument(document, {
    name: "remote-sprite-creation-03-create-error",
    expectations: [
      "A red-bordered error box shows '[provider_error] Sprites API rejected the create request' and 'HTTP 502 · Correlation ID: corr-7f3a' on its own line.",
      "A 'Copy error' button sits under the error text.",
      "The 'Create Sprite' button is enabled again for a retry.",
    ],
  });

  // Second attempt: hold the request open to capture the in-flight state.
  server.nextEnsure = "defer";
  await user.click(screen.getByRole("button", { name: "Create Sprite" }));
  const creating = await screen.findByRole("button", { name: "Creating..." });
  expect(creating).toBeDisabled();
  await screen.findByText("Requesting provisioning...");
  await captureDocument(document, {
    name: "remote-sprite-creation-04-creating",
    expectations: [
      "The primary button reads 'Creating...' and looks disabled, as does 'Back'.",
      "A muted 'Requesting provisioning...' line is shown and the previous error box is gone.",
    ],
  });

  server.releaseEnsure?.();
  await screen.findByText("Installing Treq, JJ, Git, and agents...");
  await captureDocument(document, {
    name: "remote-sprite-creation-05-bootstrapping",
    expectations: [
      "A status card reads 'Installing Treq, JJ, Git, and agents...' with 'Sprite · gen 1' on the right.",
      "'Repair setup' and a red 'Delete Sprite' button are shown; there is no 'Create Sprite' or 'Connect' button.",
    ],
  });

  // The control plane finishes setup; reopening the dialog reloads status.
  server.status = {
    instance: sprite({ status: "ready", ready_at: "2026-09-26T00:05:00Z" }),
    endpoint: {
      id: "ep-sprite",
      instance_id: "inst-qa",
      source: { type: "managed", provider: "fly_sprites", generation: 1 },
      hostname: "treq-user-qa.sprites.app",
      port: 22,
      username: "sprite",
      host_keys: [],
      authentication: {
        type: "certificate",
        key_reference: "~/.ssh/id_ed25519",
      },
    },
  };
  // The shared Dialog has no Escape handler or close button; the backdrop is
  // the only dismiss affordance.
  const backdrop = screen.getByRole("dialog").parentElement
    ?.previousElementSibling as HTMLElement;
  await user.click(backdrop);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(await screen.findByRole("button", { name: "Open via SSH" }));
  await user.click(
    await screen.findByRole("button", { name: /Treq-managed Sprite/ }),
  );
  await screen.findByRole("button", { name: "Connect" });
  await captureDocument(document, {
    name: "remote-sprite-creation-06-ready",
    expectations: [
      "The status card reads 'Ready' with 'Sprite · gen 1' and 'sprite@treq-user-qa.sprites.app:22' underneath.",
      "'Connect', 'Open repositories', 'Repair setup', and 'Delete Sprite' buttons are visible.",
    ],
  });

  expect(server.actions.filter((a) => a === "ensure")).toHaveLength(2);
}, 60000);
