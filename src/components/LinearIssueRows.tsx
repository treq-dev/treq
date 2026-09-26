import { ChevronRight } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { type LinearIssue, linearListIssueComments } from "../lib/api-linear";
import { Button } from "./ui/button";
import { LinearComments } from "./LinearComments";
import { MarkdownContent } from "./MarkdownContent";
import { cn } from "../lib/utils";

type KickoffHandler = (issueId: string, hasSubissues: boolean) => void;

export const LinearIssuesList: React.FC<{
  repoPath: string;
  issues: LinearIssue[];
  subissuesMap: Map<string, LinearIssue[]>;
  onKickoff: KickoffHandler;
}> = ({ repoPath, issues, subissuesMap, onKickoff }) => (
  <div className="divide-y divide-border">
    {issues.map((issue) => {
      const subissues = subissuesMap.get(issue.id) || [];
      return (
        <div key={issue.id}>
          <LinearIssueRow
            repoPath={repoPath}
            issue={issue}
            indent={false}
            hasSubissues={subissues.length > 0}
            onKickoff={onKickoff}
          />
          {subissues.map((subissue) => (
            <LinearIssueRow
              key={subissue.id}
              repoPath={repoPath}
              issue={subissue}
              indent
              hasSubissues={false}
              onKickoff={onKickoff}
            />
          ))}
        </div>
      );
    })}
  </div>
);

const LinearIssueRow: React.FC<{
  repoPath: string;
  issue: LinearIssue;
  indent: boolean;
  hasSubissues: boolean;
  onKickoff: KickoffHandler;
}> = ({ repoPath, issue, indent, hasSubissues, onKickoff }) => {
  const [expanded, setExpanded] = useState(false);

  const {
    data: comments = [],
    isLoading: isLoadingComments,
    error: commentsError,
  } = useSWR(
    expanded ? ["linear-issue-comments", repoPath, issue.id] : null,
    async ([, path, issueId]) => await linearListIssueComments(path, issueId),
    { revalidateOnFocus: false },
  );

  return (
    <div
      className={cn(
        "hover:bg-muted/50 transition-colors",
        indent && "ml-6 border-l border-muted-foreground/20",
      )}
    >
      <div className="flex items-start gap-2 pr-4">
        <button
          type="button"
          className="flex items-start gap-3 px-4 py-3 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn(
              "w-4 h-4 mt-1 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-sm font-medium text-primary hover:underline"
              >
                {issue.identifier}
              </a>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {issue.state.name}
              </span>
              {issue.priority_label && issue.priority !== 0 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {issue.priority_label}
                </span>
              )}
              {issue.project && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {issue.project.name}
                </span>
              )}
              {issue.assignee && (
                <span className="text-xs text-muted-foreground">
                  {issue.assignee.name}
                </span>
              )}
            </div>
            <p className="text-base mt-1 truncate">{issue.title}</p>
            {issue.labels.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-7 shrink-0 text-xs"
          onClick={() => onKickoff(issue.id, hasSubissues)}
        >
          Kick off
        </Button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pl-11" data-testid="linear-issue-expanded">
          {issue.description && (
            <MarkdownContent
              content={issue.description}
              className="text-sm prose-p:my-1"
            />
          )}
          <h4 className="text-xs font-medium text-muted-foreground uppercase mt-4 mb-2">
            Activity
          </h4>
          <LinearComments
            comments={comments}
            isLoading={isLoadingComments}
            error={commentsError}
          />
        </div>
      )}
    </div>
  );
};

export const LinearKanbanView: React.FC<{
  issues: LinearIssue[];
  subissuesMap: Map<string, LinearIssue[]>;
  issuesByState: Record<string, LinearIssue[]>;
  onKickoff: KickoffHandler;
}> = ({ issuesByState, subissuesMap, onKickoff }) => {
  const states = Object.keys(issuesByState).sort();

  return (
    <div className="flex gap-3 overflow-x-auto p-4 h-full">
      {states.map((stateName) => {
        const stateIssues = issuesByState[stateName]!.filter(
          (i) => !i.parent_id,
        );
        return (
          <div
            key={stateName}
            className="flex-shrink-0 w-80 bg-muted/30 rounded-lg border border-border p-3 flex flex-col"
          >
            <h3 className="font-medium text-sm mb-3 text-muted-foreground">
              {stateName}
            </h3>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
              {stateIssues.map((issue) => {
                const subissues = subissuesMap.get(issue.id) || [];
                return (
                  <div key={issue.id}>
                    <LinearKanbanCard
                      issue={issue}
                      hasSubissues={subissues.length > 0}
                      onKickoff={onKickoff}
                    />
                    {subissues.map((subissue) => (
                      <div key={subissue.id} className="ml-2 mt-2">
                        <LinearKanbanCard
                          issue={subissue}
                          hasSubissues={false}
                          onKickoff={onKickoff}
                          isSubissue
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LinearKanbanCard: React.FC<{
  issue: LinearIssue;
  hasSubissues: boolean;
  onKickoff: KickoffHandler;
  isSubissue?: boolean;
}> = ({ issue, hasSubissues, onKickoff, isSubissue }) => (
  <div
    className={cn(
      "bg-background border border-border rounded-md p-2.5 text-sm",
      isSubissue && "opacity-75",
    )}
  >
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs font-medium text-primary hover:underline"
    >
      {issue.identifier}
    </a>
    <p className="text-xs font-medium mt-1 line-clamp-2">{issue.title}</p>
    {issue.labels.length > 0 && (
      <div className="flex gap-1 mt-1.5 flex-wrap">
        {issue.labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="text-xs px-1 py-0.5 rounded bg-primary/10 text-primary/70"
          >
            {label}
          </span>
        ))}
        {issue.labels.length > 2 && (
          <span className="text-xs px-1 py-0.5 text-muted-foreground">
            +{issue.labels.length - 2}
          </span>
        )}
      </div>
    )}
    <Button
      size="sm"
      variant="outline"
      className="w-full mt-2 text-xs h-7"
      onClick={() => onKickoff(issue.id, hasSubissues)}
    >
      Kick off
    </Button>
  </div>
);
