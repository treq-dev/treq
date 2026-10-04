use super::*;
use wiremock::matchers::{body_partial_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Calls the mock server directly, standing in for the proxy.
pub(crate) fn local(_token: &str) -> GoogleSource {
  GoogleSource::Direct
}

pub(crate) async fn mock() -> MockServer {
  let server = MockServer::start().await;
  TEST_BASE.with(|b| *b.borrow_mut() = Some(server.uri()));
  server
}

#[test]
fn drive_query_escapes_search() {
  assert_eq!(
    drive_query(Some("it's"), true),
    format!("trashed = false and mimeType = '{GOOGLE_DOC_MIME}' and fullText contains 'it\\'s'")
  );
}

#[tokio::test]
async fn lists_tasks_across_pages_sorted_by_position() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks"))
    .and(query_param("pageToken", "p2"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({
      "items": [{"id": "a", "title": "A", "status": "needsAction", "position": "001"}]
    })))
    .mount(&server)
    .await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({
      "items": [
        {"id": "b", "title": "B", "status": "completed", "position": "002"},
        {"id": "gone", "title": "x", "deleted": true, "position": "000"}
      ],
      "nextPageToken": "p2"
    })))
    .mount(&server)
    .await;
  let tasks = list_tasks(&local("tok"), "L1").await.unwrap();
  let ids: Vec<_> = tasks.iter().map(|t| t.id.as_str()).collect();
  assert_eq!(ids, ["a", "b"]);
  assert_eq!(tasks[1].status, "completed");
}

#[tokio::test]
async fn moves_task_to_another_list() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"items": []})))
    .mount(&server)
    .await;
  Mock::given(method("POST"))
    .and(path("/tasks/v1/lists/L1/tasks/t1/move"))
    .and(query_param("destinationTasklist", "L2"))
    .respond_with(
      ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "title": "T", "position": "1"})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let task = move_task(&local("tok"), "L1", "t1", Some("L2"), None, None)
    .await
    .unwrap()
    .task;
  assert_eq!(task.list_id, "L2");
}

#[tokio::test]
async fn reopening_task_clears_completed() {
  let server = mock().await;
  Mock::given(method("PATCH"))
    .and(path("/tasks/v1/lists/L1/tasks/t1"))
    .and(body_partial_json(
      json!({"status": "needsAction", "completed": null}),
    ))
    .respond_with(
      ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "status": "needsAction"})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let input = TaskInput {
    status: Some("needsAction".into()),
    ..Default::default()
  };
  update_task(&local("tok"), "L1", "t1", &input)
    .await
    .unwrap();
}

#[tokio::test]
async fn google_errors_surface_their_message() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/users/@me/lists"))
    .respond_with(
      ResponseTemplate::new(403).set_body_json(json!({"error": {"message": "Tasks API disabled"}})),
    )
    .mount(&server)
    .await;
  let err = list_task_lists(&local("tok")).await.unwrap_err();
  assert_eq!(err, "Google: Tasks API disabled");
}

#[tokio::test]
async fn exports_google_doc_as_markdown() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/drive/v3/files/doc1/export"))
    .and(query_param("mimeType", "text/markdown"))
    .respond_with(ResponseTemplate::new(200).set_body_raw("# Title\nBody\n", "text/markdown"))
    .mount(&server)
    .await;
  let file =
    map_drive_file(&json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})).unwrap();
  assert_eq!(
    export_text(&local("tok"), &file).await.unwrap(),
    "# Title\nBody\n"
  );
}

#[tokio::test]
async fn comment_carries_quote() {
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/drive/v3/files/doc1/comments"))
    .and(body_partial_json(
      json!({"content": "fix", "quotedFileContent": {"value": "Body"}}),
    ))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "c1"})))
    .expect(1)
    .mount(&server)
    .await;
  let id = create_comment(&local("tok"), "doc1", "fix", Some("Body"))
    .await
    .unwrap();
  assert_eq!(id.as_deref(), Some("c1"));
}

#[test]
fn proxy_reconnect_message_is_kept() {
  let status = reqwest::StatusCode::UNAUTHORIZED;
  assert_eq!(
    error_message(
      status,
      r#"{"error":"Google authorization expired. Reconnect."}"#,
      true
    ),
    "Google authorization expired. Reconnect."
  );
  assert!(error_message(status, "", true).contains("Sign in to treq again"));
  assert!(error_message(status, "", false).contains("Reconnect Google Workspace"));
}

#[test]
fn path_segments_cannot_climb() {
  assert_eq!(seg(".."), "%2E%2E");
  assert_eq!(seg("a b/c"), "a%20b%2Fc");
  assert_eq!(seg("MTA-x_y~"), "MTA-x_y~");
}

