//! Log collection and querying for workflow check runs.
//!
//! Each job in a run streams its step output to a newline-delimited JSON file
//! under `.treq/runs/{run_id}/{job_id}.jsonl`. Reads go through DuckDB's
//! `read_json_auto`, which lets the logs browser filter and paginate without
//! loading a whole run into memory.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// One captured output line.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LogLine {
    pub ts: String,
    pub step_index: i64,
    pub step_name: String,
    /// `stdout` or `stderr`.
    pub stream: String,
    /// `info`, `warning`, or `error`.
    pub level: String,
    pub message: String,
}

/// Filters accepted by the logs browser.
///
/// `levels` is a set: an empty or absent list means "no level filter", matching
/// the multi-select showing nothing ticked.
#[derive(Debug, Deserialize, Default, Clone)]
pub struct LogQuery {
    pub levels: Option<Vec<String>>,
    pub search: Option<String>,
    pub step_index: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A run/job-tagged log line, for browsing across the whole repo.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RepoLogLine {
    pub run_id: i64,
    pub job_id: String,
    pub ts: String,
    pub step_index: i64,
    pub step_name: String,
    pub stream: String,
    pub level: String,
    pub message: String,
}

/// Result of an ad-hoc SQL query in the explorer.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SqlResult {
    pub columns: Vec<String>,
    /// Every cell rendered as text so any column type survives the boundary.
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: usize,
}

const DEFAULT_LIMIT: i64 = 2000;

// ── Paths ────────────────────────────────────────────────────────────────────

/// Directory holding one run's per-job log files.
pub fn run_log_dir(repo_path: &str, run_id: i64) -> PathBuf {
    Path::new(repo_path)
        .join(".treq")
        .join("runs")
        .join(run_id.to_string())
}

/// Path of a single job's log file, relative to the repo root.
pub fn job_log_relative_path(run_id: i64, job_id: &str) -> String {
    format!(".treq/runs/{}/{}.jsonl", run_id, sanitize_job_id(job_id))
}

/// Job IDs come from user-authored YAML, so keep them to a safe filename charset.
fn sanitize_job_id(job_id: &str) -> String {
    job_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// ── Level inference ──────────────────────────────────────────────────────────

/// Classify a line by content.
///
/// Deliberately not keyed on the stream: plenty of tools (cargo, npm) write
/// ordinary progress to stderr, so treating stderr as an error would paint
/// most of a healthy run red.
pub fn infer_level(message: &str) -> &'static str {
    let lower = message.to_lowercase();

    let error_markers = [
        "error",
        "error:",
        "fatal",
        "panic",
        "failed",
        "failure",
        "exception",
        "traceback",
    ];
    let warn_markers = ["warning", "warn:", "deprecated"];

    if error_markers.iter().any(|m| lower.contains(m)) {
        return "error";
    }
    if warn_markers.iter().any(|m| lower.contains(m)) {
        return "warning";
    }
    "info"
}

/// Remove ANSI SGR/CSI escape sequences so stored text renders cleanly.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Consume "[ ... <final byte>" of a CSI sequence.
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

// ── Writing ──────────────────────────────────────────────────────────────────

/// Append-only JSONL sink shared by a job's stdout and stderr reader threads.
#[derive(Clone)]
pub struct LogWriter {
    inner: Arc<Mutex<std::io::BufWriter<std::fs::File>>>,
}

impl LogWriter {
    pub fn create(repo_path: &str, run_id: i64, job_id: &str) -> Result<Self, String> {
        let dir = run_log_dir(repo_path, run_id);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
        let path = dir.join(format!("{}.jsonl", sanitize_job_id(job_id)));
        let file = std::fs::File::create(&path)
            .map_err(|e| format!("Failed to create log file: {}", e))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(std::io::BufWriter::new(file))),
        })
    }

    pub fn write_line(&self, line: &LogLine) -> Result<(), String> {
        let json = serde_json::to_string(line)
            .map_err(|e| format!("Failed to serialize log line: {}", e))?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Log writer mutex poisoned".to_string())?;
        writeln!(guard, "{}", json).map_err(|e| format!("Failed to write log line: {}", e))
    }

    pub fn flush(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Log writer mutex poisoned".to_string())?;
        guard
            .flush()
            .map_err(|e| format!("Failed to flush log file: {}", e))
    }
}

// ── Querying (DuckDB) ────────────────────────────────────────────────────────

/// Escape a path for embedding in a DuckDB single-quoted string literal.
fn sql_quote(value: &str) -> String {
    value.replace('\'', "''")
}

