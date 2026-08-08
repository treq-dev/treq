use crate::core;
use crate::github::PrCiStatus;
use crate::local_db::Workspace;
use std::collections::{HashMap, HashSet};

pub(crate) fn format_workspace_metadata_lines(workspace: &Workspace, indent: &str) -> Vec<String> {
    let mut lines = vec![format!("{indent}Title: {}", workspace.title)];
    if let Some(description) = workspace.description.as_deref() {
        lines.push(format!("{indent}Description: {description}"));
    }
    lines
}

pub(crate) fn format_workspace_stack_lines(
    statuses: &[core::WorkspaceSidebarStatus],
) -> Vec<String> {
    let by_branch: HashMap<&str, &core::WorkspaceSidebarStatus> = statuses
        .iter()
        .map(|status| (status.current.branch_name.as_str(), status))
        .collect();
    let mut children: HashMap<&str, Vec<&core::WorkspaceSidebarStatus>> = HashMap::new();
    let mut roots = Vec::new();

    for status in statuses {
        match status.current.target_branch.as_deref() {
            Some(parent)
                if parent != status.current.branch_name && by_branch.contains_key(parent) =>
            {
                children.entry(parent).or_default().push(status);
            }
            _ => roots.push(status),
        }
    }
    if roots.is_empty() {
        roots.extend(statuses);
    }
    roots.sort_by(|left, right| left.current.branch_name.cmp(&right.current.branch_name));
    for siblings in children.values_mut() {
        siblings.sort_by(|left, right| left.current.branch_name.cmp(&right.current.branch_name));
    }

    fn append_node(
        lines: &mut Vec<String>,
        status: &core::WorkspaceSidebarStatus,
        depth: usize,
        children: &HashMap<&str, Vec<&core::WorkspaceSidebarStatus>>,
        visited: &mut HashSet<i64>,
    ) {
        if !visited.insert(status.current.id) {
            return;
        }
        let prefix = if depth == 0 {
            String::new()
        } else {
            format!("  {}└─ ", "   ".repeat(depth - 1))
        };
        let conflict = if status.has_conflicts {
            " [CONFLICTS]"
        } else {
            ""
        };
        lines.push(format!(
            "{prefix}● {} — {}{conflict}",
            status.current.branch_name, status.current.title
        ));
        if let Some(description) = status.current.description.as_deref() {
            lines.push(format!(
                "{}   Description: {description}",
                "   ".repeat(depth)
            ));
        }
        if let Some(descendants) = children.get(status.current.branch_name.as_str()) {
            for child in descendants {
                append_node(lines, child, depth + 1, children, visited);
            }
        }
    }

    let mut lines = vec!["Stack:".to_string()];
    let mut visited = HashSet::new();
    for root in roots {
        append_node(&mut lines, root, 0, &children, &mut visited);
    }
    lines
}

pub(crate) struct WorkspacePrStatus {
    pub github_id: String,
    pub checks: Option<PrCiStatus>,
}

pub(crate) fn format_pr_status_lines(pr: &WorkspacePrStatus, indent: &str) -> Vec<String> {
    let mut lines = vec![format!("{indent}GitHub: {}", pr.github_id)];
    if let Some(checks) = &pr.checks {
        let summary = match checks.state.as_str() {
            "success" => format!("passing ({}/{})", checks.passed, checks.total),
            "failure" => format!(
                "failing ({} failed, {} pending, {} passed)",
                checks.failed, checks.pending, checks.passed
            ),
            _ => format!(
                "pending ({} pending, {} passed, {} failed)",
                checks.pending, checks.passed, checks.failed
            ),
        };
        lines.push(format!("{indent}Checks: {summary}"));
    }
    lines
}

