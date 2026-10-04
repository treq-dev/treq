use super::*;
use wiremock::matchers::{body_partial_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

pub(crate) fn local(token: &str) -> GoogleSource {
  GoogleSource::Local {
    tokens: StoredTokens {
      access_token: token.into(),
      refresh_token: None,
      expires_at: None,
      lifetime_secs: None,
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
    lifetime_secs: None,
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
    lifetime_secs: None,
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
    lifetime_secs: None,
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
fn short_lived_tokens_use_half_their_lifetime_as_margin() {
  let tokens = StoredTokens {
    access_token: "a".into(),
    refresh_token: Some("r".into()),
    expires_at: Some(now_secs() + 50),
    lifetime_secs: Some(60),
  };
  assert!(is_fresh(&tokens));
  let old = StoredTokens {
    lifetime_secs: None,
    ..tokens
  };
  assert!(!is_fresh(&old));
  let grant = tokens_from_grant(&json!({"access_token": "x", "expires_in": 60}), None).unwrap();
  assert_eq!(grant.lifetime_secs, Some(60));
}

#[tokio::test]
async fn failed_refresh_is_reused_briefly() {
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/token"))
    .respond_with(ResponseTemplate::new(500).set_body_json(json!({"error": "server_error"})))
    .expect(1)
    .mount(&server)
    .await;
  let tokens = StoredTokens {
    access_token: "stale".into(),
    refresh_token: Some("fails-once".into()),
    expires_at: Some(now_secs() - 10),
    lifetime_secs: None,
  };
  let (a, b) = tokio::join!(
    local_access_token(&tokens, "cid", &None, &None),
    local_access_token(&tokens, "cid", &None, &None)
  );
  assert_eq!(a.unwrap_err(), b.unwrap_err());
}

#[tokio::test]
async fn invalid_grant_clears_local_tokens() {
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/token"))
    .respond_with(ResponseTemplate::new(400).set_body_json(
      json!({"error": "invalid_grant", "error_description": "Token has been expired or revoked."}),
    ))
    .mount(&server)
    .await;
  let dir = tempfile::tempdir().unwrap();
  let db_path = dir.path().join("treq.db");
  let db = Database::new(db_path.clone()).unwrap();
  db.init().unwrap();
  let tokens = StoredTokens {
    access_token: "stale".into(),
    refresh_token: Some("revoked".into()),
    expires_at: Some(now_secs() - 10),
    lifetime_secs: None,
  };
  store_local_grant(&db, &tokens, "cid", None).unwrap();
  let source = resolve_source(&db, db_path.clone()).unwrap();
  assert_eq!(
    connection_status(Ok(source.clone())).await.mode,
    ConnectionMode::Local
  );
  let err = list_task_lists(&source).await.unwrap_err();
  assert_eq!(err, REVOKED);
  assert!(read_local_tokens(&db).is_none());
  assert_eq!(
    connection_status(resolve_source(&db, db_path)).await.mode,
    ConnectionMode::None
  );
}

#[test]
fn connection_mode_serializes_lowercase() {
  let status = GoogleConnectionStatus {
    mode: ConnectionMode::Local,
  };
  assert_eq!(
    serde_json::to_value(&status).unwrap(),
    json!({"mode": "local"})
  );
}

#[test]
fn disconnect_removes_the_token_setting() {
  let dir = tempfile::tempdir().unwrap();
  let db = Database::new(dir.path().join("treq.db")).unwrap();
  db.init().unwrap();
  db.set_setting(TOKENS_SETTING, "{}").unwrap();
  disconnect_local(&db).unwrap();
  assert_eq!(db.get_setting(TOKENS_SETTING).unwrap(), None);
}

#[tokio::test]
async fn idle_connections_do_not_delay_the_redirect() {
  use tokio::io::AsyncWriteExt;
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let addr = listener.local_addr().unwrap();
  let waiter = tokio::spawn(async move { wait_for_code(&listener, "st").await });
  let mut idle = Vec::new();
  for _ in 0..20 {
    idle.push(tokio::net::TcpStream::connect(addr).await.unwrap());
  }
  let started = std::time::Instant::now();
  let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
  s.write_all(b"GET /?state=st&code=good HTTP/1.1\r\n\r\n")
    .await
    .unwrap();
  let code = waiter.await.unwrap().unwrap();
  assert_eq!(code, "good");
  // Twenty idle connections read one after another would take 20 × 200 ms.
  assert!(started.elapsed() < Duration::from_millis(1000));
}

#[tokio::test]
async fn cancel_ends_a_waiting_sign_in() {
  begin_local_oauth("cid".into(), None).await.unwrap();
  let waiter = tokio::spawn(complete_local_oauth());
  tokio::time::sleep(Duration::from_millis(50)).await;
  cancel_local_oauth().await;
  let result = tokio::time::timeout(Duration::from_secs(5), waiter)
    .await
    .unwrap()
    .unwrap();
  assert_eq!(result.unwrap_err(), "Google sign-in was cancelled");

  // Cancelled before anyone waited: the next complete reports it too.
  begin_local_oauth("cid".into(), None).await.unwrap();
  cancel_local_oauth().await;
  assert_eq!(
    complete_local_oauth().await.unwrap_err(),
    "Google sign-in was cancelled"
  );

  // Cancelled while the code is being exchanged: the exchange is abandoned.
  // Kept in this test because sign-in state is global.
  let server = mock().await;
  Mock::given(method("POST"))
    .and(path("/token"))
    .respond_with(
      ResponseTemplate::new(200)
        .set_delay(Duration::from_secs(10))
        .set_body_json(json!({"access_token": "a", "expires_in": 3600})),
    )
    .mount(&server)
    .await;
  let url = begin_local_oauth("cid".into(), None).await.unwrap();
  let url = url::Url::parse(&url).unwrap();
  let param = |k: &str| {
    url
      .query_pairs()
      .find(|(key, _)| key == k)
      .unwrap()
      .1
      .into_owned()
  };
  let redirect = url::Url::parse(&param("redirect_uri")).unwrap();
  let waiter = tokio::spawn(complete_local_oauth());
  tokio::time::sleep(Duration::from_millis(50)).await;
  let mut s = tokio::net::TcpStream::connect(("127.0.0.1", redirect.port().unwrap()))
    .await
    .unwrap();
  use tokio::io::AsyncWriteExt;
  s.write_all(format!("GET /?state={}&code=c HTTP/1.1\r\n\r\n", param("state")).as_bytes())
    .await
    .unwrap();
  // Wait until the exchange request reaches the token endpoint.
  for _ in 0..100 {
    if !server.received_requests().await.unwrap().is_empty() {
      break;
    }
    tokio::time::sleep(Duration::from_millis(20)).await;
  }
  cancel_local_oauth().await;
  let result = tokio::time::timeout(Duration::from_secs(5), waiter)
    .await
    .unwrap()
    .unwrap();
  assert_eq!(result.unwrap_err(), "Google sign-in was cancelled");
  assert!(active_slot().is_none());
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
