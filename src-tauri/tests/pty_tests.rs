mod e2e_test_helpers;

use e2e_test_helpers::TestRepo;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use treq_lib::pty::{line_matches_auto_command, strip_ansi_codes, PtyManager};

/// Helper: create a PtyManager and an output capture buffer.
fn setup() -> (PtyManager, Arc<Mutex<String>>) {
    let manager = PtyManager::new();
    let output = Arc::new(Mutex::new(String::new()));
    (manager, output)
}

/// Helper: build a callback that appends output to the shared buffer.
fn make_callback(output: &Arc<Mutex<String>>) -> Box<dyn Fn(String) + Send + 'static> {
    let output = Arc::clone(output);
    Box::new(move |data: String| {
        let mut buf = output.lock().unwrap();
        buf.push_str(&data);
    })
}

/// Helper: wait for output buffer to contain a substring (with timeout).
fn wait_for_output(output: &Arc<Mutex<String>>, needle: &str, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    loop {
        {
            let buf = output.lock().unwrap();
            if buf.contains(needle) {
                return true;
            }
        }
        if start.elapsed() > timeout {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn is_process_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_process_alive(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}")])
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains(&pid.to_string()) && !stdout.contains("No tasks are running")
        }
        Err(_) => false,
    }
}

#[test]
fn test_pty_manager_new() {
    let manager = PtyManager::new();
    assert!(!manager.session_exists("nonexistent-session"));
    assert!(!manager.session_exists(""));
    assert!(!manager.session_exists("abc-123"));
}

#[test]
fn test_create_session() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    let result = manager.create_session(
        "test-create".to_string(),
        Some(repo.repo_path.clone()),
        None,
        None,
        None,
        make_callback(&output),
    );

    assert!(
        result.is_ok(),
        "create_session should succeed: {:?}",
        result
    );
    assert!(manager.session_exists("test-create"));

    // Cleanup
    let _ = manager.close_session("test-create");
}

#[test]
fn test_create_session_with_initial_command() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    let result = manager.create_session(
        "test-initial-cmd".to_string(),
        Some(repo.repo_path.clone()),
        None,
        Some("echo HELLO_FROM_INIT".to_string()),
        None,
        make_callback(&output),
    );

    assert!(result.is_ok());

    // Wait for the initial command output
    let found = wait_for_output(&output, "HELLO_FROM_INIT", 5000);
    assert!(
        found,
        "Expected 'HELLO_FROM_INIT' in output, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-initial-cmd");
}

#[test]
fn test_write_to_session() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-write".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell prompt to appear
    thread::sleep(Duration::from_millis(500));

    // Write a command
    let result = manager.write_to_session("test-write", "echo WRITE_TEST_OK\n");
    assert!(
        result.is_ok(),
        "write_to_session should succeed: {:?}",
        result
    );

    let found = wait_for_output(&output, "WRITE_TEST_OK", 5000);
    assert!(
        found,
        "Expected 'WRITE_TEST_OK' in output, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-write");
}

#[test]
fn test_write_to_nonexistent_session() {
    let manager = PtyManager::new();

    let result = manager.write_to_session("does-not-exist", "hello\n");
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Session not found");
}

#[test]
fn test_resize_session() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-resize".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Resize should succeed
    let result = manager.resize_session("test-resize", 48, 120);
    assert!(
        result.is_ok(),
        "resize_session should succeed: {:?}",
        result
    );

    // Resize to different dimensions should also succeed
    let result = manager.resize_session("test-resize", 24, 80);
    assert!(result.is_ok());

    let _ = manager.close_session("test-resize");
}

#[test]
fn test_resize_nonexistent_session() {
    let manager = PtyManager::new();

    let result = manager.resize_session("does-not-exist", 24, 80);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Session not found");
}

#[test]
fn test_close_session() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-close".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    assert!(manager.session_exists("test-close"));

    let result = manager.close_session("test-close");
    assert!(result.is_ok());
    assert!(!manager.session_exists("test-close"));

    // Closing again should still succeed (idempotent)
    let result = manager.close_session("test-close");
    assert!(result.is_ok());
}

