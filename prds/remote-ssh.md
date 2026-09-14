# Remote SSH Control

## Status

Proposed

## Summary

Treq will provide a controlled SSH command-and-control experience for repositories hosted on either a user-managed VM or a Treq-managed VM provisioned through a vendor adapter. The initial managed provider is Fly Sprites, but provider concepts must not leak into repository, SSH, or UI contracts.

Supabase Edge Functions form the control-plane API. The control plane authenticates users, provisions and reconciles managed VMs, registers user-owned endpoints, signs short-lived SSH user certificates for managed VMs, returns trusted connection metadata, and records auditable lifecycle operations. Repository files, JJ and Git state, workspaces, commits, conflicts, terminals, and coding-agent processes remain on the VM.

Desktop clients use a native SSH library. Structured UI operations open non-interactive SSH exec channels that invoke an allow-listed Treq CLI command and consume JSON. Interactive shells and agents use separate SSH PTY channels. Treq must not shell out to a system `ssh` executable.

## Problem

The existing remote implementation is a useful prototype but is not a complete managed-SSH product:

- an SSH repository is identified primarily by a host string and remote path;
- connections rely on local SSH aliases and a system `ssh` subprocess;
- host-key verification is not modeled as control-plane data;
- every structured invocation starts a new SSH process;
- readiness only checks whether a small set of binaries are on `PATH`;
- provisioning, reconciliation, certificate issuance, revocation, and replacement are absent;
- the UI opens a separate remote screen rather than loading remote workspaces and review data into the normal component tree;
- structured remote mutations and durable agent lifecycle operations are incomplete.

## Goals

1. Support one managed VM per user, initially backed by Fly Sprites.
2. Let a user configure the VM size from a small set of Treq-defined presets.
3. Enforce a per-user base resource allocation included in the plan: 5 GB of disk and 1 vCPU / 2 GB RAM. Purchasing additional disk or compute beyond the base allocation is out of scope for this delivery; only enforcement of the base limits is required now.
4. Let a user select the provisioning region when creating or reprovisioning the VM.
5. Support multiple repositories on the same managed VM.
6. Support explicit user-managed VM endpoints without implicitly importing arbitrary local SSH configuration.
7. Use short-lived SSH certificates for access to Treq-managed VMs.
8. Allow users to authenticate with their own existing SSH key when desired.
9. Never generate or retain a Treq-managed user private key.
10. Pin and verify SSH host keys before credentials or repository data are sent.
11. Use a native SSH library with pooled, multiplexed connections.
12. Route structured remote operations through allow-listed Treq CLI commands with JSON responses.
13. Integrate remote repositories into the existing workspace, review, terminal, and agent UI.
14. Make provisioning and lifecycle operations idempotent and observable.
15. Keep the provider model generic enough to replace or supplement Sprites later.
16. Offer entries from the user's local `~/.ssh/config` as a discovery aid when registering a user-managed VM, without granting any of them implicit trust.

## Non-goals

- Conflict resolution between a user's own multiple concurrent clients or VMs. The user is responsible for coordinating simultaneous changes across sessions they open themselves.
- Mobile SSH and mobile remote control. These are planned in [Mobile Remote Control](./mobile.md).
- Billing, metering, entitlements, payment failure, and plan enforcement.
- Purchasing additional disk or compute beyond the per-user base allocation. The add-on purchase mechanism is deferred; only enforcement of the 5 GB / 1 vCPU / 2 GB RAM base limits is in scope now.
- Backups, snapshots, and data export. Repository content is already version-controlled by JJ and Git, so a separate export mechanism is not required.
- Region migration. Reprovisioning in another region creates a replacement VM and does not migrate data automatically.
- Port forwarding, public preview URLs, SOCKS proxies, or SSH tunnel management.
- Treq-managed user keypairs or escrow of user private keys.
- A user-config mode that automatically trusts arbitrary entries discovered in `~/.ssh/config`. Surfacing those entries as autocomplete suggestions is in scope (Goal 15); granting them trust or connecting to them without explicit user selection and registration is not.
- Restricting what an owner may do after obtaining a shell on their VM.
- A WebSocket command gateway or public Treq daemon.
- Multi-user operating-system isolation within one managed VM.

## Product principles

### The user owns the VM

