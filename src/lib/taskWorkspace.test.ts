import { describe, expect, it } from "vitest";
import { taskBranchName } from "./taskWorkspace";

describe("taskBranchName", () => {
  it("names the branch after the prompt's words", () => {
    expect(taskBranchName("Fix: the login redirect (iOS)!", new Set())).toBe(
      "fix-the-login-redirect-ios",
    );
  });

  it("cuts a long prompt on a word boundary", () => {
    expect(
      taskBranchName(
        "Rework the ranking pipeline so it handles multi currency invoices correctly",
        new Set(),
      ),
    ).toBe("rework-the-ranking-pipeline-so-it-handles-multi");
  });

  it("falls back to task when the prompt has no ASCII letters or digits", () => {
    expect(taskBranchName("✨ 修复", new Set())).toBe("task");
  });

  it("adds a number when a workspace or branch already uses the name", () => {
    expect(taskBranchName("Fix bug", new Set(["fix-bug", "fix-bug-2"]))).toBe(
      "fix-bug-3",
    );
  });
});
