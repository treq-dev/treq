---
sidebar_position: 4
---

# Moving Files Between Workspaces

_How to transfer uncommitted changes from one workspace to another._

Use this when you started work in the wrong workspace, want to split changes into multiple branches, or realize changes belong elsewhere.

## Using Treq's Move Feature

In the source workspace's diff viewer, select changed files (use `Cmd/Ctrl+Click` for multiple or `Shift+Click` for ranges). Right-click and choose **Move to Workspace**, or click the **Move** button. Select the destination workspace from the dropdown and click **Move Files**.

Only uncommitted changes are moved. [Committed changes](/docs/concepts/commit-management) must be handled separately, for example with [cherry-pick](/learn/concepts/git/cherry-pick-vs-rebase).

## Using Git Stash

For more control, use git stash:

```bash
# In source workspace
git stash push -m "moving to other workspace"

# In destination workspace
git stash pop stash@{0}
```

## Commit and Cherry-Pick

The most reliable method is to commit your changes in the source, cherry-pick in the destination, then reset the source:

```bash
# In source
git add files-to-move && git commit -m "temp: changes to move"

# In destination
git cherry-pick <commit-hash>

# In source (to undo the commit but keep changes)
git reset HEAD~1
```

## Recovery

If you moved the wrong files and haven't committed in the destination, discard there and check the source's stash or [reflog](/learn/concepts/git/git-reflog). If already committed, reset the commit in the destination and move files back.

