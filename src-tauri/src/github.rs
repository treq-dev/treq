use std::path::Path;

#[derive(serde::Serialize, Clone)]
pub struct GitRemoteInfo {
  pub owner: String,
  pub repo: String,
  pub full_name: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PrInfo {
  pub number: u64,
  pub title: String,
  pub state: String,
  pub url: String,
  pub head_ref_name: String,
  pub base_ref_name: String,
  pub merge_state_status: Option<String>,
  #[serde(default)]
  pub is_draft: bool,
}

/// Parse owner/repo from a GitHub remote URL in SSH or HTTPS form.
/// Returns None if the URL is not a recognized GitHub remote.
pub fn parse_github_remote(url: &str) -> Option<GitRemoteInfo> {
  let url = url.trim();

  // SSH: git@github.com:owner/repo.git
  if let Some(rest) = url.strip_prefix("git@github.com:") {
    let path = rest.trim_end_matches(".git");
    let (owner, repo) = valid_repo_path(path)?;
    return Some(GitRemoteInfo {
      owner: owner.to_string(),
      repo: repo.to_string(),
      full_name: format!("{owner}/{repo}"),
    });
  }

  // HTTPS: https://github.com/owner/repo[.git]
  for prefix in &["https://github.com/", "http://github.com/"] {
    if let Some(rest) = url.strip_prefix(prefix) {
      let path = rest.trim_end_matches(".git");
      let (owner, repo) = valid_repo_path(path)?;
      return Some(GitRemoteInfo {
        owner: owner.to_string(),
        repo: repo.to_string(),
        full_name: format!("{owner}/{repo}"),
      });
    }
  }

  None
}

fn valid_repo_path(path: &str) -> Option<(&str, &str)> {
  let mut parts = path.split('/');
  let owner = parts.next()?;
  let repo = parts.next()?;
  if owner.is_empty() || repo.is_empty() || parts.next().is_some() {
    return None;
  }
  Some((owner, repo))
}

/// Read the GitHub remote URL from .git/config and parse owner/repo.
/// Returns None if no GitHub remote is found or the directory is not a git repo.
pub fn get_git_remote_url_impl(repo_path: &str) -> Result<Option<GitRemoteInfo>, String> {
  let dot_git = Path::new(repo_path).join(".git");
  let git_dir = if dot_git.is_dir() {
    dot_git
  } else if dot_git.is_file() {
    let pointer = std::fs::read_to_string(&dot_git).map_err(|e| e.to_string())?;
    let path = pointer
      .trim()
      .strip_prefix("gitdir:")
      .map(str::trim)
      .ok_or_else(|| "Malformed .git worktree pointer".to_string())?;
    let path = Path::new(path);
    if path.is_absolute() {
      path.to_path_buf()
    } else {
      Path::new(repo_path).join(path)
    }
  } else {
    return Ok(None);
  };
  let common_dir = git_dir.join("commondir");
  let config_dir = if common_dir.is_file() {
    let common = std::fs::read_to_string(common_dir).map_err(|e| e.to_string())?;
    git_dir.join(common.trim())
  } else if git_dir.join("config").is_file() {
    git_dir
  } else if git_dir
    .parent()
    .is_some_and(|parent| parent.file_name().is_some_and(|name| name == "worktrees"))
  {
    git_dir
      .parent()
      .and_then(Path::parent)
      .unwrap()
      .to_path_buf()
  } else {
    git_dir
  };
  let git_config_path = config_dir.join("config");
  if !git_config_path.exists() {
    return Ok(None);
  }

  let contents = std::fs::read_to_string(&git_config_path).map_err(|e| e.to_string())?;

  // Parse INI-style .git/config: find [remote "origin"] section and its url
  let mut in_origin_remote = false;
  for line in contents.lines() {
    let trimmed = line.trim();
    if trimmed.starts_with('[') {
      in_origin_remote = trimmed == r#"[remote "origin"]"#;
      continue;
    }
    if in_origin_remote {
      if let Some(rest) = trimmed.strip_prefix("url") {
        let rest = rest.trim_start();
        if let Some(url) = rest.strip_prefix('=') {
          if let Some(info) = parse_github_remote(url.trim()) {
            return Ok(Some(info));
          }
        }
      }
    }
  }

  Ok(None)
}

// ── GitHub Issues / PRs ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct GhLabel {
  pub name: String,
  pub color: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct GhAuthor {
  pub login: String,
  #[serde(default)]
  pub avatar_url: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct GhIssueComment {
  pub id: String,
  pub body: String,
  pub author: GhAuthor,
  pub created_at: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct GhIssue {
  pub number: u64,
  pub title: String,
  pub state: String,
  pub url: String,
  pub body: Option<String>,
  pub author: GhAuthor,
  pub labels: Vec<GhLabel>,
  pub created_at: String,
  pub updated_at: String,
  pub comments: Option<Vec<GhIssueComment>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct GhPullRequest {
  pub number: u64,
  pub title: String,
  pub state: String,
  pub url: String,
  pub body: Option<String>,
  pub author: GhAuthor,
  pub labels: Vec<GhLabel>,
  pub head_ref_name: String,
  pub base_ref_name: String,
  pub merge_state_status: Option<String>,
  pub created_at: String,
  pub updated_at: String,
  pub comments: Option<Vec<GhIssueComment>>,
  #[serde(default)]
  pub is_draft: bool,
}

/// ETXTBSY: the target binary is momentarily open for writing elsewhere (e.g.
/// another test process still finalizing a freshly-written fake `gh` script
/// under heavy parallelism). The exec never started in this case, so retrying
/// is always safe -- including for mutating `gh` subcommands.
const ETXTBSY: i32 = 26;

fn spawn_with_etxtbsy_retry(
  mut cmd: std::process::Command,
) -> Result<std::process::Output, String> {
  let mut attempt = 0;
  loop {
    match cmd.output() {
      Ok(output) => return Ok(output),
      Err(e) if e.raw_os_error() == Some(ETXTBSY) && attempt < 5 => {
        attempt += 1;
        std::thread::sleep(std::time::Duration::from_millis(20 * attempt as u64));
      }
      Err(e) => return Err(e.to_string()),
    }
  }
}

fn run_gh(
  gh_path: &str,
  args: &[&str],
  extended_path: &str,
) -> Result<std::process::Output, String> {
  let mut cmd = std::process::Command::new(gh_path);
  cmd.args(args).env("PATH", extended_path);
  spawn_with_etxtbsy_retry(cmd)
}

fn check_gh_output(output: std::process::Output) -> Result<Vec<u8>, String> {
  if output.status.success() {
    Ok(output.stdout)
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("gh exited with error: {stderr}"))
  }
}

fn parse_number_from_url(url: &str) -> Option<u64> {
  url.trim().rsplit('/').next()?.parse().ok()
}

pub const GH_LIST_PAGE_SIZE: u32 = 30;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GhListPage<T> {
  pub items: Vec<T>,
  pub has_more: bool,
}

/// Given items fetched with `--limit (limit * page)`, return the requested page slice.
pub fn take_list_page<T>(fetched: Vec<T>, limit: u32, page: u32) -> GhListPage<T> {
  let limit = limit.max(1) as usize;
  let page = page.max(1) as usize;
  let has_more = fetched.len() == limit * page;
  let start = (page - 1) * limit;
  let items = if start >= fetched.len() {
    Vec::new()
  } else {
    fetched.into_iter().skip(start).take(limit).collect()
  };
  GhListPage { items, has_more }
}

pub fn gh_list_issues_impl(
  gh_path: &str,
  repo_full_name: &str,
  state: &str,
  limit: u32,
  page: u32,
  extended_path: &str,
) -> Result<GhListPage<GhIssue>, String> {
  let limit = limit.max(1);
  let page = page.max(1);
  let fetch_limit = (limit * page).to_string();
  let out = run_gh(
    gh_path,
    &[
      "issue",
      "list",
      "--repo",
      repo_full_name,
      "--state",
      state,
      "--json",
      "number,title,state,url,author,labels,createdAt,updatedAt",
      "--limit",
      &fetch_limit,
    ],
    extended_path,
  )?;
  let bytes = check_gh_output(out)?;
  let fetched: Vec<GhIssue> =
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse gh output: {e}"))?;
  Ok(take_list_page(fetched, limit, page))
}

pub fn gh_view_issue_impl(
  gh_path: &str,
  repo_full_name: &str,
  issue_number: u64,
  extended_path: &str,
) -> Result<GhIssue, String> {
  let num = issue_number.to_string();
  let out = run_gh(
    gh_path,
    &[
      "issue",
      "view",
      &num,
      "--repo",
      repo_full_name,
      "--json",
      "number,title,state,url,body,author,labels,createdAt,updatedAt,comments",
    ],
    extended_path,
  )?;
  let bytes = check_gh_output(out)?;
  serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse gh output: {e}"))
}

pub fn gh_create_issue_impl(
  gh_path: &str,
  repo_full_name: &str,
  title: &str,
  body: &str,
  extended_path: &str,
) -> Result<u64, String> {
  let out = run_gh(
    gh_path,
    &[
      "issue",
      "create",
      "--repo",
      repo_full_name,
      "--title",
      title,
      "--body",
      body,
    ],
    extended_path,
  )?;
  let bytes = check_gh_output(out)?;
  let text = String::from_utf8_lossy(&bytes);
  for line in text.lines() {
    if let Some(n) = parse_number_from_url(line) {
      return Ok(n);
    }
  }
  Err(format!("Could not parse issue number from output: {text}"))
}

pub fn gh_create_issue_comment_impl(
  gh_path: &str,
  repo_full_name: &str,
  issue_number: u64,
  body: &str,
  extended_path: &str,
) -> Result<(), String> {
  let num = issue_number.to_string();
  let out = run_gh(
    gh_path,
    &[
      "issue",
      "comment",
      &num,
      "--repo",
      repo_full_name,
      "--body",
      body,
    ],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

pub fn gh_close_issue_impl(
  gh_path: &str,
  repo_full_name: &str,
  issue_number: u64,
  extended_path: &str,
) -> Result<(), String> {
  let num = issue_number.to_string();
  let out = run_gh(
    gh_path,
    &["issue", "close", &num, "--repo", repo_full_name],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

pub fn gh_reopen_issue_impl(
  gh_path: &str,
  repo_full_name: &str,
  issue_number: u64,
  extended_path: &str,
) -> Result<(), String> {
  let num = issue_number.to_string();
  let out = run_gh(
    gh_path,
    &["issue", "reopen", &num, "--repo", repo_full_name],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

pub fn gh_list_prs_impl(
  gh_path: &str,
  repo_full_name: &str,
  state: &str,
  limit: u32,
  page: u32,
  extended_path: &str,
) -> Result<GhListPage<GhPullRequest>, String> {
  let limit = limit.max(1);
  let page = page.max(1);
  let fetch_limit = (limit * page).to_string();
  let is_draft = state == "draft";
  let gh_state = if is_draft { "open" } else { state };
  let mut args = vec!["pr", "list", "--repo", repo_full_name, "--state", gh_state];
  if is_draft {
    args.push("--draft");
  }
  args.extend([
    "--json",
    "number,title,state,url,author,labels,headRefName,baseRefName,createdAt,updatedAt,isDraft",
    "--limit",
    fetch_limit.as_str(),
  ]);
  let out = run_gh(gh_path, &args, extended_path)?;
  let bytes = check_gh_output(out)?;
  let fetched: Vec<GhPullRequest> =
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse gh output: {e}"))?;
  Ok(take_list_page(fetched, limit, page))
}

pub fn gh_view_pr_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  extended_path: &str,
) -> Result<GhPullRequest, String> {
  let num = pr_number.to_string();
  let out = run_gh(
        gh_path,
        &[
            "pr",
            "view",
            &num,
            "--repo",
            repo_full_name,
            "--json",
            "number,title,state,url,body,author,labels,headRefName,baseRefName,mergeStateStatus,createdAt,updatedAt,comments,isDraft",
        ],
        extended_path,
    )?;
  let bytes = check_gh_output(out)?;
  serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse gh output: {e}"))
}

pub fn gh_create_pr_comment_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  body: &str,
  extended_path: &str,
) -> Result<(), String> {
  let num = pr_number.to_string();
  let out = run_gh(
    gh_path,
    &[
      "pr",
      "comment",
      &num,
      "--repo",
      repo_full_name,
      "--body",
      body,
    ],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

pub fn gh_close_pr_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  extended_path: &str,
) -> Result<(), String> {
  let num = pr_number.to_string();
  let out = run_gh(
    gh_path,
    &["pr", "close", &num, "--repo", repo_full_name],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

pub fn gh_reopen_pr_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  extended_path: &str,
) -> Result<(), String> {
  let num = pr_number.to_string();
  let out = run_gh(
    gh_path,
    &["pr", "reopen", &num, "--repo", repo_full_name],
    extended_path,
  )?;
  check_gh_output(out).map(|_| ())
}

/// Mark a PR ready for review (`draft = false`) or convert it to draft (`draft = true`).
pub fn gh_set_pr_draft_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  draft: bool,
  extended_path: &str,
) -> Result<(), String> {
  let num = pr_number.to_string();
  let mut args = vec!["pr", "ready", num.as_str(), "--repo", repo_full_name];
  if draft {
    args.push("--undo");
  }
  let out = run_gh(gh_path, &args, extended_path)?;
  check_gh_output(out).map(|_| ())
}

#[allow(clippy::too_many_arguments)]
pub fn gh_create_pr_impl(
  gh_path: &str,
  repo_full_name: &str,
  title: &str,
  body: &str,
  base_branch: &str,
  head_branch: &str,
  draft: bool,
  extended_path: &str,
) -> Result<u64, String> {
  let mut args = vec![
    "pr",
    "create",
    "--repo",
    repo_full_name,
    "--title",
    title,
    "--body",
    body,
    "--base",
    base_branch,
    "--head",
    head_branch,
  ];
  if draft {
    args.push("--draft");
  }
  let out = run_gh(gh_path, &args, extended_path)?;
  let bytes = check_gh_output(out)?;
  let text = String::from_utf8_lossy(&bytes);
  for line in text.lines() {
    if let Some(n) = parse_number_from_url(line) {
      return Ok(n);
    }
  }
  Err(format!("Could not parse PR number from output: {text}"))
}

const CHECK_JSON_FIELDS: &str = "name,bucket,link,startedAt,completedAt";

/// Compute elapsed seconds for a check run from `gh pr checks` timestamps.
/// Pending runs (no completedAt) measure against `now`. Inverted timestamps
/// (seen on some skipped checks) clamp to zero.
fn check_duration_secs(
  started_at: Option<&str>,
  completed_at: Option<&str>,
  now: chrono::DateTime<chrono::Utc>,
) -> Option<u64> {
  let started = chrono::DateTime::parse_from_rfc3339(started_at?)
    .ok()?
    .with_timezone(&chrono::Utc);
  let end = match completed_at {
    Some(raw) => chrono::DateTime::parse_from_rfc3339(raw)
      .ok()?
      .with_timezone(&chrono::Utc),
    None => now,
  };
  Some(end.signed_duration_since(started).num_seconds().max(0) as u64)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PrCheckEntry {
  pub name: String,
  /// "pass" | "fail" | "pending" | "skipping" | "cancel"
  pub bucket: String,
  pub link: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub duration_secs: Option<u64>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PrCiStatus {
  /// "success" | "failure" | "pending"
  pub state: String,
  pub total: u32,
  pub passed: u32,
  pub failed: u32,
  pub pending: u32,
  pub checks: Vec<PrCheckEntry>,
}

#[derive(serde::Deserialize)]
struct GhCheck {
  name: String,
  bucket: String,
  link: String,
  #[serde(default, rename = "startedAt")]
  started_at: Option<String>,
  #[serde(default, rename = "completedAt")]
  completed_at: Option<String>,
}

/// Rolls a `gh pr checks --json name,bucket,link,startedAt,completedAt` result
/// up into an overall CI status. Shared by every entry point that surfaces PR
/// CI status (the workspace header's live indicator and the GitHub panel's PR
/// detail view), so they always agree on pass/fail/pending grouping.
fn rollup_pr_checks(raw: Vec<GhCheck>) -> Option<PrCiStatus> {
  if raw.is_empty() {
    return None;
  }

  let now = chrono::Utc::now();
  let mut passed = 0u32;
  let mut failed = 0u32;
  let mut pending = 0u32;
  let checks: Vec<PrCheckEntry> = raw
    .into_iter()
    .map(|c| {
      match c.bucket.as_str() {
        "pass" | "skipping" => passed += 1,
        "fail" | "cancel" => failed += 1,
        _ => pending += 1,
      }
      let duration_secs =
        check_duration_secs(c.started_at.as_deref(), c.completed_at.as_deref(), now);
      PrCheckEntry {
        name: c.name,
        bucket: c.bucket,
        link: c.link,
        duration_secs,
      }
    })
    .collect();

  let state = if failed > 0 {
    "failure"
  } else if pending > 0 {
    "pending"
  } else {
    "success"
  }
  .to_string();

  Some(PrCiStatus {
    state,
    total: checks.len() as u32,
    passed,
    failed,
    pending,
    checks,
  })
}

/// Run `gh pr checks` for the given branch in the given repo directory and
/// roll the individual check runs up into an overall CI status.
/// Returns None if gh is not installed, not authenticated, there is no PR,
/// or the PR has no checks reported yet.
pub fn get_pr_checks_via_gh_impl(
  gh_path: &str,
  repo_path: &str,
  branch_name: &str,
  extended_path: &str,
) -> Result<Option<PrCiStatus>, String> {
  let mut cmd = std::process::Command::new(gh_path);
  cmd
    .args(["pr", "checks", branch_name, "--json", CHECK_JSON_FIELDS])
    .current_dir(repo_path)
    .env("PATH", extended_path);
  let output = spawn_with_etxtbsy_retry(cmd)?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("no pull requests found") || lower.contains("no checks reported") {
      return Ok(None);
    }
    return Err(format!("gh pr checks failed: {}", stderr.trim()));
  }

  let raw: Vec<GhCheck> = serde_json::from_slice(&output.stdout)
    .map_err(|e| format!("Failed to parse gh output: {e}"))?;

  Ok(rollup_pr_checks(raw))
}

/// Run `gh pr checks` for a specific PR number in a repo (identified by
/// `owner/repo`, not a local checkout), for callers -- like the GitHub
/// panel's PR detail view -- that browse PRs without necessarily having a
/// local workspace on that branch. Shares the same rollup as
/// `get_pr_checks_via_gh_impl` so both surfaces always report the same
/// pass/fail/pending grouping for a given PR.
pub fn get_pr_checks_for_pr_impl(
  gh_path: &str,
  repo_full_name: &str,
  pr_number: u64,
  extended_path: &str,
) -> Result<Option<PrCiStatus>, String> {
  let num = pr_number.to_string();
  let out = run_gh(
    gh_path,
    &[
      "pr",
      "checks",
      &num,
      "--repo",
      repo_full_name,
      "--json",
      CHECK_JSON_FIELDS,
    ],
    extended_path,
  )?;

  if !out.status.success() {
    let stderr = String::from_utf8_lossy(&out.stderr);
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("no pull requests found") || lower.contains("no checks reported") {
      return Ok(None);
    }
    return Err(format!("gh pr checks failed: {}", stderr.trim()));
  }

  let raw: Vec<GhCheck> =
    serde_json::from_slice(&out.stdout).map_err(|e| format!("Failed to parse gh output: {e}"))?;

  Ok(rollup_pr_checks(raw))
}

/// Run `gh pr view` for the given branch in the given repo directory.
/// Returns None if gh is not installed, not authenticated, or no PR exists.
/// The `gh_path` argument is the resolved path to the gh binary.
pub fn get_pr_info_via_gh_impl(
  gh_path: &str,
  repo_path: &str,
  branch_name: &str,
  extended_path: &str,
) -> Result<Option<PrInfo>, String> {
  #[derive(serde::Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct GhPrView {
    number: u64,
    title: String,
    state: String,
    url: String,
    head_ref_name: String,
    base_ref_name: String,
    merge_state_status: Option<String>,
    #[serde(default)]
    is_draft: bool,
  }

  let mut cmd = std::process::Command::new(gh_path);
  cmd
    .args([
      "pr",
      "view",
      branch_name,
      "--json",
      "number,title,state,url,headRefName,baseRefName,mergeStateStatus,isDraft",
    ])
    .current_dir(repo_path)
    .env("PATH", extended_path);
  let output = spawn_with_etxtbsy_retry(cmd)?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr
      .to_ascii_lowercase()
      .contains("no pull requests found")
    {
      return Ok(None);
    }
    return Err(format!("gh pr view failed: {}", stderr.trim()));
  }

  let raw: GhPrView = serde_json::from_slice(&output.stdout)
    .map_err(|e| format!("Failed to parse gh output: {e}"))?;

  Ok(Some(PrInfo {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    url: raw.url,
    head_ref_name: raw.head_ref_name,
    base_ref_name: raw.base_ref_name,
    merge_state_status: raw.merge_state_status,
    is_draft: raw.is_draft,
  }))
}

// ── GitHub PR review comment threads (read-only) ────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct GhReviewComment {
  pub id: String,
  pub body: String,
  pub author: GhAuthor,
  pub created_at: String,
  pub diff_hunk: String,
  pub url: String,
}

#[derive(serde::Serialize, Clone)]
pub struct GhReviewThread {
  pub id: String,
  pub is_resolved: bool,
  pub is_outdated: bool,
  pub path: String,
  pub line: Option<i64>,
  pub diff_side: String,
  pub comments: Vec<GhReviewComment>,
}

const REVIEW_THREADS_QUERY: &str = r#"query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              url
              diffHunk
              author { login avatarUrl }
            }
          }
        }
      }
    }
  }
}"#;