The managed VM is a full development sandbox for its owner. The user may install software, alter configuration, run unrelated processes, and modify or remove Treq. Treq readiness checks must therefore detect drift rather than assume the VM remains pristine.

### The VM is the source of truth

Repository files and development state stay on the VM. Supabase stores control-plane metadata, never a second authoritative copy of repository state.

### SSH transports behavior; Treq owns behavior

Structured repository operations must invoke typed Treq CLI commands. SSH connection code must not implement JJ, Git, workspace, diff, commit, or conflict behavior.

### Trust is explicit

A client must know the endpoint, user, port, expected host key, authentication method, and repository identity. No managed connection may silently accept a new host key or infer credentials from ambient SSH configuration.

### Provider details stay behind an adapter

Sprites is the first provider, not the domain model. Treq models a managed compute instance and maps it to vendor APIs through an adapter.

### Multiple clients are the user's own problem

A user may open the same managed VM, or the same repository on it, from more than one desktop client at once. Treq does not implement locking, session exclusivity, or conflict resolution between a user's own concurrent clients. The user is responsible for coordinating simultaneous changes they make from multiple sessions, the same way they would with two local terminals open on one machine.

What Treq does own is visibility: when the VM-side repository state changes for any reason other than the current client's own action, connected clients must detect the change and refresh, so no client is left showing stale workspace, change, or conflict data. Refresh replaces the client's read state; it never attempts to merge or arbitrate divergent in-flight edits.

## User modes

### Treq-managed VM

Treq provisions and reconciles one managed VM for the authenticated user. The control plane owns provider lifecycle calls, records trusted endpoint metadata, configures the SSH CA trust, and issues short-lived SSH certificates.

The user selects:

- a region at initial provisioning or reprovisioning;
- one of a small set of VM size presets;
- an existing local public/private key identity to use for certificate authentication, or an existing public key whose private half is available to the client.

Treq does not create a private key. If the user has no suitable key, the UI explains how to create or import one outside Treq.

### User-managed VM

The user explicitly configures:

- display name;
- hostname or IP address;
- SSH port;
- SSH username;
- expected host-key fingerprint;
- authentication identity reference;
- optional explicit SSH alias.

An alias is used only when the user explicitly selects alias mode for that endpoint. Treq does not scan and automatically trust arbitrary aliases. The user is responsible for installing Treq, JJ, Git, agents, and their public key on the VM.

To speed up entry, the registration UI may read host aliases from the user's local `~/.ssh/config` (and included files) and offer them as autocomplete suggestions for the hostname/alias field. This is discovery only: selecting a suggestion fills in the field but does not register, trust, or connect to that endpoint. The endpoint is trusted only after the user completes explicit registration, including host-key verification.

User-managed endpoints use the same structured Treq CLI protocol and UI after connection. Control-plane certificate issuance is not required for these endpoints, though a future custom-CA option may be added.

## High-level architecture

```text
Desktop Treq
  ├─ Supabase session
  ├─ control-plane API client
  └─ native SSH client
       ├─ exec channels: treq <command> --format=json
       └─ PTY channels: shell and agent sessions
                 ↓
Managed or user-owned VM
  ├─ SSH server
  ├─ Treq CLI
  ├─ JJ and Git
  ├─ coding agents
  └─ repositories and workspaces

Supabase Edge Functions
  ├─ authenticate and authorize
  ├─ provision/reconcile managed compute
  ├─ issue short-lived SSH certificates
  ├─ return signed connection metadata
  └─ write operation and audit records
                 ↓
ManagedComputeProvider
  └─ initial implementation: Fly Sprites
```

## Control-plane API

Supabase Edge Functions expose authenticated APIs for:

- ensuring the current user has a managed instance;
- reading instance status and trusted endpoint metadata;
- provisioning, waking, reprovisioning, and deleting an instance;
- listing allowed regions and size presets;
- registering and revoking client public keys;
- issuing short-lived SSH certificates;
- registering user-managed endpoints;
- recording repository registrations;
- reading operation progress and audit events.

Provider credentials are server-side secrets. Clients never receive Fly or other vendor API tokens.

### Suggested resources

```text
remote_instances
remote_instance_operations
remote_instance_endpoints
remote_client_keys
remote_instance_access
remote_repositories
remote_audit_events
```

All tables use row-level security. Edge Functions verify both the Supabase principal and resource ownership instead of relying only on client-supplied IDs.

## Generic compute-provider model

