import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import {
  getSessionModel,
  getSessions,
  setRepoSetting,
  setSetting,
} from "../../src/lib/api";
import { render, screen, waitFor, within } from "../test-utils";
import { createTestRepo, openRepo } from "../utils";

const PROMPT = "Add input validation to the signup form";

describe("agent session default model", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let repoPath: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  async function startSessionFromPromptDialog() {
    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");
    await user.keyboard("{Meta>}i{/Meta}");
    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    await user.type(
      within(dialog).getByPlaceholderText("Describe a task..."),
      PROMPT,
    );
    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));

    let sessionId: number | undefined;
    await waitFor(async () => {
      const sessions = await getSessions(repoPath);
      sessionId = sessions.find((s) => s.name === PROMPT)?.id;
      expect(sessionId).toBeDefined();
    });
    return sessionId as number;
  }

  it("applies the app default model to sessions started from the prompt dialog", async () => {
    await setSetting("default_model", "sonnet");

    const sessionId = await startSessionFromPromptDialog();

    expect(await getSessionModel(repoPath, sessionId)).toBe("sonnet");
  }, 60000);

  it("prefers the repo default model over the app default", async () => {
    await setSetting("default_model", "sonnet");
    await setRepoSetting(repoPath, "default_model", "opus");

    const sessionId = await startSessionFromPromptDialog();

    expect(await getSessionModel(repoPath, sessionId)).toBe("opus");
  }, 60000);
});
