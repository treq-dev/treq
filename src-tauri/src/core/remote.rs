use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshHost {
    pub alias: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteReadinessCheck {
    pub name: String,
    pub available: bool,
    pub detail: String,
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
pub struct RemoteRepository {
    pub host: String,
    pub path: String,
    pub display_name: String,
    pub repo_uri: String,
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
            if alias == "*" || alias.contains('*') || alias.contains('?') || alias.starts_with('!')
            {
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

pub fn check_readiness(host: &str) -> Result<RemoteReadiness, String> {
    validate_host_alias(host)?;
    let script = "set -u; for c in treq jj git; do command -v $c >/dev/null 2>&1 && echo $c:ok || echo $c:missing; done; for c in claude codex cursor-agent cursor; do command -v $c >/dev/null 2>&1 && echo agent:$c:ok; done";
    let output = ssh_output(host, script)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut checks = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<_> = line.split(':').collect();
        match parts.as_slice() {
            [name, "ok"] => checks.push(RemoteReadinessCheck {
                name: (*name).to_string(),
                available: true,
                detail: "available".to_string(),
            }),
            [name, "missing"] => checks.push(RemoteReadinessCheck {
                name: (*name).to_string(),
                available: false,
                detail: "missing from PATH".to_string(),
            }),
            ["agent", name, "ok"] => checks.push(RemoteReadinessCheck {
                name: format!("agent:{name}"),
                available: true,
                detail: "available".to_string(),
            }),
            _ => {}
        }
    }
    Ok(RemoteReadiness {
        host: host.to_string(),
        connected: output.status.success(),
        checks,
    })
}

pub fn probe_repo(host: &str, path: &str) -> Result<RemoteRepoProbe, String> {
    validate_host_alias(host)?;
    validate_remote_path(path)?;
    let quoted = shell_quote(path);
    let script = format!("if [ -d {quoted} ]; then echo exists; if [ -d {quoted}/.jj ] || [ -d {quoted}/.git ]; then echo repo; fi; else echo missing; fi");
    let output = ssh_output(host, &script)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let exists = stdout.lines().any(|line| line == "exists");
    let is_repo = stdout.lines().any(|line| line == "repo");
    Ok(RemoteRepoProbe {
        host: host.to_string(),
        path: path.to_string(),
        exists,
        is_repo,
        needs_clone: !is_repo,
    })
}

pub fn clone_repo(
    host: &str,
    repo_url: &str,
    destination: &str,
) -> Result<RemoteRepository, String> {
    validate_host_alias(host)?;
    validate_remote_path(destination)?;
    if repo_url.trim().is_empty() {
        return Err("Repository URL is required".to_string());
    }
    let quoted_url = shell_quote(repo_url);
    let quoted_destination = shell_quote(destination);
    let script = format!("git clone {quoted_url} {quoted_destination} && cd {quoted_destination} && treq st >/dev/null 2>&1 || true");
    let output = ssh_output(host, &script)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(open_repo(host, destination))
}

pub fn open_repo(host: &str, path: &str) -> RemoteRepository {
    let display_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string();
    RemoteRepository {
        host: host.to_string(),
        path: path.to_string(),
        display_name: format!("{host}:{display_name}"),
        repo_uri: format!("ssh://{host}{path}"),
    }
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

fn ssh_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(home).join(".ssh").join("config"));
    }
    paths.push(PathBuf::from("/etc/ssh/ssh_config"));
    paths
}

fn ssh_output(host: &str, script: &str) -> Result<std::process::Output, String> {
    Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=10")
        .arg(host)
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to run ssh: {e}"))
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
    fn probe_repo_rejects_empty_path_before_ssh() {
        let error = probe_repo("devbox", "").unwrap_err();
        assert_eq!(error, "Remote path is required");
    }

    #[test]
    fn clone_repo_rejects_empty_url_before_ssh() {
        let error = clone_repo("devbox", "", "/srv/project").unwrap_err();
        assert_eq!(error, "Repository URL is required");
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
    fn opens_repo_identity_for_remote_path() {
        let repo = open_repo("devbox", "/srv/project");
        assert_eq!(repo.display_name, "devbox:project");
        assert_eq!(repo.repo_uri, "ssh://devbox/srv/project");
    }
}