Define a provider-neutral interface similar to:

```rust
trait ManagedComputeProvider {
    async fn create_instance(&self, request: CreateInstanceRequest)
        -> Result<ProviderInstance, ProviderError>;
    async fn get_instance(&self, provider_id: &str)
        -> Result<ProviderInstance, ProviderError>;
    async fn wake_instance(&self, provider_id: &str)
        -> Result<(), ProviderError>;
    async fn replace_instance(&self, request: ReplaceInstanceRequest)
        -> Result<ProviderInstance, ProviderError>;
    async fn delete_instance(&self, provider_id: &str)
        -> Result<(), ProviderError>;
}
```

The domain record contains provider-independent fields:

```text
instance_id
owner_user_id
provider_kind
provider_resource_id
region
size_preset
status
generation
endpoint_id
image_manifest_version
created_at
ready_at
```

Provider responses are normalized into Treq statuses. UI and repository code never import Sprites SDK types or vendor status strings.

## Instance lifecycle

### Cardinality

- One managed instance per user.
- One instance hosts multiple repositories.
- A user chooses one active size preset for that instance.
- Presets map to provider-specific CPU, memory, storage, and related settings.
- Organizations and shared instances are future work.

### Resource quotas

Every user's managed instance starts at a fixed base allocation included in the plan:

- 5 GB of disk;
- 1 vCPU;
- 2 GB of RAM.

These limits are enforced now, at provisioning and on an ongoing basis, regardless of how many repositories the user places on the instance. A user may not exceed the base allocation in this delivery; purchasing additional disk or compute as a plan add-on is explicitly deferred (see Non-goals) and must not be implemented yet, only the enforcement of the base limits. When enforcement blocks an operation — for example a write that would exceed the disk quota — the failure must be a distinct, structured readiness or mutation error so the UI can explain the quota rather than surfacing a generic filesystem or provider failure.

### Provisioning trigger

Provision lazily when an eligible user first chooses a managed remote repository. Billing and eligibility enforcement are outside this PRD; the provisioning API accepts that authorization as already established.

### State machine

```text
unprovisioned
  → provisioning
  → bootstrapping
  → installing_access
  → verifying
  → ready

ready ↔ suspended/waking
ready → reprovisioning → verifying → ready
any active state → degraded/failed
any state → deleting → deleted
```

Vendor-controlled idleness automatically suspends the instance. Treq records observed suspension but does not implement a second idle timer. A connection attempt may first call the control plane to ensure the VM is awake, then wait for endpoint and SSH readiness.

### Reprovisioning

The user may reprovision their managed VM to:

- repair a drifted or damaged environment;
- select another size preset;
- select another region;
- apply a newer boot manifest.

Region migration is not supported. The UI must clearly state that reprovisioning can replace the VM and that repository preservation or export is the user's responsibility according to the selected provider storage behavior. The control plane increments the instance generation and clients treat endpoint or host-key changes as an explicit trust transition.

### Idempotency

Every mutating control-plane request includes an idempotency key. The server records the operation before invoking the provider.

Repeated requests with the same key:

- return the existing operation;
- never create a second instance;
- never install the same access record twice;
- resume reconciliation after a partial failure where safe.

Reconciliation compares desired state, Supabase state, and provider state. It must handle a provider call succeeding before the Edge Function records completion.

## Boot manifest and readiness

The boot manifest defines the dependencies and versions that provisioning must install. It is an internal control-plane and image-build artifact; it is not exposed as a user-facing Treq CLI command.

Example contents:

```yaml
manifest_version: 1
treq_version: 0.2.0
jj_version: 0.x.y
git_version: 2.x
agents:
  codex: x.y.z
  claude: x.y.z
```

The exact installation mechanism may be a base image, vendor initialization command, or versioned bootstrap script. It must be repeatable and tied to an instance generation.

### Expanded readiness

Readiness verifies more than binary presence:

- provider reports the instance running or connectable;
- SSH endpoint resolves and accepts connections;
- presented host key matches trusted control-plane metadata;
- certificate or selected user key authenticates;
- expected Unix user and home directory exist;
- persistent repository root exists and is writable;
- Treq, JJ, Git, and configured agents execute successfully;
- installed dependency versions satisfy the boot manifest;
- Treq can initialize and inspect a temporary test repository;
- sufficient disk space and inode capacity remain within the user's base disk quota;
- the recorded generation matches the provisioned environment.

