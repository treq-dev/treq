//! Stack comments. After Treq creates a pull request for a workspace that
//! sits in a stack, it keeps one comment on every open PR in that stack that
//! lists the layers, so reviewers know the merge order.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::github::{self, CommentWrite, OpenPr};
use crate::local_db::{self, Workspace};
use crate::lock_ext::LockExt;

/// Repository setting that turns stack comments off when set to `"false"`.
pub const STACK_COMMENTS_SETTING: &str = "post_stack_comments";

/// Hidden marker that identifies Treq's stack comment on a PR.
pub const STACK_COMMENT_MARKER: &str = "<!-- treq:stack-comment -->";

/// Serializes syncs so a comment found missing is posted before the next
/// sync looks for it.
static SYNC_LOCK: Mutex<()> = Mutex::new(());

const STACK_COMMENT_FOOTER: &str = "<sub>Stacked with [Treq](https://treq.dev/?utm_source=github&utm_medium=stack_comment&utm_campaign=stack), which rebases each layer when the one below it moves.</sub>";

/// What [`sync_stack_comments`] did.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum StackCommentOutcome {
  /// The repository setting is off.
  Disabled,
  /// Fewer than two open PRs share a stack with the branch.
  NotStacked,
  Posted {
    created: u32,
    updated: u32,
    unchanged: u32,
  },
}

/// Workspaces linked by `target_branch`: a child targets its parent's branch.
struct StackTree {
  parent: HashMap<String, String>,
  children: HashMap<String, Vec<String>>,
}

impl StackTree {
  fn new(workspaces: &[Workspace]) -> Self {
    let branches: HashSet<&str> = workspaces.iter().map(|w| w.branch_name.as_str()).collect();
    let mut parent = HashMap::new();
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for workspace in workspaces {
      let Some(target) = workspace.target_branch.as_deref() else {
        continue;
      };
      if target != workspace.branch_name && branches.contains(target) {
        parent.insert(workspace.branch_name.clone(), target.to_string());
        children
          .entry(target.to_string())
          .or_default()
          .push(workspace.branch_name.clone());
      }
    }
    StackTree { parent, children }
  }

  /// Parent, grandparent, and so on, nearest first.
  fn ancestors(&self, branch: &str) -> Vec<String> {
    let mut seen = HashSet::from([branch.to_string()]);
    let mut ancestors = Vec::new();
    let mut current = branch;
    while let Some(parent) = self.parent.get(current) {
      if !seen.insert(parent.clone()) {
        break;
      }
      ancestors.push(parent.clone());
      current = parent;
    }
    ancestors
  }

  /// Children and their children, depth first.
  fn descendants(&self, branch: &str) -> Vec<String> {
    let mut seen = HashSet::from([branch.to_string()]);
    let mut descendants = Vec::new();
    let mut pending: Vec<&String> = self.children_of(branch).rev().collect();
    while let Some(next) = pending.pop() {
      if !seen.insert(next.clone()) {
        continue;
      }
      descendants.push(next.clone());
      pending.extend(self.children_of(next).rev());
    }
    descendants
  }

  fn children_of(&self, branch: &str) -> impl DoubleEndedIterator<Item = &String> {
    self.children.get(branch).into_iter().flatten()
  }

  /// The stack as `branch` sees it, newest layer first.
  fn layers(&self, branch: &str) -> Vec<String> {
    let mut layers = self.descendants(branch);
    layers.reverse();
    layers.push(branch.to_string());
    for ancestor in self.ancestors(branch) {
      // A target_branch cycle makes a branch both an ancestor and a descendant.
      if !layers.contains(&ancestor) {
        layers.push(ancestor);
      }
    }
    layers
  }

  /// Every branch in the workspace tree that holds `branch`.
  fn tree_of(&self, branch: &str) -> Vec<String> {
    let root = self
      .ancestors(branch)
      .pop()
      .unwrap_or_else(|| branch.to_string());
    let mut tree = self.descendants(&root);
    tree.insert(0, root);
    tree
  }
}

/// Backslash-escape characters that GitHub Markdown would otherwise format.
fn escape_markdown(text: &str) -> String {
  let mut escaped = String::with_capacity(text.len());
  for c in text.chars() {
    if matches!(c, '\\' | '`' | '*' | '_' | '~' | '[' | ']' | '<' | '>') {
      escaped.push('\\');
    }
    escaped.push(c);
  }
  escaped
}

/// Render the stack comment for PR `current`. `layers` runs newest first.
pub fn render_stack_comment(layers: &[&OpenPr], current: u64, base_branch: &str) -> String {
  let mut body = String::from("**Stack** (merge from the bottom up)\n");
  for layer in layers {
    let title = escape_markdown(&layer.title);
    if layer.number == current {
      body.push_str(&format!("- **#{} {title}** ← this PR\n", layer.number));
    } else {
      body.push_str(&format!("- #{} {title}\n", layer.number));
    }
  }
  body.push_str(&format!(
    "- `{base_branch}`\n\n{STACK_COMMENT_FOOTER}\n{STACK_COMMENT_MARKER}"
  ));
  body
}

