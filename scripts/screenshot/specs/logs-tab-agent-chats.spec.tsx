import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import {
  recordAgentChatScreen,
  recordAgentChatUserMessage,
  registerAgentChat,
} from "../../../src/lib/api";
import { captureDocument } from "../capture";

it("captures the Agent chats log source group", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  await registerAgentChat(repoPath, 21, "pty-21", "Claude", "claude", null);
  await recordAgentChatScreen(repoPath, 21, "Welcome to Claude");
  await recordAgentChatUserMessage(
    repoPath,
    21,
    "Welcome to Claude",
    "explain the stack",
  );
  await recordAgentChatScreen(
    repoPath,
    21,
    "Welcome to Claude\nexplain the stack\nThis stack has two workspaces.",
  );

  const user = userEvent.setup();
  render(<Dashboard />);
  await user.click(await screen.findByRole("tab", { name: /^Logs/ }));
  await user.selectOptions(
    await screen.findByLabelText("Log source"),
    "agent-chats",
  );
  await screen.findByText("explain the stack");
  await screen.findByText(/This stack has two workspaces/i);

  await captureDocument(document, {
    name: "logs-tab-agent-chats-01",
    expectations: [
      'The "Log source" select in the header reads "Agent".',
      'A dropdown lists the "Claude · claude" agent terminal; Browse/Logs Explorer are not shown.',
      "Conversation lines show a Role column (user/agent) plus the cleaned message text.",
    ],
  });
}, 60000);
