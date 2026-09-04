# Phase 8: Remote SSH real-API test infrastructure

This document maps `prds/remote-ssh.md`'s **21** acceptance criteria to the tests
that cover them. It states plainly which run today in this sandbox versus which
require real credentials this sandbox does not have, and documents the cleanup
script's safety gates.

`test/remote-ssh-traceability.test.ts` asserts the row count here matches the
PRD. `test/vitest-config.test.ts` guards Vitest `sequence.groupOrder` against
regression.

## Test suites

| Suite | File(s) | Layer | Credential gate |
|---|---|---|---|
| Rust real-API e2e | `remote_e2e.rs` | rust-e2e | `TREQ_REMOTE_E2E=1` + `FLY_TEST_API_TOKEN`, `FLY_TEST_APP_NAME`; live tests are `#[ignore]` |
| Native SSH real-API e2e | `remote_e2e_native.rs` | rust-e2e | `TREQ_REMOTE_E2E=1` + `TREQ_REMOTE_E2E_NATIVE=1` + Supabase test-project vars; certificate auth against a real `SshConnectionPool` |
| Deno real-API e2e | `supabase/functions/tests/remote_e2e.test.ts` | deno-e2e | `TREQ_REMOTE_E2E=1` + Supabase test-project vars (see file header) |
| Real `sshd` server-it | `remote_ssh_server_it.rs` | server-it | `TREQ_SSH_SERVER_IT=1` + `TREQ_SSH_IT_*` (see file header; CI: `.github/workflows/remote-ssh-server-it.yml`) |
| Native SSH transport (mock server) | `core/remote_ssh_transport.rs` `mod tests` | unit (Rust) | none |
| Control-plane / domain units | `core/remote*.rs`, `commands/remote*.rs` | unit (Rust) | none |
| Quota catalog units | `supabase/functions/tests/remote_quota.test.ts` | unit (Deno) | none |
| Frontend units | `src/lib/remote-*.test.ts`, `src/components/remote/*.test.tsx` | unit (Vitest) | none |
| Frontend integration | `test/integration/remote-ssh.test.ts` | integration (Vitest + NAPI) | none (needs NAPI build) |
| Compensating cleanup | `scripts/remote-e2e-cleanup.ts` / `scripts/lib/remote-e2e-cleanup.ts` | operator script | dry-run by default; see [Cleanup](#cleanup-scriptsremote-e2e-cleanupts) below for the full env var and safety-gate list |

**Skip contract:** gated suites print a `SKIP` reason and execute **zero**
assertions when credentials are absent. That proves the harness compiles and
skips gracefully; it is **not** a passing acceptance run. Status `skipped` below
means exactly that.

**Partial transport coverage** is marked `partial`: the test runs
unconditionally but only proves a transport/UI subset (for example mock `russh`
server or stub CLI shim), not the full criterion against a provisioned VM.

## Required environment variables

### Fly adapter live tests (`remote_e2e.rs`)

- `TREQ_REMOTE_E2E=1` — explicit opt-in
- `FLY_TEST_API_TOKEN` — token scoped to a **disposable test** org/app
- `FLY_TEST_APP_NAME` — dedicated test app, never production
- `FLY_TEST_API_BASE_URL` — optional, default `https://api.machines.dev/v1`
- `TREQ_REMOTE_E2E_MAX_CONCURRENCY` — optional, default `2`
- `TREQ_REMOTE_E2E_FULL_MATRIX=1` — optional region matrix

### Control-plane live tests (`remote_e2e.test.ts`)

- `TREQ_REMOTE_E2E=1`
- `SUPABASE_TEST_URL` — dedicated **test** project URL
- `SUPABASE_TEST_ANON_KEY`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `REMOTE_ADMIN_API_KEY_TEST` — matches that project's `REMOTE_ADMIN_API_KEY`
- `TREQ_REMOTE_E2E_SOAK=1` — optional scheduled idle-timer soak (hours)

### Native SSH live tests (`remote_e2e_native.rs`)

All control-plane vars above, plus:

- `TREQ_REMOTE_E2E_NATIVE=1`
- Network reachability to the provisioned VM SSH endpoint

### Cleanup (`scripts/remote-e2e-cleanup.ts`)

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test` — **required for `--apply`**
- `FLY_E2E_CLEANUP_API_TOKEN` — **separately scoped** cleanup token (not `FLY_TEST_API_TOKEN`, not `FLY_SPRITES_API_TOKEN`)
- `FLY_E2E_CLEANUP_APP_NAME`
- `FLY_E2E_CLEANUP_API_BASE_URL` — optional

Never point any of these at production. Missing credentials skip the
corresponding scan or test; they do not delete anything. Local unit coverage
for cleanup lives in `scripts/remote-e2e-cleanup.test.ts` and
`scripts/lib/remote-e2e-cleanup.ts` — those tests use fixtures only and never
call a provider.

## Safety gates

- Live tests are opt-in (`TREQ_REMOTE_E2E=1`) and `#[ignore]` / Deno `ignore`.
- Cleanup **defaults to dry-run**. `--apply` also requires `TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test`.
- Cleanup matches only `treq-e2e-<uuid>` tags (and machine names derived from them). Untagged resources are **refused**.
- Minimum age default 2 hours. Concurrency default 2, cap 8.
- Compensating cleanup runs on test failure (`Drop` / `finally`). The scheduled script is the backstop.
- An ordinary `wake` against a running instance is **not** suspension recovery.

## Acceptance criteria mapping

| # | Criterion (summary) | Tests | Layer | Environment | Status | Proved |
|---|---|---|---|---|---|---|
| 1 | Provision exactly one managed VM with selected region and size preset | `remote_e2e.rs::provisions_instance_with_selected_region_and_size`; `::provisions_across_every_region_at_the_base_allocation` (needs `TREQ_REMOTE_E2E_FULL_MATRIX=1`); `remote_e2e.test.ts` "provisions with a selected region and size preset and reaches ready"; `remote_provider_sprites.rs::create_instance_normalizes_a_started_machine`; `RemoteSetupDialog.test.tsx` "shows region and size pickers..."; `test/integration/remote-ssh.test.ts` "opens the remote setup dialog from onboarding" | rust-e2e, deno-e2e, unit, integration | Fly + Supabase test project for e2e; jsdom + NAPI for integration | **skipped** (e2e); **pass** (unit); **blocked** (integration — NAPI) | Region/size provisioning against real Fly + control plane when creds set; UI exposes pickers. **Gap:** no test enforces one-VM-per-user cardinality. |
| 2 | Base 5 GB / 1 vCPU / 2 GB RAM enforcement; distinct disk-quota errors | `remote.rs` `enforce_disk_quota_*`, `disk_quota_readiness_check_*`; `remote_provider.rs` `base_allocation_*`, `disk_quota_*`; `remote_provider_sprites.rs::create_instance_always_requests_the_base_allocation_regardless_of_preset`; `remote_quota.test.ts` (3 tests); `remote_e2e.rs::provisions_across_every_region_at_the_base_allocation` | unit (Rust/Deno), rust-e2e | In-process / mock HTTP; Fly for matrix e2e | **pass** (units); **skipped** (matrix e2e) | Structured `disk_quota_exceeded` errors and base-allocation constants match PRD; Sprites adapter always requests base guest spec. |
| 3 | Repeated provisioning with same idempotency key does not duplicate | `remote_e2e.rs::repeated_create_with_same_idempotency_key_does_not_duplicate_instance`; `remote_e2e.test.ts` "repeated ensure calls with the same idempotency key provision exactly one instance"; `remote_provider_sprites.rs` `create_instance_sends_idempotency_headers`, `create_instance_conflict_returns_existing_machine_instead_of_erroring`; `remote.rs` `idempotency_key_replays_cached_result_*` | rust-e2e, deno-e2e, unit | Fly + Supabase test project; mock HTTP | **skipped** (e2e); **pass** (units) | Idempotency headers on provider create; replay cache on client mutations. |
| 4 | VM bootstrapped to declared versions; expanded readiness passes | `remote_bootstrap.rs` (7 tests: manifest, idempotent bootstrap script, CA trust, authorized_keys markers); `remote_e2e.test.ts` "provisions... and reaches ready" (polls to `ready`); `remote_provider.rs::boot_manifest_round_trips_through_json`; `remote.rs::disk_quota_readiness_check_reports_a_distinct_code_when_over_quota` | unit, deno-e2e | In-process; Supabase test project | **pass** (units); **skipped** (e2e ready poll) | Bootstrap script/manifest wiring and readiness stage for disk quota. **Gap:** no test runs bootstrap against a real VM image. |
| 5 | Client authenticates with user-selected key + short-lived cert; Treq never generates a private key | `remote_e2e.test.ts` "issues a short-lived certificate...", "issued certificates carry a bounded, short expiry"; `remote_ssh_server_it.rs` certificate auth against real `sshd`; `remote_e2e_native.rs` (native certificate authentication); `RemoteSetupDialog.test.tsx` "shows region and size pickers and the key fingerprint..."; `remote_local_keys.rs::returns_empty_when_ssh_dir_missing` | deno-e2e, unit, server-it, rust-e2e | Supabase test project; jsdom; CI `sshd` | **skipped** (e2e / server-it / native e2e without creds); **pass** (UI unit) | Control plane issues bounded cert; UI shows fingerprint before registration; production transport authenticates with `ssh-keygen -s` user certs against a trusted CA on live `sshd`; native pool authenticates with the issued cert when Supabase test creds are set. **Gap:** Deno signer vs `ssh-keygen` format parity is assumed, not executed in the same process. |
| 6 | Silent certificate renewal ahead of expiry without interrupting channels | `remote-cert-lifecycle.test.ts` (`renewalDelayMs`, `CertificateRenewalManager` renew/retry cases); `remote_e2e.test.ts` "silent renewal issues a fresh certificate and is audited distinctly from first issuance" | unit, deno-e2e | jsdom; Supabase test project | **pass** (unit timing/manager); **skipped** (e2e) | Renewal schedule and client manager behavior. **Gap:** no test proves open exec/PTY channels stay up during renewal. |
| 7 | Revoked key or lapsed cert blocks interaction until reauthentication | `remote-cert-lifecycle.test.ts` (`classifyRenewalError`, cutoff/session-ended/revoked/expired manager cases); `remote_e2e.test.ts` cert-after-revoke rejection + "a forced cutoff report is recorded..."; `remote_ssh_transport.rs` `force_cutoff_tears_down_*`, `clear_cutoff_restores_*`; `remote_ssh_server_it.rs` expired/not-yet-valid cert reject + `client_cutoff_tears_down_a_live_connection_without_sshd_krl` | unit, deno-e2e, server-it | jsdom; mock SSH server; Supabase test project; real `sshd` | **pass** (units); **skipped** (e2e / server-it) | Client cutoff policy, transport teardown, and live `sshd` rejection of expired/not-yet-valid certs. OpenSSH KRLs are not configured; control-plane key revocation is the client `force_cutoff` path. |
| 8 | Client rejects unknown or changed host key | `remote_ssh_transport.rs` `host_key_verifier_*`, `exec_command_rejects_unknown_host_key*`; `remote_ssh_server_it.rs::exec_command_rejects_a_real_server_whose_host_key_is_not_the_pinned_one`; `RemoteSetupDialog.test.tsx` "requires host-trust confirmation before registering a user-managed endpoint" | unit, server-it | In-process mock `russh`; real `sshd` container in CI; jsdom | **pass** (mock unit); **skipped** (server-it without creds); **pass** (UI unit) | Strict host-key pinning on mock and real servers; UI requires explicit trust for user-managed endpoints. |
| 9 | Native SSH transport reuses a connection for multiple structured commands | `remote_ssh_transport.rs::exec_command_returns_stdout_and_reuses_pooled_connection`, `exec_command_reconnects_after_pooled_connection_is_marked_dead`, `pool_key_*`; `remote_ssh_server_it.rs::pool_reuses_one_connection_across_multiple_execs_against_a_real_server`; `remote_e2e_native.rs` (new `SshConnectionPool` reconnect after drop) | unit, server-it, rust-e2e | Mock `russh`; real `sshd`; Supabase test project | **pass** (mock unit); **skipped** (server-it, e2e) | Pooled connection reuse and generation-aware pool keys. |
| 10 | Register a fully explicit user-owned VM endpoint | `remote_control_plane.rs::register_endpoint_request_alias_is_optional`; `RemoteSetupDialog.test.tsx` "requires host-trust confirmation..."; `test/integration/remote-ssh.test.ts` "opens the remote setup dialog..." (Your own VM path) | unit, integration | jsdom; NAPI | **pass** (UI unit); **blocked** (integration) | Registration request shape and host-trust UI. **Gap:** no e2e registers a user-managed endpoint against a real control plane. |
| 11 | Explicit SSH alias for user-owned endpoint; no auto-discovery or trust | `remote.rs` `parses_ssh_hosts_*`, `lists_configured_hosts_*`, `rejects_unsafe_host_aliases`; `commands/remote.rs::remote_open_repo_rejects_unsafe_host_before_ssh`; `test/integration/remote-ssh.test.ts` unsafe-alias rejection + `listSshHosts` array tests | unit, integration | In-process; NAPI + jsdom | **pass** (Rust unit); **blocked** (integration) | Alias parsing is discovery-only; unsafe aliases rejected before SSH. **Gap:** no test for explicit alias *selection* in the user-managed registration flow. |
| 12 | Multiple repositories on one managed VM | `remote_e2e_native.rs` (`InitRepo` ×2 on one instance, inspect, `CreateWorkspace`/`ListWorkspaces`) | rust-e2e | Supabase test project | **skipped** (e2e) | Native e2e initializes two repositories on a single provisioned VM and drives workspace commands against both. Not proved without credentials. |
| 13 | Remote workspaces, changes, diffs, file context, commits, conflicts render in existing UI | `test/integration/remote-ssh.test.ts` "restores the last remote repository without reading it locally"; `RemoteReviewPanel.change-marker.test.tsx` "refreshes remote review data when the operation marker changes underneath the client"; `remote-query-keys.test.ts` (endpoint/generation in query keys) | integration, unit | NAPI + jsdom | **pass** (review-panel unit); **blocked** (integration) | Last-remote restore banner and change-marker-driven refresh. **Gap:** no integration test renders diffs/commits/conflicts for a live remote repo. |
| 14 | Detect VM-side changes from other sessions; refresh without conflict resolution | `RemoteReviewPanel.change-marker.test.tsx` (same as #13); `remote.rs` `builds_typed_change_marker_arguments`, `change_marker_reflects_new_operations_and_local_dispatch_matches_direct_jj_call` | unit | jsdom; in-process jj | **pass** | Change-marker poll refreshes client view; typed marker args match jj op log. Does not merge concurrent edits. |
| 15 | Supported mutations execute through typed Treq commands | `remote.rs` `builds_typed_remote_review_command_arguments`, `builds_typed_probe_clone_init_arguments`, mutation classification tests; `commands/remote_control.rs` dispatch boundary tests; `remote_ssh_transport.rs` `structured_cli_error_survives_*`, `build_remote_command_line_quotes_arguments`; `remote_ssh_server_it.rs` stub CLI exec tests; `remote_e2e_native.rs` (`agent-remote status` exec against a real VM) | unit, server-it, rust-e2e | Mock `russh`; real `sshd` + stub CLI shim; Supabase test project | **pass** (units); **partial** (server-it — stub CLI only); **skipped** (native e2e) | Allow-listed command construction and exec-channel error mapping; native e2e drives real `treq`/`agent-remote` commands on a provisioned VM when creds are set. |
| 16 | After network loss during mutation, verify observable state before retry | `remote_ssh_transport.rs` `retry_after_reconnect_*` (4 tests); `remote.rs` workspace/agent verification recipes + `restore_file_has_no_verification_recipe` | unit | Mock `russh` with reconnect simulation | **pass** | Post-reconnect verify-then-retry/idempotency-key behavior and ambiguity surfacing. |
| 17 | Shell and agent PTYs start in the selected remote workspace | `remote_ssh_transport.rs::pty_open_and_close_record_start_and_exit_counts`, `pty_open_in_directory_execs_a_quoted_cd_before_the_command`; `remote.rs` `builds_ssh_shell_command_with_working_dir`, `quotes_remote_paths_with_single_quotes`; `remote_ssh_server_it.rs` PTY cwd/IO/resize/close; `remote_e2e_native.rs` (native PTY `pwd` in repo A) | unit, server-it, rust-e2e | Mock `russh`; real `sshd`; Supabase test project | **partial** (units); **skipped** (server-it / native e2e) | PTY open/close, quoted `cd` into the selected directory, live `sshd` PTY cwd/IO/resize/close, and native e2e opens a real PTY in a selected workspace when creds are set. **Gap:** no coding-agent PTY on a provisioned Treq VM. |
| 18 | Managed VMs recover from vendor auto-suspension via visible wake/reconnect | `remote_e2e.rs::wakes_instance_from_vendor_suspension`; `remote_e2e.test.ts` "wake transitions a suspended instance back toward ready" (+ `TREQ_REMOTE_E2E_SOAK=1` idle-timer soak); `remote_provider_sprites.rs` wake/get_instance suspended mapping; `RemoteStatusBanner.test.tsx` suspended→waking banner | rust-e2e, deno-e2e, unit | Fly + Supabase; jsdom | **skipped** (e2e); **pass** (units) | Wake API and waking UI state; Fly `/suspend`-then-`wake` proves the round trip when the API exists, soak test is the fallback. **Gap:** an ordinary wake against a running instance is not suspension recovery and is not treated as such. |
| 19 | Reprovisioning increments generation; explicit host-trust transition | `remote_e2e.rs::reprovision_replaces_instance_and_can_change_region_and_size`; `remote_e2e.test.ts` "reprovisioning increments the instance generation and rotates the host key"; `remote_e2e_native.rs` (re-issue + reconnect across a generation bump); `remote-query-keys.test.ts` generation in cache keys; `remote_ssh_transport.rs::pool_key_differs_across_generations_for_same_hostname`; `remote_provider_sprites.rs::replace_instance_normalizes_updated_machine` | rust-e2e, deno-e2e, unit | Fly + Supabase; in-process | **skipped** (e2e); **pass** (units) | Generation bump rotates host key in e2e; pool/cache keys isolate generations; native e2e re-issues a cert and reconnects across the transition. |
| 20 | Lifecycle, cert, host-key, readiness, provider failures correlated in audit without secrets | `remote_e2e.test.ts` "lifecycle operations are correlated in audit events without leaking secrets" (forbidden-substring check), renewal/cutoff audit cases; `remote_e2e.rs::provisions_instance_with_selected_region_and_size` (captures `fly-request-id`); `remote_provider_sprites.rs` `create_instance_captures_vendor_request_id_header`, `config_debug_redacts_token` | deno-e2e, rust-e2e, unit | Supabase test project; Fly; mock HTTP | **skipped** (e2e); **pass** (units) | Audit rows correlate operations; vendor request IDs captured; tokens redacted in debug output. |
| 21 | E2E acceptance tests pass against real test-environment APIs; no orphan resources | `remote_e2e.rs` (all tests + `InstanceCleanupGuard` / `E2E_TAG_PREFIX`); `remote_e2e_native.rs` (native teardown via `Drop`); `remote_e2e.test.ts` (delete + remote-admin cleanup); `remote_ssh_server_it.rs`; `scripts/remote-e2e-cleanup.ts` + `scripts/lib/remote-e2e-cleanup.ts` (unit-tested fixtures; live dry-run/apply script gated as documented above) | rust-e2e, deno-e2e, server-it | Dedicated Fly org + Supabase test project + CI `sshd` job | **skipped** (gated suites without creds); unit tests on cleanup fixtures **run** | Tagged (`treq-e2e-<uuid>`) resources, per-test compensating cleanup, admin cleanup path, and a scheduled dry-run/apply backstop with its own safety gates. Full green run requires credentials and compatible toolchain; the Fly orphan scan remains a documented operator step when run manually. |

### Honest acceptance totals (this sandbox)

| Status | Criteria | Notes |
|---|---|---|
| **pass** — unconditional tests prove core behavior | 2, 3, 4, 6, 7, 8, 9, 10, 11, 14, 16, 18, 19, 20 | Rust/Vitest units and mock transport; no Fly/Supabase/`sshd` creds required. |
| **partial** — runs but does not close the full criterion | 1, 5, 13, 15, 17 | UI units, stub CLI server-it, mock PTY, or control-plane-only slices. |
| **skipped** — gated real-API suites without creds (not acceptance pass) | 1, 3, 4, 5, 6, 7, 9, 12, 15, 17, 18, 19, 20, 21 | `remote_e2e.rs`, `remote_e2e_native.rs`, `remote_e2e.test.ts`, `remote_ssh_server_it.rs` print SKIP and run zero assertions. |
| **gap** — no test | — | None open; #12 (multiple repositories on one managed VM) is now covered by `remote_e2e_native.rs`, gated as above. |

Treat every **skipped** e2e row as "not proved in this environment", never as passed.

## Vitest targeted execution

Root `vitest.config.ts` lists unit, integration-serial, and integration-parallel
as separate projects with different `maxWorkers`. Vitest 4 requires distinct
`sequence.groupOrder` values when `maxWorkers` differ; shared defaults caused
collection to fail on multi-core hosts before any tests ran:

```text
Projects "unit" and "integration-parallel" have different 'maxWorkers'
but same 'sequence.groupOrder'. Provide unique 'sequence.groupOrder' for them.
```

`vitest.projects.ts` centralizes `groupOrder` (unit → serial → parallel). Prefer
targeted runs through the project-specific configs when you only need one layer:

```bash
npm run test:unit -- test/merge-queue
npm run test:integration:run -- test/integration/settings test/integration/workspace
```

## What actually ran in this sandbox

No live Fly Sprites account, Supabase test project, or reachable `sshd` for
server-it. Unconditional suites that **did** run:

- `npm run test:unit` — includes `remote-cert-lifecycle.test.ts`,
  `remote-query-keys.test.ts`, `RemoteSetupDialog.test.tsx`,
  `RemoteStatusBanner.test.tsx`, `RemoteReviewPanel.change-marker.test.tsx`,
  `test/vitest-config.test.ts`, `test/remote-ssh-traceability.test.ts`,
  `scripts/remote-e2e-cleanup.test.ts`
- `cargo test --lib core::remote_ssh_transport::tests` (when Rust toolchain
  supports the crate edition) — mock-server transport tests
- Gated suites print SKIP and execute zero assertions (harness-only pass)

## Running the gated real-API suites

1. Disposable Fly organization/app + `FLY_TEST_API_TOKEN` / `FLY_TEST_APP_NAME`.
2. Dedicated Supabase **test** project with Phase 1–7 migrations and Remote SSH
   Edge Functions deployed; Edge Function secrets configured on the Supabase
   side; `REMOTE_ADMIN_API_KEY_TEST` exported locally.
3. For server-it: reachable `sshd` + `TREQ_SSH_IT_*` vars (see
   `remote_ssh_server_it.rs` header).
4. For native SSH e2e: the above Supabase test project plus network
   reachability to the provisioned VM's SSH endpoint.
5. Run:

```bash
TREQ_REMOTE_E2E=1 cargo test --test remote_e2e -- --ignored --test-threads=1
TREQ_REMOTE_E2E=1 TREQ_REMOTE_E2E_NATIVE=1 cargo test --test remote_e2e_native -- --ignored --test-threads=1
TREQ_REMOTE_E2E=1 deno test --allow-net --allow-env supabase/functions/tests/remote_e2e.test.ts
TREQ_SSH_SERVER_IT=1 cargo test --test remote_ssh_server_it -- --test-threads=1
```

6. Periodically (dry-run by default):

```bash
deno run --allow-net --allow-env scripts/remote-e2e-cleanup.ts
TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test deno run --allow-net --allow-env scripts/remote-e2e-cleanup.ts --apply
```

`--test-threads=1` on the Rust side is recommended; the harness also caps
concurrency via `TREQ_REMOTE_E2E_MAX_CONCURRENCY` (default 2) in `remote_e2e.rs`.

## Known gaps (not hidden in passing-looking tests)

- **Real `treq` CLI on a provisioned VM (#15)** — server-it uses a stub CLI shim only; `remote_e2e_native.rs` covers the real path but only with live credentials.
- **Coding-agent PTY on a provisioned Treq VM (#17)** — live `sshd` PTY cwd/IO/resize/close is covered in CI; agent sessions on a managed VM are not.
- **True vendor suspend→wake (#18)** — proved only when Fly's `/suspend` API is available in the test env; otherwise falls back to the soak test; cannot force a real vendor idle timer directly.
- **OpenSSH KRL / `RevokedKeys` (#7)** — live `sshd` rejects expired/invalid certs; client-key revocation is the client `force_cutoff` path, not a server KRL.
- **Deno Edge Function signer vs `ssh-keygen -s` parity (#5)** — both emit OpenSSH user certs; the CI job uses `ssh-keygen -s` against real `sshd`, native e2e authenticates with the issued cert against the Supabase test project — the two signer paths are not exercised in the same process.
- **Full remote UI for diffs/commits/conflicts (#13)** — change-marker unit test only.
- **One-VM-per-user enforcement (#1)** — not asserted.
- **Explicit alias selection in user-managed flow (#11)** — discovery/rejection only.

Each gap is either absent from the test files or called out explicitly in test
comments and the Status/Proved columns above.
