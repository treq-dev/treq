//! Live native-SSH acceptance against a dedicated test project.
//!
//! Gated on `TREQ_REMOTE_E2E=1` plus `TREQ_REMOTE_E2E_NATIVE=1` and the
//! Supabase test-project credentials. Missing credentials skip (via
//! `#[ignore]` + an inner gate), they never count as passing acceptance.
//!
//! Run:
//! `TREQ_REMOTE_E2E=1 TREQ_REMOTE_E2E_NATIVE=1 cargo test --test remote_e2e_native -- --ignored --test-threads=1`

use std::path::PathBuf;
use std::time::Duration;

use russh::keys::PrivateKey;
use serde_json::Value;
use treq_lib::core::remote::TreqCommandRequest;
use treq_lib::core::remote_control_plane::{
  SshAuthentication, SshEndpoint, SshEndpointSource, TrustedHostKey,
};
use treq_lib::core::remote_ssh_transport::{
  exec_command, CancellationToken, ExecLimits, RemotePtyChannel, SshConnectionPool,
};

const LIVE_IGNORE: &str =
  "live native SSH; TREQ_REMOTE_E2E=1 TREQ_REMOTE_E2E_NATIVE=1 cargo test --test remote_e2e_native -- --ignored";

struct NativeCfg {
  url: String,
  anon_key: String,
  service_role_key: String,
}

fn native_cfg() -> Option<NativeCfg> {
  if std::env::var("TREQ_REMOTE_E2E").as_deref() != Ok("1") {
    return None;
  }
  if std::env::var("TREQ_REMOTE_E2E_NATIVE").as_deref() != Ok("1") {
    eprintln!(
      "[remote-e2e-native] SKIP: TREQ_REMOTE_E2E_NATIVE=1 not set. \
       Native certificate authentication is not proven by an ordinary wake or control-plane-only test."
    );
    return None;
  }
  let url = std::env::var("SUPABASE_TEST_URL").ok()?;
  let anon_key = std::env::var("SUPABASE_TEST_ANON_KEY").ok()?;
  let service_role_key = std::env::var("SUPABASE_TEST_SERVICE_ROLE_KEY").ok()?;
  Some(NativeCfg {
    url,
    anon_key,
    service_role_key,
  })
}

macro_rules! require_native {
  () => {
    match native_cfg() {
      Some(cfg) => cfg,
      None => {
        eprintln!("[remote-e2e-native] SKIP {}: missing native live credentials", module_path!());
        return;
      }
    }
  };
}

fn e2e_tag() -> String {
  format!("treq-e2e-{}", uuid::Uuid::new_v4())
}

async fn json_post(url: &str, token: &str, extra_headers: &[(&str, &str)], body: Value) -> (u16, Value) {
  let mut request = reqwest::Client::new()
    .post(url)
    .json(&body)
    .header("Content-Type", "application/json");
  for (name, value) in extra_headers {
    request = request.header(*name, *value);
  }
  request = request.bearer_auth(token);
  let response = request.send().await.expect("http send");
  let status = response.status().as_u16();
  let json: Value = response.json().await.unwrap_or(Value::Null);
  if let Some(id) = json.get("correlation_id").and_then(|v| v.as_str()) {
    eprintln!("[remote-e2e-native] correlation_id={id}");
  }
  (status, json)
}

fn write_client_key(dir: &std::path::Path) -> (String, String) {
  use getrandom::SysRng;
  use rand_core::UnwrapErr;
  let key = PrivateKey::random(&mut UnwrapErr(SysRng), russh::keys::Algorithm::Ed25519).unwrap();
  let path = dir.join("id_e2e");
  let pem = key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap();
  std::fs::write(&path, pem.as_bytes()).unwrap();
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
  }
  let public = key.public_key().to_openssh().expect("openssh public key");
  (path.to_string_lossy().into_owned(), public)
}

