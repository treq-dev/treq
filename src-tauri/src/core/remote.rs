use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::jj;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshHost {
  pub alias: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteReadinessCheck {
  pub name: String,
  pub available: bool,
  pub detail: String,
  /// Distinct structured error code for this check, when it failed for a
  /// reason more specific than "unavailable" (PRD "Resource quotas": quota
  /// failures "must be a distinct, structured readiness or mutation error
  /// so the UI can explain the quota rather than surfacing a generic
  /// filesystem or provider failure"). `None` for ordinary binary-presence
  /// checks; `Some("disk_quota_exceeded")` when the base disk quota check
  /// fails.
  #[serde(skip_serializing_if = "Option::is_none", default)]
  pub code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteReadiness {
  pub host: String,
  pub connected: bool,
  pub checks: Vec<RemoteReadinessCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteRepoProbe {
  pub host: String,
  pub path: String,
  pub exists: bool,
  pub is_repo: bool,
  pub needs_clone: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RepositoryLocation {
  Local { path: String },
  Ssh { host: String, path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryDescriptor {
  pub id: String,
  pub location: RepositoryLocation,
  pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryInspection {
  pub root: String,
  pub repository_type: String,
  pub current_branch: Option<String>,
  pub default_branch: String,
  pub current_change_id: String,
  pub current_commit_id: String,
  pub descriptor: RepositoryDescriptor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteRepository {
  pub host: String,
  pub path: String,
  pub display_name: String,
  pub repo_uri: String,
  pub inspection: RepositoryInspection,
}

/// Cheap, pollable change marker for a workspace's JJ operation log (PRD
/// "Change propagation across concurrent clients"). A client stores the
/// last `operation_id` it observed and compares it against the latest
/// value; a mismatch means repository state moved on the VM for a reason
/// other than the client's own in-flight mutation, and the client should
/// refresh status/changes/commits/conflicts rather than merge or reconcile
/// anything. This is stale-state notification only, never conflict
/// resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceChangeMarker {
  pub operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliErrorBody {
  pub error: CliErrorDetail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliErrorDetail {
  pub code: String,
  pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum TreqCommandRequest {
  InspectRepository {
    repo: String,
  },
  RepositoryStatus {
    repo: String,
  },
  ListBranches {
    repo: String,
  },
  ListWorkspaces {
    repo: String,
  },
  InspectWorkspace {
    repo: String,
    workspace: String,
  },
  ListChanges {
    repo: String,
    workspace: Option<String>,
  },
  DiffFile {
    repo: String,
    workspace: Option<String>,
    path: String,
  },
  ReadFile {
    repo: String,
    workspace: Option<String>,
    path: String,
    revision: FileRevision,
    start_line: Option<usize>,
    end_line: Option<usize>,
  },
  ListCommits {
    repo: String,
    workspace: Option<String>,
  },
  ListConflicts {
    repo: String,
    workspace: Option<String>,
  },
  /// Returns the workspace's current JJ operation id as a lightweight,
  /// pollable change marker so a client can detect that another client (or
  /// process) moved VM-side repository state and refresh. See
  /// [`WorkspaceChangeMarker`].
  WorkspaceChangeMarker {
    repo: String,
    workspace: Option<String>,
  },
  // -- Phase 5: probe/clone/init as typed commands ---------------------------
  ProbeRepo {
    repo: String,
  },
  CloneRepo {
    repo_url: String,
    destination: String,
    idempotency_key: String,
  },
  InitRepo {
    repo: String,
    idempotency_key: String,
  },
  // -- Phase 5: workspace mutations -------------------------------------------
  CreateWorkspace {
    repo: String,
    branch_name: String,
    source_branch: Option<String>,
    idempotency_key: String,
  },
  RenameWorkspace {
    repo: String,
    workspace: String,
    new_name: String,
    idempotency_key: String,
  },
  UpdateWorkspace {
    repo: String,
    workspace: String,
    target_branch: Option<String>,
    description: Option<String>,
  },
  DeleteWorkspace {
    repo: String,
    workspace: String,
  },
  MoveWorkspaceChanges {
    repo: String,
    workspace: String,
    destination: String,
    commits: Vec<String>,
    idempotency_key: String,
  },
  RebaseWorkspace {
    repo: String,
    workspace: String,
    target_branch: String,
    idempotency_key: String,
  },
  // -- Phase 5: file mutations -------------------------------------------------
  RestoreFile {
    repo: String,
    workspace: Option<String>,
    path: String,
  },
  PatchFile {
    repo: String,
    workspace: Option<String>,
    path: String,
    patch_base64: String,
    idempotency_key: String,
  },
  // -- Phase 5: commit mutations ------------------------------------------------
  CreateCommit {
    repo: String,
    workspace: Option<String>,
    message: String,
    idempotency_key: String,
  },
  DescribeCommit {
    repo: String,
    workspace: String,
    commit: String,
    message: String,
  },
  /// Non-interactive split: the caller supplies the files and/or hunks to
  /// place in the first commit. No interactive hunk selector runs on the
  /// exec channel.
  SplitCommit {
    repo: String,
    workspace: String,
    commit: String,
    files: Vec<String>,
    hunks: Vec<crate::core::workspaces::HunkSpec>,
    idempotency_key: String,
  },
  MoveCommit {
    repo: String,
    workspace: String,
    commit: String,
    target_workspace: String,
    idempotency_key: String,
  },
  AbandonCommit {
    repo: String,
    workspace: String,
    commit: String,
    idempotency_key: String,
  },
  // -- Phase 5: conflict mutations ----------------------------------------------
  ResolveConflict {
    repo: String,
    revision: String,
    sides: Vec<String>,
    idempotency_key: String,
  },
  // -- Phase 5: git operations ---------------------------------------------------
  GitFetch {
    repo: String,
  },
  GitBookmarkTrack {
    repo: String,
    bookmark: String,
    remote_name: String,
  },
  GitPush {
    repo: String,
    workspace: Option<String>,
    idempotency_key: String,
  },
  // -- Phase 5: agent lifecycle (VM-local supervisor) -----------------------------
  AgentStart {
    repo: String,
    workspace: String,
    agent: String,
    prompt: String,
    idempotency_key: String,
  },
  AgentInput {
    repo: String,
    workspace: String,
    input: String,
    idempotency_key: String,
  },
  AgentStatus {
    repo: String,
    workspace: String,
  },
  AgentStop {
    repo: String,
    workspace: String,
  },
  AgentLogs {
    repo: String,
    workspace: String,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileRevision {
  WorkingCopy,
  Parent,
}

// ---------------------------------------------------------------------------
// Retrying after network loss (PRD "Structured command protocol" >
// "Retrying after network loss")
// ---------------------------------------------------------------------------
//
// A network failure while a mutating command is in flight does not tell the
// client whether the command reached the VM, ran, or completed. This section
// classifies every `TreqCommandRequest` as a mutation or a pure read, and
// gives every mutation covered by "Remote mutation coverage" a verification
// recipe: a typed read command plus a check of its result that decides
// whether the mutation's effect is already observable in VM state. Pure
// reads are always safe to retry and are never classified as mutations.

impl TreqCommandRequest {
  /// True for every workspace, commit, conflict, Git, and agent-lifecycle
  /// mutation listed under "Remote mutation coverage"; false for every
  /// read/inspect command, which the PRD says is "always safe to retry".
  pub fn is_mutation(&self) -> bool {
    match self {
      // -- Pure reads: always safe to retry -----------------------------------
      Self::InspectRepository { .. }
      | Self::RepositoryStatus { .. }
      | Self::ListBranches { .. }
      | Self::ListWorkspaces { .. }
      | Self::InspectWorkspace { .. }
      | Self::ListChanges { .. }
      | Self::DiffFile { .. }
      | Self::ReadFile { .. }
      | Self::ListCommits { .. }
      | Self::ListConflicts { .. }
      | Self::ProbeRepo { .. }
      | Self::AgentStatus { .. }
      | Self::AgentLogs { .. }
      | Self::WorkspaceChangeMarker { .. } => false,
      // -- Mutations -----------------------------------------------------------
      Self::CloneRepo { .. }
      | Self::InitRepo { .. }
      | Self::CreateWorkspace { .. }
      | Self::RenameWorkspace { .. }
      | Self::UpdateWorkspace { .. }
      | Self::DeleteWorkspace { .. }
      | Self::MoveWorkspaceChanges { .. }
      | Self::RebaseWorkspace { .. }
      | Self::RestoreFile { .. }
      | Self::PatchFile { .. }
      | Self::CreateCommit { .. }
      | Self::DescribeCommit { .. }
      | Self::SplitCommit { .. }
      | Self::MoveCommit { .. }
      | Self::AbandonCommit { .. }
      | Self::ResolveConflict { .. }
      | Self::GitFetch { .. }
      | Self::GitBookmarkTrack { .. }
      | Self::GitPush { .. }
      | Self::AgentStart { .. }
      | Self::AgentInput { .. }
      | Self::AgentStop { .. } => true,
    }
  }

  /// Mutations that are not naturally idempotent must carry a non-empty
  /// idempotency key. Overwrite-style and no-op-on-repeat operations
  /// (describe/update, fetch, bookmark track, restore, delete, agent stop)
  /// do not require one.
  pub fn requires_idempotency_key(&self) -> bool {
    match self {
      Self::CloneRepo { .. }
      | Self::InitRepo { .. }
      | Self::CreateWorkspace { .. }
      | Self::RenameWorkspace { .. }
      | Self::MoveWorkspaceChanges { .. }
      | Self::RebaseWorkspace { .. }
      | Self::PatchFile { .. }
      | Self::CreateCommit { .. }
      | Self::SplitCommit { .. }
      | Self::MoveCommit { .. }
      | Self::AbandonCommit { .. }
      | Self::ResolveConflict { .. }
      | Self::GitPush { .. }
      | Self::AgentStart { .. }
      | Self::AgentInput { .. } => true,
      Self::InspectRepository { .. }
      | Self::RepositoryStatus { .. }
      | Self::ListBranches { .. }
      | Self::ListWorkspaces { .. }
      | Self::InspectWorkspace { .. }
      | Self::ListChanges { .. }
      | Self::DiffFile { .. }
      | Self::ReadFile { .. }
      | Self::ListCommits { .. }
      | Self::ListConflicts { .. }
      | Self::WorkspaceChangeMarker { .. }
      | Self::ProbeRepo { .. }
      | Self::UpdateWorkspace { .. }
      | Self::DeleteWorkspace { .. }
      | Self::RestoreFile { .. }
      | Self::DescribeCommit { .. }
      | Self::GitFetch { .. }
      | Self::GitBookmarkTrack { .. }
      | Self::AgentStatus { .. }
      | Self::AgentStop { .. }
      | Self::AgentLogs { .. } => false,
    }
  }

  pub fn kind_name(&self) -> &'static str {
    match self {
      Self::InspectRepository { .. } => "InspectRepository",
      Self::RepositoryStatus { .. } => "RepositoryStatus",
      Self::ListBranches { .. } => "ListBranches",
      Self::ListWorkspaces { .. } => "ListWorkspaces",
      Self::InspectWorkspace { .. } => "InspectWorkspace",
      Self::ListChanges { .. } => "ListChanges",
      Self::DiffFile { .. } => "DiffFile",
      Self::ReadFile { .. } => "ReadFile",
      Self::ListCommits { .. } => "ListCommits",
      Self::ListConflicts { .. } => "ListConflicts",
      Self::WorkspaceChangeMarker { .. } => "WorkspaceChangeMarker",
      Self::ProbeRepo { .. } => "ProbeRepo",
      Self::CloneRepo { .. } => "CloneRepo",
      Self::InitRepo { .. } => "InitRepo",
      Self::CreateWorkspace { .. } => "CreateWorkspace",
      Self::RenameWorkspace { .. } => "RenameWorkspace",
      Self::UpdateWorkspace { .. } => "UpdateWorkspace",
      Self::DeleteWorkspace { .. } => "DeleteWorkspace",
      Self::MoveWorkspaceChanges { .. } => "MoveWorkspaceChanges",
      Self::RebaseWorkspace { .. } => "RebaseWorkspace",
      Self::RestoreFile { .. } => "RestoreFile",
      Self::PatchFile { .. } => "PatchFile",
      Self::CreateCommit { .. } => "CreateCommit",
      Self::DescribeCommit { .. } => "DescribeCommit",
      Self::SplitCommit { .. } => "SplitCommit",
      Self::MoveCommit { .. } => "MoveCommit",
      Self::AbandonCommit { .. } => "AbandonCommit",
      Self::ResolveConflict { .. } => "ResolveConflict",
      Self::GitFetch { .. } => "GitFetch",
      Self::GitBookmarkTrack { .. } => "GitBookmarkTrack",
      Self::GitPush { .. } => "GitPush",
      Self::AgentStart { .. } => "AgentStart",
      Self::AgentInput { .. } => "AgentInput",
      Self::AgentStatus { .. } => "AgentStatus",
      Self::AgentStop { .. } => "AgentStop",
      Self::AgentLogs { .. } => "AgentLogs",
    }
  }

  /// Stable list of every typed command kind. TypeScript
  /// `TREQ_COMMAND_KINDS` must match this exactly.
  pub const KIND_NAMES: &'static [&'static str] = &[
    "InspectRepository",
    "RepositoryStatus",
    "ListBranches",
    "ListWorkspaces",
    "InspectWorkspace",
    "ListChanges",
    "DiffFile",
    "ReadFile",
    "ListCommits",
    "ListConflicts",
    "WorkspaceChangeMarker",
    "ProbeRepo",
    "CloneRepo",
    "InitRepo",
    "CreateWorkspace",
    "RenameWorkspace",
    "UpdateWorkspace",
    "DeleteWorkspace",
    "MoveWorkspaceChanges",
    "RebaseWorkspace",
    "RestoreFile",
    "PatchFile",
    "CreateCommit",
    "DescribeCommit",
    "SplitCommit",
    "MoveCommit",
    "AbandonCommit",
    "ResolveConflict",
    "GitFetch",
    "GitBookmarkTrack",
    "GitPush",
    "AgentStart",
    "AgentInput",
    "AgentStatus",
    "AgentStop",
    "AgentLogs",
  ];
}

/// The result of checking observable VM state against a mutation's expected
/// effect after a network failure interrupted the original attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationVerificationOutcome {
  /// State shows the mutation already applied: the client treats it as
  /// complete and does not resend.
  AlreadyApplied,
  /// State shows the mutation did not apply: the client may retry, using the
  /// same idempotency key.
  NotApplied,
  /// State is ambiguous: the client surfaces this to the user rather than
  /// guessing.
  Ambiguous,
}

/// A verification recipe for one in-flight mutation: a typed read command
/// safe to retry, plus a function that inspects its JSON result and decides
/// whether the mutation already landed. Built once per mutation attempt (it
/// closes over the mutation's own arguments, e.g. the branch name a
/// `CreateWorkspace` call was trying to create) so the check can compare
/// "what we asked for" against "what state now shows".
pub struct MutationVerification {
  pub read_request: TreqCommandRequest,
  pub check: Box<dyn Fn(&serde_json::Value) -> MutationVerificationOutcome + Send + Sync>,
}

fn json_str<'a>(value: &'a serde_json::Value, field: &str) -> Option<&'a str> {
  value.get(field).and_then(|v| v.as_str())
}

/// Builds the verification recipe for `request`, when one exists. Every
/// mutation under "Remote mutation coverage" that this module currently
/// implements has one; a mutation with no meaningful state to observe (e.g.
/// `RestoreFile`, whose "effect" is the absence of a diff a read command
/// would need workspace-specific context to reconstruct reliably) returns
/// `None`, and the caller treats that as always-ambiguous rather than
/// guessing a false-positive check.
pub fn verification_for(request: &TreqCommandRequest) -> Option<MutationVerification> {
  match request {
    TreqCommandRequest::CreateWorkspace {
      repo, branch_name, ..
    } => {
      let branch_name = branch_name.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListWorkspaces { repo: repo.clone() },
        check: Box::new(move |value| {
          let Some(items) = value.as_array() else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let found = items
            .iter()
            .any(|item| json_str(item, "branch_name") == Some(branch_name.as_str()));
          if found {
            MutationVerificationOutcome::AlreadyApplied
          } else {
            MutationVerificationOutcome::NotApplied
          }
        }),
      })
    }
    TreqCommandRequest::DeleteWorkspace { repo, workspace } => {
      let workspace = workspace.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListWorkspaces { repo: repo.clone() },
        check: Box::new(move |value| {
          let Some(items) = value.as_array() else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let still_present = items.iter().any(|item| {
            json_str(item, "id")
              .map(|id| id == workspace)
              .unwrap_or(false)
          });
          if still_present {
            MutationVerificationOutcome::NotApplied
          } else {
            MutationVerificationOutcome::AlreadyApplied
          }
        }),
      })
    }
    TreqCommandRequest::RenameWorkspace {
      repo,
      workspace,
      new_name,
      ..
    } => {
      let workspace = workspace.clone();
      let new_name = new_name.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::InspectWorkspace {
          repo: repo.clone(),
          workspace,
        },
        check: Box::new(move |value| {
          match json_str(value, "title").or_else(|| json_str(value, "workspace_name")) {
            Some(current) if current == new_name => MutationVerificationOutcome::AlreadyApplied,
            Some(_) => MutationVerificationOutcome::NotApplied,
            None => MutationVerificationOutcome::Ambiguous,
          }
        }),
      })
    }
    TreqCommandRequest::CreateCommit {
      repo,
      workspace,
      message,
      ..
    } => {
      let message = message.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListCommits {
          repo: repo.clone(),
          workspace: workspace.clone(),
        },
        check: Box::new(move |value| {
          let Some(items) = value.get("commits").and_then(|v| v.as_array()) else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let found = items
            .iter()
            .any(|item| json_str(item, "description") == Some(message.as_str()));
          if found {
            MutationVerificationOutcome::AlreadyApplied
          } else {
            MutationVerificationOutcome::NotApplied
          }
        }),
      })
    }
    TreqCommandRequest::AbandonCommit {
      repo,
      workspace,
      commit,
      ..
    } => {
      let commit = commit.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListCommits {
          repo: repo.clone(),
          workspace: Some(workspace.clone()),
        },
        check: Box::new(move |value| {
          let Some(items) = value.get("commits").and_then(|v| v.as_array()) else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let still_present = items.iter().any(|item| {
            json_str(item, "commit_id") == Some(commit.as_str())
              || json_str(item, "change_id") == Some(commit.as_str())
          });
          if still_present {
            MutationVerificationOutcome::NotApplied
          } else {
            MutationVerificationOutcome::AlreadyApplied
          }
        }),
      })
    }
    TreqCommandRequest::ResolveConflict { repo, revision, .. } => {
      let revision = revision.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListConflicts {
          repo: repo.clone(),
          workspace: None,
        },
        check: Box::new(move |value| {
          let Some(items) = value.as_array() else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let still_conflicted = items.iter().any(|item| {
            item.as_str() == Some(revision.as_str())
              || json_str(item, "path") == Some(revision.as_str())
          });
          if still_conflicted {
            MutationVerificationOutcome::NotApplied
          } else {
            MutationVerificationOutcome::AlreadyApplied
          }
        }),
      })
    }
    TreqCommandRequest::GitBookmarkTrack { repo, bookmark, .. } => {
      let bookmark = bookmark.clone();
      Some(MutationVerification {
        read_request: TreqCommandRequest::ListBranches { repo: repo.clone() },
        check: Box::new(move |value| {
          let Some(items) = value.as_array() else {
            return MutationVerificationOutcome::Ambiguous;
          };
          let tracked = items.iter().any(|item| {
            json_str(item, "name") == Some(bookmark.as_str())
              && item.get("tracked").and_then(|v| v.as_bool()) == Some(true)
          });
          if tracked {
            MutationVerificationOutcome::AlreadyApplied
          } else {
            MutationVerificationOutcome::NotApplied
          }
        }),
      })
    }
    TreqCommandRequest::AgentStart {
      repo, workspace, ..
    } => Some(MutationVerification {
      read_request: TreqCommandRequest::AgentStatus {
        repo: repo.clone(),
        workspace: workspace.clone(),
      },
      check: Box::new(
        move |value| match value.get("running").and_then(|v| v.as_bool()) {
          Some(true) => MutationVerificationOutcome::AlreadyApplied,
          Some(false) => MutationVerificationOutcome::NotApplied,
          None => MutationVerificationOutcome::Ambiguous,
        },
      ),
    }),
    TreqCommandRequest::AgentStop {
      repo, workspace, ..
    } => Some(MutationVerification {
      read_request: TreqCommandRequest::AgentStatus {
        repo: repo.clone(),
        workspace: workspace.clone(),
      },
      check: Box::new(
        move |value| match value.get("running").and_then(|v| v.as_bool()) {
          Some(false) => MutationVerificationOutcome::AlreadyApplied,
          Some(true) => MutationVerificationOutcome::NotApplied,
          None => MutationVerificationOutcome::Ambiguous,
        },
      ),
    }),
    // No reliable, cheap state check exists yet for these mutations over the
    // typed read surface (e.g. a file restore's "effect" is the absence of a
    // diff, which needs the same file/workspace context the mutation itself
    // used and is easy to get subtly wrong). Rather than guess and risk a
    // false "already applied"/"not applied" call, these fall back to
    // `MutationVerificationOutcome::Ambiguous` in `retry_after_reconnect`.
    _ => None,
  }
}