/// Maximum pages of review threads to fetch (50 threads/page) -- generous for
/// any real PR while bounding worst-case `gh` invocations.
const MAX_REVIEW_THREAD_PAGES: usize = 10;

#[derive(serde::Deserialize)]
struct GqlResponse {
  data: Option<GqlData>,
}

#[derive(serde::Deserialize)]
struct GqlData {
  repository: Option<GqlRepository>,
}

#[derive(serde::Deserialize)]
struct GqlRepository {
  #[serde(rename = "pullRequest")]
  pull_request: Option<GqlPullRequest>,
}

#[derive(serde::Deserialize)]
struct GqlPullRequest {
  #[serde(rename = "reviewThreads")]
  review_threads: GqlReviewThreadsConnection,
}

#[derive(serde::Deserialize)]
struct GqlReviewThreadsConnection {
  #[serde(rename = "pageInfo")]
  page_info: GqlPageInfo,
  nodes: Vec<GqlReviewThread>,
}

#[derive(serde::Deserialize)]
struct GqlPageInfo {
  #[serde(rename = "hasNextPage")]
  has_next_page: bool,
  #[serde(rename = "endCursor")]
  end_cursor: Option<String>,
}

#[derive(serde::Deserialize)]
struct GqlReviewThread {
  id: String,
  #[serde(rename = "isResolved")]
  is_resolved: bool,
  #[serde(rename = "isOutdated")]
  is_outdated: bool,
  path: String,
  line: Option<i64>,
  #[serde(rename = "diffSide")]
  diff_side: String,
  comments: GqlCommentsConnection,
}