Readiness results are structured, stage-specific, and safe to retry. They distinguish provider, network, trust, authentication, dependency, filesystem, and Treq failures.

## SSH identity and certificates

### Client key policy

- Treq never generates a user private key.
- Users select an existing key identity.
- Private keys remain on the user's device or in an SSH agent.
- Supabase stores public keys, fingerprints, metadata, expiry, and revocation state only.
- Each client key is independently registered and revocable.

### Managed VM certificate flow

1. Client authenticates to Supabase.
2. Client registers or selects an existing public key.
3. Client requests access to its managed instance.
4. Edge Function verifies ownership, key status, and instance status.
5. The control plane signs a short-lived OpenSSH user certificate.
6. Client receives the certificate plus trusted endpoint metadata.
7. Native SSH verifies the server host key and authenticates with the existing private key plus certificate.
8. Certificate expiration ends access without editing `authorized_keys`.

The SSH CA private key must be held in an appropriate server-side signing service or secret store and must never be returned to a client or written to Supabase tables. Certificate lifetime should be short enough to bound loss exposure while allowing normal reconnects.

### Silent renewal while the session is active

A certificate must never lapse under a user who remains authenticated. While the user's Supabase session stays valid, the desktop client silently requests a fresh certificate from the control plane as the current one nears expiry, the same way an OAuth 2 access token is refreshed ahead of expiry. This renewal is transparent: it must not interrupt open exec or PTY channels, and it must not prompt the user, so a certificate's short lifetime bounds loss exposure without becoming a recurring interruption for a legitimately logged-in user.

Renewal is refused, and the certificate is allowed to lapse, only when the underlying authorization is no longer valid: the Supabase session has ended, the client's public key has been revoked, or the instance itself is no longer accessible to that user. In those cases the client does not retry renewal; it proceeds to the hard cutoff below.

### Hard cutoff on revocation or expiry

If a client key is revoked, or a certificate expires without a valid renewal, the client is immediately cut off from the managed VM:

- open exec and PTY channels to that instance are torn down;
- no further structured commands, shell, or agent traffic is sent over the stale credential;
- the UI blocks further interaction with that instance behind a reauthentication prompt.

The user regains access only by reauthenticating and obtaining a new certificate through the normal registration and issuance flow. Treq does not offer a soft-degraded mode for a revoked or expired credential — access is fully blocked until identity is reverified.

### Existing keys without certificates

Users may choose direct public-key authentication where supported. For managed VMs this is an explicit alternative, not a Treq-generated identity. Installation and removal are idempotent and auditable. Certificates remain the preferred managed path.

## Host-key verification

The control plane obtains the VM host public key or fingerprint through a trusted provisioning path and records it with the instance generation.

Clients must:

- require a matching trusted host key;
- reject unknown keys for managed instances;
- reject changed keys unless the control plane reports an explicit generation transition;
- show a clear trust-change confirmation for user-managed endpoints;
- never use an equivalent of `StrictHostKeyChecking=no`;
- keep managed host trust separate from the user's global `known_hosts` file.

Reprovisioning may rotate the host key. The replacement operation records old and new fingerprints, generation, timestamp, provider resource ID, and initiating principal.

## Expanded SSH connection model

```rust
struct SshEndpoint {
    id: String,
    instance_id: Option<String>,
    source: SshEndpointSource,
    hostname: String,
    port: u16,
    username: String,
    host_keys: Vec<TrustedHostKey>,
    authentication: SshAuthentication,
}

enum SshEndpointSource {
    Managed { provider: String, generation: u64 },
    UserManaged,
    ExplicitAlias { alias: String },
}
```

Repository identity references the endpoint ID and canonical remote path rather than only a host string. Managed instance IDs remain stable across hostname changes; an instance generation records replacement.

## Native SSH transport

Replace system `ssh` subprocesses with a native Rust SSH library on desktop.

The transport owns:

- strict host-key verification;
- user-key and certificate authentication;
- connection pooling and channel multiplexing;
- keepalives;
- reconnect and stale-connection recovery, without assuming an in-flight mutation completed or is safe to blindly retry;
- exec channels without PTYs for structured commands;
- PTY channels for interactive shells and agents;
- terminal resize;
- total operation deadlines;
- cancellation;
- stdout/stderr separation;
- output size limits;
- sensitive-value redaction;
- connection and channel metrics.