/// Outcome of running a mutation with verify-before-retry semantics after a
/// network failure. Carries enough for a Phase 6 UI to render each case from
/// the PRD: treat-as-complete, retry-with-idempotency-key, or
/// surface-ambiguity-to-user.
#[derive(Debug, Clone, PartialEq)]
pub enum MutationRetryOutcome<T> {
  /// The mutation exec channel completed normally (no network failure, or a
  /// retry that itself completed). Carries the fresh response.
  Applied(T),
  /// A network failure interrupted the exec channel, but the post-reconnect
  /// verification read showed the mutation's effect was already observable
  /// in VM state. The client does not resend.
  AlreadyApplied,
  /// A network failure interrupted the exec channel, and the post-reconnect
  /// verification read could not determine whether the mutation applied
  /// (the read itself failed, returned an unexpected shape, or this
  /// mutation has no verification recipe). The client must surface this to
  /// the user rather than guess.
  Ambiguous { reason: String },
}

/// Reported once per verify-before-retry decision so a caller can feed it
/// into telemetry (PRD "Client and transport telemetry": "post-reconnect
/// state verifications before a mutation retry, and their outcome").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostReconnectVerification {
  AlreadyApplied,
  Retried,
  Ambiguous,
}

/// Runs `request` over `pool`/`endpoint` with the PRD's verify-before-retry
/// behavior: a network failure while the mutation was in flight (as opposed
/// to a structured error the CLI itself returned) never triggers a blind
/// resend. Instead, once the connection is usable again, an appropriate
/// typed read command checks whether the mutation's effect is already
/// observable, and only a "not applied" verdict retries — with the same
/// idempotency key the original request carried, so a command that actually
/// landed once on the VM is not reapplied by a late retry racing the
/// original.
///
/// `on_verification` is called at most once, exactly when a network failure
/// forced a verification read, with the decision that resulted — this is the
/// hook a caller uses to emit the PRD's "post-reconnect state verifications
/// ... and their outcome" telemetry.
pub async fn retry_after_reconnect<T, F>(
  pool: &crate::core::remote_ssh_transport::SshConnectionPool,
  endpoint: &crate::core::remote_control_plane::SshEndpoint,
  request: TreqCommandRequest,
  limits: crate::core::remote_ssh_transport::ExecLimits,
  cancellation: &crate::core::remote_ssh_transport::CancellationToken,
  mut on_verification: F,
) -> Result<MutationRetryOutcome<T>, RemoteCommandError>
where
  T: DeserializeOwned,
  F: FnMut(PostReconnectVerification),
{
  debug_assert!(
    request.is_mutation(),
    "retry_after_reconnect is only meaningful for mutations; reads are always safe to retry directly"
  );

  match execute_remote_command::<T>(
    pool,
    endpoint,
    clone_request(&request),
    limits,
    cancellation,
  )
  .await
  {
    Ok(value) => Ok(MutationRetryOutcome::Applied(value)),
    // The CLI reached the VM and returned a structured application-level
    // error (e.g. `workspace_not_found`). That is not the "did it land?"
    // uncertainty this function exists for — the CLI told us plainly it did
    // not run — so it is surfaced as-is rather than triggering verification.
    Err(error @ RemoteCommandError::Command { .. }) => Err(error),
    Err(error @ RemoteCommandError::InvalidJson(_)) => Err(error),
    // The command was refused locally before ever reaching the network
    // (PRD "Hard cutoff on revocation or expiry"): there is no "did it
    // land?" uncertainty to verify, since it certainly did not run.
    Err(error @ RemoteCommandError::CredentialCutOff { .. }) => Err(error),
    // A transport-layer failure: the client cannot tell whether the command
    // reached the VM, ran, or completed. Verify observable state before
    // deciding anything.
    Err(RemoteCommandError::Transport(transport_message)) => {
      let Some(verification) = verification_for(&request) else {
        on_verification(PostReconnectVerification::Ambiguous);
        return Ok(MutationRetryOutcome::Ambiguous {
          reason: format!(
            "network failure during mutation ({transport_message}), and no state check is available to confirm whether it applied"
          ),
        });
      };

      let read_result = execute_remote_command::<serde_json::Value>(
        pool,
        endpoint,
        verification.read_request,
        limits,
        cancellation,
      )
      .await;

      let observed = match read_result {
        Ok(value) => (verification.check)(&value),
        // The verification read itself could not be completed (e.g. still
        // reconnecting) — this is exactly the "state is ambiguous" case, not
        // a reason to guess.
        Err(_) => MutationVerificationOutcome::Ambiguous,
      };

      match observed {
        MutationVerificationOutcome::AlreadyApplied => {
          on_verification(PostReconnectVerification::AlreadyApplied);
          Ok(MutationRetryOutcome::AlreadyApplied)
        }
        MutationVerificationOutcome::NotApplied => {
          on_verification(PostReconnectVerification::Retried);
          // Retried with the exact same request, including its idempotency
          // key field (if any) — so a command that actually did land exactly
          // once on the VM side is not reapplied a second time by this retry
          // racing the original.
          let retried =
            execute_remote_command::<T>(pool, endpoint, request, limits, cancellation).await?;
          Ok(MutationRetryOutcome::Applied(retried))
        }
        MutationVerificationOutcome::Ambiguous => {
          on_verification(PostReconnectVerification::Ambiguous);
          Ok(MutationRetryOutcome::Ambiguous {
            reason: format!(
              "network failure during mutation ({transport_message}), and post-reconnect state was ambiguous"
            ),
          })
        }
      }
    }
  }
}

