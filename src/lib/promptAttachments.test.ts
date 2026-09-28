import { describe, expect, it } from "vitest";
import {
  ISSUE_SOURCES,
  formatPromptWithIssue,
  issueFromGitHub,
  issueFromLinear,
  issueFromTrackerItem,
  type IssueAttachment,
} from "./promptAttachments";

const githubIssue: IssueAttachment = {
  source: "github",
  id: "42",
  key: "#42",
  url: "https://github.com/acme/treq/issues/42",
  title: "Fix the login bug",
  includeSubItems: false,
};

describe("formatPromptWithIssue", () => {
  it("appends the issue reference and url when the user typed a prompt", () => {
    expect(formatPromptWithIssue("fix auth redirect", githubIssue)).toBe(
      "fix auth redirect\n\nGitHub issue #42: https://github.com/acme/treq/issues/42",
    );
  });

  it("builds a default prompt from the issue when the textarea is empty", () => {
    expect(formatPromptWithIssue("  ", githubIssue)).toBe(
      "Address GitHub issue #42: Fix the login bug\n\nhttps://github.com/acme/treq/issues/42",
    );
  });

  it("omits the title suffix when the issue has no title", () => {
    expect(formatPromptWithIssue("", { ...githubIssue, title: "" })).toBe(
      "Address GitHub issue #42\n\nhttps://github.com/acme/treq/issues/42",
    );
  });

  it("names each source with its own label and item noun", () => {
    const at = (source: IssueAttachment["source"], key: string) =>
      formatPromptWithIssue("do it", {
        ...githubIssue,
        source,
        key,
        url: "https://example.test/x",
      });
    expect(at("linear", "ENG-101")).toBe(
      "do it\n\nLinear issue ENG-101: https://example.test/x",
    );
    expect(at("trello", "#12")).toBe(
      "do it\n\nTrello card #12: https://example.test/x",
    );
    expect(at("jira", "ENG-42")).toBe(
      "do it\n\nJira issue ENG-42: https://example.test/x",
    );
  });
});

describe("issue adapters", () => {
  it("maps a GitHub issue to a #number key", () => {
    expect(
      issueFromGitHub({
        number: 42,
        url: githubIssue.url,
        title: "Fix the login bug",
      }),
    ).toEqual(githubIssue);
  });

  it("maps a Linear issue, keeping its sub-issue choice", () => {
    expect(
      issueFromLinear({
        id: "issue-1",
        identifier: "ENG-101",
        url: "https://linear.app/x/ENG-101",
        title: "Rework ranking",
        includeSubissues: true,
      }),
    ).toEqual({
      source: "linear",
      id: "issue-1",
      key: "ENG-101",
      url: "https://linear.app/x/ENG-101",
      title: "Rework ranking",
      includeSubItems: true,
    });
  });

  it("maps a Trello or Jira item to its provider as the source", () => {
    expect(
      issueFromTrackerItem({
        provider: "jira",
        id: "10001",
        key: "ENG-42",
        url: "https://acme.atlassian.net/browse/ENG-42",
        title: "Add Jira integration",
        includeSubItems: false,
      }).source,
    ).toBe("jira");
  });

  it("describes sub-items with each source's own noun", () => {
    expect(ISSUE_SOURCES.linear.subItemNoun).toBe("sub-issues");
    expect(ISSUE_SOURCES.github.label).toBe("GitHub");
  });
});
