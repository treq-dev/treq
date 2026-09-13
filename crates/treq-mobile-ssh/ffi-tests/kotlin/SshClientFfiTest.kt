// Real, unmocked verification that Kotlin can drive the compiled
// treq-mobile-ssh Rust library through the UniFFI-generated bindings: no
// JS/TS mock stands in for `uniffi.treq_mobile_ssh.SshClient` here - this
// calls the actual native library (loaded by JNA from `-Djna.library.path`)
// and, for the connect/exec assertions, talks over a real TCP socket to
// the `mock_ssh_server` example binary (`treq_mobile_ssh::mock_server`,
// gated behind the `ffi-tests` Cargo feature) started by the CI job.
//
// Run via `.github/workflows/mobile.yml`'s `kotlin-ffi` job. Expects three
// CLI args: the mock server's port and its SHA256 host-key fingerprint
// (both printed by `mock_ssh_server` as `LISTENING <host> <port> <fp>`),
// and the path to the `mock_ssh_server` binary itself (used to sign a real
// test certificate via its `sign-cert` subcommand - see
// `mock_server::sign_test_certificate`).

import uniffi.treq_mobile_ssh.SshClient
import uniffi.treq_mobile_ssh.SshException

fun main(args: Array<String>) {
    require(args.size == 3) { "usage: SshClientFfiTest <port> <fingerprint_sha256> <mock_ssh_server_path>" }
    val port = args[0].toInt()
    val fingerprint = args[1]
    val mockServerPath = args[2]

    val client = SshClient()

    // 1. Real ed25519 key generation and OpenSSH encoding, in real Rust.
    val deviceKey = client.generateDeviceKey()
    check(deviceKey.publicKeyOpenssh.startsWith("ssh-ed25519 ")) {
        "expected an ssh-ed25519 public key, got: ${deviceKey.publicKeyOpenssh}"
    }
    check(deviceKey.fingerprintSha256.startsWith("SHA256:")) {
        "expected a SHA256 fingerprint, got: ${deviceKey.fingerprintSha256}"
    }
    check(deviceKey.privateKeyPem.contains("BEGIN OPENSSH PRIVATE KEY")) {
        "expected an OpenSSH-armored private key"
    }
    println("OK: generateDeviceKey produced a real ed25519 keypair")

    // 2. Host-key pinning really rejects a wrong fingerprint, over a real
    //    TCP connection to the real mock server (not a mocked promise).
    try {
        client.connect("127.0.0.1", port.toUShort(), "treq", deviceKey.privateKeyPem, "SHA256:not-the-real-fingerprint")
        error("expected connect() to reject a mismatched host-key fingerprint")
    } catch (e: SshException.ConnectionFailed) {
        println("OK: connect() rejected a mismatched host-key fingerprint")
    }

    // 3. A real connect + exec round trip: the mock server accepts any
    //    public key and echoes the command it received as JSON.
    val sessionId = client.connect("127.0.0.1", port.toUShort(), "treq", deviceKey.privateKeyPem, fingerprint)
    val result = client.execCommand(sessionId, listOf("treq", "workspace", "list"))
    check(result.exitStatus == 0) { "expected exit status 0, got ${result.exitStatus}" }
    check(result.stdout.contains("'treq' 'workspace' 'list'")) {
        "expected the mock server's echoed command in stdout, got: ${result.stdout}"
    }
    println("OK: connect + execCommand round-tripped over a real SSH session")

    // 3b. connectWithCertificate: a real OpenSSH user certificate, signed
    //     by shelling out to `mock_ssh_server sign-cert` (Kotlin has no
    //     certificate-building library of its own), presented over a real
    //     SSH session.
    val certProcess = ProcessBuilder(mockServerPath, "sign-cert", deviceKey.publicKeyOpenssh)
        .redirectErrorStream(false)
        .start()
    val certificate = certProcess.inputStream.bufferedReader().readText().trim()
    check(certProcess.waitFor() == 0) { "mock_ssh_server sign-cert exited non-zero" }
    check(certificate.startsWith("ssh-ed25519-cert-v01@openssh.com ")) {
        "expected a real OpenSSH certificate, got: $certificate"
    }
    val certSessionId = client.connectWithCertificate(
        "127.0.0.1", port.toUShort(), "treq", deviceKey.privateKeyPem, certificate, fingerprint,
    )
    val certResult = client.execCommand(certSessionId, listOf("treq", "workspace", "list"))
    check(certResult.exitStatus == 0) { "expected exit status 0 for cert session, got ${certResult.exitStatus}" }
    client.disconnect(certSessionId)
    println("OK: connectWithCertificate authenticated with a real signed certificate")

    // 4. disconnect() really tears the session down.
    client.disconnect(sessionId)
    try {
        client.execCommand(sessionId, listOf("treq"))
        error("expected execCommand() to fail on a disconnected session")
    } catch (e: SshException.SessionNotFound) {
        println("OK: execCommand() failed on a disconnected session")
    }

    println("ALL KOTLIN FFI CHECKS PASSED")
}
