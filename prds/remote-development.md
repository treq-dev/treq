# Remote Development

## Status

Active.

This document is the product and durable architecture contract for remote development in Treq. It replaces `remote-ssh.md` and `remote_workspaces_prd.md`.

Implementation history, phase logs, test-run notes, and superseded designs belong in Git history and test documentation rather than this PRD.

## Summary

Treq should make a repository feel like the same Treq workspace whether it lives on the user's computer, a Treq-managed VM, or a user-managed SSH host.

Remote repositories use the existing review, workspace, terminal, and agent experiences. Transport differences are hidden behind repository/remote adapters rather than producing a separate reduced remote workflow.

For MVP, each user may have one Treq-managed VM containing multiple repositories. This is an MVP product simplification, not a permanent identity or storage constraint. A future version may support multiple managed VMs and let the user choose the target VM when opening or cloning a repository.

## Product model

```text
User
├── Local repositories
├── Treq-managed VM (MVP: at most one)
│   ├── Repository A
│   │   └── Workspaces
│   └── Repository B
│       └── Workspaces
└── User-managed SSH hosts
    └── Repositories
        └── Workspaces
```

A repository is always associated with a transport/environment identity. Workspace, terminal, review, and agent state must therefore be addressable without assuming that repository paths are globally unique.

The durable model must not make "one managed VM per user" part of repository identity. Future multi-VM support should be possible without migrating repository/workspace identities.

## Goals

- Let users open and work with remote repositories using the normal Treq UI.
- Support both Treq-managed compute and explicitly configured user-managed SSH hosts.
- Keep repository semantics in Treq's typed command layer rather than duplicating remote variants of every operation.
- Support multiple repositories on the MVP managed VM.
- Make review, mutations, agents, and terminals resilient to reconnects.
- Treat trust and credential failures as explicit blocking states.
- Keep managed-compute provider details behind a provider/control-plane boundary.
- Preserve enough environment identity to support multiple managed VMs in the future.

## MVP scope

### Treq-managed VM

For MVP, an authenticated user can have at most one Treq-managed VM.

Treq may create, wake, reconnect to, or delete that VM through the managed-compute control plane. The VM can contain multiple repositories.

When a user opens or clones another managed remote repository in MVP, it is placed on that managed VM automatically because there is only one target.

The PRD intentionally does **not** specify fixed CPU, RAM, disk, or machine-size values. Resource configuration is a service/provider concern and may evolve independently of the product contract.

### User-managed SSH

Users may register explicit SSH endpoints they control.

Registration must include sufficient connection and trust information to connect safely. SSH config discovery may be offered as a convenience, but discovery must not silently establish trust.

Private keys remain on the user's device. Treq's server-side systems must not require custody of user SSH private keys.

### Remote repositories

A remote environment may contain multiple repositories.

Opening a repository creates or restores a repository descriptor containing the environment/transport identity and the repository identity/path. The VM or SSH host remains the source of truth for repository state.

Treq must not copy remote repository contents locally merely to make the normal review UI work.

## Durable architecture

### Repository transport

The application should model transport explicitly, for example:

```text
local
ssh
managed
```

The exact implementation types may evolve, but callers should operate through a common repository surface rather than branching throughout the UI.

Managed compute may use provider/control-plane APIs for lifecycle operations. Repository behavior itself should converge on Treq's typed CLI/command contract.

### Typed Treq commands

Structured remote operations execute through allow-listed Treq CLI commands with machine-readable output such as `--format=json`.

This command layer owns repository/workspace semantics. SSH or another managed transport is responsible for executing the command and returning its structured result.

Do not create a second remote implementation of each repository operation when the existing Treq command can represent the behavior.

Interactive shells and coding-agent terminals use PTY channels rather than the structured request/response path.

### Identity and state

Remote state must be scoped strongly enough to distinguish:

- environment/VM or SSH endpoint;
- repository;
- workspace;
- terminal or agent session where applicable.

Local and remote repositories may be visible in the same application session. Remote selection must not overwrite or reinterpret local repository history.

Changes made directly on the VM, by another client, by a terminal, or by an agent must be detectable so stale review state can refresh.

### Mutation safety

Read operations may be retried after reconnect.

For a mutation where the connection is lost before the outcome is known, Treq must verify observable remote state before deciding whether to retry. It must not blindly replay a mutation that may already have succeeded.

Operations that cannot be safely verified should surface ambiguity instead of guessing.

### Terminals and agents

Remote shell and agent sessions are bound to a selected remote workspace.

Interactive sessions should support normal terminal input/output and resize. Sessions intended to survive UI disconnects should expose safe detach/reattach semantics using remote session identity rather than relying on a continuously alive frontend socket.