SFTP is not required for the first delivery unless a concrete UI operation cannot be implemented through the Treq CLI. Port forwarding is excluded.

## Structured command protocol

The existing typed request concept remains, but it moves out of an SSH-specific module into a transport-neutral application protocol.

Every UI-facing operation must be an allow-listed Treq CLI command:

```text
treq repo inspect --repo <path> --format=json
treq workspace list --repo <path> --format=json
treq changes list --repo <path> --workspace <id> --format=json
```

Requirements:

- stdout contains only the result JSON;
- stderr contains diagnostics;
- failures return non-zero status and structured error JSON;
- error codes survive transport mapping;
- commands have bounded output and total deadlines;
- mutations accept idempotency keys where retry could duplicate work;
- no frontend-provided arbitrary command enters an exec channel;
- probe, clone, and initialization become typed Treq commands rather than SSH shell scripts.

### Retrying after network loss

A network failure while a mutating command is in flight does not tell the client whether the command reached the VM, ran, or completed. The client must not assume the operation is safely idempotent and blindly resend it. Instead, on reconnect the client verifies observable repository state relevant to that mutation (for example, re-reading the affected commit, workspace, or bookmark through a typed read command) before deciding whether to retry:

- if state shows the mutation already applied, the client treats it as complete and does not resend;
- if state shows the mutation did not apply, the client may retry, using the same idempotency key so a command that actually did land exactly once on the VM-side is not reapplied a second time by a late retry racing the original;
- if state is ambiguous, the client surfaces the ambiguity to the user rather than guessing.

This applies to workspace, commit, conflict, Git, and agent-lifecycle mutations alike. It does not apply to pure read/inspect commands, which are always safe to retry.

## Remote mutation coverage

Full remote control requires typed operations for:

- workspace creation, update, rename, deletion, movement, and rebase;
- file restore and patch application;
- commit creation, description, split, movement, and abandonment;
- conflict inspection and resolution;
- Git fetch and bookmark tracking or push;
- agent start, input, status, attach, stop, and logs.

The operation response uses the same DTO as the local Tauri path whenever practical.

## Agent and terminal lifecycle

Interactive SSH sessions remain separate from structured commands. A terminal is bound to:

```text
endpoint_id
repository_id
workspace_id
remote_working_directory
local_session_id
```

This carve-out (terminal reconnect explicitly unsupported after the client exits) is retired at the backend level: [Mobile Remote Control](./mobile.md)'s Phase 7 added a VM-local persistent PTY supervisor (`core::pty_remote_supervisor`, tmux/screen-backed) and its `pty-remote` CLI surface, and Phase 8 added `RemotePtyManager::create_with_command` plus `remote_pty_list_persistent_sessions`/`remote_pty_reattach` Tauri commands so a desktop client *can* list and reattach to a session that outlived a prior connection. What remains unsupported is UI: desktop's remote-review surface has no terminal panel wired to these commands yet, so nothing in the shipped app actually offers reattach today - see `mobile.md`'s Phase 8 write-up for exactly what exists versus what's still a backend-only capability. Agent processes that must survive disconnection still use the separate `agent-remote` CLI lifecycle commands backed by `core::agent_supervisor`, unaffected by this. Neither supervisor listens on a public network port or introduces a public Treq daemon.

When an agent exits or a mutation completes, the desktop client refreshes remote repository status, changes, commits, and conflicts.

### Change propagation across concurrent clients

Because a user may connect multiple desktop clients (or connect to multiple VMs) at once, remote state can change underneath a client that did not initiate the change. The remote side must give connected clients a way to learn that repository state moved — for example a lightweight watch/poll on the workspace's JJ operation log or an equivalent change marker exposed through a typed Treq CLI command — so a client can detect a foreign change and refresh rather than relying only on its own mutation responses. This is a stale-state notification mechanism, not a conflict-resolution mechanism: Treq does not merge or reconcile divergent edits made concurrently from different clients; it only ensures every client's view converges to current VM state after each detected change.

## UI requirements

### Remote setup

- Present two choices: **Treq-managed VM** and **Your own VM**.
- Show provisioning state and stage-specific errors.
- Let managed users choose region and size preset.
- Let users select an existing SSH identity.
- Show the selected public-key fingerprint before registration.
- Show host-key verification status.
- Explain replacement and data consequences before reprovisioning.
- Provide revoke, reconnect, wake, reprovision, and delete actions as appropriate.