/// `TreqCommandRequest` does not derive `Clone` reuse would require adding it
/// repo-wide; this narrow helper only needs to survive a single retry path,
/// so it round-trips through JSON rather than widening the enum's derive
/// list for one caller.
fn clone_request(request: &TreqCommandRequest) -> TreqCommandRequest {
  serde_json::from_value(serde_json::to_value(request).expect("TreqCommandRequest serializes"))
    .expect("TreqCommandRequest round-trips through its own JSON shape")
}

/// Allow-listed argument fields shared by every Phase 5 typed command. Only
/// commands built from a [`TreqCommandRequest`] variant can populate these —
/// no frontend-provided raw string is ever assembled into this shape, which
/// is what keeps arbitrary commands out of the exec channel.
#[derive(Default)]
struct CliArgFields<'a> {
  workspace: Option<&'a str>,
  path: Option<&'a str>,
  owned_path: Option<String>,
  target: Option<&'a str>,
  value: Option<String>,
  idempotency_key: Option<&'a str>,
}

impl TreqCommandRequest {
  /// Convert a typed request into remote CLI arguments. Values remain separate
  /// process arguments so no frontend-provided value is interpreted as shell.
  pub fn cli_args(&self) -> Result<Vec<String>, String> {
    let mut fields = CliArgFields::default();
    let (command, action, repo): (&str, &str, &str) = match self {
      Self::InspectRepository { repo } => ("repo", "inspect", repo),
      Self::RepositoryStatus { repo } => ("repo", "status", repo),
      Self::ListBranches { repo } => ("repo", "branches", repo),
      Self::ProbeRepo { repo } => ("repo", "probe", repo),
      Self::InitRepo {
        repo,
        idempotency_key,
      } => {
        fields.idempotency_key = Some(idempotency_key);
        ("repo", "init", repo)
      }
      Self::CloneRepo {
        repo_url,
        destination,
        idempotency_key,
      } => {
        if repo_url.trim().is_empty() {
          return Err("Repository URL is required".to_string());
        }
        fields.value = Some(repo_url.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("repo", "clone", destination)
      }
      Self::ListWorkspaces { repo } => ("workspace", "list", repo),
      Self::InspectWorkspace { repo, workspace } => {
        fields.workspace = Some(workspace);
        ("workspace", "inspect", repo)
      }
      Self::CreateWorkspace {
        repo,
        branch_name,
        source_branch,
        idempotency_key,
      } => {
        fields.value = Some(branch_name.clone());
        fields.target = source_branch.as_deref();
        fields.idempotency_key = Some(idempotency_key);
        ("workspace", "create", repo)
      }
      Self::RenameWorkspace {
        repo,
        workspace,
        new_name,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.value = Some(new_name.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("workspace", "rename", repo)
      }
      Self::UpdateWorkspace {
        repo,
        workspace,
        target_branch,
        description,
      } => {
        fields.workspace = Some(workspace);
        fields.target = target_branch.as_deref();
        fields.value = description.clone();
        ("workspace", "update", repo)
      }
      Self::DeleteWorkspace { repo, workspace } => {
        fields.workspace = Some(workspace);
        ("workspace", "delete", repo)
      }
      Self::MoveWorkspaceChanges {
        repo,
        workspace,
        destination,
        commits,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(destination);
        fields.value = Some(commits.join(","));
        fields.idempotency_key = Some(idempotency_key);
        ("workspace", "move", repo)
      }
      Self::RebaseWorkspace {
        repo,
        workspace,
        target_branch,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(target_branch);
        fields.idempotency_key = Some(idempotency_key);
        ("workspace", "rebase", repo)
      }
      Self::ListChanges { repo, workspace } => {
        fields.workspace = workspace.as_deref();
        ("changes", "list", repo)
      }
      Self::DiffFile {
        repo,
        workspace,
        path,
      } => {
        fields.workspace = workspace.as_deref();
        fields.path = Some(path);
        ("changes", "diff", repo)
      }
      Self::ReadFile {
        repo,
        workspace,
        path,
        ..
      } => {
        fields.workspace = workspace.as_deref();
        fields.path = Some(path);
        ("file", "read", repo)
      }
      Self::RestoreFile {
        repo,
        workspace,
        path,
      } => {
        fields.workspace = workspace.as_deref();
        fields.path = Some(path);
        ("file", "restore", repo)
      }
      Self::PatchFile {
        repo,
        workspace,
        path,
        patch_base64,
        idempotency_key,
      } => {
        fields.workspace = workspace.as_deref();
        fields.path = Some(path);
        fields.value = Some(patch_base64.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("file", "patch", repo)
      }
      Self::ListCommits { repo, workspace } => {
        fields.workspace = workspace.as_deref();
        ("commits", "list", repo)
      }
      Self::CreateCommit {
        repo,
        workspace,
        message,
        idempotency_key,
      } => {
        fields.workspace = workspace.as_deref();
        fields.value = Some(message.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("commits", "create", repo)
      }
      Self::DescribeCommit {
        repo,
        workspace,
        commit,
        message,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(commit);
        fields.value = Some(message.clone());
        ("commits", "describe", repo)
      }
      Self::SplitCommit {
        repo,
        workspace,
        commit,
        files,
        hunks,
        idempotency_key,
      } => {
        if files.iter().all(|f| f.trim().is_empty()) && hunks.is_empty() {
          return Err(
            "invalid_arguments: SplitCommit requires selected files or hunks".to_string(),
          );
        }
        fields.workspace = Some(workspace);
        fields.target = Some(commit);
        if !files.is_empty() {
          fields.value = Some(files.join(","));
        }
        if !hunks.is_empty() {
          fields.owned_path = Some(
            hunks
              .iter()
              .map(|h| format!("{}:{}-{}", h.file_path, h.start_line, h.end_line))
              .collect::<Vec<_>>()
              .join(","),
          );
        }
        fields.idempotency_key = Some(idempotency_key);
        ("commits", "split", repo)
      }
      Self::MoveCommit {
        repo,
        workspace,
        commit,
        target_workspace,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(commit);
        fields.value = Some(target_workspace.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("commits", "move", repo)
      }
      Self::AbandonCommit {
        repo,
        workspace,
        commit,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(commit);
        fields.idempotency_key = Some(idempotency_key);
        ("commits", "abandon", repo)
      }
      Self::ListConflicts { repo, workspace } => {
        fields.workspace = workspace.as_deref();
        ("conflicts", "list", repo)
      }
      Self::WorkspaceChangeMarker { repo, workspace } => {
        fields.workspace = workspace.as_deref();
        ("workspace", "marker", repo)
      }
      Self::ResolveConflict {
        repo,
        revision,
        sides,
        idempotency_key,
      } => {
        fields.target = Some(revision);
        fields.value = Some(sides.join(","));
        fields.idempotency_key = Some(idempotency_key);
        ("conflicts", "resolve", repo)
      }
      Self::GitFetch { repo } => ("git", "fetch", repo),
      Self::GitBookmarkTrack {
        repo,
        bookmark,
        remote_name,
      } => {
        fields.value = Some(bookmark.clone());
        fields.target = Some(remote_name);
        ("git", "bookmark-track", repo)
      }
      Self::GitPush {
        repo,
        workspace,
        idempotency_key,
      } => {
        fields.workspace = workspace.as_deref();
        fields.idempotency_key = Some(idempotency_key);
        ("git", "push", repo)
      }
      Self::AgentStart {
        repo,
        workspace,
        agent,
        prompt,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.target = Some(agent);
        fields.value = Some(prompt.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("agent-remote", "start", repo)
      }
      Self::AgentInput {
        repo,
        workspace,
        input,
        idempotency_key,
      } => {
        fields.workspace = Some(workspace);
        fields.value = Some(input.clone());
        fields.idempotency_key = Some(idempotency_key);
        ("agent-remote", "input", repo)
      }
      Self::AgentStatus { repo, workspace } => {
        fields.workspace = Some(workspace);
        ("agent-remote", "status", repo)
      }
      Self::AgentStop { repo, workspace } => {
        fields.workspace = Some(workspace);
        ("agent-remote", "stop", repo)
      }
      Self::AgentLogs { repo, workspace } => {
        fields.workspace = Some(workspace);
        ("agent-remote", "logs", repo)
      }
    };
    validate_remote_path(repo)?;
    let path = fields.path.or(fields.owned_path.as_deref());
    if let Some(path) = path {
      if path.trim().is_empty() {
        return Err("Remote file path is required".to_string());
      }
    }
    let mut args = vec![
      command.into(),
      action.into(),
      "--repo".into(),
      repo.to_string(),
    ];
    if let Some(workspace) = fields.workspace {
      if workspace.trim().is_empty() {
        return Err("Remote workspace is required".to_string());
      }
      args.extend(["--workspace".into(), workspace.to_string()]);
    }
    if let Some(path) = path {
      args.extend(["--path".into(), path.to_string()]);
    }
    if let Some(target) = fields.target {
      args.extend(["--target".into(), target.to_string()]);
    }
    if let Some(value) = &fields.value {
      args.extend(["--value".into(), value.clone()]);
    }
    if self.requires_idempotency_key() {
      match fields.idempotency_key {
        Some(key) if !key.trim().is_empty() => {
          args.extend(["--idempotency-key".into(), key.to_string()]);
        }
        _ => {
          return Err("invalid_arguments: idempotency key is required".to_string());
        }
      }
    } else if let Some(key) = fields.idempotency_key {
      if key.trim().is_empty() {
        return Err("Idempotency key must not be empty when provided".to_string());
      }
      args.extend(["--idempotency-key".into(), key.to_string()]);
    }
    if let Self::ReadFile {
      revision,
      start_line,
      end_line,
      ..
    } = self
    {
      args.extend([
        "--revision".into(),
        match revision {
          FileRevision::WorkingCopy => "working-copy",
          FileRevision::Parent => "parent",
        }
        .into(),
      ]);
      if let Some(line) = start_line {
        args.extend(["--start-line".into(), line.to_string()]);
      }
      if let Some(line) = end_line {
        args.extend(["--end-line".into(), line.to_string()]);
      }
    }
    args.extend(["--format".into(), "json".into()]);
    Ok(args)
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
  SshConnectionFailed(String),
  CommandFailed { code: Option<i32>, message: String },
  InvalidJson(String),
}

pub trait TreqCommandTransport {
  fn execute<T: DeserializeOwned>(&self, request: TreqCommandRequest) -> Result<T, TransportError>;
}

/// Serializes the same core DTOs the native SSH exec transport
/// (`crate::core::remote_ssh_transport`) does, which keeps local and remote
/// callers on one response contract.
pub struct LocalTransport;

impl TreqCommandTransport for LocalTransport {
  fn execute<T: DeserializeOwned>(&self, request: TreqCommandRequest) -> Result<T, TransportError> {
    let value = execute_local_request(request).map_err_command()?;
    serde_json::from_value(value).map_err(|error| TransportError::InvalidJson(error.to_string()))
  }
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
//
// Mutations that could duplicate work on retry (create, movement, git push,
// agent start) accept an idempotency key. A repeated call with the same key
// replays the recorded response instead of re-running the mutation.
//
// Persisted durably in `core::idempotency_store::IdempotencyStore`, keyed by
// the same repo-local `.treq/local.db` convention `local_db.rs` uses — not
// an in-process cache — because the remote VM starts a fresh `treq` CLI
// process per SSH exec channel, and a process-local cache cannot deduplicate
// a retry, or a concurrent invocation, that lands in a different process.
//
// Naturally idempotent operations (describe/update, which simply overwrite;
// fetch/inspect/list, which are read-only) do not accept a key at all —
// adding dedupe machinery for those would be needless per the PRD's own
// carve-out.
use crate::core::idempotency_store::{
  fingerprint, redact_for_storage, IdempotencyStore, RecoveryDecision,
};

/// Runs `run` unless `key` was already used for `operation` on an equivalent
/// `request`, in which case the previously recorded (or verification-derived)
/// response is replayed and `run` is never invoked again. Durable across CLI
/// process boundaries: `repo` selects the same `.treq/local.db` any other
/// invocation against that repository would open.
///
/// Reusing `key` for a different operation, or the same operation with a
/// different request body, returns a structured `idempotency_conflict`
/// error. A pending claim left behind by a process that died mid-mutation
/// (lost SSH connection, crashed CLI) is resolved by re-running the
/// mutation's existing observable-state verification recipe
/// ([`verification_for`]) once it goes stale, exactly as a post-reconnect
/// retry would.
fn with_idempotency_key<F>(
  repo: &str,
  operation: &str,
  key: Option<&str>,
  request: &TreqCommandRequest,
  run: F,
) -> Result<serde_json::Value, String>
where
  F: FnOnce() -> Result<serde_json::Value, String>,
{
  let Some(key) = key.filter(|k| !k.trim().is_empty()) else {
    return run();
  };

  let request_json = serde_json::to_value(request).map_err(|e| e.to_string())?;
  let request_fingerprint = fingerprint(&request_json);
  let store = IdempotencyStore::open(repo)?;

  let claim = store.claim_or_replay(
    operation,
    key,
    &request_fingerprint,
    crate::core::idempotency_store::DEFAULT_STALE_AFTER,
    || recover_stale_claim(request),
  )?;
  if let Some(replay) = claim {
    return Ok(replay);
  }

  let outcome = match run() {
    Ok(result) => {
      store.complete(operation, key, &redact_for_storage(&result))?;
      Ok(result)
    }
    Err(error) => {
      // A structured failure, not a "did it land?" ambiguity: free the key
      // for reuse rather than leaving a pending claim behind forever.
      store.abandon(operation, key)?;
      Err(error)
    }
  };
  // Best-effort, bounded retention: opportunistically sweep old completed
  // records on the same connection rather than running a separate cleanup
  // process. A failure here must never mask the mutation's own outcome.
  let _ = store.cleanup(crate::core::idempotency_store::DEFAULT_RETENTION);
  outcome
}

/// Resolves a stale pending claim by running the mutation's existing
/// observable-state verification recipe locally (the same recipe
/// [`verification_for`] builds for the async post-reconnect retry path,
/// applied here via a synchronous local dispatch instead of an SSH read).
fn recover_stale_claim(request: &TreqCommandRequest) -> Result<RecoveryDecision, String> {
  let Some(verification) = verification_for(request) else {
    return Ok(RecoveryDecision::Ambiguous);
  };
  let observed = match execute_local_request(verification.read_request) {
    Ok(value) => value,
    Err(_) => return Ok(RecoveryDecision::Ambiguous),
  };
  match (verification.check)(&observed) {
    MutationVerificationOutcome::AlreadyApplied => {
      Ok(RecoveryDecision::AlreadyApplied { observed })
    }
    MutationVerificationOutcome::NotApplied => Ok(RecoveryDecision::VerifiedNotApplied),
    MutationVerificationOutcome::Ambiguous => Ok(RecoveryDecision::Ambiguous),
  }
}

fn resolve_workspace_path(repo: &str, id: Option<i64>) -> Result<String, String> {
  match id {
    None => Ok(repo.to_string()),
    Some(id) => {
      let workspace = crate::local_db::get_workspace_by_id(repo, id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("workspace_not_found: Workspace {id} was not found"))?;
      Ok(
        Path::new(repo)
          .join(".treq")
          .join("workspaces")
          .join(workspace.workspace_path)
          .to_string_lossy()
          .into_owned(),
      )
    }
  }
}

fn workspace_id(value: Option<&String>) -> Result<Option<i64>, String> {
  value
    .map(|value| {
      value
        .parse::<i64>()
        .map_err(|_| "invalid_arguments: workspace must be a numeric id".to_string())
    })
    .transpose()
}

/// Dispatches typed CLI requests to the same core functions used by Tauri.
pub fn execute_local_request(request: TreqCommandRequest) -> Result<serde_json::Value, String> {
  request.cli_args()?;
  fn json<T: Serialize>(result: Result<T, String>) -> Result<serde_json::Value, String> {
    serde_json::to_value(result?).map_err(|error| error.to_string())
  }
  // Snapshotted before the match consumes `request` by value: mutation arms
  // need the whole original request both for the idempotency store's
  // fingerprint and, on a stale claim, for `verification_for`.
  let request_snapshot = if request.is_mutation() {
    Some(clone_request(&request))
  } else {
    None
  };
  match request {
    TreqCommandRequest::InspectRepository { repo } => json(inspect_repository_path(&repo)),
    TreqCommandRequest::RepositoryStatus { repo } => {
      json(crate::core::workspaces::workspace_status(&repo, None))
    }
    TreqCommandRequest::ListBranches { repo } => json(crate::core::repo::list_repo_branches(&repo)),
    TreqCommandRequest::ListWorkspaces { repo } => {
      json(crate::core::workspaces::list_workspaces(&repo))
    }
    TreqCommandRequest::InspectWorkspace { repo, workspace } => json(
      crate::core::workspaces::workspace_status(&repo, workspace_id(Some(&workspace))?),
    ),
    TreqCommandRequest::ListChanges { repo, workspace } => json(
      crate::core::changes::list_changed_files(&repo, workspace_id(workspace.as_ref())?),
    ),
    TreqCommandRequest::DiffFile {
      repo,
      workspace,
      path,
    } => json(crate::core::changes::list_file_hunks(
      &repo,
      workspace_id(workspace.as_ref())?,
      &path,
      "git",
    )),
    TreqCommandRequest::ReadFile {
      repo,
      workspace,
      path,
      revision,
      start_line,
      end_line,
    } => json(crate::core::changes::get_file_lines(
      &repo,
      workspace_id(workspace.as_ref())?,
      &path,
      revision == FileRevision::Parent,
      start_line.unwrap_or(1),
      end_line.unwrap_or(300),
    )),
    TreqCommandRequest::ListCommits { repo, workspace } => {
      json(crate::core::commits::list_commits(
        &repo,
        workspace_id(workspace.as_ref())?,
        false,
        None,
        None,
      ))
    }
    TreqCommandRequest::ListConflicts { repo, workspace } => {
      let id = workspace_id(workspace.as_ref())?;
      let workspace_path = resolve_workspace_path(&repo, id)?;
      let files = crate::jj::get_conflicted_files(&workspace_path, None)
        .map_err(|error| format!("jj_command_failed: {error}"))?;
      serde_json::to_value(files).map_err(|error| error.to_string())
    }
    TreqCommandRequest::WorkspaceChangeMarker { repo, workspace } => {
      let id = workspace_id(workspace.as_ref())?;
      let workspace_path = resolve_workspace_path(&repo, id)?;
      json(Ok::<_, String>(WorkspaceChangeMarker {
        operation_id: crate::jj::jj_head_operation_id(&workspace_path)
          .map_err(|error| format!("jj_command_failed: {error}"))?,
      }))
    }
    TreqCommandRequest::ProbeRepo { repo } => json(probe_repo_path(&repo)),
    TreqCommandRequest::InitRepo {
      repo,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "repo.init",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("InitRepo is a mutation"),
      || json(init_repo_path(&repo)),
    ),
    TreqCommandRequest::CloneRepo {
      repo_url,
      destination,
      idempotency_key,
    } => with_idempotency_key(
      // `destination` does not exist yet — cloning is the whole point —
      // so the idempotency store (which eagerly creates `<repo>/.treq/`
      // when opened) must not be scoped there or `git clone` will refuse
      // to write into an already-non-empty destination. Its parent
      // directory is guaranteed to exist since the caller chose a path
      // under it.
      Path::new(&destination)
        .parent()
        .and_then(|parent| parent.to_str())
        .unwrap_or("."),
      "repo.clone",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("CloneRepo is a mutation"),
      || json(clone_repo_local(&repo_url, &destination)),
    ),
    TreqCommandRequest::CreateWorkspace {
      repo,
      branch_name,
      source_branch,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "workspace.create",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("CreateWorkspace is a mutation"),
      || {
        json(crate::core::workspaces::create_workspace(
          &repo,
          &branch_name,
          None,
          None,
          source_branch.as_deref(),
          None,
          None,
        ))
      },
    ),
    TreqCommandRequest::RenameWorkspace {
      repo,
      workspace,
      new_name,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "workspace.rename",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("RenameWorkspace is a mutation"),
      || {
        json(crate::core::workspaces::rename_workspace(
          &repo,
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?,
          &new_name,
          false,
        ))
      },
    ),
    TreqCommandRequest::UpdateWorkspace {
      repo,
      workspace,
      target_branch,
      description,
    } => json(crate::core::workspaces::update_workspace(
      &repo,
      workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?,
      target_branch.map_or(
        crate::core::workspaces::MaybeEmptyParam::Omitted,
        crate::core::workspaces::MaybeEmptyParam::Some,
      ),
      description.map_or(
        crate::core::workspaces::MaybeEmptyParam::Omitted,
        crate::core::workspaces::MaybeEmptyParam::Some,
      ),
    )),
    TreqCommandRequest::DeleteWorkspace { repo, workspace } => {
      let id = workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
      json(crate::core::workspaces::delete_workspace(&repo, &id))
    }
    TreqCommandRequest::MoveWorkspaceChanges {
      repo,
      workspace,
      destination,
      commits,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "workspace.move",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("MoveWorkspaceChanges is a mutation"),
      || {
        let request = crate::core::workspaces::WorkspaceMoveRequest {
          files: vec![],
          hunks: vec![],
          commits: commits.iter().filter(|c| !c.is_empty()).cloned().collect(),
        };
        json(crate::core::workspaces::move_workspace_changes(
          &repo,
          &workspace,
          &destination,
          request,
        ))
      },
    ),
    TreqCommandRequest::RebaseWorkspace {
      repo,
      workspace,
      target_branch,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "workspace.rebase",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("RebaseWorkspace is a mutation"),
      || {
        let id =
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
        json(crate::core::workspaces::retarget_workspace(
          &repo,
          id,
          &target_branch,
          "main",
        ))
      },
    ),
    TreqCommandRequest::RestoreFile {
      repo,
      workspace,
      path,
    } => {
      let workspace_path = resolve_workspace_path(&repo, workspace_id(workspace.as_ref())?)?;
      json(crate::core::changes::discard_file_changes(
        &workspace_path,
        &path,
      ))
    }
    TreqCommandRequest::PatchFile {
      repo,
      workspace,
      path,
      patch_base64,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "file.patch",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("PatchFile is a mutation"),
      || {
        json(apply_remote_patch(
          &repo,
          workspace_id(workspace.as_ref())?,
          &path,
          &patch_base64,
        ))
      },
    ),
    TreqCommandRequest::CreateCommit {
      repo,
      workspace,
      message,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "commit.create",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("CreateCommit is a mutation"),
      || {
        json(crate::core::workspaces::commit_workspace_with_auto_push(
          &repo,
          workspace_id(workspace.as_ref())?,
          &message,
        ))
      },
    ),
    TreqCommandRequest::DescribeCommit {
      repo,
      workspace,
      commit,
      message,
    } => {
      let id = workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
      // Naturally idempotent: it overwrites the description each call, so no
      // idempotency key is needed or accepted.
      json(crate::core::commits::describe_commit(
        &repo, id, &commit, &message,
      ))
    }
    TreqCommandRequest::SplitCommit {
      repo,
      workspace,
      commit: _,
      files,
      hunks,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "commit.split",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("SplitCommit is a mutation"),
      || {
        let mut selected: Vec<String> = files
          .into_iter()
          .map(|f| f.trim().to_string())
          .filter(|f| !f.is_empty())
          .collect();
        for hunk in hunks {
          if !selected.iter().any(|f| f == &hunk.file_path) {
            selected.push(hunk.file_path);
          }
        }
        if selected.is_empty() {
          return Err(
            "invalid_arguments: SplitCommit requires selected files or hunks".to_string(),
          );
        }
        let id =
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
        let workspace_path = resolve_workspace_path(&repo, Some(id))?;
        json(
          crate::jj::jj_split(&workspace_path, "", selected)
            .map_err(|error| format!("jj_command_failed: {error}")),
        )
      },
    ),
    TreqCommandRequest::MoveCommit {
      repo,
      workspace,
      commit,
      target_workspace,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "commit.move",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("MoveCommit is a mutation"),
      || {
        let source_id =
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
        let target_id = workspace_id(Some(&target_workspace))?
          .ok_or("invalid_arguments: target workspace is required")?;
        json(crate::core::commits::move_commit_to_existing_workspace(
          &repo, source_id, &commit, target_id,
        ))
      },
    ),
    TreqCommandRequest::AbandonCommit {
      repo,
      workspace,
      commit,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "commit.abandon",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("AbandonCommit is a mutation"),
      || {
        let id =
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
        json(crate::core::commits::abandon_commit(&repo, id, &commit))
      },
    ),
    TreqCommandRequest::ResolveConflict {
      repo,
      revision,
      sides,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "conflict.resolve",
      Some(idempotency_key.as_str()),
      request_snapshot
        .as_ref()
        .expect("ResolveConflict is a mutation"),
      || {
        let sides = crate::core::resolve::parse_resolve_sides(
          &sides
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>(),
        )?;
        json(crate::core::resolve::resolve_commit(
          &repo, &revision, &sides, None,
        ))
      },
    ),
    TreqCommandRequest::GitFetch { repo } => {
      json(crate::jj::jj_git_fetch(&repo).map_err(|error| format!("jj_command_failed: {error}")))
    }
    TreqCommandRequest::GitBookmarkTrack {
      repo,
      bookmark,
      remote_name,
    } => {
      // Tracking an already-tracked bookmark is a no-op in jj, so this is
      // naturally idempotent and does not need a key.
      json(
        crate::jj::jj_bookmark_track(&repo, &bookmark, &remote_name)
          .map_err(|error| format!("jj_command_failed: {error}")),
      )
    }
    TreqCommandRequest::GitPush {
      repo,
      workspace,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "git.push",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("GitPush is a mutation"),
      || {
        json(crate::core::workspaces::push_workspace_to_remote(
          &repo,
          workspace_id(workspace.as_ref())?,
        ))
      },
    ),
    TreqCommandRequest::AgentStart {
      repo,
      workspace,
      agent,
      prompt,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "agent.start",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("AgentStart is a mutation"),
      || {
        let id =
          workspace_id(Some(&workspace))?.ok_or("invalid_arguments: workspace is required")?;
        let workspace_path = resolve_workspace_path(&repo, Some(id))?;
        json(crate::core::agent_supervisor::start_agent(
          &repo,
          &workspace,
          &workspace_path,
          &agent,
          &prompt,
        ))
      },
    ),
    TreqCommandRequest::AgentInput {
      repo,
      workspace,
      input,
      idempotency_key,
    } => with_idempotency_key(
      &repo,
      "agent.input",
      Some(idempotency_key.as_str()),
      request_snapshot.as_ref().expect("AgentInput is a mutation"),
      || {
        json(crate::core::agent_supervisor::send_agent_input(
          &repo, &workspace, &input,
        ))
      },
    ),
    TreqCommandRequest::AgentStatus { repo, workspace } => json(
      crate::core::agent_supervisor::agent_status(&repo, &workspace),
    ),
    TreqCommandRequest::AgentStop { repo, workspace } => {
      json(crate::core::agent_supervisor::stop_agent(&repo, &workspace))
    }
    TreqCommandRequest::AgentLogs { repo, workspace } => {
      json(crate::core::agent_supervisor::agent_logs(&repo, &workspace))
    }
  }
}

fn probe_repo_path(repo_path: &str) -> Result<RemoteRepoProbe, String> {
  let trimmed = repo_path.trim();
  if trimmed.is_empty() {
    return Err("Remote path is required".to_string());
  }
  let path = Path::new(trimmed);
  let exists = path.exists();
  let is_repo = exists && (path.join(".jj").is_dir() || path.join(".git").exists());
  Ok(RemoteRepoProbe {
    host: String::new(),
    path: trimmed.to_string(),
    exists,
    is_repo,
    needs_clone: !is_repo,
  })
}

/// Recursively sums file sizes under `root` (best effort: unreadable entries
/// are skipped rather than failing the whole walk) as the "disk used"
/// figure for base-disk-quota enforcement. This walks the repository root
/// rather than statvfs-ing the whole volume, since the quota is scoped to
/// what the user's repositories occupy, not the base image itself.
fn directory_usage_bytes(root: &Path) -> u64 {
  let mut total = 0u64;
  let mut stack = vec![root.to_path_buf()];
  while let Some(dir) = stack.pop() {
    let Ok(entries) = fs::read_dir(&dir) else {
      continue;
    };
    for entry in entries.flatten() {
      let Ok(metadata) = entry.metadata() else {
        continue;
      };
      if metadata.is_dir() {
        stack.push(entry.path());
      } else {
        total += metadata.len();
      }
    }
  }
  total
}

/// Enforces the base disk quota (PRD "Resource quotas") before a
/// write-triggering mutation (repo init, clone, patch apply) proceeds.
/// Returns the distinct `disk_quota_exceeded: ...` structured error the PRD
/// requires instead of letting the write fail as a generic filesystem
/// error. `root` is the directory whose usage counts against the quota —
/// callers pass the repository root (or its parent, before it exists) so
/// the check reflects what the write is about to add to.
fn enforce_disk_quota(root: &Path) -> Result<(), String> {
  enforce_disk_quota_against(root, crate::core::remote_provider::BASE_DISK_QUOTA_BYTES)
}

/// Same as [`enforce_disk_quota`] but against an arbitrary `quota_bytes`
/// ceiling, so tests can exercise the failure path without writing 5 GB of
/// fixture data to disk.
fn enforce_disk_quota_against(root: &Path, quota_bytes: u64) -> Result<(), String> {
  let scan_root = if root.exists() {
    root.to_path_buf()
  } else {
    root
      .parent()
      .map(Path::to_path_buf)
      .unwrap_or_else(|| root.to_path_buf())
  };
  let used_bytes = directory_usage_bytes(&scan_root);
  crate::core::remote_provider::check_disk_quota_against(used_bytes, quota_bytes)
    .map_err(|err| err.to_string())
}

fn init_repo_path(repo_path: &str) -> Result<RepositoryInspection, String> {
  let trimmed = repo_path.trim();
  if trimmed.is_empty() {
    return Err("Remote path is required".to_string());
  }
  let path = Path::new(trimmed);
  enforce_disk_quota(path)?;
  fs::create_dir_all(path)
    .map_err(|e| format!("filesystem_error: Failed to create {trimmed}: {e}"))?;
  if !path.join(".jj").is_dir() && !path.join(".git").exists() {
    let output = Command::new("jj")
      .current_dir(path)
      .args(["git", "init", "--colocate", "."])
      .output()
      .map_err(|e| format!("dependency_error: Failed to run jj: {e}"))?;
    if !output.status.success() {
      return Err(format!(
        "jj_command_failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
      ));
    }
  }
  inspect_repository_path(trimmed)
}

fn clone_repo_local(repo_url: &str, destination: &str) -> Result<RepositoryInspection, String> {
  if repo_url.trim().is_empty() {
    return Err("Repository URL is required".to_string());
  }
  validate_remote_path(destination)?;
  enforce_disk_quota(Path::new(destination))?;
  let output = Command::new("git")
    .args(["clone", repo_url, destination])
    .output()
    .map_err(|e| format!("dependency_error: Failed to run git: {e}"))?;
  if !output.status.success() {
    return Err(format!(
      "git_command_failed: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }
  inspect_repository_path(destination)
}

/// Applies a base64-encoded unified diff to `path` inside the given
/// workspace (or the repo root) using `git apply`. Base64 keeps the exec
/// argument vector a plain string even though the payload contains newlines.
fn apply_remote_patch(
  repo: &str,
  workspace: Option<i64>,
  path: &str,
  patch_base64: &str,
) -> Result<String, String> {
  use std::io::Write;
  let workspace_path = resolve_workspace_path(repo, workspace)?;
  enforce_disk_quota(Path::new(&workspace_path))?;
  let decoded = decode_base64(patch_base64.trim())
    .map_err(|e| format!("invalid_arguments: patch is not valid base64: {e}"))?;
  let mut child = Command::new("git")
    .current_dir(&workspace_path)
    .args(["apply", "--whitespace=nowarn", "--", path])
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .spawn()
    .map_err(|e| format!("dependency_error: Failed to run git apply: {e}"))?;
  child
    .stdin
    .take()
    .ok_or("dependency_error: Failed to open git apply stdin")?
    .write_all(&decoded)
    .map_err(|e| format!("filesystem_error: Failed to write patch input: {e}"))?;
  let output = child
    .wait_with_output()
    .map_err(|e| format!("dependency_error: git apply failed: {e}"))?;
  if !output.status.success() {
    return Err(format!(
      "git_command_failed: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }
  Ok(format!("Applied patch to {path}"))
}

/// Minimal RFC 4648 base64 decoder (standard alphabet, `=` padding) so patch
/// payloads can travel through the plain-string exec argument vector without
/// pulling in an extra crate dependency.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
  fn value(byte: u8) -> Option<u8> {
    match byte {
      b'A'..=b'Z' => Some(byte - b'A'),
      b'a'..=b'z' => Some(byte - b'a' + 26),
      b'0'..=b'9' => Some(byte - b'0' + 52),
      b'+' => Some(62),
      b'/' => Some(63),
      _ => None,
    }
  }
  let cleaned: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
  let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
  for chunk in cleaned.chunks(4) {
    if chunk.len() < 2 {
      return Err("truncated base64 input".to_string());
    }
    let padding = chunk.iter().filter(|&&b| b == b'=').count();
    let vals: Vec<u8> = chunk
      .iter()
      .filter(|&&b| b != b'=')
      .map(|&b| value(b).ok_or_else(|| "invalid base64 character".to_string()))
      .collect::<Result<_, _>>()?;
    let mut buf = [0u8; 4];
    for (i, v) in vals.iter().enumerate() {
      buf[i] = *v;
    }
    out.push((buf[0] << 2) | (buf[1] >> 4));
    if padding < 2 && vals.len() > 2 {
      out.push((buf[1] << 4) | (buf[2] >> 2));
    }
    if padding < 1 && vals.len() > 3 {
      out.push((buf[2] << 6) | buf[3]);
    }
  }
  Ok(out)
}

// ---------------------------------------------------------------------------
// Native (Phase 4) SSH exec transport for typed commands
// ---------------------------------------------------------------------------
//
// Every reachable connection path — managed, user-managed, and explicit-alias
// (`SshEndpointSource::ExplicitAlias`, built by
// `crate::core::remote_ssh_config::build_explicit_alias_endpoint`) — goes
// through the pooled native `russh` transport below and in
// `crate::core::remote_ssh_transport`, never a system `ssh` subprocess.

/// Structured error for a typed command executed over the native transport.
/// Distinguishes a transport-layer failure (connection/host-key/auth/limits —
/// see [`crate::core::remote_ssh_transport::SshTransportError`]) from a
/// command-layer failure the remote Treq CLI itself reported, so a caller
/// can tell "we could not reach the CLI" from "the CLI ran and rejected the
/// request" and keep the CLI's own error code intact either way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteCommandError {
  Transport(String),
  Command {
    code: String,
    message: String,
  },
  InvalidJson(String),
  /// The endpoint's credential is under hard cutoff (PRD "Hard cutoff on
  /// revocation or expiry") — no further structured commands may be sent
  /// until the user reauthenticates. Kept distinct from `Transport` so a
  /// caller (the Tauri command layer, the UI) can drive a reauth prompt
  /// instead of a generic transport-error toast.
  CredentialCutOff {
    endpoint_id: String,
    reason: String,
  },
}

impl std::fmt::Display for RemoteCommandError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::Transport(message) => write!(f, "transport_error: {message}"),
      Self::Command { code, message } => write!(f, "{code}: {message}"),
      Self::InvalidJson(message) => write!(f, "invalid_remote_json: {message}"),
      Self::CredentialCutOff {
        endpoint_id,
        reason,
      } => {
        write!(f, "credential_cut_off: endpoint {endpoint_id} ({reason})")
      }
    }
  }
}

impl std::error::Error for RemoteCommandError {}

/// Executes a typed `TreqCommandRequest` against `endpoint` over the pooled
/// native SSH transport's exec channel and decodes the JSON result. This is
/// the only path by which a Phase 5 mutation, read-only command, probe,
/// clone, or agent lifecycle call reaches the wire — `request` is always
/// built from an allow-listed enum variant, never a raw string, so no
/// frontend-provided arbitrary command can enter the exec channel.
pub async fn execute_remote_command<T: DeserializeOwned>(
  pool: &crate::core::remote_ssh_transport::SshConnectionPool,
  endpoint: &crate::core::remote_control_plane::SshEndpoint,
  request: TreqCommandRequest,
  limits: crate::core::remote_ssh_transport::ExecLimits,
  cancellation: &crate::core::remote_ssh_transport::CancellationToken,
) -> Result<T, RemoteCommandError> {
  let args = request
    .cli_args()
    .map_err(|error| RemoteCommandError::Command {
      code: "invalid_arguments".to_string(),
      message: error,
    })?;
  let output =
    crate::core::remote_ssh_transport::exec_command(pool, endpoint, &args, limits, cancellation)
      .await
      .map_err(|error| match error {
        crate::core::remote_ssh_transport::SshTransportError::CredentialCutOff {
          endpoint_id,
          reason,
        } => RemoteCommandError::CredentialCutOff {
          endpoint_id,
          reason: reason.to_string(),
        },
        crate::core::remote_ssh_transport::SshTransportError::CommandFailed {
          stderr,
          stdout,
          ..
        } => {
          // The CLI always emits `{"error":{"code":...,"message":...}}` on
          // stdout for a structured failure, so prefer that over stderr: it is
          // what lets the CLI's own error code survive transport mapping rather
          // than collapsing to a generic string.
          if let Ok(body) = serde_json::from_str::<CliErrorBody>(&stdout) {
            RemoteCommandError::Command {
              code: body.error.code,
              message: body.error.message,
            }
          } else {
            RemoteCommandError::Command {
              code: "treq_command_failed".to_string(),
              message: if stderr.is_empty() {
                "Remote treq command failed".to_string()
              } else {
                stderr
              },
            }
          }
        }
        other => RemoteCommandError::Transport(other.to_string()),
      })?;
  serde_json::from_slice::<T>(&output.stdout)
    .map_err(|error| RemoteCommandError::InvalidJson(error.to_string()))
}

impl TransportError {
  fn command_failed_from_message(message: String) -> Self {
    Self::CommandFailed {
      code: None,
      message,
    }
  }
}

trait TransportErrorExt<T> {
  fn map_err_command(self) -> Result<T, TransportError>;
}

impl<T> TransportErrorExt<T> for Result<T, String> {
  fn map_err_command(self) -> Result<T, TransportError> {
    self.map_err(TransportError::command_failed_from_message)
  }
}

pub fn inspect_repository_path(repo_path: &str) -> Result<RepositoryInspection, String> {
  let root = validate_repository_path(repo_path)?;
  let repository_type = detect_repository_type(&root)?;
  let branch = crate::core::repo::get_repo_current_branch(&root).ok();
  let default_branch =
    crate::core::repo::get_repo_default_branch(&root).unwrap_or_else(|_| "main".to_string());
  let current_commit_id = jj::jj_get_commit_id(&root, "@").unwrap_or_default();
  let current_change_id = String::new();
  let display_name = repository_display_name(&root);

  Ok(RepositoryInspection {
    root: root.clone(),
    repository_type,
    current_branch: branch.and_then(|branch| branch.current_branch),
    default_branch,
    current_change_id,
    current_commit_id,
    descriptor: RepositoryDescriptor {
      id: format!("local:{root}"),
      location: RepositoryLocation::Local { path: root },
      display_name,
    },
  })
}

pub fn remote_repository_from_inspection(
  host: &str,
  mut inspection: RepositoryInspection,
) -> RemoteRepository {
  let path = inspection.root.clone();
  let display_name = format!("{host}:{}", repository_display_name(&path));
  inspection.descriptor = RepositoryDescriptor {
    id: format!("ssh:{host}:{path}"),
    location: RepositoryLocation::Ssh {
      host: host.to_string(),
      path: path.clone(),
    },
    display_name: display_name.clone(),
  };
  RemoteRepository {
    host: host.to_string(),
    path: path.clone(),
    display_name,
    repo_uri: format!("ssh://{host}{path}"),
    inspection,
  }
}

/// A stable label for an [`SshEndpoint`] to display in place of a bare host
/// string: the alias for an explicit-alias endpoint (matching what the user
/// actually selected), otherwise the resolved hostname.
fn endpoint_label(endpoint: &crate::core::remote_control_plane::SshEndpoint) -> String {
  match &endpoint.source {
    crate::core::remote_control_plane::SshEndpointSource::ExplicitAlias { alias } => alias.clone(),
    _ => endpoint.hostname.clone(),
  }
}

/// Probes a remote path over the pooled native SSH transport for an already
/// trust-pinned [`crate::core::remote_control_plane::SshEndpoint`] (built via
/// `crate::core::remote_ssh_config::build_explicit_alias_endpoint` for the
/// explicit-alias case, or from a managed/user-managed registration
/// otherwise). This never shells out to a system `ssh` binary: the exec
/// channel runs over the same `russh`-based connection every other typed
/// command uses.
pub async fn probe_repo_native(
  pool: &crate::core::remote_ssh_transport::SshConnectionPool,
  endpoint: &crate::core::remote_control_plane::SshEndpoint,
  path: &str,
) -> Result<RemoteRepoProbe, RemoteCommandError> {
  let cancellation = crate::core::remote_ssh_transport::CancellationToken::new();
  let mut probe: RemoteRepoProbe = execute_remote_command(
    pool,
    endpoint,
    TreqCommandRequest::ProbeRepo {
      repo: path.to_string(),
    },
    crate::core::remote_ssh_transport::ExecLimits::default(),
    &cancellation,
  )
  .await?;
  probe.host = endpoint_label(endpoint);
  Ok(probe)
}

/// Inspects an existing remote repository over the native transport and
/// returns it in the same [`RemoteRepository`] shape the (now-removed)
/// subprocess-based `open_repo` used to produce, so callers do not need to
/// know the transport changed.
pub async fn open_repo_native(
  pool: &crate::core::remote_ssh_transport::SshConnectionPool,
  endpoint: &crate::core::remote_control_plane::SshEndpoint,
  path: &str,
) -> Result<RemoteRepository, RemoteCommandError> {
  let cancellation = crate::core::remote_ssh_transport::CancellationToken::new();
  let inspection: RepositoryInspection = execute_remote_command(
    pool,
    endpoint,
    TreqCommandRequest::InspectRepository {
      repo: path.to_string(),
    },
    crate::core::remote_ssh_transport::ExecLimits::default(),
    &cancellation,
  )
  .await?;
  Ok(remote_repository_from_inspection(
    &endpoint_label(endpoint),
    inspection,
  ))
}

/// Clones a repository into `destination` on the remote host over the native
/// transport (the typed `CloneRepo` command), then inspects it the same way
/// [`open_repo_native`] does.
pub async fn clone_repo_native(
  pool: &crate::core::remote_ssh_transport::SshConnectionPool,
  endpoint: &crate::core::remote_control_plane::SshEndpoint,
  repo_url: &str,
  destination: &str,
) -> Result<RemoteRepository, RemoteCommandError> {
  let cancellation = crate::core::remote_ssh_transport::CancellationToken::new();
  let _inspection: RepositoryInspection = execute_remote_command(
    pool,
    endpoint,
    TreqCommandRequest::CloneRepo {
      repo_url: repo_url.to_string(),
      destination: destination.to_string(),
      idempotency_key: String::new(),
    },
    crate::core::remote_ssh_transport::ExecLimits::default(),
    &cancellation,
  )
  .await?;
  open_repo_native(pool, endpoint, destination).await
}

pub fn parse_ssh_config_hosts(contents: &str) -> Vec<SshHost> {
  let mut aliases = BTreeSet::new();
  for line in contents.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
      continue;
    }
    let mut parts = trimmed.split_whitespace();
    let Some(keyword) = parts.next() else {
      continue;
    };
    if !keyword.eq_ignore_ascii_case("host") {
      continue;
    }
    for alias in parts {
      if alias == "*" || alias.contains('*') || alias.contains('?') || alias.starts_with('!') {
        continue;
      }
      aliases.insert(alias.to_string());
    }
  }
  aliases.into_iter().map(|alias| SshHost { alias }).collect()
}

pub fn list_configured_hosts() -> Result<Vec<SshHost>, String> {
  list_configured_hosts_from_paths(ssh_config_paths())
}

pub fn list_configured_hosts_from_paths(paths: Vec<PathBuf>) -> Result<Vec<SshHost>, String> {
  let mut all = BTreeSet::new();
  for path in paths {
    if let Ok(contents) = fs::read_to_string(path) {
      for host in parse_ssh_config_hosts(&contents) {
        all.insert(host.alias);
      }
    }
  }
  Ok(all.into_iter().map(|alias| SshHost { alias }).collect())
}

pub fn build_ssh_shell_command(
  host: &str,
  working_dir: Option<&str>,
  initial_command: Option<&str>,
) -> Result<(String, Vec<String>), String> {
  validate_host_alias(host)?;
  let mut remote_command = String::new();
  if let Some(dir) = working_dir {
    validate_remote_path(dir)?;
    remote_command.push_str("cd ");
    remote_command.push_str(&shell_quote(dir));
    remote_command.push_str(" && ");
  }
  remote_command.push_str("${SHELL:-/bin/sh} -l");
  if let Some(command) = initial_command {
    if !command.trim().is_empty() {
      remote_command.push_str(" -c ");
      remote_command.push_str(&shell_quote(command));
    }
  }
  Ok((
    "ssh".to_string(),
    vec![host.to_string(), "-t".to_string(), remote_command],
  ))
}

fn validate_repository_path(repo_path: &str) -> Result<String, String> {
  let trimmed = repo_path.trim();
  if trimmed.is_empty() {
    return Err("Repository path is required".to_string());
  }
  let path = Path::new(trimmed);
  if !path.exists() {
    return Err("repository_not_found: Repository path does not exist".to_string());
  }
  if !path.is_dir() {
    return Err("invalid_repository: Repository path is not a directory".to_string());
  }
  std::fs::canonicalize(path)
    .map_err(|e| format!("permission_denied: Failed to read repository path: {e}"))?
    .to_str()
    .map(|path| path.to_string())
    .ok_or_else(|| "invalid_repository: Repository path is not valid UTF-8".to_string())
}

fn detect_repository_type(root: &str) -> Result<String, String> {
  let path = Path::new(root);
  let has_jj = path.join(".jj").is_dir();
  let has_git = path.join(".git").exists();
  match (has_jj, has_git) {
    (true, true) => Ok("jj_colocated".to_string()),
    (true, false) => Ok("jj".to_string()),
    (false, true) => Ok("git".to_string()),
    (false, false) => Err("invalid_repository: No .jj or .git directory found".to_string()),
  }
}

fn repository_display_name(path: &str) -> String {
  Path::new(path)
    .file_name()
    .and_then(|name| name.to_str())
    .filter(|name| !name.is_empty())
    .unwrap_or(path)
    .to_string()
}

fn ssh_config_paths() -> Vec<PathBuf> {
  let mut paths = Vec::new();
  if let Ok(home) = std::env::var("HOME") {
    paths.push(PathBuf::from(home).join(".ssh").join("config"));
  }
  paths.push(PathBuf::from("/etc/ssh/ssh_config"));
  paths
}

pub fn shell_quote(value: &str) -> String {
  format!("'{}'", value.replace('\'', "'\\''"))
}

fn validate_host_alias(host: &str) -> Result<(), String> {
  if host.trim().is_empty() {
    return Err("SSH host is required".to_string());
  }
  if host
    .chars()
    .any(|c| c.is_whitespace() || matches!(c, ';' | '&' | '|' | '`' | '$' | '<' | '>'))
  {
    return Err("SSH host must be a host alias from ssh config".to_string());
  }
  Ok(())
}

fn validate_remote_path(path: &str) -> Result<(), String> {
  if path.trim().is_empty() {
    return Err("Remote path is required".to_string());
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_ssh_hosts_ignoring_patterns() {
    let hosts = parse_ssh_config_hosts("\nHost prod bastion\n  HostName example.com\nHost *\nHost !blocked *.internal test?\nHost dev\n");
    let aliases: Vec<_> = hosts.into_iter().map(|h| h.alias).collect();
    assert_eq!(aliases, vec!["bastion", "dev", "prod"]);
  }

  #[test]
  fn lists_configured_hosts_from_multiple_files() {
    let temp_dir = tempfile::tempdir().unwrap();
    let user_config = temp_dir.path().join("user_config");
    let system_config = temp_dir.path().join("system_config");
    std::fs::write(&user_config, "Host dev prod\n  User test\n").unwrap();
    std::fs::write(&system_config, "Host prod staging *.ignored\n").unwrap();

    let hosts = list_configured_hosts_from_paths(vec![user_config, system_config]).unwrap();
    let aliases: Vec<_> = hosts.into_iter().map(|host| host.alias).collect();

    assert_eq!(aliases, vec!["dev", "prod", "staging"]);
  }

  #[test]
  fn directory_usage_sums_nested_file_sizes() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), vec![0u8; 10]).unwrap();
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    std::fs::write(nested.join("b.txt"), vec![0u8; 5]).unwrap();
    assert_eq!(directory_usage_bytes(dir.path()), 15);
  }

  #[test]
  fn enforce_disk_quota_passes_under_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), vec![0u8; 10]).unwrap();
    assert!(enforce_disk_quota_against(dir.path(), 100).is_ok());
  }

  #[test]
  fn enforce_disk_quota_returns_distinct_structured_error_over_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), vec![0u8; 10]).unwrap();
    let error = enforce_disk_quota_against(dir.path(), 5).unwrap_err();
    assert!(
      error.starts_with("disk_quota_exceeded: "),
      "expected a distinct disk_quota_exceeded error, got: {error}"
    );
  }

  #[test]
  fn enforce_disk_quota_falls_back_to_parent_for_a_not_yet_created_path() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("existing.bin"), vec![0u8; 10]).unwrap();
    let not_yet_created = dir.path().join("new-repo");
    // The target path doesn't exist yet (this is `init_repo_path`'s case),
    // so usage is measured from its parent instead of failing the walk.
    let error = enforce_disk_quota_against(&not_yet_created, 5).unwrap_err();
    assert!(error.starts_with("disk_quota_exceeded: "));
    assert!(enforce_disk_quota_against(&not_yet_created, 100).is_ok());
  }

  #[test]
  fn quotes_remote_paths_with_single_quotes() {
    assert_eq!(shell_quote("/tmp/a b/it's"), "'/tmp/a b/it'\\''s'");
  }

  #[test]
  fn builds_ssh_shell_command_with_working_dir() {
    let (program, args) = build_ssh_shell_command("devbox", Some("/srv/my app"), None).unwrap();
    assert_eq!(program, "ssh");
    assert_eq!(args[0], "devbox");
    assert!(args[2].contains("cd '/srv/my app'"));
  }

  #[test]
  fn rejects_unsafe_host_aliases() {
    assert!(build_ssh_shell_command("dev; rm -rf /", None, None).is_err());
  }

  #[test]
  fn builds_remote_repository_from_inspection() {
    let inspection = RepositoryInspection {
      root: "/srv/project".to_string(),
      repository_type: "jj_colocated".to_string(),
      current_branch: Some("main".to_string()),
      default_branch: "main".to_string(),
      current_change_id: "change".to_string(),
      current_commit_id: "commit".to_string(),
      descriptor: RepositoryDescriptor {
        id: "local:/srv/project".to_string(),
        location: RepositoryLocation::Local {
          path: "/srv/project".to_string(),
        },
        display_name: "project".to_string(),
      },
    };

    let repo = remote_repository_from_inspection("devbox", inspection);
    assert_eq!(repo.display_name, "devbox:project");
    assert_eq!(repo.repo_uri, "ssh://devbox/srv/project");
    assert_eq!(repo.inspection.descriptor.id, "ssh:devbox:/srv/project");
    assert!(matches!(
        repo.inspection.descriptor.location,
        RepositoryLocation::Ssh { ref host, ref path }
            if host == "devbox" && path == "/srv/project"
    ));
  }

  #[test]
  fn builds_typed_remote_review_command_arguments() {
    assert_eq!(
      TreqCommandRequest::ListChanges {
        repo: "/srv/project".into(),
        workspace: Some("feature-auth".into()),
      }
      .cli_args()
      .unwrap(),
      vec![
        "changes",
        "list",
        "--repo",
        "/srv/project",
        "--workspace",
        "feature-auth",
        "--format",
        "json"
      ]
    );
  }

  #[test]
  fn rejects_invalid_paths_in_typed_requests() {
    let error = TreqCommandRequest::ReadFile {
      repo: "/srv/project".into(),
      workspace: Some("main".into()),
      path: "".into(),
      revision: FileRevision::WorkingCopy,
      start_line: None,
      end_line: None,
    }
    .cli_args()
    .unwrap_err();
    assert_eq!(error, "Remote file path is required");
  }

  #[test]
  fn builds_typed_probe_clone_init_arguments() {
    assert_eq!(
      TreqCommandRequest::ProbeRepo {
        repo: "/srv/project".into()
      }
      .cli_args()
      .unwrap(),
      vec![
        "repo",
        "probe",
        "--repo",
        "/srv/project",
        "--format",
        "json"
      ]
    );
    assert_eq!(
      TreqCommandRequest::CloneRepo {
        repo_url: "git@example.com:x/y.git".into(),
        destination: "/srv/project".into(),
        idempotency_key: "key-1".into(),
      }
      .cli_args()
      .unwrap(),
      vec![
        "repo",
        "clone",
        "--repo",
        "/srv/project",
        "--value",
        "git@example.com:x/y.git",
        "--idempotency-key",
        "key-1",
        "--format",
        "json"
      ]
    );
  }

  #[test]
  fn rejects_empty_idempotency_key() {
    let error = TreqCommandRequest::InitRepo {
      repo: "/srv/project".into(),
      idempotency_key: "  ".into(),
    }
    .cli_args()
    .unwrap_err();
    assert_eq!(error, "invalid_arguments: idempotency key is required");
  }

  // -- Idempotency ------------------------------------------------------------

  fn test_request(repo: &str) -> TreqCommandRequest {
    TreqCommandRequest::CreateWorkspace {
      repo: repo.to_string(),
      branch_name: "feature-x".into(),
      source_branch: None,
      idempotency_key: String::new(),
    }
  }

  #[test]
  fn idempotency_key_replays_cached_result_for_a_create_style_mutation_instead_of_rerunning() {
    let dir = tempfile::TempDir::new().unwrap();
    let repo = dir.path().to_str().unwrap();
    let request = test_request(repo);
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls_clone = calls.clone();
    let run = move || {
      let n = calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
      Ok(serde_json::json!({ "created_count": n }))
    };
    let key = format!("test-create-{}", uuid_like());
    let first =
      with_idempotency_key(repo, "test.create", Some(&key), &request, run.clone()).unwrap();
    let second = with_idempotency_key(repo, "test.create", Some(&key), &request, run).unwrap();
    // The second call must replay the first response rather than invoking
    // `run` again — a retried "create" mutation must not duplicate work.
    assert_eq!(first, second);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
  }

  #[test]
  fn missing_idempotency_key_always_reruns_the_operation() {
    let dir = tempfile::TempDir::new().unwrap();
    let repo = dir.path().to_str().unwrap();
    let request = test_request(repo);
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for _ in 0..2 {
      let calls_clone = calls.clone();
      with_idempotency_key(repo, "test.no-key", None, &request, move || {
        calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(serde_json::json!(null))
      })
      .unwrap();
    }
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
  }

  #[test]
  fn reusing_key_for_a_different_request_is_a_structured_conflict() {
    let dir = tempfile::TempDir::new().unwrap();
    let repo = dir.path().to_str().unwrap();
    let key = format!("test-conflict-{}", uuid_like());
    let first_request = test_request(repo);
    with_idempotency_key(repo, "test.create", Some(&key), &first_request, || {
      Ok(serde_json::json!({ "id": 1 }))
    })
    .unwrap();

    let second_request = TreqCommandRequest::CreateWorkspace {
      repo: repo.to_string(),
      branch_name: "different-branch".into(),
      source_branch: None,
      idempotency_key: String::new(),
    };
    let error = with_idempotency_key(repo, "test.create", Some(&key), &second_request, || {
      panic!("must not execute a mutation reusing a key for a different request")
    })
    .unwrap_err();
    assert!(error.starts_with("idempotency_conflict:"), "{error}");
  }

  #[test]
  fn a_failed_mutation_frees_its_idempotency_key_for_reuse() {
    let dir = tempfile::TempDir::new().unwrap();
    let repo = dir.path().to_str().unwrap();
    let request = test_request(repo);
    let key = format!("test-fail-{}", uuid_like());

    let error = with_idempotency_key(repo, "test.create", Some(&key), &request, || {
      Err("workspace_not_found: boom".to_string())
    })
    .unwrap_err();
    assert_eq!(error, "workspace_not_found: boom");

    // The failed attempt must not leave a pending claim behind: a retry
    // with the same key runs the mutation again rather than replaying or
    // conflicting.
    let result = with_idempotency_key(repo, "test.create", Some(&key), &request, || {
      Ok(serde_json::json!({ "id": 2 }))
    })
    .unwrap();
    assert_eq!(result, serde_json::json!({ "id": 2 }));
  }

  /// `describe_commit`'s CLI dispatch takes no idempotency key at all: it is
  /// naturally idempotent (rewriting a description is safe to repeat), so
  /// the typed request has no field for one and every call always runs.
  #[test]
  fn describe_commit_request_has_no_idempotency_key_field() {
    let args = TreqCommandRequest::DescribeCommit {
      repo: "/srv/project".into(),
      workspace: "1".into(),
      commit: "abc123".into(),
      message: "new description".into(),
    }
    .cli_args()
    .unwrap();
    assert!(!args.iter().any(|a| a == "--idempotency-key"));
  }

  // -- Change propagation across concurrent clients ---------------------------

  #[test]
  fn builds_typed_change_marker_arguments() {
    assert_eq!(
      TreqCommandRequest::WorkspaceChangeMarker {
        repo: "/srv/project".into(),
        workspace: Some("feature-auth".into()),
      }
      .cli_args()
      .unwrap(),
      vec![
        "workspace",
        "marker",
        "--repo",
        "/srv/project",
        "--workspace",
        "feature-auth",
        "--format",
        "json"
      ]
    );
    // Marker is also valid for the repo root (no workspace scope).
    assert_eq!(
      TreqCommandRequest::WorkspaceChangeMarker {
        repo: "/srv/project".into(),
        workspace: None,
      }
      .cli_args()
      .unwrap(),
      vec![
        "workspace",
        "marker",
        "--repo",
        "/srv/project",
        "--format",
        "json"
      ]
    );
  }

  #[test]
  fn change_marker_reflects_new_operations_and_local_dispatch_matches_direct_jj_call() {
    let repo_dir = tempfile::tempdir().unwrap();
    let repo_path = repo_dir.path().to_str().unwrap().to_string();
    crate::core::remote::execute_local_request(TreqCommandRequest::InitRepo {
      repo: repo_path.clone(),
      idempotency_key: "init-1".into(),
    })
    .unwrap();

    let before = execute_local_request(TreqCommandRequest::WorkspaceChangeMarker {
      repo: repo_path.clone(),
      workspace: None,
    })
    .unwrap();
    let before: WorkspaceChangeMarker = serde_json::from_value(before).unwrap();
    assert_eq!(
      before.operation_id,
      crate::jj::jj_head_operation_id(&repo_path).unwrap()
    );

    // A mutation (a new commit) must advance the operation log, so the
    // marker a second client polls for changes even though it never
    // initiated the mutation itself.
    execute_local_request(TreqCommandRequest::CreateCommit {
      repo: repo_path.clone(),
      workspace: None,
      message: "test commit".into(),
      idempotency_key: "commit-1".into(),
    })
    .unwrap();

    let after = execute_local_request(TreqCommandRequest::WorkspaceChangeMarker {
      repo: repo_path.clone(),
      workspace: None,
    })
    .unwrap();
    let after: WorkspaceChangeMarker = serde_json::from_value(after).unwrap();

    assert_ne!(
      before.operation_id, after.operation_id,
      "operation id must change after a mutation so a foreign client can detect it"
    );
  }

  fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    format!(
      "{}-{}",
      std::process::id(),
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    )
  }

  // -- Retrying after network loss: classification and verification -----------

  #[test]
  fn reads_are_never_classified_as_mutations() {
    let reads = [
      TreqCommandRequest::InspectRepository { repo: "/r".into() },
      TreqCommandRequest::RepositoryStatus { repo: "/r".into() },
      TreqCommandRequest::ListBranches { repo: "/r".into() },
      TreqCommandRequest::ListWorkspaces { repo: "/r".into() },
      TreqCommandRequest::ListChanges {
        repo: "/r".into(),
        workspace: None,
      },
      TreqCommandRequest::ListCommits {
        repo: "/r".into(),
        workspace: None,
      },
      TreqCommandRequest::ListConflicts {
        repo: "/r".into(),
        workspace: None,
      },
      TreqCommandRequest::ProbeRepo { repo: "/r".into() },
      TreqCommandRequest::AgentStatus {
        repo: "/r".into(),
        workspace: "1".into(),
      },
    ];
    for request in reads {
      assert!(
        !request.is_mutation(),
        "expected a read-only request to not be classified as a mutation: {request:?}"
      );
    }
  }

  #[test]
  fn workspace_commit_conflict_git_and_agent_mutations_are_all_classified_as_mutations() {
    let mutations = [
      TreqCommandRequest::CreateWorkspace {
        repo: "/r".into(),
        branch_name: "b".into(),
        source_branch: None,
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::DeleteWorkspace {
        repo: "/r".into(),
        workspace: "1".into(),
      },
      TreqCommandRequest::RebaseWorkspace {
        repo: "/r".into(),
        workspace: "1".into(),
        target_branch: "main".into(),
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::CreateCommit {
        repo: "/r".into(),
        workspace: None,
        message: "m".into(),
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::AbandonCommit {
        repo: "/r".into(),
        workspace: "1".into(),
        commit: "c".into(),
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::ResolveConflict {
        repo: "/r".into(),
        revision: "c".into(),
        sides: vec![],
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::GitFetch { repo: "/r".into() },
      TreqCommandRequest::GitPush {
        repo: "/r".into(),
        workspace: None,
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::AgentStart {
        repo: "/r".into(),
        workspace: "1".into(),
        agent: "claude".into(),
        prompt: "p".into(),
        idempotency_key: "k".into(),
      },
      TreqCommandRequest::AgentStop {
        repo: "/r".into(),
        workspace: "1".into(),
      },
    ];
    for request in mutations {
      assert!(
        request.is_mutation(),
        "expected a mutating request to be classified as a mutation: {request:?}"
      );
    }
  }

  #[test]
  fn create_workspace_verification_detects_already_applied_and_not_applied() {
    let verification = verification_for(&TreqCommandRequest::CreateWorkspace {
      repo: "/r".into(),
      branch_name: "feature-x".into(),
      source_branch: None,
      idempotency_key: "key".into(),
    })
    .expect("CreateWorkspace has a verification recipe");
    assert!(matches!(
      verification.read_request,
      TreqCommandRequest::ListWorkspaces { .. }
    ));

    let applied = serde_json::json!([{ "id": 1, "branch_name": "feature-x" }]);
    assert_eq!(
      (verification.check)(&applied),
      MutationVerificationOutcome::AlreadyApplied
    );

    let not_applied = serde_json::json!([{ "id": 1, "branch_name": "some-other-branch" }]);
    assert_eq!(
      (verification.check)(&not_applied),
      MutationVerificationOutcome::NotApplied
    );

    let unexpected_shape = serde_json::json!({ "not": "an array" });
    assert_eq!(
      (verification.check)(&unexpected_shape),
      MutationVerificationOutcome::Ambiguous
    );
  }

  #[test]
  fn delete_workspace_verification_treats_absence_as_applied() {
    let verification = verification_for(&TreqCommandRequest::DeleteWorkspace {
      repo: "/r".into(),
      workspace: "42".into(),
    })
    .expect("DeleteWorkspace has a verification recipe");

    let still_present = serde_json::json!([{ "id": "42" }]);
    assert_eq!(
      (verification.check)(&still_present),
      MutationVerificationOutcome::NotApplied
    );

    let gone = serde_json::json!([{ "id": "7" }]);
    assert_eq!(
      (verification.check)(&gone),
      MutationVerificationOutcome::AlreadyApplied
    );
  }

  #[test]
  fn agent_start_verification_reads_the_running_flag() {
    let verification = verification_for(&TreqCommandRequest::AgentStart {
      repo: "/r".into(),
      workspace: "1".into(),
      agent: "claude".into(),
      prompt: "p".into(),
      idempotency_key: "k".into(),
    })
    .expect("AgentStart has a verification recipe");
    assert!(matches!(
      verification.read_request,
      TreqCommandRequest::AgentStatus { .. }
    ));

    assert_eq!(
      (verification.check)(&serde_json::json!({ "running": true })),
      MutationVerificationOutcome::AlreadyApplied
    );
    assert_eq!(
      (verification.check)(&serde_json::json!({ "running": false })),
      MutationVerificationOutcome::NotApplied
    );
    assert_eq!(
      (verification.check)(&serde_json::json!({})),
      MutationVerificationOutcome::Ambiguous
    );
  }

  #[test]
  fn restore_file_has_no_verification_recipe() {
    // Documented carve-out: rather than guess at a false-positive check, a
    // mutation with no reliable observable-state read falls back to
    // `MutationVerificationOutcome::Ambiguous` in `retry_after_reconnect`.
    let request = TreqCommandRequest::RestoreFile {
      repo: "/r".into(),
      workspace: None,
      path: "a.txt".into(),
    };
    assert!(verification_for(&request).is_none());
  }

  #[test]
  fn split_commit_rejects_empty_files_and_hunks() {
    let error = TreqCommandRequest::SplitCommit {
      repo: "/srv/project".into(),
      workspace: "1".into(),
      commit: "abc".into(),
      files: vec![],
      hunks: vec![],
      idempotency_key: "split-1".into(),
    }
    .cli_args()
    .unwrap_err();
    assert!(error.contains("files or hunks"));
  }

  #[test]
  fn split_commit_encodes_selected_files_and_hunks() {
    let args = TreqCommandRequest::SplitCommit {
      repo: "/srv/project".into(),
      workspace: "1".into(),
      commit: "abc".into(),
      files: vec!["a.rs".into()],
      hunks: vec![crate::core::workspaces::HunkSpec {
        file_path: "b.rs".into(),
        start_line: 2,
        end_line: 4,
      }],
      idempotency_key: "split-1".into(),
    }
    .cli_args()
    .unwrap();
    assert!(args.contains(&"commits".into()));
    assert!(args.contains(&"split".into()));
    assert!(args.contains(&"a.rs".into()));
    assert!(args.iter().any(|a| a.contains("b.rs:2-4")));
    assert!(args.contains(&"--idempotency-key".into()));
  }

  #[test]
  fn split_commit_execute_does_not_return_not_implemented() {
    let error = execute_local_request(TreqCommandRequest::SplitCommit {
      repo: "/does/not/exist".into(),
      workspace: "1".into(),
      commit: "abc".into(),
      files: vec!["a.rs".into()],
      hunks: vec![],
      idempotency_key: "split-exec".into(),
    })
    .unwrap_err();
    assert!(
      !error.contains("not_implemented"),
      "split must be a real typed mutation, got: {error}"
    );
  }

  #[test]
  fn describe_commit_does_not_require_an_idempotency_key() {
    let request = TreqCommandRequest::DescribeCommit {
      repo: "/r".into(),
      workspace: "1".into(),
      commit: "c".into(),
      message: "m".into(),
    };
    assert!(!request.requires_idempotency_key());
    assert!(request
      .cli_args()
      .unwrap()
      .iter()
      .all(|a| a != "--idempotency-key"));
  }

  #[test]
  fn create_commit_requires_a_non_empty_idempotency_key() {
    let request = TreqCommandRequest::CreateCommit {
      repo: "/r".into(),
      workspace: None,
      message: "m".into(),
      idempotency_key: " ".into(),
    };
    assert!(request.requires_idempotency_key());
    assert!(request
      .cli_args()
      .unwrap_err()
      .contains("idempotency key is required"));
  }

  #[test]
  fn kind_names_match_serde_kind_tags() {
    let sample = TreqCommandRequest::GitFetch { repo: "/r".into() };
    let value = serde_json::to_value(&sample).unwrap();
    assert_eq!(value["kind"], "GitFetch");
    assert!(TreqCommandRequest::KIND_NAMES.contains(&sample.kind_name()));
    assert_eq!(TreqCommandRequest::KIND_NAMES.len(), 36);
  }

  #[test]
  fn rejects_unknown_command_kind_at_json_boundary() {
    let parsed = serde_json::from_value::<TreqCommandRequest>(serde_json::json!({
      "kind": "RunArbitraryShell",
      "cmd": "rm -rf /"
    }));
    assert!(parsed.is_err());
  }
}
