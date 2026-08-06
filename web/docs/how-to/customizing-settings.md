---
sidebar_position: 2
---

# Customizing Settings

_Personalize Treq to match your preferences and workflow._

Open settings with the gear icon (⚙️) in the sidebar. Settings split into two levels. Repository settings apply to the current Git repository. Application settings apply everywhere. Both are saved when you save them, but repository settings live in the `.treq` directory and are lost if you delete it.

## Repository Settings

**Branch naming pattern** builds branch names from variables.

| Variable | Value |
| --- | --- |
| `{name}` | The intent taken from your plan |
| `{user}` | Your git username |
| `{date}` | Today's date as `YYYY-MM-DD` |

Common patterns are `feature/{name}`, `dev/{user}`, and `bugfix/{name}-{date}`.

**Copy files** copies specific files listed in `.gitignore`, such as `.env`, into each new workspace. Use it for small config files that should be independent copies.

**Symlinked directories** creates symlinks from each new workspace back to heavy directories in the home repo, such as `node_modules/`, `target/`, or `.venv/`. Prefer this over copying when the directory is large and already installed in the home working copy. Workspaces share one tree on disk instead of duplicating it.

## Terminal Settings

| Setting | Options |
| --- | --- |
| Font size | 12-16px recommended |
| Default shell | Auto-detect, `bash`, `zsh`, `fish`, or a custom path |
| Scrollback buffer | 1000-10000 lines |
| Cursor style | Block, underline, or bar |
| Cursor blink | On or off |

Add shell arguments such as `--login` or `-i` for interactive sessions.

## Appearance

| Setting | Options |
| --- | --- |
| Theme | Light, dark, or system |
| UI density | Compact, normal, or comfortable |
| Font scaling | 12-18px, for interface elements only |

Font scaling does not affect the terminal. Custom themes are planned for a future release.

## Diff Viewer

Toggle line numbers, the minimap, word wrap, and whitespace visibility. Pick a syntax highlighting theme from GitHub, VS Code, Monokai, or the Solarized variants.

## Git Preferences

**Commit settings** turn on auto-stage, which we do not recommend, set a commit message template, and add validation rules such as a maximum length or a requirement for conventional commits.

**Merge settings** choose the default strategy, the [conflict style](/learn/concepts/git/zdiff3), and whether Treq stashes your work before an operation.

| Setting | Options |
| --- | --- |
| Default strategy | Regular, squash, no-ff, or ff-only |
| Conflict style | Standard or diff3 |
| Auto-stash | On or off |

[Merge vs Rebase](/learn/concepts/git/merge-vs-rebase) explains what each strategy does to your history.

## Performance

Set **file watching** to ignore the paths you never need, such as `node_modules/`, `.git/`, and `dist/`, and set the polling interval between 100 and 1000ms. The **git cache** holds 100 to 1000 entries, and you can clear it to force a refresh. For large repositories, consider shallow [clones](/learn/concepts/git/git-worktrees-vs-clones), sparse checkout, or LFS support.

## Privacy

Anonymous usage data covers feature statistics, error reports, and performance metrics. You can turn it off in Privacy settings. Plan history is stored in `.treq/plans/`. **Clear All Data** resets everything, and it cannot be undone.

## Advanced

**Developer mode** turns on debug logs and experimental features, which may be unstable. The **update channel** is stable, beta for early features, or nightly for the latest and least tested build. Database operations cover backup, restore, and rebuild.

## Import/Export

Export your settings as JSON from Settings → Advanced → Export to share them with the team or keep a backup. To import, select a JSON file and choose which settings to apply. You can reset one category or all of them from Advanced settings.
