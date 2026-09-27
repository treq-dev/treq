import { describe, expect, it } from "vitest";
import {
  formatPromptWithGitHubIssue,
  formatPromptWithTrackerItem,
} from "./promptAttachments";

describe("formatPromptWithGitHubIssue", () => {
  const issue = {
    number: 42,
    url: "https://github.com/acme/treq/issues/42",
    title: "Fix the login bug",
  };

  it("appends the issue number and url when the user typed a prompt", () => {
    expect(formatPromptWithGitHubIssue("fix auth redirect", issue)).toBe(
      "fix auth redirect\n\nGitHub issue #42: https://github.com/acme/treq/issues/42",
    );
  });

  it("builds a default prompt from the issue when the textarea is empty", () => {
    expect(formatPromptWithGitHubIssue("  ", issue)).toBe(
      "Address GitHub issue #42: Fix the login bug\n\nhttps://github.com/acme/treq/issues/42",
    );
  });

  it("omits the title suffix when the issue has no title", () => {
    expect(formatPromptWithGitHubIssue("", { ...issue, title: "" })).toBe(
      "Address GitHub issue #42\n\nhttps://github.com/acme/treq/issues/42",
    );
  });
});

describe("formatPromptWithTrackerItem", () => {
  const card = {
    provider: "trello" as const,
    id: "card-1",
    key: "#12",
    url: "https://trello.com/c/AbC123xy",
    title: "Add Trello integration",
    includeSubItems: false,
  };

  it("names the provider and item when the user typed a prompt", () => {
    expect(formatPromptWithTrackerItem("wire the panel", card)).toBe(
      "wire the panel\n\nTrello card #12: https://trello.com/c/AbC123xy",
    );
  });

  it("builds a default prompt from the item when the textarea is empty", () => {
    expect(
      formatPromptWithTrackerItem("", {
        ...card,
        provider: "jira",
        key: "ENG-42",
        url: "https://acme.atlassian.net/browse/ENG-42",
        title: "Add Jira integration",
      }),
    ).toBe(
      "Address Jira issue ENG-42: Add Jira integration\n\nhttps://acme.atlassian.net/browse/ENG-42",
    );
  });
});