### Repository opening

- Select an existing registered repository or enter a remote path.
- Probe and inspect through typed Treq commands.
- Clone through a typed remote clone command.
- Persist endpoint-aware repository descriptors.
- Restore a saved repository only after reconnect and trust validation.

### Main application integration

Remote repositories use the existing component tree rather than a placeholder connected screen. Transport selection is derived from repository location.

The UI must support:

- remote workspace sidebar and selection;
- repository status and branches;
- changed files;
- structured diffs;
- working-copy and parent file context;
- commit history;
- conflicts;
- SSH-backed shell and agent sessions in the selected workspace;
- manual refresh;
- refresh after mutations and agent completion;
- visible offline, waking, reconnecting, stale, and degraded states;
- disabling any action not yet supported remotely.

TanStack Query keys include repository identity, endpoint generation, and workspace identity so local and remote cache entries cannot collide.

## Observability and audit

### Control-plane events

Record:

- instance create, wake, replace, and delete requests;
- provider request identifiers and normalized outcomes;
- desired and observed lifecycle state;
- region, size preset, manifest version, and generation;
- client-key registration and revocation;
- certificate serial, principals, issue time, expiry, and each renewal;
- forced cutoffs from key revocation or certificate lapse;
- host-key registration and rotation;
- initiating user and client device;
- idempotency key and operation duration;
- readiness stage failures.

### Client and transport telemetry

Record non-sensitive metrics for:

- DNS and TCP connection duration;
- SSH negotiation and authentication duration;
- host-key mismatch count;
- pooled connection reuse;
- reconnect attempts;
- post-reconnect state verifications before a mutation retry, and their outcome (already applied, safe to retry, ambiguous);
- exec channel duration and exit category;
- timeout, cancellation, and output-limit failures;
- PTY start and exit;
- remote Treq version mismatch.

Never log:

- private keys;
- SSH CA private material;
- certificate private keys;
- source contents or diffs;
- raw terminal output by default;
- prompts by default;
- credentials embedded in repository URLs;
- access tokens or provider secrets.

Logs use correlation IDs spanning the desktop request, Edge Function operation, provider request, and SSH command where applicable.

## Security requirements

- Verify Supabase authentication and resource ownership server-side.
- Apply RLS to all instance, key, endpoint, repository, and audit tables.
- Keep provider and CA credentials in server-side secret infrastructure.
- Store only public client-key material in Supabase.
- Pin managed host keys.
- Use short-lived certificates and independently revocable client keys.
- Do not interpolate frontend text into remote shell scripts.
- Use allow-listed typed commands for structured control.
- Put hard limits on command duration and output.
- Make terminal access an explicit user action.
- Treat the VM owner as fully trusted within their own sandbox.

## Delivery phases

### Phase 1: Neutral domain and control-plane contracts

- Extract endpoint, repository location, typed request, response, and error models from the current SSH module.
- Define managed compute provider interfaces and normalized lifecycle states.
- Add Supabase schema, RLS policies, Edge Function request contracts, and operation idempotency.
- Define size presets, region records, and boot-manifest format.
- Implement `~/.ssh/config` alias discovery as an autocomplete-only input to user-managed VM registration.

### Phase 2: Sprites provisioning

- Implement the Sprites provider adapter.
- Provision one instance per user.
- Apply region and size selection.
- Bootstrap dependencies from the versioned manifest.
- Record endpoint and host-key metadata.
- Implement wake, status, reprovision, and delete reconciliation.

### Phase 3: SSH trust and authentication

- Register user-selected public keys.
- Implement short-lived certificate signing for managed instances.
- Configure the managed VM to trust the Treq SSH CA.
- Implement direct existing-key authentication as an alternative.
- Implement strict host-key verification and rotation workflows.

### Phase 4: Native desktop SSH

- Select and integrate a native Rust SSH library.
- Implement pooled connections and channel multiplexing.
- Implement structured exec and interactive PTY channels.
- Add deadlines, cancellation, output limits, keepalives, and reconnect.
- Remove system `ssh` subprocesses from the managed transport.

### Phase 5: Full remote command/control

