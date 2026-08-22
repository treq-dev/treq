export interface ElementComment {
  id: string;
  selector: string;
  tag: string;
  textPreview: string;
  htmlSnippet: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  createdAt: string;
}

export interface PickedElement {
  selector: string;
  tag: string;
  textPreview: string;
  htmlSnippet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An externally requested navigation, e.g. from `treq send --browser`. */
export interface BrowserOpenRequest {
  id: string;
  url: string;
}

export interface BrowserPanelProps {
  repoPath?: string;
  workspaceId?: number;
  onCreateAgentWithReview?: (
    reviewMarkdown: string,
    mode: "plan" | "acceptEdits",
  ) => Promise<void>;
  onReviewSubmitted?: () => void;
  openRequest?: BrowserOpenRequest | null;
}
