//! Standalone process wrapping `treq_mobile_ssh::mock_server`, so the
//! Kotlin (JVM+JNA) and Swift FFI jobs in `.github/workflows/mobile.yml`
//! have a *real* SSH server to connect to over a real socket - built with
//! `--features ffi-tests`, never part of an ordinary build.
//!
//! Prints a single line, `LISTENING <host> <port> <fingerprint_sha256>`,
//! then blocks forever serving connections. A CI step greps that line to
//! learn where to connect.

use russh::keys::HashAlg;
use treq_mobile_ssh::mock_server::start_mock_server;

#[tokio::main]
async fn main() {
    let bind_addr = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:0".to_string());

    let (addr, host_key) = start_mock_server(&bind_addr).await;
    let fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

    println!("LISTENING {} {} {}", addr.ip(), addr.port(), fingerprint);
    use std::io::Write;
    std::io::stdout().flush().ok();

    // Serve forever; the CI step kills this process once its test run
    // finishes.
    std::future::pending::<()>().await;
}
