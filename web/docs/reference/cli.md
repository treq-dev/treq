---
sidebar_position: 6
---

# CLI

_Reference for Treq's command-line interface._

The `treq` command lets you create and inspect [workspaces](/docs/concepts/workspaces) from a terminal. Run commands from inside a Git repository so Treq can detect the repository context.

## Commands

### `treq add`

Create a new workspace.

```bash
treq add <branch_name> [-d <description>] [-l <title>] [-s <source_branch>] [-p <sparse_path>]... [-k <symlink_path>]...
```

- `branch_name`: branch name for the workspace.
- `-d, --description`: optional workspace description.
- `-l, --title`: optional workspace title.
- `-s, --source-branch`: branch to stack the new workspace on.
- `-p, --sparse`: sparse checkout path prefix; repeatable. Only matching paths are materialized.
- `-k, --symlink`: path to symlink from the home repo into the new workspace; repeatable (e.g. `node_modules`).

Example:

```bash
treq add feat/deps -k node_modules -k target
```

### `treq set`

Update workspace metadata.

```bash
treq set <workspace_name> [-d <description>] [-l <title>] [-t <target_branch>]
```

- `workspace_name`: workspace branch name.
- `-d, --description`: set the workspace description.
- `-l, --title`: set the workspace title.
- `-t, --target-branch`: set the target branch.

### `treq st`

Show workspace status.

```bash
treq st [workspace_name]
```

From a workspace directory, or with `workspace_name`, Treq prints that workspace only: its stacked parent and children, uncommitted change count, conflicted-file count, and commit count. It omits the repository default branch. If files are conflicted, it tells you to run `treq diff`.

From the home repository with no name, it lists every workspace. GitHub pull request information is included when GitHub integration is available.

### `treq diff`

Show conflicted files and conflict hunks for a workspace.

```bash
treq diff [workspace_name]
```

Run this from a workspace directory, or pass `workspace_name`. The output lists conflicted files, conflicted commits with change ids, and the conflict hunks. See [Commit Management](/docs/concepts/commit-management).

### `treq mv`

Move selected changes from one workspace to another.

```bash
treq mv <source> <destination> -f <file> [-f <file> ...]
treq mv <source> <destination> -c <commit> [-c <commit> ...]
```

- `source`: source workspace branch name.
- `destination`: destination workspace branch name.
- `-f`: file path to move.
- `-c`: commit ID to move.

### `treq agent`

Start an agent session in a workspace.

```bash
treq agent <branch> <prompt> [-m <edit|plan>]
```

- `branch`: workspace branch name.
- `prompt`: prompt to send to the agent.
- `-m, --mode`: [permission mode](/docs/concepts/agent-sessions). Use `edit` or `plan`.

### `treq commit`

Create a commit from the pending changes in a workspace.

```bash
treq commit <workspace_name> -m <message> [--push]
```

- `workspace_name`: workspace branch name.
- `-m, --message`: commit message (required).
- `--push`: push the workspace to the remote after a successful commit.

This records working-copy changes in that workspace. It does not merge the workspace into its target. See [Commit Management](/docs/concepts/commit-management).

### `treq resolve`

Finish inplace conflict resolution for a conflicted commit that already has a resolve directory under `.treq/resolve/<workspace-slug>/`.

```bash
treq resolve <commit_id> [sides...]
echo '{"path/to/file": "replacement\n"}' | treq resolve <commit_id>
```

- `commit_id`: change id or commit id of the conflicted revision. Required.
- `sides`: optional conflict sides to take. Use `1`, `2`, `base`, or `both`.
- Non-TTY stdin: JSON object of path to full file content replacements.

When the change is clean, Treq rewrites that commit in place and deletes its resolve directory. See [Resolve commit conflicts inplace](/docs/concepts/commit-management#resolve-commit-conflicts-inplace).

### `treq send`

Send a file or stdin content to the open Treq window for preview. Images show as square thumbnails in the terminal that ran the command; click a thumbnail to open a modal. Text opens a read-only, selectable preview.

```bash
treq send <path>
treq send -
echo "notes" | treq send
```

- `path`: existing file on disk. Omit or use `-` to read stdin.
- Image types: `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`.
- Everything else is treated as text.
- Piped stdin is staged under `.treq/send/` in the repo (already gitignored).
- When run inside a Treq terminal, previews attach to that pane via `TREQ_PTY_SESSION_ID`.

Treq must already have this repository open.

- `--browser`: open the given localhost URL or local HTML file directly in the in-app browser, instead of a preview thumbnail.

```bash
treq send --browser http://localhost:3000
treq send --browser ./dist/index.html
```

Only `http://localhost`, `http://127.0.0.1`, and `file://` URLs are allowed, matching the in-app browser's own scope. A filesystem path to an existing HTML file is resolved to a `file://` URL automatically. This switches the workspace to the Changes tab's Browser view and navigates there.