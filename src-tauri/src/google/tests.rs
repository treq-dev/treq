use super::*;
use wiremock::matchers::{body_partial_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

pub(crate) fn local(token: &str) -> GoogleSource {
  GoogleSource::Local {
    tokens: StoredTokens {
      access_token: token.into(),
      refresh_token: None,
      expires_at: None,
    },
    client_id: "cid".into(),
    client_secret: None,
    token_db: None,
  }
}

pub(crate) async fn mock() -> MockServer {
  let server = MockServer::start().await;
  TEST_BASE.with(|b| *b.borrow_mut() = Some(server.uri()));
  server
}

#[test]
fn base64url_matches_rfc4648_vectors() {
  assert_eq!(base64url(b""), "");
  assert_eq!(base64url(b"f"), "Zg");
  assert_eq!(base64url(b"fo"), "Zm8");
  assert_eq!(base64url(b"foo"), "Zm9v");
  assert_eq!(base64url(b"foob"), "Zm9vYg");
  assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
}

#[test]
fn pkce_challenge_matches_rfc7636_example() {
  assert_eq!(
    pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  );
}

#[test]
fn authorize_url_requests_offline_pkce_grant() {
  let url = authorize_url("cid", "http://127.0.0.1:5000", "st", "ch");
  for part in [
    "client_id=cid",
    "code_challenge=ch",
    "code_challenge_method=S256",
    "access_type=offline",
    "state=st",
    "redirect_uri=http%3A%2F%2F127.0.0.1%3A5000",
  ] {
    assert!(url.contains(part), "{url} missing {part}");
  }
}

#[test]
fn parse_redirect_checks_state_and_path() {
  assert_eq!(
    parse_redirect("GET /?state=abc&code=xyz HTTP/1.1", "abc"),
    Redirect::Code("xyz".into())
  );
  assert_eq!(
    parse_redirect("GET /?error=access_denied&state=abc HTTP/1.1", "abc"),
    Redirect::Denied("access_denied".into())
  );
  for line in [
    "GET /?state=bad&code=xyz HTTP/1.1",
    "GET /?error=access_denied HTTP/1.1",
    "GET /favicon.ico HTTP/1.1",
    "GET /other?state=abc&code=xyz HTTP/1.1",
    "POST /?state=abc&code=xyz HTTP/1.1",
    "garbage",
  ] {
    assert_eq!(parse_redirect(line, "abc"), Redirect::Ignore, "{line}");
  }
}

#[tokio::test]
async fn listener_survives_stray_and_silent_connections() {
  use tokio::io::{AsyncReadExt, AsyncWriteExt};
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let addr = listener.local_addr().unwrap();
  let waiter = tokio::spawn(async move { wait_for_code(&listener, "st").await });

  // A wrong state and a stray path are ignored, not fatal.
  for request in [
    "GET /?state=bad&error=x HTTP/1.1\r\n\r\n",
    "GET /favicon.ico HTTP/1.1\r\n\r\n",
  ] {
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(request.as_bytes()).await.unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).await.unwrap();
    assert!(out.starts_with("HTTP/1.1 404"), "{out}");
  }
  // A silent connection is dropped after the read timeout; then the real
  // redirect still completes the sign-in.
  let _silent = tokio::net::TcpStream::connect(addr).await.unwrap();
  let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
  s.write_all(b"GET /?state=st&code=good HTTP/1.1\r\n\r\n")
    .await
    .unwrap();
  let code = tokio::time::timeout(Duration::from_secs(10), waiter)
    .await
    .unwrap()
    .unwrap();
  assert_eq!(code.unwrap(), "good");
}

#[test]
fn local_tokens_win_over_proxy() {
  let tokens = StoredTokens {
    access_token: "a".into(),
    refresh_token: None,
    expires_at: None,
  };
  let session = ProxySession {
    supabase_url: "u".into(),
    access_token: "t".into(),
  };
  assert!(matches!(
    choose_source(
      Some(tokens.clone()),
      Some("cid".into()),
      None,
      Some(session.clone())
    ),
    Ok(GoogleSource::Local { .. })
  ));
  assert!(matches!(
    choose_source(None, None, None, Some(session)),
    Ok(GoogleSource::Proxy(_))
  ));
  assert!(choose_source(Some(tokens), None, None, None).is_err());
}

#[test]
fn grant_keeps_previous_refresh_token() {
  let tokens = tokens_from_grant(
    &json!({"access_token": "new", "expires_in": 3600}),
    Some("old-refresh".into()),
  )
  .unwrap();
  assert_eq!(tokens.refresh_token.as_deref(), Some("old-refresh"));
  assert!(tokens.expires_at.unwrap() > now_secs());
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
  Mock::given(method("POST"))
    .and(path("/tasks/v1/lists/L1/tasks/t1/move"))
    .and(query_param("destinationTasklist", "L2"))
    .respond_with(
      ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "title": "T", "position": "1"})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let task = move_task(&local("tok"), "L1", "t1", Some("L2"), None)
    .await
    .unwrap();
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
async fn expired_local_token_is_refreshed() {
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/token"))
    .respond_with(
      ResponseTemplate::new(200)
        .set_body_json(json!({"access_token": "fresh", "expires_in": 3600})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let tokens = StoredTokens {
    access_token: "stale".into(),
    refresh_token: Some("r".into()),
    expires_at: Some(now_secs() - 10),
  };
  let token = local_access_token(&tokens, "cid", &None, &None)
    .await
    .unwrap();
  assert_eq!(token, "fresh");
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
  assert_eq!(id, "c1");
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
async fn concurrent_refreshes_hit_google_once() {
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/token"))
    .respond_with(
      ResponseTemplate::new(200)
        .set_body_json(json!({"access_token": "fresh", "expires_in": 3600})),
    )
    .expect(1)
    .mount(&server)
    .await;
  let tokens = StoredTokens {
    access_token: "stale".into(),
    refresh_token: Some("single-flight".into()),
    expires_at: Some(now_secs() - 10),
  };
  let (a, b) = tokio::join!(
    local_access_token(&tokens, "cid", &None, &None),
    local_access_token(&tokens, "cid", &None, &None)
  );
  assert_eq!(
    (a.unwrap(), b.unwrap()),
    ("fresh".to_string(), "fresh".to_string())
  );
}