pub(crate) fn print_workspace_partial_status(
    status: &core::WorkspaceSidebarStatus,
    pr: Option<&WorkspacePrStatus>,
) {
    let flags = if status.has_conflicts {
        " [CONFLICTS]"
    } else {
        ""
    };
    println!("  {} {}{}", "●", status.current.branch_name, flags);
    for line in format_workspace_metadata_lines(&status.current, "    ") {
        println!("{line}");
    }
    if let Some(ref target) = status.current.target_branch {
        println!("    Target: {}", target);
    }
    if let Some(pr) = pr {
        for line in format_pr_status_lines(pr, "    ") {
            println!("{line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(
        id: i64,
        branch: &str,
        title: &str,
        description: Option<&str>,
        target: Option<&str>,
    ) -> crate::local_db::Workspace {
        crate::local_db::Workspace {
            id,
            repo_path: "/repo".to_string(),
            workspace_name: branch.to_string(),
            workspace_path: branch.to_string(),
            branch_name: branch.to_string(),
            created_at: String::new(),
            refreshed_at: None,
            metadata: None,
            target_branch: target.map(str::to_string),
            title: title.to_string(),
            description: description.map(str::to_string),
            moved_files: None,
            not_on_remote: false,
            sparse_patterns: None,
            archived: false,
        }
    }

    fn sidebar(current: crate::local_db::Workspace) -> core::WorkspaceSidebarStatus {
        core::WorkspaceSidebarStatus {
            current,
            has_conflicts: false,
        }
    }

    #[test]
    fn formats_workspace_title_and_description() {
        let current = workspace(
            1,
            "feat/auth",
            "Add authentication",
            Some("Support passkeys"),
            Some("main"),
        );

        assert_eq!(
            format_workspace_metadata_lines(&current, "  "),
            vec![
                "  Title: Add authentication",
                "  Description: Support passkeys"
            ]
        );
    }

    #[test]
    fn formats_workspace_stack_as_hierarchy() {
        let statuses = vec![
            sidebar(workspace(3, "feat/ui", "UI", None, Some("feat/api"))),
            sidebar(workspace(1, "main-work", "Main", None, Some("main"))),
            sidebar(workspace(2, "feat/api", "API", None, Some("main-work"))),
        ];

        assert_eq!(
            format_workspace_stack_lines(&statuses),
            vec![
                "Stack:",
                "● main-work — Main",
                "  └─ ● feat/api — API",
                "     └─ ● feat/ui — UI",
            ]
        );
    }

    fn checks(state: &str, passed: u32, failed: u32, pending: u32) -> PrCiStatus {
        PrCiStatus {
            state: state.to_string(),
            total: passed + failed + pending,
            passed,
            failed,
            pending,
            checks: Vec::new(),
        }
    }

    #[test]
    fn formats_github_id_and_passing_checks() {
        let pr = WorkspacePrStatus {
            github_id: "acme/treq#42".to_string(),
            checks: Some(checks("success", 3, 0, 0)),
        };

        assert_eq!(
            format_pr_status_lines(&pr, "    "),
            vec!["    GitHub: acme/treq#42", "    Checks: passing (3/3)"]
        );
    }

    #[test]
    fn formats_failing_checks_with_counts() {
        let pr = WorkspacePrStatus {
            github_id: "octo/app#7".to_string(),
            checks: Some(checks("failure", 2, 1, 1)),
        };

        assert_eq!(
            format_pr_status_lines(&pr, "  "),
            vec![
                "  GitHub: octo/app#7",
                "  Checks: failing (1 failed, 1 pending, 2 passed)"
            ]
        );
    }

    #[test]
    fn omits_checks_when_github_reports_none() {
        let pr = WorkspacePrStatus {
            github_id: "octo/app#8".to_string(),
            checks: None,
        };

        assert_eq!(format_pr_status_lines(&pr, ""), vec!["GitHub: octo/app#8"]);
    }
}

pub(crate) fn print_workspace_status_detail(
    status: &core::WorkspaceStatus,
    pr: Option<&WorkspacePrStatus>,
) {
    println!("Workspace: {}", status.partial.current.branch_name);
    for line in format_workspace_metadata_lines(&status.partial.current, "  ") {
        println!("{line}");
    }
    if let Some(ref target) = &status.target {
        println!("  Target: {}", target.branch_name);
    }
    println!(
        "  Changes: {}",
        if status.partial.has_changes {
            "yes"
        } else {
            "no"
        }
    );
    println!(
        "  Conflicts: {}",
        if status.partial.has_conflicts {
            "YES"
        } else {
            "no"
        }
    );
    println!("  Commits ahead: {}", status.commits_ahead_of_target.len());
    if let Some(pr) = pr {
        for line in format_pr_status_lines(pr, "  ") {
            println!("{line}");
        }
    }

    if !status.dag_nodes.is_empty() {
        let stack_statuses: Vec<_> = status
            .dag_nodes
            .iter()
            .map(|node| core::WorkspaceSidebarStatus {
                current: node.status.current.clone(),
                has_conflicts: node.status.has_conflicts,
            })
            .collect();
        for line in format_workspace_stack_lines(&stack_statuses) {
            println!("  {line}");
        }
    }

    if !status.children.is_empty() {
        println!("  Children:");
        for child in &status.children {
            println!("    - {}", child.branch_name);
        }
    }

    if !status.commits_ahead_of_target.is_empty() {
        println!("  Commits:");
        for commit in &status.commits_ahead_of_target {
            let msg = commit.message.lines().next().unwrap_or("");
            println!("    {} {}", &commit.hash[..8.min(commit.hash.len())], msg);
        }
    }
}
