//! Standalone process wrapping `treq_mobile_ssh::mock_server`, so the
//! Kotlin (JVM+JNA) and Swift FFI jobs in `.github/workflows/mobile.yml`
//! have a *real* SSH server to connect to over a real socket - built with
//! `--features ffi-tests`, never part of an ordinary build.
//!
//! Two modes:
//!
//! - `mock_ssh_server <bind_addr>`: starts the server. Prints a single
//!   line, `LISTENING <host> <port> <fingerprint_sha256>`, then blocks
//!   forever serving connections. A CI step greps that line to learn
//!   where to connect.
//! - `mock_ssh_server sign-cert <public_key_openssh>`: signs a throwaway
//!   OpenSSH user certificate for the given public key and prints it,
//!   then exits. Lets FFI test programs that have no certificate-signing
//!   library of their own (Kotlin, Swift) get a real certificate to
//!   exercise `connect_with_certificate` with.

use russh::keys::HashAlg;
use treq_mobile_ssh::mock_server::{sign_test_certificate, start_mock_server};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let first = args.next();

    if first.as_deref() == Some("sign-cert") {
        let public_key = args.next().unwrap_or_else(|| {
            eprintln!("usage: mock_ssh_server sign-cert <public_key_openssh>");
            std::process::exit(2);
        });
        match sign_test_certificate(&public_key) {
            Ok(cert) => println!("{cert}"),
            Err(e) => {
                eprintln!("failed to sign certificate: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let bind_addr = first.unwrap_or_else(|| "127.0.0.1:0".to_string());

    let (addr, host_key) = start_mock_server(&bind_addr).await;
    let fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

    println!("LISTENING {} {} {}", addr.ip(), addr.port(), fingerprint);
    use std::io::Write;
    std::io::stdout().flush().ok();

    // Serve forever; the CI step kills this process once its test run
    // finishes.
    std::future::pending::<()>().await;
}