#[test]
fn subtasks_are_created_under_their_parent() {
  assert_eq!(
    create_task_url("L1", Some("t 1")),
    format!("{TASKS_API}/lists/L1/tasks?parent=t+1")
  );
  assert_eq!(
    create_task_url("L1", None),
    format!("{TASKS_API}/lists/L1/tasks")
  );
}

#[tokio::test]
async fn pagination_stops_on_a_repeated_page_token() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({
      "items": [{"id": "a", "position": "1"}],
      "nextPageToken": "same"
    })))
    .expect(2)
    .mount(&server)
    .await;
  let tasks = list_tasks(&local("tok"), "L1").await.unwrap();
  assert_eq!(tasks.len(), 2);
}

#[tokio::test]
async fn pagination_is_capped() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/users/@me/lists"))
    .respond_with(move |req: &wiremock::Request| {
      let n = req
        .url
        .query_pairs()
        .find(|(k, _)| k == "pageToken")
        .map(|(_, v)| v.parse::<u32>().unwrap())
        .unwrap_or(0);
      ResponseTemplate::new(200).set_body_json(json!({
        "items": [{"id": format!("l{n}"), "title": "x"}],
        "nextPageToken": (n + 1).to_string()
      }))
    })
    .expect(50)
    .mount(&server)
    .await;
  let lists = list_task_lists(&local("tok")).await.unwrap();
  assert_eq!(lists.len(), 50);
}

#[tokio::test]
async fn task_lists_follow_page_tokens() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/users/@me/lists"))
    .and(query_param("pageToken", "p2"))
    .respond_with(
      ResponseTemplate::new(200).set_body_json(json!({"items": [{"id": "b", "title": "B"}]})),
    )
    .mount(&server)
    .await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/users/@me/lists"))
    .respond_with(
      ResponseTemplate::new(200)
        .set_body_json(json!({"items": [{"id": "a", "title": "A"}], "nextPageToken": "p2"})),
    )
    .mount(&server)
    .await;
  let ids: Vec<_> = list_task_lists(&local("tok"))
    .await
    .unwrap()
    .into_iter()
    .map(|l| l.id)
    .collect();
  assert_eq!(ids, ["a", "b"]);
}

#[tokio::test]
async fn drive_listing_follows_pages_up_to_the_cap() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/drive/v3/files"))
    .respond_with(move |req: &wiremock::Request| {
      let n = req
        .url
        .query_pairs()
        .find(|(k, _)| k == "pageToken")
        .map(|(_, v)| v.parse::<u32>().unwrap())
        .unwrap_or(0);
      ResponseTemplate::new(200).set_body_json(json!({
        "files": [{"id": format!("f{n}"), "name": "x", "mimeType": GOOGLE_DOC_MIME}],
        "nextPageToken": (n + 1).to_string()
      }))
    })
    .expect(4)
    .mount(&server)
    .await;
  let files = list_drive_files(&local("tok"), None, true).await.unwrap();
  assert_eq!(files.len(), 4);
}

#[tokio::test]
async fn empty_export_is_empty_text() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/drive/v3/files/doc1/export"))
    .respond_with(ResponseTemplate::new(200))
    .mount(&server)
    .await;
  let file =
    map_drive_file(&json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})).unwrap();
  assert_eq!(export_text(&local("tok"), &file).await.unwrap(), "");
}

#[tokio::test]
async fn json_download_is_returned_verbatim() {
  let server = mock().await;
  let raw = "{\"b\":1,  \"a\":2}\n";
  Mock::given(method("GET"))
    .and(path("/drive/v3/files/j1"))
    .and(query_param("alt", "media"))
    .respond_with(ResponseTemplate::new(200).set_body_raw(raw, "application/json"))
    .mount(&server)
    .await;
  let file =
    map_drive_file(&json!({"id": "j1", "name": "a.json", "mimeType": "application/json"})).unwrap();
  assert_eq!(export_text(&local("tok"), &file).await.unwrap(), raw);
}

#[tokio::test]
async fn oversized_export_is_refused() {
  let server = mock().await;
  let big = "x".repeat(MAX_RESPONSE_BYTES as usize + 1);
  Mock::given(method("GET"))
    .and(path("/drive/v3/files/doc1/export"))
    .respond_with(ResponseTemplate::new(200).set_body_raw(big, "text/markdown"))
    .mount(&server)
    .await;
  let file =
    map_drive_file(&json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})).unwrap();
  assert_eq!(
    export_text(&local("tok"), &file).await.unwrap_err(),
    "Document too large to review (over 20 MB)"
  );
}

