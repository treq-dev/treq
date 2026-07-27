---
sidebar_position: 3
---

# Discarding Changes

_How to safely discard unwanted changes._

**Deselecting** a file removes it from the next [commit](/docs/concepts/commit-management) without losing changes. **Discarding** permanently deletes changes and cannot be undone.

## Discarding Files

In the diff viewer, right-click a changed file and select **Discard Changes**, or select the file and press `Delete`. In the terminal, use `git checkout -- filename`. The file reverts to its last committed state.

To discard all changes, click **Discard All** and confirm. In the terminal: `git checkout -- .`

## Partial Discards

Treq doesn't support discarding specific lines directly. As a workaround, commit the lines you want to keep, discard the remaining changes, then continue working.

## Recovery

There's no direct undo for discarded changes. Check your editor's local history (VS Code, IntelliJ), look for auto-save copies, or check the [git reflog](/learn/concepts/git/git-reflog) if changes were previously committed.

Before discarding uncertain changes, create a safety net with `git stash push -m "backup"` or [commit](/docs/concepts/commit-management) to a temporary branch.

## Best Practices

Review the diff before discarding. Prefer stashing over discarding when unsure. You can always drop the stash later. Discard files individually when possible instead of clearing everything at once. Commit often so discards are less risky.

