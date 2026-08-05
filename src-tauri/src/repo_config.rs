use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct RepoConfig {
    pub branch_name_pattern: Option<String>,
    pub default_model: Option<String>,
    pub default_agent: Option<String>,
    pub target_branch: Option<String>,
    pub included_copy_files: Option<Vec<String>>,
}

pub fn config_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path).join(".treq").join("config.yaml")
}

/// Read `.treq/config.yaml`, cache every field to the local DB, and return the parsed config.
/// If the file does not exist, returns a default (all-`None`) config and clears any stale cache.
pub fn load_and_cache(repo_path: &str) -> Result<RepoConfig, String> {
    let path = config_path(repo_path);
    let config = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read .treq/config.yaml: {e}"))?;
        serde_yaml::from_str::<RepoConfig>(&content)
            .map_err(|e| format!("Failed to parse .treq/config.yaml: {e}"))?
    } else {
        RepoConfig::default()
    };
    crate::local_db::cache_repo_config(repo_path, &config)?;
    Ok(config)
}

/// Return the `RepoConfig` that was previously cached in the local DB.
/// Returns an all-`None` default when no cache entry exists yet.
pub fn get_cached(repo_path: &str) -> Result<RepoConfig, String> {
    crate::local_db::get_cached_repo_config(repo_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_db::clear_db_cache_for_testing;
    use std::fs;
    use tempfile::TempDir;

    fn cleanup(repo_path: &str) {
        clear_db_cache_for_testing(repo_path);
    }

    #[test]
    fn test_config_path_is_dotreq_config_yaml() {
        let path = config_path("/home/user/myrepo");
        assert_eq!(path, Path::new("/home/user/myrepo/.treq/config.yaml"));
    }

    #[test]
    fn test_load_and_cache_returns_default_when_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let config = load_and_cache(repo_path).expect("should succeed with no file");
        assert_eq!(config, RepoConfig::default());

        cleanup(repo_path);
    }

    #[test]
    fn test_load_and_cache_reads_branch_name_pattern() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "branch_name_pattern: \"feat/{name}\"\n",
        )
        .unwrap();

        let config = load_and_cache(repo_path).expect("should parse");
        assert_eq!(config.branch_name_pattern.as_deref(), Some("feat/{name}"));

        cleanup(repo_path);
    }

    #[test]
    fn test_load_and_cache_reads_all_fields() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "branch_name_pattern: \"treq/{name}\"\n\
             default_model: \"claude-opus-4\"\n\
             default_agent: \"code\"\n\
             target_branch: \"main\"\n\
             included_copy_files:\n\
               - \"src/main.rs\"\n\
               - \"Cargo.toml\"\n",
        )
        .unwrap();

        let config = load_and_cache(repo_path).expect("should parse all fields");
        assert_eq!(
            config.branch_name_pattern.as_deref(),
            Some("treq/{name}")
        );
        assert_eq!(config.default_model.as_deref(), Some("claude-opus-4"));
        assert_eq!(config.default_agent.as_deref(), Some("code"));
        assert_eq!(config.target_branch.as_deref(), Some("main"));
        assert_eq!(
            config.included_copy_files,
            Some(vec![
                "src/main.rs".to_string(),
                "Cargo.toml".to_string()
            ])
        );

        cleanup(repo_path);
    }

    #[test]
    fn test_load_and_cache_partial_config() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "target_branch: \"develop\"\n",
        )
        .unwrap();

        let config = load_and_cache(repo_path).expect("should handle partial config");
        assert_eq!(config.target_branch.as_deref(), Some("develop"));
        assert!(config.branch_name_pattern.is_none());
        assert!(config.default_model.is_none());
        assert!(config.default_agent.is_none());
        assert!(config.included_copy_files.is_none());

        cleanup(repo_path);
    }

    #[test]
    fn test_cached_config_survives_round_trip() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "default_model: \"claude-opus-4\"\ntarget_branch: \"main\"\n",
        )
        .unwrap();

        load_and_cache(repo_path).expect("should cache");

        let cached = get_cached(repo_path).expect("should read cache");
        assert_eq!(cached.default_model.as_deref(), Some("claude-opus-4"));
        assert_eq!(cached.target_branch.as_deref(), Some("main"));
        assert!(cached.branch_name_pattern.is_none());

        cleanup(repo_path);
    }

    #[test]
    fn test_get_cached_returns_default_when_no_cache() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let cached = get_cached(repo_path).expect("should return default when empty");
        assert_eq!(cached, RepoConfig::default());

        cleanup(repo_path);
    }

    #[test]
    fn test_load_and_cache_updates_cache_on_reload() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "default_model: \"claude-haiku\"\n",
        )
        .unwrap();
        load_and_cache(repo_path).expect("first load");

        // Overwrite the YAML with new content.
        fs::write(
            treq_dir.join("config.yaml"),
            "default_model: \"claude-opus-4\"\n",
        )
        .unwrap();
        load_and_cache(repo_path).expect("second load");

        let cached = get_cached(repo_path).expect("should reflect updated cache");
        assert_eq!(cached.default_model.as_deref(), Some("claude-opus-4"));

        cleanup(repo_path);
    }

    #[test]
    fn test_cached_included_copy_files_round_trip() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_str().unwrap();

        let treq_dir = temp_dir.path().join(".treq");
        fs::create_dir_all(&treq_dir).unwrap();
        fs::write(
            treq_dir.join("config.yaml"),
            "included_copy_files:\n  - \"a.rs\"\n  - \"b.rs\"\n",
        )
        .unwrap();

        load_and_cache(repo_path).expect("should cache");
        let cached = get_cached(repo_path).expect("should read cache");
        assert_eq!(
            cached.included_copy_files,
            Some(vec!["a.rs".to_string(), "b.rs".to_string()])
        );

        cleanup(repo_path);
    }
}
