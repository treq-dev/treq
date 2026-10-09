export type PrerequisiteGroup = "required" | "agent" | "optional";

export interface PrerequisiteTool {
  binary: string;
  label: string;
  group: PrerequisiteGroup;
  installUrl: string;
  note?: string;
}

/** Tools the first-run checklist reports on, in display order. */
export const PREREQUISITE_TOOLS: readonly PrerequisiteTool[] = [
  {
    binary: "git",
    label: "Git",
    group: "required",
    installUrl: "https://git-scm.com/downloads",
  },
  {
    binary: "claude",
    label: "Claude Code",
    group: "agent",
    installUrl: "https://code.claude.com/docs/en/setup",
  },
  {
    binary: "codex",
    label: "Codex",
    group: "agent",
    installUrl: "https://developers.openai.com/codex/cli",
  },
  {
    binary: "cursor-agent",
    label: "Cursor Agent",
    group: "agent",
    installUrl: "https://cursor.com/docs/cli/installation",
  },
  {
    binary: "copilot",
    label: "GitHub Copilot CLI",
    group: "agent",
    installUrl:
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
  },
  {
    binary: "gh",
    label: "GitHub CLI",
    group: "optional",
    installUrl: "https://cli.github.com/",
    note: "Needed for pull requests and issues",
  },
];