/// Stack comments are on unless the repository setting is `"false"`. An
/// unreadable setting counts as off, so a stored "off" never reads as "on".
fn stack_comments_enabled(repo_path: &str) -> bool {
  let db_path = crate::core::resolve_app_db_path(repo_path);
  if !db_path.exists() {
    return true;
  }
  match crate::db::Database::new(db_path)
    .and_then(|db| db.get_repo_setting(repo_path, STACK_COMMENTS_SETTING))
  {
    Ok(value) => value.as_deref() != Some("false"),
    Err(e) => {
      log::warn!("Skipping stack comments: could not read {STACK_COMMENTS_SETTING}: {e}");
      false
    }
  }
}

/// Create or refresh the stack comment on every open PR in `head_branch`'s
/// stack. Never touches GitHub when the setting is off or the branch is not
/// stacked.
pub fn sync_stack_comments(
  repo_path: &str,
  repo_full_name: &str,
  head_branch: &str,
  gh_path: Option<&str>,
  extended_path: &str,
) -> Result<StackCommentOutcome, String> {
  if !stack_comments_enabled(repo_path) {
    return Ok(StackCommentOutcome::Disabled);
  }
  let workspaces = local_db::get_workspaces(repo_path)?;
  let tree = StackTree::new(&workspaces);
  let members = tree.layers(head_branch);
  if members.len() < 2 {
    return Ok(StackCommentOutcome::NotStacked);
  }

  let gh = gh_path.ok_or_else(|| "gh CLI not found".to_string())?;
  // Two syncs that both find no comment would both post one.
  let _one_sync_at_a_time = SYNC_LOCK.lock_or_recover();
  let mut open_prs = HashMap::new();
  for branch in tree.tree_of(head_branch) {
    if let Some(pr) =
      github::gh_find_open_pr_for_branch_impl(gh, repo_full_name, &branch, extended_path)?
    {
      open_prs.insert(branch, pr);
    }
  }
  let targets: Vec<&String> = members
    .iter()
    .filter(|branch| open_prs.contains_key(*branch))
    .collect();
  if targets.len() < 2 {
    return Ok(StackCommentOutcome::NotStacked);
  }

  let login = github::gh_authenticated_login_impl(gh, extended_path)?;
  let (mut created, mut updated, mut unchanged) = (0, 0, 0);
  let mut failures = Vec::new();
  for branch in targets {
    let pr = &open_prs[branch];
    let layers: Vec<&OpenPr> = tree
      .layers(branch)
      .iter()
      .filter_map(|layer| open_prs.get(layer))
      .collect();
    let base_branch = layers
      .last()
      .map_or("", |bottom| bottom.base_ref_name.as_str());
    let body = render_stack_comment(&layers, pr.number, base_branch);
    match github::upsert_marked_pr_comment_impl(
      gh,
      repo_full_name,
      pr.number,
      &login,
      STACK_COMMENT_MARKER,
      &body,
      extended_path,
    ) {
      Ok(CommentWrite::Created) => created += 1,
      Ok(CommentWrite::Updated) => updated += 1,
      Ok(CommentWrite::Unchanged) => unchanged += 1,
      Err(e) => {
        log::warn!("Failed to update the stack comment on #{}: {e}", pr.number);
        failures.push(format!("#{}: {e}", pr.number));
      }
    }
  }
  if !failures.is_empty() {
    return Err(format!(
      "Could not update the stack comment on {}",
      failures.join("; ")
    ));
  }
  Ok(StackCommentOutcome::Posted {
    created,
    updated,
    unchanged,
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::core::AppDataDirGuard;
  use std::fs;
  use std::io::Write;
  use tempfile::TempDir;

  fn workspace(branch: &str, target: Option<&str>) -> Workspace {
    Workspace {
      id: 0,
      repo_path: String::new(),
      workspace_name: branch.to_string(),
      workspace_path: branch.to_string(),
      branch_name: branch.to_string(),
      created_at: String::new(),
      refreshed_at: None,
      metadata: None,
      target_branch: target.map(str::to_string),
      title: branch.to_string(),
      description: None,
      moved_files: None,
      not_on_remote: false,
      sparse_patterns: None,
      hidden_until: None,
      archived: false,
    }
  }

  fn pr(number: u64, title: &str, base: &str) -> OpenPr {
    OpenPr {
      number,
      title: title.to_string(),
      base_ref_name: base.to_string(),
    }
  }

  #[test]
  fn renders_layers_newest_first_and_marks_the_current_pr() {
    let top = pr(103, "Add tests", "feat/parser");
    let middle = pr(102, "Refactor parser", "feat/module");
    let bottom = pr(101, "Extract module", "main");

    let body = render_stack_comment(&[&top, &middle, &bottom], 102, "main");

    assert_eq!(
      body,
      "**Stack** (merge from the bottom up)\n\
       - #103 Add tests\n\
       - **#102 Refactor parser** ← this PR\n\
       - #101 Extract module\n\
       - `main`\n\
       \n\
       <sub>Stacked with [Treq](https://treq.dev/?utm_source=github&utm_medium=stack_comment&utm_campaign=stack), which rebases each layer when the one below it moves.</sub>\n\
       <!-- treq:stack-comment -->"
    );
  }

  #[test]
  fn render_escapes_markdown_in_titles() {
    let layer = pr(7, "Fix <Foo> *bar*", "main");

    let body = render_stack_comment(&[&layer], 7, "main");

    assert!(body.contains("- **#7 Fix \\<Foo\\> \\*bar\\*** ← this PR\n"));
  }

  #[test]
  fn layers_put_descendants_above_and_ancestors_below() {
    let workspaces = [
      workspace("feat/a", Some("main")),
      workspace("feat/b", Some("feat/a")),
      workspace("feat/c", Some("feat/b")),
      workspace("other", Some("main")),
    ];
    let tree = StackTree::new(&workspaces);

    assert_eq!(tree.layers("feat/b"), ["feat/c", "feat/b", "feat/a"]);
    assert_eq!(tree.tree_of("feat/c"), ["feat/a", "feat/b", "feat/c"]);
    assert_eq!(tree.layers("other"), ["other"]);
  }

  #[test]
  fn layers_survive_a_target_branch_cycle() {
    let workspaces = [
      workspace("feat/a", Some("feat/b")),
      workspace("feat/b", Some("feat/a")),
    ];
    let tree = StackTree::new(&workspaces);

    assert_eq!(tree.layers("feat/a"), ["feat/b", "feat/a"]);
  }

  /// A local DB with the stack `feat/a` <- `feat/b` and the lone `solo`.
  fn stacked_repo() -> TempDir {
    let repo = TempDir::new().unwrap();
    let path = repo.path().to_str().unwrap();
    for (branch, target) in [("feat/a", "main"), ("feat/b", "feat/a"), ("solo", "main")] {
      let id = local_db::add_workspace(
        path,
        branch.replace('/', "-"),
        branch.replace('/', "-"),
        branch.to_string(),
        None,
        None,
        None,
      )
      .unwrap();
      local_db::update_workspace_target_branch(path, id, target).unwrap();
    }
    repo
  }

  /// Fake `gh` that logs each call's argv to `calls` and reports `open_prs`.
  fn write_stack_gh(dir: &TempDir, open_prs: &[(&str, u64)]) -> String {
    let mut cases = String::new();
    for (branch, number) in open_prs {
      cases.push_str(&format!(
        "  \"pr list --repo owner/repo --head={branch} --state open --json number,title,baseRefName --limit 1\")\n    echo '[{{\"number\":{number},\"title\":\"PR {number}\",\"baseRefName\":\"main\"}}]' ;;\n"
      ));
    }
    let script = r#"#!/bin/sh
echo "$*" >> 'DIR/calls'
case "$*" in
CASES  "pr list "*) echo '[]' ;;
  "api user --jq .login") echo alice ;;
  "api --paginate "*)
    n=$(echo "$3" | cut -d/ -f5)
    if [ -e "DIR/body-$n" ]; then
      echo "[{\"id\":$n,\"body\":\"<!-- treq:stack-comment -->\",\"user\":{\"login\":\"alice\"}}]"
    else
      sleep 0.3
      echo '[]'
    fi ;;
  "pr comment "*) cat > "DIR/body-$3" ;;
  "api --method PATCH "*) cat > /dev/null ;;
  *) exit 9 ;;