- Move probe, clone, and initialization into typed CLI commands.
- Complete read-only commands and structured error preservation.
- Add remote mutations and idempotency.
- Add agent lifecycle commands and optional local supervisor.

### Phase 6: UI integration

- Add managed and user-owned endpoint flows.
- Add provisioning, size, region, identity, host trust, and readiness UI.
- Replace the remote placeholder screen with transport-aware existing components.
- Bind terminals and agents to endpoint, repository, and workspace identities.
- Add reconnect, wake, reprovision, refresh, and degraded-state handling.

### Phase 7: Observability and operations

- Add correlated control-plane audit events.
- Add provider and SSH transport metrics.
- Add redaction and retention policies.
- Add operational dashboards and failure inspection tooling.
- Add administrative key revocation and instance recovery procedures.

### Phase 8: Test infrastructure against real APIs

Build a dedicated test environment that uses actual Supabase test projects and provider test-environment APIs rather than mocked provider responses for final acceptance.

Coverage includes:

- idempotent concurrent provisioning;
- partial provider failure and reconciliation;
- valid, expired, and revoked SSH certificates;
- correct, unknown, and rotated host keys;
- wake from vendor suspension;
- region and size preset provisioning;
- reprovision generation transitions;
- native SSH pooling, keepalives, cancellation, deadlines, and output limits;
- repository inspect, clone, workspace, diff, file, commit, conflict, and mutation operations;
- terminal and agent execution in the selected workspace;
- client restart and reconnection;
- audit-event completeness and sensitive-data redaction;
- teardown and orphan-resource detection.

Tests create uniquely tagged resources, enforce spending and concurrency caps, capture provider request IDs, and always run compensating cleanup. A scheduled cleanup job removes leaked test resources after a safety window.

## Acceptance criteria

1. An authenticated user can provision exactly one managed VM with a selected region and size preset.
2. The instance enforces the base 5 GB disk and 1 vCPU / 2 GB RAM allocation, and disk-quota failures surface as a distinct, structured error rather than a generic failure.
3. Repeated provisioning requests with the same idempotency key do not create duplicate resources.
4. The VM is bootstrapped to the declared dependency versions and passes expanded readiness checks.
5. A desktop client authenticates with a user-selected key and short-lived certificate without Treq generating a private key.
6. A desktop client silently renews its certificate ahead of expiry while the user's session remains valid, without interrupting open channels or prompting the user.
7. A revoked client key or a certificate that lapses without valid renewal immediately blocks further interaction with the instance until the user reauthenticates.
8. The client rejects an unknown or changed host key.
9. The native SSH transport reuses a connection for multiple structured commands.
10. A user can register a fully explicit user-owned VM endpoint.
11. A user can explicitly choose an SSH alias for a user-owned endpoint without automatic alias discovery or trust.
12. Multiple repositories can be opened on the user's single managed VM.
13. Remote workspaces, changes, diffs, file context, commits, and conflicts render in the existing UI.
14. A client detects VM-side repository changes made outside its own session (including from another of the user's own clients) and refreshes its view, without attempting to resolve conflicting concurrent edits.
15. Supported workspace, file, commit, conflict, Git, and agent mutations execute through typed Treq commands.
16. After a network loss during an in-flight mutation, the client verifies observable repository state before retrying, rather than assuming the mutation is idempotent and resending it blindly.
17. Shell and agent PTYs start in the selected remote workspace.
18. Managed VMs recover from vendor auto-suspension through a visible wake and reconnect flow.
19. Reprovisioning increments the instance generation and performs an explicit host-trust transition.
20. Lifecycle, certificate, host-key, readiness, and provider failures can be correlated through audit records without exposing secrets or source data.
21. End-to-end acceptance tests pass against dedicated real test-environment APIs and leave no orphan resources.

## Open questions

- Which native Rust SSH library satisfies host-key, OpenSSH certificate, agent, multiplexing, cancellation, and PTY requirements?
- Where will the SSH CA private key be held and which signing interface will Edge Functions call?
- Which user key algorithms and hardware-backed identities will be supported first?
- What are the provider guarantees for persistent data across suspension and reprovisioning?
- Does reprovisioning preserve a volume, restore a snapshot, or always start empty?
- Which size presets and regions are offered initially?
- What wake behavior and latency does the provider expose to an incoming SSH client?
- Is a VM-local agent supervisor required for the first remote-control release?
- What retention period applies to audit records and provider operation metadata?
