---
sidebar_position: 2
---

# Pushing to Remote

_How to push commits to remote repositories._

## Basic Push

For new branches not yet on remote, use `-u` to set up tracking:

```bash
git push -u origin treq/your-branch
```

After the first push, subsequent pushes only need `git push`.

## In Treq Dashboard

Click the push icon (↑) on the workspace card, or right-click and select **Push**. Status indicators show commits ahead (↑2) and behind (↓3) relative to the remote.

## Handling Rejections

If remote has commits you don't have ("Updates were rejected"), pull first:

```bash
git pull origin treq/your-branch
# Or with rebase:
git pull --rebase origin treq/your-branch
```

Then push again.

For authentication issues, configure your credential helper for HTTPS (`git config --global credential.helper store`) or ensure your SSH key is added (`ssh-add ~/.ssh/id_rsa`).

## Force Push

Only force push when you [rebased](/learn/concepts/git/merge-vs-rebase) your own branch or are fixing mistakes in unpushed [commits](/docs/concepts/commit-management). Never force push shared or main branches.

```bash
git push --force-with-lease origin treq/your-branch
```

Use [`--force-with-lease`](/learn/concepts/git/force-with-lease) instead of `--force`. It fails if someone else pushed, preventing accidental overwrites.

## Best Practices

Push often to keep local and remote in sync. Pull before pushing to avoid conflicts. Never force push main or shared branches.

