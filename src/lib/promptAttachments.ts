import { TRACKER_PROVIDERS, type TrackerProvider } from "./trackers";

/**
 * An issue attached to an agent prompt. Every tracker (GitHub, Linear,
 * Trello, Jira) uses this one shape, so the prompt dialog, chip, prompt text
 * and "open the issue's workspace" step behave the same for all of them.
 */
export type IssueSource = "github" | "linear" | TrackerProvider;

export interface IssueAttachment {
  source: IssueSource;
  /** Id the source's backend command needs (a GitHub issue number as text). */
  id: string;
  /** What the user sees: `#42`, `ENG-101`, `#12`. */
  key: string;
  url: string;
  title: string;
  /** Also open workspaces for the issue's sub-items, where the source has them. */
  includeSubItems: boolean;
  /** The sub-items to open, one workspace each, after the issue's own. */
  subItemIds: string[];
}

export const ISSUE_SOURCES: Record<
  IssueSource,
  { label: string; itemNoun: string; subItemNoun: string }
> = {
  github: { label: "GitHub", itemNoun: "issue", subItemNoun: "sub-issues" },
  linear: { label: "Linear", itemNoun: "issue", subItemNoun: "sub-issues" },
  trello: {
    label: TRACKER_PROVIDERS.trello.label,
    itemNoun: TRACKER_PROVIDERS.trello.itemNoun,
    subItemNoun: TRACKER_PROVIDERS.trello.subItemNoun,
  },
  jira: {
    label: TRACKER_PROVIDERS.jira.label,
    itemNoun: TRACKER_PROVIDERS.jira.itemNoun,
    subItemNoun: TRACKER_PROVIDERS.jira.subItemNoun,
  },
};

/** What each panel hands over when the user starts a prompt from an item. */
export interface GitHubIssueAttachment {
  number: number;
  url: string;
  title: string;
}

export interface LinearIssueAttachment {
  id: string;
  identifier: string;
  url: string;
  title: string;
  includeSubissues: boolean;
  sub_issue_ids?: string[];
}

export interface TrackerItemAttachment {
  provider: TrackerProvider;
  id: string;
  key: string;
  url: string;
  title: string;
  includeSubItems: boolean;
  subItemIds?: string[];
}

export const issueFromGitHub = (
  issue: GitHubIssueAttachment,
): IssueAttachment => ({
  source: "github",
  id: String(issue.number),
  key: `#${issue.number}`,
  url: issue.url,
  title: issue.title,
  includeSubItems: false,
  subItemIds: [],
});

export const issueFromLinear = (
  issue: LinearIssueAttachment,
): IssueAttachment => ({
  source: "linear",
  id: issue.id,
  key: issue.identifier,
  url: issue.url,
  title: issue.title,
  includeSubItems: issue.includeSubissues,
  subItemIds: issue.sub_issue_ids ?? [],
});

export const issueFromTrackerItem = (
  item: TrackerItemAttachment,
): IssueAttachment => ({
  source: item.provider,
  id: item.id,
  key: item.key,
  url: item.url,
  title: item.title,
  includeSubItems: item.includeSubItems,
  subItemIds: item.subItemIds ?? [],
});

export function formatPromptWithIssue(
  text: string,
  issue: IssueAttachment,
): string {
  const trimmed = text.trim();
  const { label, itemNoun } = ISSUE_SOURCES[issue.source];
  const ref = `${label} ${itemNoun} ${issue.key}`;
  if (!trimmed) {
    const titlePart = issue.title.trim() ? `: ${issue.title.trim()}` : "";
    return `Address ${ref}${titlePart}\n\n${issue.url}`;
  }
  return `${trimmed}\n\n${ref}: ${issue.url}`;
}
