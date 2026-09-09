export interface SessionCreationInfo {
  sessionId: number;
  sessionName: string;
  workspaceId: number | null;
  workspacePath: string | null;
  repoPath: string;
  pendingPrompt?: string; // Optional prompt to send after agent initializes
  permissionMode?: "plan" | "acceptEdits"; // Permission mode for Claude terminal
  agent?: "claude" | "codex" | "cursor" | "copilot";
}