#[test]
fn proxy_treq_session_401_asks_to_sign_in_again() {
  let status = reqwest::StatusCode::UNAUTHORIZED;
  assert_eq!(
    error_message(
      status,
      r#"{"error":"Unauthorized","code":"treq_session"}"#,
      true
    ),
    "treq could not authenticate with the Google proxy. Sign in to treq again."
  );
}

#[test]
fn connection_mode_serializes_lowercase() {
  let status = GoogleConnectionStatus {
    mode: ConnectionMode::Proxy,
  };
  assert_eq!(
    serde_json::to_value(&status).unwrap(),
    json!({"mode": "proxy"})
  );
}

#[tokio::test]
async fn cross_list_move_brings_subtasks_along() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"items": [
      {"id": "t1", "position": "1"},
      {"id": "s1", "parent": "t1", "position": "2"},
      {"id": "s2", "parent": "t1", "position": "2b"},
      {"id": "other", "position": "3"}
    ]})))
    .mount(&server)
    .await;
  Mock::given(method("POST"))
    .and(path("/tasks/v1/lists/L1/tasks/t1/move"))
    .and(query_param("destinationTasklist", "L2"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "position": "1"})))
    .expect(1)
    .mount(&server)
    .await;
  Mock::given(method("POST"))
    .and(path("/tasks/v1/lists/L1/tasks/s1/move"))
    .and(query_param("destinationTasklist", "L2"))
    .and(query_param("parent", "t1"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "s1", "position": "1"})))
    .expect(1)
    .mount(&server)
    .await;
  Mock::given(method("POST"))
    .and(path("/tasks/v1/lists/L1/tasks/s2/move"))
    .respond_with(ResponseTemplate::new(500).set_body_json(json!({"error": {"message": "boom"}})))
    .expect(1)
    .mount(&server)
    .await;
  let moved = move_task(&local("tok"), "L1", "t1", Some("L2"), None, None)
    .await
    .unwrap();
  assert_eq!(moved.task.list_id, "L2");
  assert_eq!(moved.failed_subtask_ids, ["s2"]);
}

#[test]
fn move_url_sends_only_allowed_params() {
  assert_eq!(
    move_task_url("L1", "t1", Some("L1"), Some("p"), Some("prev")),
    format!("{TASKS_API}/lists/L1/tasks/t1/move?parent=p&previous=prev")
  );
  assert_eq!(
    move_task_url("L1", "t1", None, None, None),
    format!("{TASKS_API}/lists/L1/tasks/t1/move")
  );
}

#[tokio::test]
async fn drive_calls_reject_invalid_ids() {
  let err = get_drive_file(&local("tok"), "../x").await.unwrap_err();
  assert!(err.contains("Invalid Google Drive file id"), "{err}");
}

#[tokio::test]
async fn proxy_forwards_request_with_session_token() {
  let server = MockServer::start().await;
  Mock::given(method("POST"))
    .and(path("/functions/v1/google-proxy"))
    .and(wiremock::matchers::header("authorization", "Bearer sess"))
    .and(body_partial_json(json!({
      "method": "PATCH",
      "url": format!("{TASKS_API}/lists/L1/tasks/t1"),
      "body": {"status": "completed"}
    })))
    .respond_with(
      ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "status": "completed"})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let source = GoogleSource::Proxy(ProxySession {
    supabase_url: server.uri(),
    access_token: "sess".into(),
  });
  let task = complete_task(&source, "L1", "t1").await.unwrap();
  assert_eq!(task.status, "completed");
}

#[tokio::test]
async fn connection_status_is_none_without_proxy() {
  assert_eq!(
    connection_status(Err(NOT_CONNECTED.into())).await.mode,
    ConnectionMode::None
  );
}

#[tokio::test]
async fn connection_status_is_proxy_when_linked() {
  let server = MockServer::start().await;
  Mock::given(method("POST"))
    .and(path("/functions/v1/google-proxy"))
    .and(body_partial_json(json!({"op": "status"})))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({"linked": true})))
    .mount(&server)
    .await;
  let source = GoogleSource::Proxy(ProxySession {
    supabase_url: server.uri(),
    access_token: "sess".into(),
  });
  assert_eq!(
    connection_status(Ok(source)).await.mode,
    ConnectionMode::Proxy
  );
}

#[tokio::test]
async fn gets_one_task() {
  let server = mock().await;
  Mock::given(method("GET"))
    .and(path("/tasks/v1/lists/L1/tasks/t1"))
    .respond_with(ResponseTemplate::new(200).set_body_json(
      json!({"id": "t1", "title": "Ship it", "notes": "n", "webViewLink": "https://x/t1"}),
    ))
    .mount(&server)
    .await;
  let task = get_task(&local("tok"), "L1", "t1").await.unwrap();
  assert_eq!(task.title, "Ship it");
  assert_eq!(task.web_link.as_deref(), Some("https://x/t1"));
}