#[derive(serde::Deserialize)]
struct GqlCommentsConnection {
  nodes: Vec<GqlComment>,
}

#[derive(serde::Deserialize)]
struct GqlComment {
  id: String,
  body: String,
  #[serde(rename = "createdAt")]
  created_at: String,
  url: String,
  #[serde(rename = "diffHunk")]
  diff_hunk: String,
  author: Option<GqlAuthor>,
}

#[derive(serde::Deserialize)]
struct GqlAuthor {
  login: String,
  #[serde(rename = "avatarUrl")]
  avatar_url: Option<String>,
}

/// Fetch every review-comment thread (with resolved/outdated state) on a PR via
/// `gh api graphql`, the only way to get thread-grouped comments with a
/// `isResolved` flag -- the REST/`gh pr view` helpers above don't expose it.
/// Read-only: no mutations are issued.
pub fn gh_list_pr_review_threads_impl(
  gh_path: &str,
  owner: &str,
  repo: &str,
  pr_number: u64,
  extended_path: &str,
) -> Result<Vec<GhReviewThread>, String> {
  let number = pr_number.to_string();
  let mut threads: Vec<GhReviewThread> = Vec::new();
  let mut after: Option<String> = None;

  for _ in 0..MAX_REVIEW_THREAD_PAGES {
    let query_arg = format!("query={REVIEW_THREADS_QUERY}");
    let owner_arg = format!("owner={owner}");
    let repo_arg = format!("repo={repo}");
    let number_arg = format!("number={number}");
    let after_arg = after.as_ref().map(|cursor| format!("after={cursor}"));

    let mut args: Vec<&str> = vec![
      "api",
      "graphql",
      "-f",
      &query_arg,
      "-f",
      &owner_arg,
      "-f",
      &repo_arg,
      "-F",
      &number_arg,
    ];
    if let Some(after_arg) = &after_arg {
      args.push("-f");
      args.push(after_arg);
    }

    let out = run_gh(gh_path, &args, extended_path)?;
    let bytes = check_gh_output(out)?;
    let parsed: GqlResponse = serde_json::from_slice(&bytes)
      .map_err(|e| format!("Failed to parse gh graphql output: {e}"))?;

    let connection = parsed
      .data
      .and_then(|d| d.repository)
      .and_then(|r| r.pull_request)
      .map(|pr| pr.review_threads);

    let Some(connection) = connection else {
      break;
    };

    for node in connection.nodes {
      threads.push(GhReviewThread {
        id: node.id,
        is_resolved: node.is_resolved,
        is_outdated: node.is_outdated,
        path: node.path,
        line: node.line,
        diff_side: node.diff_side,
        comments: node
          .comments
          .nodes
          .into_iter()
          .map(|c| GhReviewComment {
            id: c.id,
            body: c.body,
            author: c
              .author
              .map(|a| GhAuthor {
                login: a.login,
                avatar_url: a.avatar_url,
              })
              .unwrap_or_else(|| GhAuthor {
                login: "ghost".to_string(),
                avatar_url: None,
              }),
            created_at: c.created_at,
            diff_hunk: c.diff_hunk,
            url: c.url,
          })
          .collect(),
      });
    }

    if !connection.page_info.has_next_page {
      break;
    }
    after = connection.page_info.end_cursor;
    if after.is_none() {
      break;
    }
  }

  Ok(threads)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::io::Write;
  use tempfile::TempDir;

  // ── parse_github_remote ──────────────────────────────────────────────────

  #[test]
  fn test_parse_ssh_url() {
    let info = parse_github_remote("git@github.com:owner/repo.git").unwrap();
    assert_eq!(info.owner, "owner");
    assert_eq!(info.repo, "repo");
    assert_eq!(info.full_name, "owner/repo");
  }

  #[test]
  fn test_parse_https_url() {
    let info = parse_github_remote("https://github.com/owner/repo.git").unwrap();
    assert_eq!(info.owner, "owner");
    assert_eq!(info.repo, "repo");
    assert_eq!(info.full_name, "owner/repo");
  }

  #[test]
  fn test_parse_https_url_no_dot_git() {
    let info = parse_github_remote("https://github.com/owner/repo").unwrap();
    assert_eq!(info.full_name, "owner/repo");
  }

  #[test]
  fn test_parse_non_github_url_returns_none() {
    assert!(parse_github_remote("https://gitlab.com/owner/repo.git").is_none());
  }

  #[test]
  fn test_parse_invalid_url_returns_none() {
    assert!(parse_github_remote("not-a-url").is_none());
  }

  #[test]
  fn rejects_malformed_github_remote_paths() {
    for url in [
      "https://github.com/owner",
      "https://github.com/owner/",
      "https://github.com//repo.git",
      "https://github.com/owner/repo/extra",
      "git@github.com:owner/repo/extra.git",
    ] {
      assert!(parse_github_remote(url).is_none(), "accepted {url}");
    }
  }

  #[test]
  fn test_parse_trims_whitespace() {
    let info = parse_github_remote("  git@github.com:owner/repo.git  ").unwrap();
    assert_eq!(info.full_name, "owner/repo");
  }

  // ── get_git_remote_url_impl ──────────────────────────────────────────────

  fn write_git_config(dir: &TempDir, content: &str) {
    let git_dir = dir.path().join(".git");
    fs::create_dir_all(&git_dir).unwrap();
    fs::write(git_dir.join("config"), content).unwrap();
  }

  #[test]
  fn test_get_git_remote_url_parses_ssh_origin() {
    let dir = TempDir::new().unwrap();
    write_git_config(
      &dir,
      r#"[core]
    repositoryformatversion = 0
[remote "origin"]
    url = git@github.com:ziinc/treq.git
    fetch = +refs/heads/*:refs/remotes/origin/*
"#,
    );
    let info = get_git_remote_url_impl(dir.path().to_str().unwrap())
      .unwrap()
      .unwrap();
    assert_eq!(info.owner, "ziinc");
    assert_eq!(info.repo, "treq");
    assert_eq!(info.full_name, "ziinc/treq");
  }

  #[test]
  fn test_get_git_remote_url_parses_https_origin() {
    let dir = TempDir::new().unwrap();
    write_git_config(
      &dir,
      r#"[remote "origin"]
    url = https://github.com/ziinc/treq.git
"#,
    );
    let info = get_git_remote_url_impl(dir.path().to_str().unwrap())
      .unwrap()
      .unwrap();
    assert_eq!(info.full_name, "ziinc/treq");
  }

  #[test]
  fn test_get_git_remote_url_non_github_remote_returns_none() {
    let dir = TempDir::new().unwrap();
    write_git_config(
      &dir,
      r#"[remote "origin"]
    url = https://gitlab.com/owner/repo.git
"#,
    );
    let result = get_git_remote_url_impl(dir.path().to_str().unwrap()).unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_get_git_remote_url_missing_git_dir_returns_none() {
    let dir = TempDir::new().unwrap();
    let result = get_git_remote_url_impl(dir.path().to_str().unwrap()).unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_get_git_remote_url_ignores_non_origin_remotes() {
    let dir = TempDir::new().unwrap();
    write_git_config(
      &dir,
      r#"[remote "upstream"]
    url = git@github.com:owner/repo.git
"#,
    );
    let result = get_git_remote_url_impl(dir.path().to_str().unwrap()).unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn reads_origin_from_git_worktree_common_config() {
    let dir = TempDir::new().unwrap();
    let common = dir.path().join("repo/.git");
    let worktree = dir.path().join("repo/.git/worktrees/feature");
    let checkout = dir.path().join("feature");
    fs::create_dir_all(&worktree).unwrap();
    fs::create_dir_all(&checkout).unwrap();
    fs::write(
      common.join("config"),
      "[remote \"origin\"]\n url = https://github.com/owner/repo.git\n",
    )
    .unwrap();
    fs::write(
      checkout.join(".git"),
      format!("gitdir: {}\n", worktree.display()),
    )
    .unwrap();

    let info = get_git_remote_url_impl(checkout.to_str().unwrap())
      .unwrap()
      .unwrap();
    assert_eq!(info.full_name, "owner/repo");
  }

  // ── get_pr_info_via_gh_impl ──────────────────────────────────────────────

  #[cfg(unix)]
  fn write_fake_gh(dir: &TempDir, script_body: &str) -> String {
    let path = dir.path().join("gh");
    let mut f = fs::File::create(&path).unwrap();
    writeln!(f, "#!/bin/sh").unwrap();
    write!(f, "{script_body}").unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path.to_str().unwrap().to_string()
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_info_via_gh_returns_parsed_pr() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '{"number":42,"title":"My PR","state":"OPEN","url":"https://github.com/o/r/pull/42","headRefName":"feat","baseRefName":"main","mergeStateStatus":"CLEAN","isDraft":false}'"#,
    );

    let info = get_pr_info_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();

    assert_eq!(info.number, 42);
    assert_eq!(info.title, "My PR");
    assert_eq!(info.state, "OPEN");
    assert_eq!(info.head_ref_name, "feat");
    assert_eq!(info.base_ref_name, "main");
    assert_eq!(info.merge_state_status.as_deref(), Some("CLEAN"));
    assert!(!info.is_draft);
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_info_parses_draft_flag() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '{"number":7,"title":"Draft","state":"OPEN","url":"https://github.com/o/r/pull/7","headRefName":"feat","baseRefName":"main","mergeStateStatus":null,"isDraft":true}'"#,
    );

    let info = get_pr_info_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();
    assert!(info.is_draft);
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_info_invokes_gh_with_exact_arguments_and_working_directory() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let expected_dir = repo_dir.path().canonicalize().unwrap();
    let expected_dir = expected_dir.display();
    let script = format!(
      r#"test "$PWD" = "{expected_dir}" || exit 8
test "$*" = "pr view feat --json number,title,state,url,headRefName,baseRefName,mergeStateStatus,isDraft" || exit 9
echo '{{"number":42,"title":"My PR","state":"OPEN","url":"https://github.com/o/r/pull/42","headRefName":"feat","baseRefName":"main","mergeStateStatus":null,"isDraft":false}}'"#,
    );
    let gh_path = write_fake_gh(&bin_dir, &script);

    let result = get_pr_info_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    );

    assert!(result.unwrap().is_some());
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_info_via_gh_operational_error_is_returned() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(&bin_dir, "echo 'authentication required' >&2\nexit 1");

    let result = get_pr_info_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    );
    let error = match result {
      Err(error) => error,
      Ok(_) => panic!("operational gh failure was treated as no PR"),
    };

    assert!(error.contains("authentication required"));
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_info_via_gh_no_pr_state_returns_none() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    // gh exits 1 with a "no pull requests found" message on stderr
    let gh_path = write_fake_gh(&bin_dir, "echo 'no pull requests found' >&2\nexit 1");

    let result = get_pr_info_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "unknown-branch",
      "/usr/bin:/bin",
    )
    .unwrap();

    assert!(result.is_none());
  }

  #[test]
  #[cfg(unix)]
  fn gh_create_pr_passes_draft_flag_when_requested() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr create --repo owner/repo --title T --body B --base main --head feat --draft" || exit 9
echo 'https://github.com/owner/repo/pull/7'"#,
    );

    let number = gh_create_pr_impl(
      &gh_path,
      "owner/repo",
      "T",
      "B",
      "main",
      "feat",
      true,
      "/usr/bin:/bin",
    )
    .unwrap();
    assert_eq!(number, 7);
  }

  #[test]
  #[cfg(unix)]
  fn gh_create_pr_omits_draft_flag_when_not_requested() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr create --repo owner/repo --title T --body B --base main --head feat" || exit 9
echo 'https://github.com/owner/repo/pull/8'"#,
    );

    let number = gh_create_pr_impl(
      &gh_path,
      "owner/repo",
      "T",
      "B",
      "main",
      "feat",
      false,
      "/usr/bin:/bin",
    )
    .unwrap();
    assert_eq!(number, 8);
  }

  #[test]
  #[cfg(unix)]
  fn gh_set_pr_draft_marks_ready_without_undo() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr ready 9 --repo owner/repo" || exit 9
echo ok"#,
    );
    gh_set_pr_draft_impl(&gh_path, "owner/repo", 9, false, "/usr/bin:/bin").unwrap();
  }

  #[test]
  #[cfg(unix)]
  fn gh_set_pr_draft_converts_to_draft_with_undo() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr ready 9 --repo owner/repo --undo" || exit 9
echo ok"#,
    );
    gh_set_pr_draft_impl(&gh_path, "owner/repo", 9, true, "/usr/bin:/bin").unwrap();
  }

  #[test]
  #[cfg(unix)]
  fn gh_list_prs_passes_draft_flag_when_state_is_draft() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr list --repo owner/repo --state open --draft --json number,title,state,url,author,labels,headRefName,baseRefName,createdAt,updatedAt,isDraft --limit 30" || exit 9
echo '[]'"#,
    );
    let page = gh_list_prs_impl(&gh_path, "owner/repo", "draft", 30, 1, "/usr/bin:/bin").unwrap();
    assert!(page.items.is_empty());
    assert!(!page.has_more);
  }

  // ── check duration ───────────────────────────────────────────────────────

  #[test]
  fn check_duration_secs_from_completed_run() {
    let secs = check_duration_secs(
      Some("2026-08-08T22:00:00Z"),
      Some("2026-08-08T22:05:56Z"),
      chrono::DateTime::parse_from_rfc3339("2026-08-08T23:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc),
    );
    assert_eq!(secs, Some(5 * 60 + 56));
  }

  #[test]
  fn check_duration_secs_uses_now_when_still_running() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-08-08T22:01:30Z")
      .unwrap()
      .with_timezone(&chrono::Utc);
    let secs = check_duration_secs(Some("2026-08-08T22:00:00Z"), None, now);
    assert_eq!(secs, Some(90));
  }

  #[test]
  fn check_duration_secs_clamps_inverted_timestamps() {
    // Skipped checks sometimes report startedAt after completedAt.
    let secs = check_duration_secs(
      Some("2026-08-08T22:02:45Z"),
      Some("2026-08-08T22:02:35Z"),
      chrono::Utc::now(),
    );
    assert_eq!(secs, Some(0));
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_includes_duration_from_timestamps() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '[{"name":"build","bucket":"pass","link":"https://x/1","startedAt":"2026-08-08T22:00:00Z","completedAt":"2026-08-08T22:05:56Z"}]'"#,
    );

    let status = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.checks[0].duration_secs, Some(5 * 60 + 56));
  }

  // ── get_pr_checks_via_gh_impl ────────────────────────────────────────────

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_all_passing_reports_success() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '[{"name":"build","bucket":"pass","link":"https://x/1"},{"name":"lint","bucket":"skipping","link":"https://x/2"}]'"#,
    );

    let status = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.state, "success");
    assert_eq!(status.total, 2);
    assert_eq!(status.passed, 2);
    assert_eq!(status.failed, 0);
    assert_eq!(status.pending, 0);
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_any_failure_reports_failure() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '[{"name":"build","bucket":"pass","link":"https://x/1"},{"name":"test","bucket":"fail","link":"https://x/2"},{"name":"lint","bucket":"pending","link":"https://x/3"}]'"#,
    );

    let status = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.state, "failure");
    assert_eq!(status.total, 3);
    assert_eq!(status.passed, 1);
    assert_eq!(status.failed, 1);
    assert_eq!(status.pending, 1);
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_pending_without_failure_reports_pending() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '[{"name":"build","bucket":"pass","link":"https://x/1"},{"name":"test","bucket":"pending","link":"https://x/2"}]'"#,
    );

    let status = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap()
    .unwrap();

    assert_eq!(status.state, "pending");
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_no_checks_reported_returns_none() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      "echo 'no checks reported on the feat branch' >&2\nexit 1",
    );

    let result = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    )
    .unwrap();

    assert!(result.is_none());
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_no_pr_returns_none() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(&bin_dir, "echo 'no pull requests found' >&2\nexit 1");

    let result = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "unknown-branch",
      "/usr/bin:/bin",
    )
    .unwrap();

    assert!(result.is_none());
  }

  #[test]
  #[cfg(unix)]
  fn test_get_pr_checks_operational_error_is_returned() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(&bin_dir, "echo 'authentication required' >&2\nexit 1");

    let result = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    );
    let error = match result {
      Err(error) => error,
      Ok(_) => panic!("operational gh failure was treated as no checks"),
    };
    assert!(error.contains("authentication required"));
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_invokes_gh_with_exact_arguments_and_working_directory() {
    let bin_dir = TempDir::new().unwrap();
    let repo_dir = TempDir::new().unwrap();
    let expected_dir = repo_dir.path().canonicalize().unwrap();
    let expected_dir = expected_dir.display();
    let script = format!(
      r#"test "$PWD" = "{expected_dir}" || exit 8
test "$*" = "pr checks feat --json name,bucket,link,startedAt,completedAt" || exit 9
echo '[{{"name":"build","bucket":"pass","link":"https://x/1"}}]'"#,
    );
    let gh_path = write_fake_gh(&bin_dir, &script);

    let result = get_pr_checks_via_gh_impl(
      &gh_path,
      repo_dir.path().to_str().unwrap(),
      "feat",
      "/usr/bin:/bin",
    );

    assert!(result.unwrap().is_some());
  }

  // ── get_pr_checks_for_pr_impl ────────────────────────────────────────────

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_for_pr_rolls_up_like_the_branch_based_lookup() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"echo '[{"name":"build","bucket":"pass","link":"https://x/1"},{"name":"test","bucket":"fail","link":"https://x/2"}]'"#,
    );

    let status = get_pr_checks_for_pr_impl(&gh_path, "owner/repo", 42, "/usr/bin:/bin")
      .unwrap()
      .unwrap();

    assert_eq!(status.state, "failure");
    assert_eq!(status.total, 2);
    assert_eq!(status.passed, 1);
    assert_eq!(status.failed, 1);
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_for_pr_invokes_gh_with_exact_arguments() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      r#"test "$*" = "pr checks 42 --repo owner/repo --json name,bucket,link,startedAt,completedAt" || exit 9
echo '[{"name":"build","bucket":"pass","link":"https://x/1"}]'"#,
    );

    let result = get_pr_checks_for_pr_impl(&gh_path, "owner/repo", 42, "/usr/bin:/bin");

    assert!(result.unwrap().is_some());
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_for_pr_no_checks_reported_returns_none() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(
      &bin_dir,
      "echo 'no checks reported on the feat branch' >&2\nexit 1",
    );

    let result = get_pr_checks_for_pr_impl(&gh_path, "owner/repo", 42, "/usr/bin:/bin").unwrap();

    assert!(result.is_none());
  }

  #[test]
  #[cfg(unix)]
  fn get_pr_checks_for_pr_operational_error_is_returned() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(&bin_dir, "echo 'authentication required' >&2\nexit 1");

    let result = get_pr_checks_for_pr_impl(&gh_path, "owner/repo", 42, "/usr/bin:/bin");
    let error = match result {
      Err(error) => error,
      Ok(_) => panic!("operational gh failure was treated as no checks"),
    };
    assert!(error.contains("authentication required"));
  }

  #[test]
  fn test_get_pr_info_via_gh_bad_binary_returns_err() {
    let result = get_pr_info_via_gh_impl("/nonexistent/gh", "/tmp", "feat", "/usr/bin:/bin");
    assert!(result.is_err());
  }

  #[test]
  fn take_list_page_returns_first_page_and_has_more_when_full() {
    // Page 1 is fetched with --limit (limit * page) == 2
    let page = take_list_page(vec![1, 2], 2, 1);
    assert_eq!(page.items, vec![1, 2]);
    assert!(page.has_more);
  }

  #[test]
  fn take_list_page_returns_second_page_slice() {
    // Page 2 is fetched with --limit 4
    let page = take_list_page(vec![1, 2, 3, 4], 2, 2);
    assert_eq!(page.items, vec![3, 4]);
    assert!(page.has_more);
  }

  #[test]
  fn take_list_page_has_more_false_when_short_of_full_prefix() {
    let page = take_list_page(vec![1, 2, 3], 2, 2);
    assert_eq!(page.items, vec![3]);
    assert!(!page.has_more);
  }

  #[test]
  fn take_list_page_has_more_false_on_short_first_page() {
    let page = take_list_page(vec![1], 2, 1);
    assert_eq!(page.items, vec![1]);
    assert!(!page.has_more);
  }

  // ── gh_list_pr_review_threads_impl ───────────────────────────────────────

  #[test]
  #[cfg(unix)]
  fn test_gh_list_pr_review_threads_parses_and_maps_fields() {
    let bin_dir = TempDir::new().unwrap();
    let response = serde_json::json!({
        "data": {
            "repository": {
                "pullRequest": {
                    "reviewThreads": {
                        "pageInfo": {"hasNextPage": false, "endCursor": null},
                        "nodes": [{
                            "id": "PRRT_1",
                            "isResolved": true,
                            "isOutdated": false,
                            "path": "src/main.rs",
                            "line": 42,
                            "diffSide": "RIGHT",
                            "comments": {
                                "nodes": [{
                                    "id": "PRRC_1",
                                    "body": "nit: rename this",
                                    "createdAt": "2026-01-01T00:00:00Z",
                                    "url": "https://github.com/o/r/pull/1#discussion_r1",
                                    "diffHunk": "@@ -1,3 +1,3 @@\n-a\n+b",
                                    "author": {"login": "reviewer1", "avatarUrl": "https://avatars.example/reviewer1.png"}
                                }]
                            }
                        }]
                    }
                }
            }
        }
    });
    let script = format!("cat <<'EOF'\n{response}\nEOF\n");
    let gh_path = write_fake_gh(&bin_dir, &script);

    let threads =
      gh_list_pr_review_threads_impl(&gh_path, "owner", "repo", 1, "/usr/bin:/bin").unwrap();

    assert_eq!(threads.len(), 1);
    let thread = &threads[0];
    assert_eq!(thread.id, "PRRT_1");
    assert!(thread.is_resolved);
    assert!(!thread.is_outdated);
    assert_eq!(thread.path, "src/main.rs");
    assert_eq!(thread.line, Some(42));
    assert_eq!(thread.diff_side, "RIGHT");
    assert_eq!(thread.comments.len(), 1);
    assert_eq!(thread.comments[0].body, "nit: rename this");
    assert_eq!(thread.comments[0].author.login, "reviewer1");
    assert_eq!(
      thread.comments[0].author.avatar_url.as_deref(),
      Some("https://avatars.example/reviewer1.png")
    );
  }

  #[test]
  #[cfg(unix)]
  fn test_gh_list_pr_review_threads_defaults_deleted_author_to_ghost() {
    let bin_dir = TempDir::new().unwrap();
    let response = serde_json::json!({
        "data": {"repository": {"pullRequest": {"reviewThreads": {
            "pageInfo": {"hasNextPage": false, "endCursor": null},
            "nodes": [{
                "id": "PRRT_1", "isResolved": false, "isOutdated": false,
                "path": "a.rs", "line": 1, "diffSide": "RIGHT",
                "comments": {"nodes": [{
                    "id": "PRRC_1", "body": "hi", "createdAt": "2026-01-01T00:00:00Z",
                    "url": "https://github.com/o/r/pull/1#discussion_r1",
                    "diffHunk": "@@ -1 +1 @@", "author": null
                }]}
            }]
        }}}}
    });
    let script = format!("cat <<'EOF'\n{response}\nEOF\n");
    let gh_path = write_fake_gh(&bin_dir, &script);

    let threads =
      gh_list_pr_review_threads_impl(&gh_path, "owner", "repo", 1, "/usr/bin:/bin").unwrap();

    assert_eq!(threads[0].comments[0].author.login, "ghost");
    assert_eq!(threads[0].comments[0].author.avatar_url, None);
  }

  #[test]
  #[cfg(unix)]
  fn test_gh_list_pr_review_threads_paginates_across_pages() {
    let bin_dir = TempDir::new().unwrap();
    let page1 = serde_json::json!({
        "data": {"repository": {"pullRequest": {"reviewThreads": {
            "pageInfo": {"hasNextPage": true, "endCursor": "CURSOR1"},
            "nodes": [{
                "id": "T1", "isResolved": false, "isOutdated": false,
                "path": "a.rs", "line": 1, "diffSide": "RIGHT",
                "comments": {"nodes": []}
            }]
        }}}}
    });
    let page2 = serde_json::json!({
        "data": {"repository": {"pullRequest": {"reviewThreads": {
            "pageInfo": {"hasNextPage": false, "endCursor": null},
            "nodes": [{
                "id": "T2", "isResolved": false, "isOutdated": false,
                "path": "b.rs", "line": 2, "diffSide": "RIGHT",
                "comments": {"nodes": []}
            }]
        }}}}
    });
    let script = format!(
      r#"case "$*" in
  *"after=CURSOR1"*) cat <<'EOF'
{page2}
EOF
  ;;
  *) cat <<'EOF'
{page1}
EOF
  ;;
esac
"#,
    );
    let gh_path = write_fake_gh(&bin_dir, &script);

    let threads =
      gh_list_pr_review_threads_impl(&gh_path, "owner", "repo", 1, "/usr/bin:/bin").unwrap();

    assert_eq!(threads.len(), 2);
    assert_eq!(threads[0].id, "T1");
    assert_eq!(threads[1].id, "T2");
  }

  #[test]
  #[cfg(unix)]
  fn test_gh_list_pr_review_threads_returns_empty_when_no_pull_request() {
    let bin_dir = TempDir::new().unwrap();
    let script = "cat <<'EOF'\n{\"data\":{\"repository\":{\"pullRequest\":null}}}\nEOF\n";
    let gh_path = write_fake_gh(&bin_dir, script);

    let threads =
      gh_list_pr_review_threads_impl(&gh_path, "owner", "repo", 1, "/usr/bin:/bin").unwrap();

    assert!(threads.is_empty());
  }

  #[test]
  #[cfg(unix)]
  fn test_gh_list_pr_review_threads_propagates_gh_error() {
    let bin_dir = TempDir::new().unwrap();
    let gh_path = write_fake_gh(&bin_dir, "echo 'GraphQL error' >&2\nexit 1");

    let result = gh_list_pr_review_threads_impl(&gh_path, "owner", "repo", 1, "/usr/bin:/bin");

    assert!(result.is_err());
  }
}
