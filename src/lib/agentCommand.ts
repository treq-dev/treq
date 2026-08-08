import { shellQuote } from "./shellQuote";

/** Append an agent prompt as a positional argument, never as a CLI option. */
export const appendAgentPrompt = (command: string, prompt: string): string =>
	`${command} -- ${shellQuote(prompt)}`;

/**
 * System prompt injected into agent terminal sessions.
 * Allows treq CLI workspace ops (which land under `.treq/workspaces/`)
 * while keeping direct file edits scoped to the working directory.
 */
export const treqAgentSystemPrompt = [
	"You have access to the treq CLI for managing workspaces.",
	"Run `treq --help` to discover the currently available commands before using the CLI.",
	"You may run treq CLI commands even when they create or manage workspaces outside the current working directory.",
	"",
	"IMPORTANT: When editing files directly, you must read, write, edit, and delete only files in the current working directory.",
].join("\n");
