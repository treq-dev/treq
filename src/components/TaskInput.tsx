import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FilePicker } from "./FilePicker";
import { TaskInputMentionDropdown } from "./task-input/TaskInputMentionDropdown";
import { TaskInputToolbar } from "./task-input/TaskInputToolbar";
import {
	createSession,
	getSetting,
	getRepoSetting,
	searchWorkspaceFiles,
	setRepoSetting,
	type FileSearchResult,
} from "../lib/api";
import { useToast } from "./ui/toast";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../lib/utils";
import type { AgentType } from "../lib/agentDeepLink";
import type { SessionCreationInfo } from "../types/sessions";

interface TaskInputProps {
	repoPath: string;
	workspaceId: number | null;
	workspacePath: string | null;
	workingDirectory: string;
	onSessionCreated?: (session: SessionCreationInfo) => void;
	focusRequest?: number;
	/** Pre-fill the textarea with this text on mount (e.g. re-running a past prompt). */
	initialText?: string;
}

export const TaskInput: React.FC<TaskInputProps> = ({
	repoPath,
	workspaceId,
	workspacePath,
	workingDirectory,
	onSessionCreated,
	focusRequest,
	initialText,
}) => {
	const [taskText, setTaskText] = useState(initialText ?? "");
	const [filePickerOpen, setFilePickerOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [focused, setFocused] = useState(false);
	const [selectedAgent, setSelectedAgent] = useState<AgentType>("claude");
	const [configuredDefaultAgent, setConfiguredDefaultAgent] =
		useState<AgentType>("claude");
	const [saveAsRepoDefault, setSaveAsRepoDefault] = useState(false);
	const [showSaveAsRepoDefault, setShowSaveAsRepoDefault] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const mentionRef = useRef<HTMLDivElement>(null);
	const { addToast } = useToast();

	// @ mention state
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionResults, setMentionResults] = useState<FileSearchResult[]>([]);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
	const debouncedMentionQuery = useDebounce(mentionQuery, 150);

	// Autofocus when workspace changes
	useEffect(() => {
		textareaRef.current?.focus();
	}, [workspaceId]);

	useEffect(() => {
		if (focusRequest) textareaRef.current?.focus();
	}, [focusRequest]);

	// Load default agent from repo setting, falling back to global setting
	useEffect(() => {
		let cancelled = false;
		getRepoSetting(repoPath, "default_agent")
			.then((repoAgent) => {
				if (cancelled) return;
				if (
					repoAgent === "claude" ||
					repoAgent === "codex" ||
					repoAgent === "cursor"
				) {
					setSelectedAgent(repoAgent);
					setConfiguredDefaultAgent(repoAgent);
					setSaveAsRepoDefault(false);
					setShowSaveAsRepoDefault(false);
					return;
				}
				return getSetting("default_agent").then((globalAgent) => {
					if (cancelled) return;
					if (
						globalAgent === "claude" ||
						globalAgent === "codex" ||
						globalAgent === "cursor"
					) {
						setSelectedAgent(globalAgent);
					}
					setConfiguredDefaultAgent(
						globalAgent === "claude" ||
							globalAgent === "codex" ||
							globalAgent === "cursor"
							? globalAgent
							: "claude",
					);
					setSaveAsRepoDefault(false);
					setShowSaveAsRepoDefault(false);
				});
			})
			.catch(() => {
				// Keep current selection on read failure.
			});
		return () => {
			cancelled = true;
		};
	}, [repoPath, workspaceId]);

	// Auto-resize textarea
	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
		}
	}, [taskText]);

	// Search files when mention query changes
	useEffect(() => {
		if (debouncedMentionQuery === null) {
			setMentionResults([]);
			return;
		}
		let cancelled = false;
		searchWorkspaceFiles(repoPath, workspaceId, debouncedMentionQuery, 4)
			.then((results) => {
				if (!cancelled) {
					setMentionResults(results);
					setMentionIndex(0);
				}
			})
			.catch(() => {
				if (!cancelled) setMentionResults([]);
			});
		return () => {
			cancelled = true;
		};
	}, [debouncedMentionQuery, repoPath, workspaceId]);

	// Close mention dropdown on outside click
	useEffect(() => {
		if (mentionQuery === null) return;
		const handler = (e: MouseEvent) => {
			const target = e.target as Node;
			if (
				mentionRef.current &&
				!mentionRef.current.contains(target) &&
				textareaRef.current &&
				!textareaRef.current.contains(target)
			) {
				setMentionQuery(null);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [mentionQuery]);

	// Helper: insert text at the current cursor position (or end) and update taskText
	const insertAtCursor = useCallback(
		(insertion: string) => {
			const textarea = textareaRef.current;
			const cursorPos = textarea?.selectionStart ?? taskText.length;
			const before = taskText.slice(0, cursorPos);
			const after = taskText.slice(cursorPos);
			// Add a leading space if cursor is not at start and previous char isn't whitespace
			const needsSpace = before.length > 0 && !/\s$/.test(before);
			const text = needsSpace ? ` ${insertion}` : insertion;
			const newText = before + text + after;
			setTaskText(newText);

			const newCursorPos = before.length + text.length;
			requestAnimationFrame(() => {
				if (textarea) {
					textarea.focus();
					textarea.selectionStart = newCursorPos;
					textarea.selectionEnd = newCursorPos;
				}
			});
		},
		[taskText],
	);

	// FilePicker: insert @relative_path at cursor
	const handleFileSelect = useCallback(
		(relativePath: string) => {
			insertAtCursor(`@${relativePath} `);
		},
		[insertAtCursor],
	);

	// Finder: insert 'absolute_path' at cursor
	const handleAttachFromFinder = useCallback(async () => {
		const selected = await open({
			multiple: true,
			title: "Attach Files",
		});
		if (!selected) return;
		const paths = Array.isArray(selected) ? selected : [selected];
		const textarea = textareaRef.current;
		const cursorPos = textarea?.selectionStart ?? taskText.length;
		const before = taskText.slice(0, cursorPos);
		const after = taskText.slice(cursorPos);
		const needsSpace = before.length > 0 && !/\s$/.test(before);
		const insertion = paths.map((p) => `'${p}'`).join(" ");
		const text = `${(needsSpace ? " " : "") + insertion} `;
		const newText = before + text + after;
		setTaskText(newText);

		const newCursorPos = before.length + text.length;
		requestAnimationFrame(() => {
			if (textarea) {
				textarea.focus();
				textarea.selectionStart = newCursorPos;
				textarea.selectionEnd = newCursorPos;
			}
		});
	}, [taskText]);

	// @ mention dropdown: insert @relative_path at cursor (preserving the @)
	const handleMentionSelect = useCallback(
		(file: FileSearchResult) => {
			if (mentionAnchor === null) return;
			const textarea = textareaRef.current;
			const cursorPos = textarea?.selectionStart ?? taskText.length;
			// Replace from the @ anchor to cursor with @relative_path
			const before = taskText.slice(0, mentionAnchor);
			const after = taskText.slice(cursorPos);
			const inserted = `@${file.relative_path} `;
			const newText = before + inserted + after;
			setTaskText(newText);

			// Close dropdown
			setMentionQuery(null);
			setMentionAnchor(null);

			// Restore focus and cursor position after the inserted path
			requestAnimationFrame(() => {
				if (textarea) {
					textarea.focus();
					const newCursorPos = before.length + inserted.length;
					textarea.selectionStart = newCursorPos;
					textarea.selectionEnd = newCursorPos;
				}
			});
		},
		[mentionAnchor, taskText],
	);

	const handleTextChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const { value } = e.target;
			setTaskText(value);

			const cursorPos = e.target.selectionStart;
			// Look backwards from cursor to find @ preceded by whitespace or at start
			let foundAnchor: number | null = null;
			for (let i = cursorPos - 1; i >= 0; i--) {
				const ch = value[i];
				if (ch === "@") {
					// Valid if at position 0 or preceded by whitespace
					if (i === 0 || /\s/.test(value[i - 1])) {
						foundAnchor = i;
					}
					break;
				}
				// Stop searching if we hit whitespace (no @ in this "word")
				if (/\s/.test(ch)) break;
			}

			if (foundAnchor !== null) {
				setMentionAnchor(foundAnchor);
				setMentionQuery(value.slice(foundAnchor + 1, cursorPos));
			} else {
				setMentionQuery(null);
				setMentionAnchor(null);
			}
		},
		[],
	);

	const handleSubmit = useCallback(
		async (mode: "plan" | "acceptEdits") => {
			const trimmed = taskText.trim();
			if (!trimmed || submitting) return;

			setSubmitting(true);
			try {
				if (saveAsRepoDefault && selectedAgent !== configuredDefaultAgent) {
					await setRepoSetting(repoPath, "default_agent", selectedAgent);
					setConfiguredDefaultAgent(selectedAgent);
					setSaveAsRepoDefault(false);
				}

				const sessionName =
					trimmed.length > 50 ? `${trimmed.slice(0, 47)}...` : trimmed;

				const dbSessionId = await createSession(
					repoPath,
					workspaceId,
					sessionName,
				);

				const sessionRepoPath = repoPath || workingDirectory;

				onSessionCreated?.({
					sessionId: dbSessionId,
					sessionName,
					workspaceId,
					workspacePath,
					repoPath: sessionRepoPath,
					pendingPrompt: trimmed,
					permissionMode: mode,
					agent: selectedAgent,
				});

				// Clear input on success
				setTaskText("");
				setShowSaveAsRepoDefault(false);
			} catch (error) {
				addToast({
					title: "Failed to create task",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			} finally {
				setSubmitting(false);
			}
		},
		[
			taskText,
			submitting,
			repoPath,
			workspaceId,
			workspacePath,
			workingDirectory,
			onSessionCreated,
			addToast,
			selectedAgent,
			saveAsRepoDefault,
			configuredDefaultAgent,
		],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// When mention dropdown is open, handle navigation keys
			if (mentionQuery !== null && mentionResults.length > 0) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setMentionIndex((prev) => (prev + 1) % mentionResults.length);
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					setMentionIndex(
						(prev) =>
							(prev - 1 + mentionResults.length) % mentionResults.length,
					);
					return;
				}
				if (e.key === "Enter") {
					e.preventDefault();
					handleMentionSelect(mentionResults[mentionIndex]);
					return;
				}
				if (e.key === "Escape" || e.key === "Tab") {
					setMentionQuery(null);
					setMentionAnchor(null);
					return;
				}
			}

			if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
				e.preventDefault();
				handleSubmit("acceptEdits");
			}
		},
		[
			handleSubmit,
			mentionQuery,
			mentionResults,
			mentionIndex,
			handleMentionSelect,
		],
	);

	const isEmpty = taskText.trim().length === 0;

	return (
		<>
			<div className="max-w-2xl min-w-0 mx-auto w-full">
				<div
					className={cn(
						"min-h-28 rounded-xl border bg-background relative transition-colors flex flex-col",
						focused ? "border-blue-400" : "border-border",
					)}
				>
					<textarea
						ref={textareaRef}
						value={taskText}
						onChange={handleTextChange}
						onKeyDown={handleKeyDown}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						placeholder="Describe a task..."
						rows={1}
						className="block w-full min-w-0 resize-none overflow-x-hidden border-0 bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground focus:ring-0 caret-blue-400"
						style={{ minHeight: "44px", maxHeight: "200px" }}
					/>

					<TaskInputMentionDropdown
						mentionRef={mentionRef}
						mentionQuery={mentionQuery}
						mentionResults={mentionResults}
						mentionIndex={mentionIndex}
						onMentionSelect={handleMentionSelect}
					/>

					<div className="mt-auto">
						<TaskInputToolbar
							isEmpty={isEmpty}
							submitting={submitting}
							selectedAgent={selectedAgent}
							configuredDefaultAgent={configuredDefaultAgent}
							saveAsRepoDefault={saveAsRepoDefault}
							showSaveAsRepoDefault={showSaveAsRepoDefault}
							onOpenFilePicker={() => setFilePickerOpen(true)}
							onAttachFromFinder={handleAttachFromFinder}
							onAgentChange={(nextAgent) => {
								setSelectedAgent(nextAgent);
								setSaveAsRepoDefault(false);
								setShowSaveAsRepoDefault(nextAgent !== configuredDefaultAgent);
							}}
							onSaveAsRepoDefaultChange={setSaveAsRepoDefault}
							onSubmit={handleSubmit}
						/>
					</div>
				</div>
			</div>

			<FilePicker
				open={filePickerOpen}
				onOpenChange={setFilePickerOpen}
				repoPath={repoPath}
				workspaceId={workspaceId}
				onFileSelect={handleFileSelect}
			/>
		</>
	);
};
