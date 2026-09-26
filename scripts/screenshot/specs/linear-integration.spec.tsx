import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

it("captures the Linear panel opened from the sidebar", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const user = userEvent.setup();
  render(<Dashboard />);

  await screen.findByRole("button", { name: "Settings" });
  const linearButton = await screen.findByTestId("linear-sidebar-item");
  expect(linearButton).toBeTruthy();

  await captureDocument(document, {
    name: "linear-integration-01-sidebar-button",
    expectations: [
      "A Linear nav item is visible in the sidebar, alongside the other panel buttons.",
      "The main workspace view is still showing; the Linear panel is not open yet.",
    ],
  });

  await user.click(linearButton);
  await screen.findByTestId("linear-panel");

  await captureDocument(document, {
    name: "linear-integration-02-panel-no-api-key",
    expectations: [
      "The Linear panel is open with List/Kanban view tabs visible.",
      "Since no API key or OAuth connection is configured for this repo, an error or empty state is shown instead of an issue list.",
      "The Linear sidebar item is highlighted as the current page.",
    ],
  });

  // The team selector dropdown is captured in
  // linear-views-filtering-projects.spec.tsx: inside the full Dashboard, jsdom
  // gives Base UI a zero-size anchor, so the popup lands under the sidebar.
}, 60000);

it("captures the Linear integration settings", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await screen.findByLabelText("Settings"));
  await user.click(await screen.findByRole("tab", { name: /integrations/i }));
  await screen.findByRole("tab", { name: /integrations/i, selected: true });
  await screen.findByRole("heading", { name: "Linear" });

  await captureDocument(document, {
    name: "linear-integration-03-settings",
    expectations: [
      "The Settings page Integrations tab is open with a Linear section.",
      "An API key input control and an 'Add API Key' (or similar) button are visible for the free-tier flow.",
      "An auto-kickoff label input control is visible below the API key section.",
    ],
  });

  await user.click(screen.getByRole("button", { name: /add label/i }));
  const labelInput = screen.getByPlaceholderText("e.g. ready-to-work");
  await user.type(labelInput, "ready-for-dev");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Auto-kickoff label saved");
  await screen.findByText(/Issues with label "ready-for-dev" auto-open a workspace/);

  await captureDocument(document, {
    name: "linear-integration-05-auto-kickoff-label-saved",
    expectations: [
      "A success toast confirms the auto-kickoff label was saved.",
      "The Auto-kickoff Label row now describes issues with label 'ready-for-dev' auto-opening a workspace, instead of the empty-state helper text.",
    ],
  });

  // Leave and re-enter the tab to prove the label persisted, not just local state.
  await user.click(await screen.findByRole("tab", { name: /application/i }));
  await user.click(await screen.findByRole("tab", { name: /integrations/i }));
  await screen.findByText(/Issues with label "ready-for-dev" auto-open a workspace/);

  await captureDocument(document, {
    name: "linear-integration-06-auto-kickoff-label-persisted",
    expectations: [
      "After switching away to Application and back to Integrations, the Auto-kickoff Label row still shows the saved label 'ready-for-dev', proving it was persisted rather than only held in local state.",
    ],
  });
}, 60000);

// The ShowWorkspace "linked to Linear issue" badge (data-testid
// "linear-issue-badge") and the backend write that populates it are
// covered by core::workspaces::merge_linear_issue_metadata_persists_to_real_workspace
// in src-tauri -- there's no test-only way to seed workspace metadata from
// this harness without a production-only command whose sole caller would be
// this spec, so that plumbing is verified at the Rust layer instead.