/// Shared WHERE builder for the single-job and cross-run readers.
fn build_where_clause(query: &LogQuery) -> String {
    let mut conditions: Vec<String> = Vec::new();

    if let Some(levels) = query.levels.as_ref().filter(|l| !l.is_empty()) {
        let list = levels
            .iter()
            .map(|l| format!("'{}'", sql_quote(l)))
            .collect::<Vec<_>>()
            .join(", ");
        conditions.push(format!("level IN ({})", list));
    }
    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        conditions.push(format!(
            "lower(message) LIKE '%{}%'",
            sql_quote(&search.to_lowercase())
        ));
    }
    if let Some(step_index) = query.step_index {
        conditions.push(format!("step_index = {}", step_index));
    }

    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}

/// Read a job's log file, applying the browser's filters.
///
/// Returns an empty vec when the file is missing or empty — a job that produced
/// no output is a normal state, not an error.
pub fn query_logs(absolute_log_path: &str, query: &LogQuery) -> Result<Vec<LogLine>, String> {
    let path = Path::new(absolute_log_path);
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() == 0 => return Ok(vec![]),
        Ok(_) => {}
        Err(_) => return Ok(vec![]),
    }

    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("Failed to open DuckDB connection: {}", e))?;

    let where_clause = build_where_clause(query);

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100_000);
    let offset = query.offset.unwrap_or(0).max(0);

    // Cast ts to VARCHAR so DuckDB timestamp inference can't alter the format.
    let sql = format!(
        "SELECT CAST(ts AS VARCHAR) AS ts,
                CAST(step_index AS BIGINT) AS step_index,
                CAST(step_name AS VARCHAR) AS step_name,
                CAST(stream AS VARCHAR) AS stream,
                CAST(level AS VARCHAR) AS level,
                CAST(message AS VARCHAR) AS message
         FROM read_json_auto('{}', format='newline_delimited')
         {}
         ORDER BY ts, step_index
         LIMIT {} OFFSET {}",
        sql_quote(absolute_log_path),
        where_clause,
        limit,
        offset
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare log query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LogLine {
                ts: row.get(0)?,
                step_index: row.get(1)?,
                step_name: row.get(2)?,
                stream: row.get(3)?,
                level: row.get(4)?,
                message: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query logs: {}", e))?;

    rows.collect::<duckdb::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read log rows: {}", e))
}

// ── Repo-wide data source ────────────────────────────────────────────────────

/// Glob covering every job log in the repo.
fn runs_glob(repo_path: &str) -> String {
    Path::new(repo_path)
        .join(".treq")
        .join("runs")
        .join("*")
        .join("*.jsonl")
        .to_string_lossy()
        .to_string()
}

/// True when at least one log file exists, so callers can skip DuckDB entirely.
fn has_any_logs(repo_path: &str) -> bool {
    let runs_dir = Path::new(repo_path).join(".treq").join("runs");
    let Ok(entries) = std::fs::read_dir(&runs_dir) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|run_dir| {
        std::fs::read_dir(run_dir.path())
            .map(|mut files| {
                files.any(|f| {
                    f.ok()
                        .map(|f| f.file_name().to_string_lossy().ends_with(".jsonl"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

/// SQL defining the `logs` view: every run's JSONL, with `run_id` and `job_id`
/// recovered from the file path so cross-run queries can group by them.
fn logs_view_sql(repo_path: &str) -> String {
    format!(
        "CREATE OR REPLACE VIEW logs AS
         SELECT
           CAST(regexp_extract(filename, 'runs/([0-9]+)/', 1) AS BIGINT) AS run_id,
           regexp_extract(filename, '/([^/]+)\\.jsonl$', 1) AS job_id,
           CAST(ts AS VARCHAR) AS ts,
           CAST(step_index AS BIGINT) AS step_index,
           CAST(step_name AS VARCHAR) AS step_name,
           CAST(stream AS VARCHAR) AS stream,
           CAST(level AS VARCHAR) AS level,
           CAST(message AS VARCHAR) AS message
         FROM read_json_auto('{}', format='newline_delimited', filename=true)",
        sql_quote(&runs_glob(repo_path))
    )
}

/// Open an in-memory DuckDB with the `logs` view registered.
fn connect_with_logs_view(repo_path: &str) -> Result<duckdb::Connection, String> {
    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("Failed to open DuckDB connection: {}", e))?;
    conn.execute_batch(&logs_view_sql(repo_path))
        .map_err(|e| format!("Failed to register logs view: {}", e))?;
    Ok(conn)
}

/// Browse log lines across every run in the repo.
pub fn query_repo_logs(repo_path: &str, query: &LogQuery) -> Result<Vec<RepoLogLine>, String> {
    if !has_any_logs(repo_path) {
        return Ok(vec![]);
    }
    let conn = connect_with_logs_view(repo_path)?;

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT run_id, job_id, ts, step_index, step_name, stream, level, message
         FROM logs {} ORDER BY run_id DESC, ts, step_index LIMIT {} OFFSET {}",
        build_where_clause(query),
        limit,
        offset
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare repo log query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RepoLogLine {
                run_id: row.get(0)?,
                job_id: row.get(1)?,
                ts: row.get(2)?,
                step_index: row.get(3)?,
                step_name: row.get(4)?,
                stream: row.get(5)?,
                level: row.get(6)?,
                message: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query repo logs: {}", e))?;

    rows.collect::<duckdb::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read repo log rows: {}", e))
}

// ── SQL explorer ─────────────────────────────────────────────────────────────

/// Statement kinds the explorer will run. Everything else is rejected so a
/// stray COPY/ATTACH/INSTALL can't write files or pull in extensions.
const ALLOWED_SQL_PREFIXES: [&str; 6] =
    ["select", "with", "describe", "show", "explain", "summarize"];

/// Reject anything that isn't a single read-only statement.
fn validate_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("Query is empty".to_string());
    }
    // One statement only: a second one could smuggle in a write.
    if trimmed.contains(';') {
        return Err("Only a single statement can be run at a time".to_string());
    }

    let lower = trimmed.to_lowercase();
    if !ALLOWED_SQL_PREFIXES
        .iter()
        .any(|p| lower.starts_with(p) && lower[p.len()..].starts_with(char::is_whitespace))
    {
        return Err(
            "Only read-only queries are allowed (SELECT, WITH, DESCRIBE, SHOW, EXPLAIN, SUMMARIZE)"
                .to_string(),
        );
    }

    // These can still appear mid-statement, e.g. inside a CTE body.
    let blocked = [
        "attach ", "copy ", "install ", "load ", "export ", "import ", "create ", "insert ",
        "update ", "delete ", "drop ", "alter ",
    ];
    if let Some(word) = blocked.iter().find(|w| lower.contains(*w)) {
        return Err(format!(
            "Statement contains a disallowed keyword: {}",
            word.trim()
        ));
    }
    Ok(())
}

/// Run an ad-hoc read-only query against the `logs` view.
pub fn run_logs_sql(repo_path: &str, sql: &str, max_rows: i64) -> Result<SqlResult, String> {
    validate_sql(sql)?;

    if !has_any_logs(repo_path) {
        return Err(
            "No check logs recorded yet — run a workflow check to populate the logs table."
                .to_string(),
        );
    }

    let conn = connect_with_logs_view(repo_path)?;
    let capped = format!(
        "SELECT * FROM ({}) AS explorer_query LIMIT {}",
        sql.trim().trim_end_matches(';'),
        max_rows.clamp(1, 10_000)
    );

    let mut stmt = conn
        .prepare(&capped)
        .map_err(|e| format!("Query error: {}", e))?;
    let mut rows = stmt.query([]).map_err(|e| format!("Query error: {}", e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut out_rows: Vec<Vec<Option<String>>> = Vec::new();

    while let Some(row) = rows.next().map_err(|e| format!("Query error: {}", e))? {
        if columns.is_empty() {
            columns = row
                .as_ref()
                .column_names()
                .into_iter()
                .map(String::from)
                .collect();
        }
        let mut cells = Vec::with_capacity(columns.len());
        for idx in 0..columns.len() {
            // Everything is stringified; the grid renders text regardless of type.
            let value: Option<String> = row
                .get::<_, Option<String>>(idx)
                .or_else(|_| {
                    row.get::<_, Option<i64>>(idx)
                        .map(|v| v.map(|n| n.to_string()))
                })
                .or_else(|_| {
                    row.get::<_, Option<f64>>(idx)
                        .map(|v| v.map(|n| n.to_string()))
                })
                .or_else(|_| {
                    row.get::<_, Option<bool>>(idx)
                        .map(|v| v.map(|b| b.to_string()))
                })
                .unwrap_or(None);
            cells.push(value);
        }
        out_rows.push(cells);
    }

    // A zero-row result still needs its header, which the loop above never saw.
    if columns.is_empty() {
        columns = stmt.column_names().into_iter().map(String::from).collect();
    }

    let row_count = out_rows.len();
    Ok(SqlResult {
        columns,
        rows: out_rows,
        row_count,
    })
}

/// Render a job's logs as a plain text file suitable for sharing.
pub fn export_logs(absolute_log_path: &str, dest_path: &str) -> Result<String, String> {
    let lines = query_logs(
        absolute_log_path,
        &LogQuery {
            limit: Some(100_000),
            ..Default::default()
        },
    )?;

    let mut out = String::new();
    for line in &lines {
        out.push_str(&format!("{}  [{}] {}\n", line.ts, line.level, line.message));
    }

    if let Some(parent) = Path::new(dest_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export directory: {}", e))?;
    }
    std::fs::write(dest_path, out).map_err(|e| format!("Failed to write export file: {}", e))?;
    Ok(dest_path.to_string())
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_line(step_index: i64, level: &str, message: &str) -> LogLine {
        LogLine {
            ts: format!("2026-07-26T11:00:0{}Z", step_index),
            step_index,
            step_name: format!("step {}", step_index),
            stream: "stdout".to_string(),
            level: level.to_string(),
            message: message.to_string(),
        }
    }

    fn write_log(dir: &TempDir, lines: &[LogLine]) -> String {
        let writer = LogWriter::create(&dir.path().to_string_lossy(), 1, "job").unwrap();
        for line in lines {
            writer.write_line(line).unwrap();
        }
        writer.flush().unwrap();
        dir.path()
            .join(".treq/runs/1/job.jsonl")
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn test_infer_level_classifies_errors_and_warnings() {
        assert_eq!(infer_level("error: build failed"), "error");
        assert_eq!(infer_level("warning: unused variable"), "warning");
        assert_eq!(infer_level("Compiling treq v0.1.3"), "info");
    }

    #[test]
    fn test_strip_ansi_removes_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[31mred\u{1b}[0m text"), "red text");
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn test_sanitize_job_id_replaces_path_characters() {
        assert_eq!(sanitize_job_id("../escape"), "___escape");
        assert_eq!(sanitize_job_id("build-job_1"), "build-job_1");
    }

    #[test]
    fn test_query_logs_returns_empty_for_missing_file() {
        let result = query_logs("/nonexistent/path/logs.jsonl", &LogQuery::default()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_logs_reads_written_lines() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(&path, &LogQuery::default()).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].message, "hello");
    }

    #[test]
    fn test_query_logs_filters_by_level() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec!["error".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].message, "boom");
    }

    #[test]
    fn test_query_logs_filters_by_search_and_step() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "compiling crate"),
                sample_line(1, "info", "linking binary"),
            ],
        );
        let by_search = query_logs(
            &path,
            &LogQuery {
                search: Some("LINKING".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_search.len(), 1);

        let by_step = query_logs(
            &path,
            &LogQuery {
                step_index: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_step.len(), 1);
    }

    #[test]
    fn test_query_logs_filters_by_multiple_levels() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "warning", "careful"),
                sample_line(2, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec!["warning".to_string(), "error".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|l| l.level != "info"));
    }

    #[test]
    fn test_empty_levels_list_does_not_filter() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec![]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_query_repo_logs_spans_runs_with_ids() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        for run_id in [1i64, 2i64] {
            let writer = LogWriter::create(&repo, run_id, "build").unwrap();
            writer
                .write_line(&sample_line(0, "info", &format!("run {}", run_id)))
                .unwrap();
            writer.flush().unwrap();
        }

        let result = query_repo_logs(&repo, &LogQuery::default()).unwrap();
        assert_eq!(result.len(), 2);
        // Newest run first, and run/job identity is recovered from the path.
        assert_eq!(result[0].run_id, 2);
        assert_eq!(result[0].job_id, "build");
    }

    #[test]
    fn test_query_repo_logs_empty_without_runs() {
        let dir = TempDir::new().unwrap();
        let result = query_repo_logs(&dir.path().to_string_lossy(), &LogQuery::default()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_validate_sql_rejects_writes_and_multiple_statements() {
        assert!(validate_sql("SELECT * FROM logs").is_ok());
        assert!(validate_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_sql("DROP TABLE logs").is_err());
        assert!(validate_sql("SELECT 1; DROP TABLE logs").is_err());
        assert!(validate_sql("COPY logs TO '/tmp/out.csv'").is_err());
        assert!(validate_sql("").is_err());
    }

    #[test]
    fn test_run_logs_sql_returns_columns_and_rows() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 1, "build").unwrap();
        writer.write_line(&sample_line(0, "error", "boom")).unwrap();
        writer.write_line(&sample_line(1, "info", "fine")).unwrap();
        writer.flush().unwrap();

        let result = run_logs_sql(
            &repo,
            "SELECT level, count(*) AS n FROM logs GROUP BY level ORDER BY level",
            100,
        )
        .unwrap();
        assert_eq!(result.columns, vec!["level", "n"]);
        assert_eq!(result.row_count, 2);
    }

    #[test]
    fn test_run_logs_sql_rejects_disallowed_statement() {
        let dir = TempDir::new().unwrap();
        let err = run_logs_sql(&dir.path().to_string_lossy(), "DELETE FROM logs", 100).unwrap_err();
        assert!(err.contains("read-only"));
    }

    #[test]
    fn test_export_logs_writes_plain_text() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let dest = dir.path().join("out.log").to_string_lossy().to_string();
        export_logs(&path, &dest).unwrap();
        let contents = std::fs::read_to_string(&dest).unwrap();
        assert!(contents.contains("[error] boom"));
        assert_eq!(contents.lines().count(), 2);
    }
}