#[test]
fn test_close_session_terminates_process() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-close-terminates".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    let pid = manager
        .session_process_id("test-close-terminates")
        .expect("session should expose a process id");

    assert!(
        is_process_alive(pid),
        "Process should be alive before close. pid={pid}"
    );

    manager
        .close_session("test-close-terminates")
        .expect("close_session should succeed");

    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline && is_process_alive(pid) {
        thread::sleep(Duration::from_millis(50));
    }

    assert!(
        !is_process_alive(pid),
        "Process should be terminated after close. pid={pid}"
    );
}

#[test]
fn test_multiple_concurrent_sessions() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let manager = PtyManager::new();

    let output_a = Arc::new(Mutex::new(String::new()));
    let output_b = Arc::new(Mutex::new(String::new()));
    let output_c = Arc::new(Mutex::new(String::new()));

    // Create 3 sessions
    manager
        .create_session(
            "multi-a".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output_a),
        )
        .expect("create session A");

    manager
        .create_session(
            "multi-b".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output_b),
        )
        .expect("create session B");

    manager
        .create_session(
            "multi-c".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output_c),
        )
        .expect("create session C");

    assert!(manager.session_exists("multi-a"));
    assert!(manager.session_exists("multi-b"));
    assert!(manager.session_exists("multi-c"));

    // Wait for shells to be ready
    thread::sleep(Duration::from_millis(500));

    // Write unique commands to each session
    manager
        .write_to_session("multi-a", "echo SESSION_A_OUTPUT\n")
        .expect("write to A");
    manager
        .write_to_session("multi-b", "echo SESSION_B_OUTPUT\n")
        .expect("write to B");
    manager
        .write_to_session("multi-c", "echo SESSION_C_OUTPUT\n")
        .expect("write to C");

    // Verify each session got its output
    assert!(
        wait_for_output(&output_a, "SESSION_A_OUTPUT", 5000),
        "Session A output: {}",
        output_a.lock().unwrap()
    );
    assert!(
        wait_for_output(&output_b, "SESSION_B_OUTPUT", 5000),
        "Session B output: {}",
        output_b.lock().unwrap()
    );
    assert!(
        wait_for_output(&output_c, "SESSION_C_OUTPUT", 5000),
        "Session C output: {}",
        output_c.lock().unwrap()
    );

    // Cleanup
    let _ = manager.close_session("multi-a");
    let _ = manager.close_session("multi-b");
    let _ = manager.close_session("multi-c");
}

#[test]
fn test_session_isolation() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let manager = PtyManager::new();

    let output_a = Arc::new(Mutex::new(String::new()));
    let output_b = Arc::new(Mutex::new(String::new()));

    manager
        .create_session(
            "iso-a".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output_a),
        )
        .expect("create session A");

    manager
        .create_session(
            "iso-b".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output_b),
        )
        .expect("create session B");

    // Wait for shells
    thread::sleep(Duration::from_millis(500));

    // Write a unique marker to session A only
    manager
        .write_to_session("iso-a", "echo UNIQUE_MARKER_ISOLATION_A\n")
        .expect("write to A");

    // Wait for A's output
    assert!(
        wait_for_output(&output_a, "UNIQUE_MARKER_ISOLATION_A", 5000),
        "Session A should have the marker"
    );

    // Give session B some time to receive any cross-contaminated output
    thread::sleep(Duration::from_millis(500));

    // Session B should NOT contain the marker from session A
    let b_output = output_b.lock().unwrap();
    assert!(
        !b_output.contains("UNIQUE_MARKER_ISOLATION_A"),
        "Session B should not contain session A's output, but got: {}",
        b_output
    );

    let _ = manager.close_session("iso-a");
    let _ = manager.close_session("iso-b");
}

#[test]
fn test_utf8_output() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-utf8".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell
    thread::sleep(Duration::from_millis(500));

    // Test CJK characters
    manager
        .write_to_session("test-utf8", "echo '你好世界'\n")
        .expect("write CJK");
    assert!(
        wait_for_output(&output, "你好世界", 5000),
        "CJK output expected, got: {}",
        output.lock().unwrap()
    );

    // Test emoji
    manager
        .write_to_session("test-utf8", "echo '🎉🚀✨'\n")
        .expect("write emoji");
    assert!(
        wait_for_output(&output, "🎉🚀✨", 5000),
        "Emoji output expected, got: {}",
        output.lock().unwrap()
    );

    // Test mixed symbols
    manager
        .write_to_session("test-utf8", "echo '€£¥©®™'\n")
        .expect("write symbols");
    assert!(
        wait_for_output(&output, "€£¥©®™", 5000),
        "Symbol output expected, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-utf8");
}

