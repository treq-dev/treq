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

export interface BrowserPanelProps {
	repoPath?: string;
	workspaceId?: number;
	onCreateAgentWithReview?: (
		reviewMarkdown: string,
		mode: "plan" | "acceptEdits",
	) => Promise<void>;
	onReviewSubmitted?: () => void;
}
