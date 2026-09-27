import { TRACKER_PROVIDERS, type TrackerProvider } from "./trackers";

/** Context chips attached to an agent prompt (rendered separately from the textarea). */
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
}

export interface TrackerItemAttachment {
  provider: TrackerProvider;
  id: string;
  key: string;
  url: string;
  title: string;
  includeSubItems: boolean;
}

export function formatPromptWithGitHubIssue(
  text: string,
  issue: GitHubIssueAttachment,
): string {
  const trimmed = text.trim();
  const issueLine = `GitHub issue #${issue.number}: ${issue.url}`;
  if (!trimmed) {
    const titlePart = issue.title.trim() ? `: ${issue.title.trim()}` : "";
    return `Address GitHub issue #${issue.number}${titlePart}\n\n${issue.url}`;
  }
  return `${trimmed}\n\n${issueLine}`;
}

export function formatPromptWithLinearIssue(
  text: string,
  issue: LinearIssueAttachment,
): string {
  const trimmed = text.trim();
  const issueLine = `Linear issue ${issue.identifier}: ${issue.url}`;
  if (!trimmed) {
    const titlePart = issue.title.trim() ? `: ${issue.title.trim()}` : "";
    return `Address Linear issue ${issue.identifier}${titlePart}\n\n${issue.url}`;
  }
  return `${trimmed}\n\n${issueLine}`;
}

export function formatPromptWithTrackerItem(
  text: string,
  item: TrackerItemAttachment,
): string {
  const trimmed = text.trim();
  const { label, itemNoun } = TRACKER_PROVIDERS[item.provider];
  const ref = `${label} ${itemNoun} ${item.key}`;
  if (!trimmed) {
    const titlePart = item.title.trim() ? `: ${item.title.trim()}` : "";
    return `Address ${ref}${titlePart}\n\n${item.url}`;
  }
  return `${trimmed}\n\n${ref}: ${item.url}`;
}
