# Remote Workspaces in the Desktop UI

Status: Proposed

This document is the implementation source of truth for integrating the user's single persistent managed Sprite into the ordinary desktop workspace experience. It supersedes conflicting managed-Sprite UI details in `remote-ssh.md`; explicit user-managed SSH remains supported.

## Goals and non-goals

For the current local GitHub repository, the sidebar shows independent Local and Cloud groups. Either group can select the workspace displayed by `ShowWorkspace`. The sidebar and unified terminal pane stay mounted, so local and Sprite shells and agents continue running while selection changes.

Cloud history is independent from local history. Synchronization happens through normal Git operations. Cross-source stacking, drag and drop, archive, bulk selection, and change or commit transfer are out of scope and must be rejected in both UI and command validation.

The one-persistent-Sprite invariant is absolute: clone, refresh, repair, workspace, and terminal operations never replace or delete the instance. Only the explicit Delete Sprite action may delete it.

## Identity and normalized models

`WorkspaceSource` is `local | sprite`. Every workspace is addressed by `WorkspaceIdentity { source, repositoryId, workspaceId }`; home repositories use a null workspace ID. Its serialized form is used for React keys, SWR keys, drag IDs, selections, mutation state, activity, PR state, and terminal ownership. Numeric workspace IDs are never globally unique.

`RepositoryTransport` is a discriminated union for local, SSH, and managed Sprite transport. A managed Sprite repository carries instance ID, Sprite name, canonical path, and repository registration ID. Provider response objects do not enter components: adapters expose normalized repositories, workspaces, status, and structured errors.

Each sidebar group model contains source, repository, state, workspaces, status data, hidden-workspace state, and source-scoped callbacks. Group state is one of loading, unavailable, suspended, cloning, failed, empty, or ready.

## User flow

The Local group always represents the opened desktop repository. Once the persistent Sprite is known, Cloud is also shown even before that repository exists remotely.

Before setup, Cloud renders an inline Clone repository action. Clicking it resolves the current repository's canonical GitHub remote, obtains a short-lived installation token on the server, and clones to `/home/sprite/repos/<owner>/<repo>`. Progress remains inline. A failure shows its safe message and correlation ID with Copy error and Retry actions. A successful clone is inspected by the typed Treq CLI, registered against the managed instance, and refreshes Cloud.

Warm and running provider states are available. Cold maps to suspended and offers Wake. Provisioning and waking display progress. Provider, network, and typed-command failures render structured errors.

Each group renders its disk or cloud icon, label, state, home row, workspace tree, and hidden-workspace toggle independently. Navigation to settings, GitHub, Linear, artifacts, or a workspace does not unmount either group. Selecting a row changes only the content workspace.

## Control plane and security

Remote repository registrations may belong to either an SSH endpoint or a managed instance, exactly one. All managed reads and mutations use `dispatchOverManagedSprite` with allow-listed typed CLI commands and an explicit canonical working directory.

The authenticated clone operation is server-owned. It validates instance ownership and GitHub installation access, mints a short-lived repository token, and passes it only in the provider command environment. Tokens must never appear in desktop responses, logs, database rows, displayed errors, command output, process arguments, or persisted Git configuration. Responses use `{ code, error, correlation_id }`.

Terminal creation starts with a single-use short-lived ticket from an Edge function. The relay atomically consumes the ticket, validates user, instance, repository, and session ownership, then opens the provider exec WebSocket using the server-side token. It relays binary input/output, resize, exit, detach, reattach, and stop events. The desktop persists only safe metadata and the Sprite session ID. Expired, reused, or foreign tickets fail closed.

## Repository and cache behavior

Local and Cloud fetch independently; neither relies on the active-repository singleton to discover the other. Adapter selection uses the requested normalized repository transport. Source-qualified SWR keys prevent cache collisions. Cloud invalidates after clone, wake, repository/workspace mutations, agent state changes, and remote change-marker events.

Drag payloads and bulk commands contain a workspace identity. A target with a different source or repository ID is invalid. Server-side mutation entry points repeat this validation rather than trusting disabled UI.

## Unified terminals

A terminal session records source, repository identity, composite workspace identity, transport kind, and safe reattachment metadata. The existing pane and sidebar list contain all local, SSH, and Sprite sessions, with disk/cloud indicators. New sessions use the selected workspace source. Selection changes do not unmount, detach, stop, or silence existing sessions.

Closing a panel detaches by default. Stop explicitly terminates the process. On desktop startup, owned eligible Sprite sessions are listed and reattached. Local PTY, SSH PTY, and Sprite WebSocket implementations conform to one transport interface for write, resize, detach, attach, stop, output, metadata, and exit.

## Failure states

Unavailable authentication, missing GitHub installation, unsupported remotes, ownership failures, suspended instances, quota failures, timeouts, network interruption, nonzero process exits, clone conflicts, inspection failures, and registration failures retain both sidebar groups and provide a safe structured error. A correlation ID is copyable. Secrets and raw provider payloads are redacted.

Clone and registration are idempotent for instance plus canonical path. Retry inspects existing state before doing work. A partially cloned directory is never treated as registered until typed inspection succeeds.

## Acceptance criteria

- Local and Cloud render simultaneously, including equal numeric workspace IDs without collisions.
- Ready, cold, cloning, failed, empty, and unavailable Cloud states are covered by component tests.
- Selecting Cloud updates `ShowWorkspace`; local and cloud terminals remain mounted and streaming.
- Cross-source drag, selection, stacking, archive, and bulk mutations are rejected.
- First clone uses the current canonical GitHub repository, deterministic path, server-only credentials, typed inspection, registration, and Cloud refresh.
- Credential absence is verified in responses, logs, database records, Git configuration, and displayed errors.
- Sprite terminals cover input, resize, streaming, detach, reattach, stop, restart recovery, ticket expiry/reuse, ownership rejection, suspension, interruption, and nonzero exit.
- Targeted frontend, TypeScript, Rust, Edge, database, and real persistent-Sprite end-to-end tests pass.
- Manual acceptance creates local and Cloud workspaces for one repository, switches between them, streams both shells concurrently, restarts desktop, and reattaches Cloud without recreating the Sprite.
