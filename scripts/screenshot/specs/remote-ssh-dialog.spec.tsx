import * as React from "react";
import userEvent from "@testing-library/user-event";
import { it } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { render, screen } from "../../../test/test-utils";
import { captureDocument } from "../capture";

it("captures the remote setup flow opening from onboarding", async () => {
  window.history.replaceState({}, "", "/");
  const user = userEvent.setup();
  render(<Dashboard />);

  await screen.findByRole("button", { name: "Open via SSH" });
  await captureDocument(document, {
    name: "remote-ssh-dialog-01-onboarding",
    expectations: [
      "An onboarding card is shown with an 'Open Repository' button and an 'Open via SSH' button.",
    ],
  });

  await user.click(await screen.findByRole("button", { name: "Open via SSH" }));
  await screen.findByRole("dialog", { name: "Connect a remote repository" });
  await captureDocument(document, {
    name: "remote-ssh-dialog-02-choice",
    expectations: [
      "A modal dialog titled 'Connect a remote repository' is shown, overlaying the onboarding card, offering 'Treq-managed Sprite' and 'Your own VM' choices.",
    ],
  });

  await user.click(await screen.findByRole("button", { name: /Your own VM/ }));
  await screen.findByLabelText("Display name");
  await captureDocument(document, {
    name: "remote-ssh-dialog-04-user-managed",
    expectations: [
      "The dialog now shows the 'Your own VM' form with Display name, Hostname or IP address, SSH port, Username, Expected host-key fingerprint, and Auth identity reference fields.",
    ],
  });

  await user.type(screen.getByLabelText("Display name"), "My dev box");
  await user.type(
    screen.getByLabelText("Hostname or IP address"),
    "203.0.113.4",
  );
  await user.type(screen.getByLabelText("Username"), "dev");
  await user.type(
    screen.getByLabelText("Expected host-key fingerprint"),
    "SHA256:exampleFingerprint",
  );
  await user.type(
    screen.getByLabelText("Auth identity reference"),
    "~/.ssh/id_ed25519",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByTestId("host-trust-confirmation");
  await captureDocument(document, {
    name: "remote-ssh-dialog-05-host-trust-confirmation",
    expectations: [
      "A yellow host-trust confirmation box is shown, summarizing the user@host:port and fingerprint about to be trusted, with 'Trust and connect' and 'Cancel' buttons.",
    ],
  });
}, 60000);