#[test]
fn test_strip_ansi_codes_cases() {
    // Table-driven: each case is a (name, input, expected) triple. Used to be four
    // near-identical single-assertion tests for different escape sequence kinds.
    let cases: Vec<(&str, &str, &str)> = vec![
        ("plain text is untouched", "hello world", "hello world"),
        ("CSI color codes are stripped", "\x1b[32mhello\x1b[0m", "hello"),
        ("CSI codes with multiple params are stripped", "\x1b[1;31mred\x1b[0m", "red"),
        ("OSC title-setting sequence is stripped", "\x1b]0;title\x07text", "text"),
        ("charset selection sequence is stripped", "\x1b(Bhello", "hello"),
    ];

    for (name, input, expected) in cases {
        assert_eq!(strip_ansi_codes(input), expected, "case: {name}");
    }
}

#[test]
fn test_line_matches_auto_command_cases() {
    // Table-driven: each case is (name, line, auto_cmd, expected_match). Used to be
    // five near-identical tests exercising line_matches_auto_command's substring
    // matching heuristic.
    struct Case {
        name: &'static str,
        line: &'static str,
        auto_cmd: &'static str,
        expected: bool,
    }

    let cases = vec![
        Case {
            name: "lines shorter than 20 chars never match",
            line: "short",
            auto_cmd: "some long auto command that is definitely long enough",
            expected: false,
        },
        Case {
            name: "exact substring match",
            line: "claude --permission-mode acceptEdits --append-system-prompt 'some long prompt'",
            auto_cmd: "claude --permission-mode acceptEdits --append-system-prompt 'some long prompt'",
            expected: true,
        },
        Case {
            name: "line contains a 20+ char substring of the auto command",
            line: "$ claude --permission-mode acceptEdits --append-system-prompt 'very long system prompt text here'",
            auto_cmd: "claude --permission-mode acceptEdits --append-system-prompt 'very long system prompt text here'",
            expected: true,
        },
        Case {
            name: "unrelated long line does not match",
            line: "total 42\ndrwxr-xr-x  5 user  staff  160 Jan  1 00:00 .",
            auto_cmd: "claude --permission-mode acceptEdits --append-system-prompt 'some prompt'",
            expected: false,
        },
        Case {
            name: "normal CLI output does not match (greeting)",
            line: "Hello! How can I help you today?",
            auto_cmd: "claude --permission-mode acceptEdits --append-system-prompt 'hello world this is a test'",
            expected: false,
        },
        Case {
            name: "normal CLI output does not match (progress message)",
            line: "Processing your request...",
            auto_cmd: "claude --permission-mode acceptEdits --append-system-prompt 'hello world this is a test'",
            expected: false,
        },
    ];

    for case in cases {
        assert_eq!(
            line_matches_auto_command(case.line, case.auto_cmd),
            case.expected,
            "case: {}",
            case.name
        );
    }
}

#[test]
fn test_set_auto_command_nonexistent_session() {
    let manager = PtyManager::new();
    let result = manager.set_auto_command("nonexistent", "some command");
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "Session not found");
}

#[test]
fn test_set_auto_command_on_session() {
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-auto-cmd".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // set_auto_command should succeed on an existing session
    let result = manager.set_auto_command("test-auto-cmd", "some long test command string here");
    assert!(
        result.is_ok(),
        "set_auto_command should succeed: {:?}",
        result
    );

    let _ = manager.close_session("test-auto-cmd");
}

