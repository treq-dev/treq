import { githubOpenOrCreateWorkspaceFromIssue } from "./api";
import { linearOpenOrCreateWorkspaceFromIssue } from "./api-linear";
import { trackerOpenOrCreateWorkspaceFromItem } from "./api-tracker";
import type { IssueAttachment } from "./promptAttachments";

/**
 * Opens the workspace an attached issue's session runs in, creating it when
 * needed. Each tracker has its own backend command; the caller sees one step
 * and gets the workspace id back.
 */
export async function openOrCreateIssueWorkspace(
  repoPath: string,
  issue: IssueAttachment,
): Promise<number> {
  switch (issue.source) {
    case "github": {
      const result = await githubOpenOrCreateWorkspaceFromIssue(
        repoPath,
        Number(issue.id),
        issue.title,
        issue.url,
      );
      return result.workspace_id;
    }
    case "linear": {
      const results = await linearOpenOrCreateWorkspaceFromIssue(
        repoPath,
        issue.id,
        issue.includeSubItems,
      );
      const result =
        results.find((item) => item.issue_id === issue.id) ?? results[0];
      if (!result)
        throw new Error(`Failed to create workspace for ${issue.key}`);
      return result.workspace_id;
    }
    default: {
      // Trello and Jira share the tracker_* commands.
      const results = await trackerOpenOrCreateWorkspaceFromItem(repoPath, {
        provider: issue.source,
        id: issue.id,
        includeSubItems: issue.includeSubItems,
      });
      const result =
        results.find((item) => item.item_id === issue.id) ?? results[0];
      if (!result)
        throw new Error(`Failed to create workspace for ${issue.key}`);
      return result.workspace_id;
    }
  }
}
