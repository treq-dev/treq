---
sidebar_position: 5
---

# Remote SSH Workspaces

Treq can connect to a remote development node through your existing SSH configuration so you can prepare a repository directory, clone a repository when needed, and run remote terminal or agent sessions from the client UI.

## Prerequisites

Treq does **not** install software on remote nodes. Before opening a remote workspace, install and configure these tools yourself on the remote host:

- Treq CLI or remote helper available on `PATH`
- `jj` for workspace and commit operations
- `git` for cloning repositories and interacting with Git remotes
- Any coding agents you want to run remotely, such as Claude Code, Codex, or Cursor tooling

On the client, configure SSH in `~/.ssh/config`. Host aliases, identity files, and `ProxyJump` entries should live there. If `ssh my-host` works in a terminal, Treq can use the same host alias.

## Open a remote repository

1. Choose **File → Open via SSH...** or select **Open via SSH** from the onboarding screen.
2. Enter an SSH host alias from your SSH config.
3. Enter the remote repository directory.
4. If the directory does not contain a repository, enter a Git URL so Treq can clone it into that directory.

Treq stores recent SSH hosts locally so you can reconnect quickly later.

## Proxy jumps and tunnels

Use normal SSH config for proxy jumps and tunnels. For example:

```ssh-config
Host devbox
  HostName devbox.internal
  User you
  ProxyJump bastion
  LocalForward 8080 127.0.0.1:8080
```

Treq invokes SSH through the configured host alias and does not need to know the proxy details.

## Troubleshooting

- **Connection fails**: verify `ssh <host-alias>` works outside Treq.
- **Missing tool**: install the missing tool on the remote node and ensure it is on `PATH` for login shells.
- **Clone fails**: confirm the remote node has network access and credentials for the Git URL.
- **Wrong directory**: use an absolute remote path when `~` expansion is not available in your shell.