esac
"#
    .replace("DIR", &dir.path().display().to_string())
    .replace("CASES", &cases);
    let path = dir.path().join("gh");
    let mut file = fs::File::create(&path).unwrap();
    file.write_all(script.as_bytes()).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path.to_str().unwrap().to_string()
  }

  fn gh_calls(dir: &TempDir) -> Vec<String> {
    fs::read_to_string(dir.path().join("calls"))
      .unwrap_or_default()
      .lines()
      .map(str::to_string)
      .collect()
  }

  #[test]
  #[cfg(unix)]
  fn sync_comments_on_every_open_pr_in_the_stack() {
    let app = TempDir::new().unwrap();
    let _guard = AppDataDirGuard::set(app.path());
    let repo = stacked_repo();
    let bin = TempDir::new().unwrap();
    let gh = write_stack_gh(&bin, &[("feat/a", 101), ("feat/b", 102)]);

    let outcome = sync_stack_comments(
      repo.path().to_str().unwrap(),
      "owner/repo",
      "feat/b",
      Some(&gh),
      "/usr/bin:/bin",
    )
    .unwrap();

    assert_eq!(
      outcome,
      StackCommentOutcome::Posted {
        created: 2,
        updated: 0,
        unchanged: 0
      }
    );
    let calls = gh_calls(&bin);
    assert!(calls.contains(&"pr comment 101 --repo owner/repo --body-file -".to_string()));
    assert!(calls.contains(&"pr comment 102 --repo owner/repo --body-file -".to_string()));
    let bottom = fs::read_to_string(bin.path().join("body-101")).unwrap();
    assert!(bottom.contains("- #102 PR 102\n- **#101 PR 101** ← this PR\n- `main`\n"));
    let top = fs::read_to_string(bin.path().join("body-102")).unwrap();
    assert!(top.contains("- **#102 PR 102** ← this PR\n- #101 PR 101\n- `main`\n"));
  }

  #[test]
  #[cfg(unix)]
  fn concurrent_syncs_post_one_comment_per_pr() {
    let repo = stacked_repo();
    let repo_path = repo.path().to_str().unwrap().to_string();
    let bin = TempDir::new().unwrap();
    let gh = write_stack_gh(&bin, &[("feat/a", 101), ("feat/b", 102)]);

    let syncs: Vec<_> = ["feat/a", "feat/b"]
      .into_iter()
      .map(|head| {
        let (repo_path, gh) = (repo_path.clone(), gh.clone());
        std::thread::spawn(move || {
          let app = TempDir::new().unwrap();
          let _guard = AppDataDirGuard::set(app.path());
          sync_stack_comments(&repo_path, "owner/repo", head, Some(&gh), "/usr/bin:/bin")
        })
      })
      .collect();
    for sync in syncs {
      sync.join().unwrap().unwrap();
    }

    let posts: Vec<String> = gh_calls(&bin)
      .into_iter()
      .filter(|call| call.starts_with("pr comment "))
      .collect();
    assert_eq!(posts.len(), 2, "{posts:?}");
  }

  #[test]
  #[cfg(unix)]
  fn sync_posts_nothing_when_the_setting_is_off() {
    let app = TempDir::new().unwrap();
    let _guard = AppDataDirGuard::set(app.path());
    let repo = stacked_repo();
    let repo_path = repo.path().to_str().unwrap();
    let db = crate::db::Database::new(crate::core::resolve_app_db_path(repo_path)).unwrap();
    db.init().unwrap();
    db.set_repo_setting(repo_path, STACK_COMMENTS_SETTING, "false")
      .unwrap();
    let bin = TempDir::new().unwrap();
    let gh = write_stack_gh(&bin, &[("feat/a", 101), ("feat/b", 102)]);

    let outcome = sync_stack_comments(
      repo_path,
      "owner/repo",
      "feat/b",
      Some(&gh),
      "/usr/bin:/bin",
    )
    .unwrap();

    assert_eq!(outcome, StackCommentOutcome::Disabled);
    assert!(gh_calls(&bin).is_empty());
  }

  #[test]
  #[cfg(unix)]
  fn sync_leaves_a_workspace_outside_any_stack_alone() {
    let app = TempDir::new().unwrap();
    let _guard = AppDataDirGuard::set(app.path());
    let repo = stacked_repo();
    let bin = TempDir::new().unwrap();
    let gh = write_stack_gh(&bin, &[("solo", 103)]);

    let outcome = sync_stack_comments(
      repo.path().to_str().unwrap(),
      "owner/repo",
      "solo",
      Some(&gh),
      "/usr/bin:/bin",
    )
    .unwrap();

    assert_eq!(outcome, StackCommentOutcome::NotStacked);
    assert!(gh_calls(&bin).is_empty());
  }

  #[test]
  #[cfg(unix)]
  fn sync_does_not_comment_when_only_one_pr_in_the_stack_is_open() {
    let app = TempDir::new().unwrap();
    let _guard = AppDataDirGuard::set(app.path());
    let repo = stacked_repo();
    let bin = TempDir::new().unwrap();
    let gh = write_stack_gh(&bin, &[("feat/b", 102)]);

    let outcome = sync_stack_comments(
      repo.path().to_str().unwrap(),
      "owner/repo",
      "feat/b",
      Some(&gh),
      "/usr/bin:/bin",
    )
    .unwrap();

    assert_eq!(outcome, StackCommentOutcome::NotStacked);
    assert!(gh_calls(&bin)
      .iter()
      .all(|call| call.starts_with("pr list ")));
  }
}
