---
sidebar_position: 15
description: Recover a locally deleted Git branch by finding its tip in the HEAD reflog and recreating the branch ref.
---

# Recover a Deleted Git Branch

_Find the tip in the local `HEAD` reflog, then recreate the branch ref at that commit._

## Goal

Restore a branch deleted with `git branch -d` or `git branch -D` while its tip is still in the local object database.

## Why deletion is reversible

`git branch -D` removes the name under `.git/refs/heads/`. It does not delete the commits those names pointed at. The objects stay in the database until garbage collection prunes unreachable tips.

The branch's own log under `.git/logs/refs/heads/` usually disappears with the name. Recovery depends on the **[`HEAD` reflog](/learn/concepts/git/git-reflog)**, which still records checkouts that moved onto or off that branch. Those entries keep the tip hash you need.

If you never checked the branch out in this [clone](/learn/concepts/git/git-worktrees-vs-clones), the local `HEAD` reflog has no footprint to search. Use a remote that still has the tip, closed pull-request metadata, or another clone that did check it out.

## Recover the branch

List recent `HEAD` movements:

```bash
git reflog
```

Find the last tip of the deleted branch. Checkout lines often look like `checkout: moving from feature/login to main`. The hash on that line is the tip of `feature/login` at the moment you left it.

Recreate the name at that commit:

```bash
git branch feature/login abc1234
```

Or check it out in one step:

```bash
git switch -c feature/login abc1234
```

Confirm the tip and recent history:

```bash
git log --oneline -5 feature/login
```

The new ref makes those commits reachable again. [Push](/docs/how-to/pushing-to-remote) when you need the branch on a remote:

```bash
git push -u origin feature/login
```

## When this fails

Local recovery needs a local record of the tip. These cases do not provide one:

- The branch existed only on a hosting service and was never checked out here.
- The branch tip was merged through a remote pull request without a local checkout of that branch.
- The matching reflog entry expired and `git gc` already pruned the unreachable objects.

In the remote-only cases, open the closed pull request or hosting UI and copy the head commit hash, then run `git branch <name> <hash>` after fetching that object if needed. Hosting platforms do not share their internal reflogs with `git fetch`.

Act before retention windows lapse. Unreachable reflog entries default to about 30 days under `gc.reflogExpireUnreachable`. After prune, the tip is gone from this clone.

## Related

- [Discarding Changes](/docs/how-to/discarding-changes): recovery options when uncommitted work is gone
- [What is Version Control?](/learn/concepts/git/version-control): commits, branches, and local recovery basics
- [Merge vs Rebase](/learn/concepts/git/merge-vs-rebase): rewrite operations that move refs and leave tips to recover