Switching repository/workspace selection must not silently terminate unrelated running sessions.

### Managed-compute lifecycle

The managed-compute layer owns:

- provisioning;
- readiness;
- wake/reconnect;
- deletion;
- environment endpoint metadata;
- provider-specific lifecycle translation.

Provider-specific concepts should not leak into repository/workspace APIs.

MVP has one managed VM per user. This limit may be enforced at the product/control-plane layer for MVP, but application identity and repository schemas must not assume it is permanent.

### Trust and credentials

Unknown or changed SSH host keys fail closed until the user performs the required trust action.

Managed credentials may be short-lived and renewable. Expired or revoked authorization must prevent new interaction until authentication is restored.

Private user SSH keys remain local to the user's device. Secrets, private keys, provider tokens, and credentials must not appear in application logs or audit payloads.

## Ship-blocking acceptance criteria

1. **Managed setup works end-to-end.** An authenticated user can create or reconnect to their MVP Treq-managed VM, open or clone a repository on it, and return to it later.
2. **User-managed SSH works end-to-end.** A user can explicitly register a compatible SSH host, establish host trust, and open a Treq-compatible repository on it.
3. **Remote repositories use the normal Treq workspace/review UI.** Workspaces, changed files, diffs, file context, commits, and conflicts can be viewed without copying the repository locally or entering a separate reduced remote mode.
4. **Core workspace mutations work remotely.** The operations required by Treq's normal workspace workflow execute through the typed remote command layer and return structured errors/results.
5. **Agents work in remote workspaces.** A user can start, inspect, interact with, reattach to where supported, and stop a coding agent in the selected remote workspace.
6. **Interactive terminals work in remote workspaces.** A shell starts in the selected workspace and supports bidirectional I/O, resize, disconnect, and reattachment where the backing remote session persists.
7. **Reconnect is safe.** Temporary network loss does not cause blind mutation replay; Treq verifies observable state before retrying an uncertain mutation and surfaces ambiguity when it cannot safely determine the result.
8. **Out-of-band remote changes become visible.** Repository changes made by another client, terminal, or agent invalidate stale state and can be refreshed in the Treq UI.
9. **Trust failures fail closed.** Unknown/changed host keys and expired/revoked managed authorization block new remote interaction rather than silently bypassing trust.
10. **Normal managed lifecycle recovery works.** A suspended or temporarily unreachable managed VM can be woken/reconnected without requiring the user to recreate the VM or re-register its repositories.

These criteria define whether Remote Development is shippable. Internal mechanisms such as connection pooling, certificate renewal scheduling, provider idempotency implementation, quota constants, audit correlation, and test-resource cleanup are engineering requirements, not separate product acceptance criteria.

## Non-goals for MVP

- Multiple Treq-managed VMs per user.
- Choosing a target VM when opening/cloning a managed repository.
- Moving repositories between managed VMs.
- Fixed product-level CPU, RAM, disk, or machine-size guarantees.
- Port forwarding, filesystem mounting, or general-purpose SSH client features.
- Automatic trust of hosts discovered from SSH config.
- Cross-source workspace stacking or treating local and remote copies as one repository instance.
- A public command gateway that bypasses the authenticated remote transport.
- Provider-specific controls in the repository/workspace UI.

## Future considerations

### Multiple managed VMs

A future version may allow each user to create multiple managed VMs.

When multiple VMs exist, the user chooses the target VM when opening or cloning a managed remote repository. Repositories stay associated with the VM on which they were created/opened; switching VMs does not implicitly move repositories.

The intended future hierarchy is:

```text
User
└── Managed VMs
    ├── VM A
    │   ├── Repository A
    │   └── Repository B
    └── VM B
        └── Repository C
```

This is why environment identity must remain explicit even while MVP exposes only one managed VM.

Other future work may include richer VM sizing/region controls, repository transfer/reclone workflows, previews/tunneling, backup/export, and team/shared remote environments.

## Engineering and operational requirements

The following remain important but do not independently define product acceptance:

- lifecycle and mutation APIs are idempotent where appropriate;
- SSH connections may be pooled/multiplexed for efficiency;
- managed credentials renew without requiring unnecessary user interaction;
- control-plane tables and APIs enforce authorization and ownership;
- provider and credential material is redacted from logs;
- lifecycle/readiness/trust failures are observable;
- real-provider integration tests use isolated test resources and safe cleanup;
- provider adapters can change without rewriting repository semantics.

These requirements should be tested and documented with the implementation, while this PRD remains focused on intended product behavior and durable architecture.