#[test]
fn test_suppress_echo_filters_command() {
    // Simulates the real workflow: set_auto_command + write the matching command.
    // The command echo should be filtered, but subsequent output should pass through.
    // Uses `true` which produces no output (avoids output-matching-filter issue).
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-suppress".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell to be ready
    thread::sleep(Duration::from_millis(500));

    // Simulate ptyWriteSuppressEcho: set filter then write the MATCHING command.
    // `true` produces no output, so only the echo is filtered.
    let cmd = "true # suppress-test-unique-ident-1234567890";
    manager
        .set_auto_command("test-suppress", cmd)
        .expect("set_auto_command");
    manager
        .write_to_session("test-suppress", &format!("{}\n", cmd))
        .expect("write filtered command");

    // Wait for filtered command to be processed
    thread::sleep(Duration::from_millis(300));

    // Now write a follow-up command — its output should appear
    manager
        .write_to_session("test-suppress", "echo VISIBLE_AFTER\n")
        .expect("write follow-up command");

    let found = wait_for_output(&output, "VISIBLE_AFTER", 5000);
    assert!(
        found,
        "Expected output after filtered command echo, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-suppress");
}

#[test]
fn test_normal_output_not_filtered_without_filter() {
    // Sessions without a filter should pass all output through unmodified
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-no-filter".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell to be ready
    thread::sleep(Duration::from_millis(500));

    // No filter set — write a command directly
    manager
        .write_to_session("test-no-filter", "echo NORMAL_OUTPUT_VISIBLE\n")
        .expect("write command");

    let found = wait_for_output(&output, "NORMAL_OUTPUT_VISIBLE", 5000);
    assert!(
        found,
        "Normal output should not be filtered, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-no-filter");
}

#[test]
fn test_empty_lines_filtered_during_suppression() {
    // After the command echo is seen, empty lines should still be filtered
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    manager
        .create_session(
            "test-empty-filter".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            None,
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell to be ready
    thread::sleep(Duration::from_millis(500));

    // Set filter and write matching command (triggers seen_command_echo)
    let cmd = "echo TRIGGER_ECHO_MATCH_1234567890_ABCDE";
    manager
        .set_auto_command("test-empty-filter", cmd)
        .expect("set_auto_command");
    manager
        .write_to_session("test-empty-filter", &format!("{}\n", cmd))
        .expect("write trigger command");

    // Wait for the trigger to be processed
    thread::sleep(Duration::from_millis(500));

    // Now write empty lines followed by a real command
    manager
        .write_to_session("test-empty-filter", "echo AFTER_EMPTY_LINES\n")
        .expect("write commands");

    let found = wait_for_output(&output, "AFTER_EMPTY_LINES", 5000);
    assert!(
        found,
        "Output after empty lines should appear, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-empty-filter");
}

#[test]
fn test_suppress_echo_at_creation_filters_initial_prompt() {
    // Filter set at creation time suppresses shell prompt and all output
    // until the matching command echo is seen.
    let repo = TestRepo::new_without_init().expect("Failed to create test repo");
    let (manager, output) = setup();

    // Use `true` so only the echo is filtered, not command output
    let filter_cmd = "true # creation-filter-unique-ident-1234567890";
    manager
        .create_session(
            "test-creation-filter".to_string(),
            Some(repo.repo_path.clone()),
            None,
            None,
            Some(filter_cmd.to_string()),
            make_callback(&output),
        )
        .expect("create_session should succeed");

    // Wait for shell prompt to be emitted (and filtered since filter is active)
    thread::sleep(Duration::from_millis(500));

    // The initial prompt should have been suppressed.
    {
        let buf = output.lock().unwrap();
        let stripped = strip_ansi_codes(&buf);
        assert!(
            stripped.trim().is_empty(),
            "Initial prompt should be suppressed, but got: {}",
            buf.clone()
        );
    }

    // Now write the matching command (simulates ptyWriteSuppressEcho)
    manager
        .write_to_session("test-creation-filter", &format!("{}\n", filter_cmd))
        .expect("write filtered command");

    // Wait for it to be processed
    thread::sleep(Duration::from_millis(300));

    // Write a follow-up command to verify output works
    manager
        .write_to_session("test-creation-filter", "echo CREATION_VISIBLE\n")
        .expect("write follow-up command");

    let found = wait_for_output(&output, "CREATION_VISIBLE", 5000);
    assert!(
        found,
        "Output should appear after creation-time filter, got: {}",
        output.lock().unwrap()
    );

    let _ = manager.close_session("test-creation-filter");
}