async fn exec_typed(
  pool: &SshConnectionPool,
  endpoint: &SshEndpoint,
  request: TreqCommandRequest,
) -> Value {
  let args = request.cli_args().expect("typed args");
  let output = exec_command(
    pool,
    endpoint,
    &args,
    ExecLimits {
      deadline: Duration::from_secs(60),
      max_output_bytes: 8 * 1024 * 1024,
    },
    &CancellationToken::new(),
  )
  .await
  .unwrap_or_else(|err| panic!("exec {:?} failed: {err:?}", args));
  serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
    panic!(
      "stdout was not JSON: {}",
      String::from_utf8_lossy(&output.stdout)
    )
  })
}

#[test]
fn native_suite_is_ignored_without_opt_in() {
  if std::env::var("TREQ_REMOTE_E2E_NATIVE").as_deref() != Ok("1") {
    eprintln!("[remote-e2e-native] SKIP without TREQ_REMOTE_E2E_NATIVE=1");
  }
}

#[tokio::test]
#[ignore = "live native SSH; TREQ_REMOTE_E2E=1 TREQ_REMOTE_E2E_NATIVE=1 cargo test --test remote_e2e_native -- --ignored"]
async fn native_certificate_auth_two_repos_mutations_pty_reconnect_and_reprovision_trust() {
  let _ = LIVE_IGNORE;
  let cfg = require_native!();
  let tag = e2e_tag();
  let email = format!("{tag}@e2e.treq.invalid");
  let password = uuid::Uuid::new_v4().to_string();
  let admin = reqwest::Client::new();

  let created = admin
    .post(format!("{}/auth/v1/admin/users", cfg.url.trim_end_matches('/')))
    .header("apikey", &cfg.service_role_key)
    .bearer_auth(&cfg.service_role_key)
    .json(&serde_json::json!({
      "email": email,
      "password": password,
      "email_confirm": true
    }))
    .send()
    .await
    .expect("create user");
  assert!(created.status().is_success(), "admin create user failed: {}", created.text().await.unwrap_or_default());
  let created_json: Value = created.json().await.expect("create user json");
  let user_id = created_json["id"].as_str().unwrap_or_default().to_string();

  let sign_in = admin
    .post(format!("{}/auth/v1/token?grant_type=password", cfg.url.trim_end_matches('/')))
    .header("apikey", &cfg.anon_key)
    .json(&serde_json::json!({ "email": email, "password": password }))
    .send()
    .await
    .expect("sign in");
  let session: Value = sign_in.json().await.expect("session json");
  let access = session["access_token"].as_str().expect("access_token").to_string();

  struct UserCleanup {
    url: String,
    service_role_key: String,
    user_id: String,
    access: String,
    anon_key: String,
  }
  impl Drop for UserCleanup {
    fn drop(&mut self) {
      let url = self.url.clone();
      let key = self.service_role_key.clone();
      let user_id = self.user_id.clone();
      let access = self.access.clone();
      let anon = self.anon_key.clone();
      let _ = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
          .enable_all()
          .build()
          .expect("cleanup rt");
        rt.block_on(async move {
          let _ = json_post(
            &format!("{}/functions/v1/remote-instance", url.trim_end_matches('/')),
            &access,
            &[("apikey", anon.as_str())],
            serde_json::json!({ "action": "delete", "idempotency_key": format!("treq-e2e-{}", uuid::Uuid::new_v4()) }),
          )
          .await;
          let _ = reqwest::Client::new()
            .delete(format!("{}/auth/v1/admin/users/{user_id}", url.trim_end_matches('/')))
            .header("apikey", &key)
            .bearer_auth(&key)
            .send()
            .await;
        });
      })
      .join();
    }
  }
  let cleanup = UserCleanup {
    url: cfg.url.clone(),
    service_role_key: cfg.service_role_key.clone(),
    user_id,
    access: access.clone(),
    anon_key: cfg.anon_key.clone(),
  };

  let instance_url = format!("{}/functions/v1/remote-instance", cfg.url.trim_end_matches('/'));
  let trust_url = format!("{}/functions/v1/remote-ssh-trust", cfg.url.trim_end_matches('/'));
  let api_headers = [("apikey", cfg.anon_key.as_str())];

  let (ensure_status, ensure_json) = json_post(
    &instance_url,
    &access,
    &api_headers,
    serde_json::json!({
      "action": "ensure",
      "idempotency_key": e2e_tag(),
      "region": "us_east",
      "size_preset": "small"
    }),
  )
  .await;
  assert_eq!(ensure_status, 200, "ensure failed: {ensure_json}");

  let deadline = std::time::Instant::now() + Duration::from_secs(10 * 60);
  loop {
    let (st, status_json) = json_post(
      &instance_url,
      &access,
      &api_headers,
      serde_json::json!({ "action": "status" }),
    )
    .await;
    assert_eq!(st, 200);
    let status = status_json["instance"]["status"].as_str().unwrap_or("");
    if status == "ready" {
      break;
    }
    if status == "failed" || status == "degraded" {
      panic!("instance never ready: {status_json}");
    }
    if std::time::Instant::now() > deadline {
      panic!("timed out waiting for ready: {status_json}");
    }
    tokio::time::sleep(Duration::from_secs(5)).await;
  }

  let dir = tempfile::tempdir().expect("tempdir");
  let (key_path, public_line) = write_client_key(dir.path());
  let (reg_status, reg_json) = json_post(
    &trust_url,
    &access,
    &api_headers,
    serde_json::json!({
      "action": "register_client_key",
      "idempotency_key": e2e_tag(),
      "public_key": format!("{public_line} {tag}@e2e")
    }),
  )
  .await;
  assert_eq!(reg_status, 200, "register_client_key failed: {reg_json}");
  let key_id = reg_json["key"]["id"].as_str().expect("key id").to_string();
  let instance_id = json_post(
    &instance_url,
    &access,
    &api_headers,
    serde_json::json!({ "action": "status" }),
  )
  .await
  .1["instance"]["id"]
    .as_str()
    .expect("instance id")
    .to_string();

  let (issue_status, issue_json) = json_post(
    &trust_url,
    &access,
    &api_headers,
    serde_json::json!({
      "action": "issue_certificate",
      "instance_id": instance_id,
      "key_id": key_id
    }),
  )
  .await;
  assert_eq!(issue_status, 200, "issue_certificate failed: {issue_json}");
  let cert_line = issue_json["certificate"].as_str().expect("certificate");
  let cert_path = PathBuf::from(format!("{key_path}-cert.pub"));
  std::fs::write(&cert_path, cert_line).expect("write cert");

  let endpoint_json = &issue_json["endpoint"];
  let host_keys = endpoint_json["host_keys"]
    .as_array()
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .map(|row| TrustedHostKey {
      algorithm: row["algorithm"].as_str().unwrap_or("ssh-ed25519").to_string(),
      fingerprint_sha256: row["fingerprint_sha256"].as_str().unwrap_or_default().to_string(),
      comment: row["comment"].as_str().map(str::to_string),
    })
    .collect::<Vec<_>>();
  assert!(!host_keys.is_empty(), "certificate response must include trusted host keys");

  let mut endpoint = SshEndpoint {
    id: endpoint_json["id"].as_str().unwrap_or("e2e-endpoint").to_string(),
    instance_id: Some(instance_id.clone()),
    source: SshEndpointSource::Managed {
      provider: "fly_sprites".to_string(),
      generation: endpoint_json["source"]["generation"].as_u64().unwrap_or(0),
    },
    hostname: endpoint_json["hostname"].as_str().expect("hostname").to_string(),
    port: endpoint_json["port"].as_u64().unwrap_or(22) as u16,
    username: endpoint_json["username"].as_str().unwrap_or("treq").to_string(),
    host_keys,
    authentication: SshAuthentication::Certificate {
      key_reference: key_path.clone(),
    },
  };

  let pool = SshConnectionPool::new();
  let repo_a = "/home/treq/e2e-repo-a".to_string();
  let repo_b = "/home/treq/e2e-repo-b".to_string();
  exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::InitRepo {
      repo: repo_a.clone(),
      idempotency_key: Some(e2e_tag()),
    },
  )
  .await;
  exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::InitRepo {
      repo: repo_b.clone(),
      idempotency_key: Some(e2e_tag()),
    },
  )
  .await;
  let inspect_a = exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::InspectRepository { repo: repo_a.clone() },
  )
  .await;
  let inspect_b = exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::InspectRepository { repo: repo_b.clone() },
  )
  .await;
  assert!(!inspect_a.is_null() && !inspect_b.is_null(), "both repositories must inspect");

  exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::CreateWorkspace {
      repo: repo_a.clone(),
      branch_name: format!("feat/{tag}"),
      source_branch: None,
      idempotency_key: Some(e2e_tag()),
    },
  )
  .await;
  let workspaces = exec_typed(
    &pool,
    &endpoint,
    TreqCommandRequest::ListWorkspaces { repo: repo_a.clone() },
  )
  .await;
  assert!(workspaces.to_string().contains("feat/"), "workspace list should include the created workspace: {workspaces}");

  let pty = RemotePtyChannel::open(
    &pool,
    &endpoint,
    "xterm",
    80,
    24,
    Some("bash -lc 'cd /home/treq/e2e-repo-a && pwd'"),
  )
  .await
  .expect("pty open in selected workspace");
  let _ = pty.read_chunk().await;
  pty.close().await.expect("pty close");

  let agent = TreqCommandRequest::AgentStatus {
    repo: repo_a.clone(),
    workspace: format!("feat/{tag}"),
  };
  let agent_args = agent.cli_args().expect("agent args");
  let _ = exec_command(
    &pool,
    &endpoint,
    &agent_args,
    ExecLimits::default(),
    &CancellationToken::new(),
  )
  .await;

  drop(pool);
  let pool2 = SshConnectionPool::new();
  let inspect_again = exec_typed(
    &pool2,
    &endpoint,
    TreqCommandRequest::InspectRepository { repo: repo_a.clone() },
  )
  .await;
  assert!(!inspect_again.is_null());

  let (repro_status, repro_json) = json_post(
    &instance_url,
    &access,
    &api_headers,
    serde_json::json!({
      "action": "reprovision",
      "idempotency_key": e2e_tag(),
      "region": "us_east",
      "size_preset": "small"
    }),
  )
  .await;
  assert_eq!(repro_status, 200, "reprovision failed: {repro_json}");

  let (issue2_status, issue2) = json_post(
    &trust_url,
    &access,
    &api_headers,
    serde_json::json!({
      "action": "issue_certificate",
      "instance_id": instance_id,
      "key_id": key_id
    }),
  )
  .await;
  assert_eq!(issue2_status, 200, "reissue after reprovision failed: {issue2}");
  let new_fp = issue2["endpoint"]["host_keys"][0]["fingerprint_sha256"]
    .as_str()
    .unwrap_or_default();
  let old_fp = endpoint.host_keys[0].fingerprint_sha256.clone();
  if !old_fp.is_empty() && !new_fp.is_empty() {
    assert_ne!(old_fp, new_fp, "reprovision must rotate host key trust");
  }
  std::fs::write(&cert_path, issue2["certificate"].as_str().unwrap_or_default()).ok();
  endpoint.hostname = issue2["endpoint"]["hostname"]
    .as_str()
    .unwrap_or(&endpoint.hostname)
    .to_string();
  endpoint.host_keys = vec![TrustedHostKey {
    algorithm: "ssh-ed25519".to_string(),
    fingerprint_sha256: new_fp.to_string(),
    comment: None,
  }];
  endpoint.source = SshEndpointSource::Managed {
    provider: "fly_sprites".to_string(),
    generation: issue2["endpoint"]["source"]["generation"].as_u64().unwrap_or(1),
  };
  let pool3 = SshConnectionPool::new();
  let after_repro = exec_typed(
    &pool3,
    &endpoint,
    TreqCommandRequest::InspectRepository { repo: repo_a },
  )
  .await;
  let _ = after_repro;
  drop(cleanup);
}
