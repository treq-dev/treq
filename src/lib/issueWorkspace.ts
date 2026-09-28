import { githubOpenOrCreateWorkspaceFromIssue } from "./api";
import {
  type LinearKickoffFailure,
  type LinearKickoffResult,
  linearOpenOrCreateWorkspaceFromIssue,
} from "./api-linear";
import { trackerOpenOrCreateWorkspaceFromItem } from "./api-tracker";
import type { IssueAttachment } from "./promptAttachments";

export type IssueWorkspace = {
  workspaceId: number;
  // Linear sub-issue workspaces kicked off alongside the parent.
  subissueResults?: LinearKickoffResult[];
  subissueFailures?: LinearKickoffFailure[];
};

/**
 * Opens the workspace an attached issue's session runs in, creating it when
 * needed. Each tracker has its own backend command; the caller sees one step
 * and gets the workspace id back, plus any Linear sub-issue outcomes.
 */
export async function openOrCreateIssueWorkspace(
  repoPath: string,
  issue: IssueAttachment,
): Promise<IssueWorkspace> {
  switch (issue.source) {
    case "github": {
      const result = await githubOpenOrCreateWorkspaceFromIssue(
        repoPath,
        Number(issue.id),
        issue.title,
        issue.url,
      );
      return { workspaceId: result.workspace_id };
    }
    case "linear": {
      const { results, failures } = await linearOpenOrCreateWorkspaceFromIssue(
        repoPath,
        issue.id,
        issue.includeSubItems,
      );
      const result =
        results.find((item) => item.issue_id === issue.id) ?? results[0];
      if (!result)
        throw new Error(`Failed to create workspace for ${issue.key}`);
      return {
        workspaceId: result.workspace_id,
        subissueResults: results.filter((item) => item !== result),
        subissueFailures: failures,
      };
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
      return { workspaceId: result.workspace_id };
    }
  }
}
