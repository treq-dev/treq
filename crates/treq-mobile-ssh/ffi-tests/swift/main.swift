// Real, unmocked verification that Swift can drive the compiled
// treq-mobile-ssh Rust library through the UniFFI-generated bindings: no
// JS/TS mock stands in for `SshClient` here - this calls the actual native
// library and, for the connect/exec assertions, talks over a real TCP
// socket to the `mock_ssh_server` example binary (`treq_mobile_ssh::mock_server`,
// gated behind the `ffi-tests` Cargo feature) started by the CI job.
//
// Run via `.github/workflows/mobile.yml`'s `swift-ffi` job. Expects three
// CLI args: the mock server's port and its SHA256 host-key fingerprint
// (both printed by `mock_ssh_server` as `LISTENING <host> <port> <fp>`),
// and the path to the `mock_ssh_server` binary itself (used to sign a real
// test certificate via its `sign-cert` subcommand - see
// `mock_server::sign_test_certificate`).

import Foundation

let args = CommandLine.arguments
guard args.count == 4, let port = UInt16(args[1]) else {
  fatalError("usage: SshClientFfiTest <port> <fingerprint_sha256> <mock_ssh_server_path>")
}
let fingerprint = args[2]
let mockServerPath = args[3]

let client = SshClient()

// 1. Real ed25519 key generation and OpenSSH encoding, in real Rust.
let deviceKey = try! client.generateDeviceKey()
guard deviceKey.publicKeyOpenssh.hasPrefix("ssh-ed25519 ") else {
  fatalError("expected an ssh-ed25519 public key, got: \(deviceKey.publicKeyOpenssh)")
}
guard deviceKey.fingerprintSha256.hasPrefix("SHA256:") else {
  fatalError("expected a SHA256 fingerprint, got: \(deviceKey.fingerprintSha256)")
}
guard deviceKey.privateKeyPem.contains("BEGIN OPENSSH PRIVATE KEY") else {
  fatalError("expected an OpenSSH-armored private key")
}
print("OK: generateDeviceKey produced a real ed25519 keypair")

// 2. Host-key pinning really rejects a wrong fingerprint, over a real TCP
//    connection to the real mock server (not a mocked promise).
do {
  _ = try client.connect(
    host: "127.0.0.1", port: port, username: "treq",
    privateKeyPem: deviceKey.privateKeyPem,
    expectedFingerprintSha256: "SHA256:not-the-real-fingerprint")
  fatalError("expected connect() to reject a mismatched host-key fingerprint")
} catch SshError.ConnectionFailed {
  print("OK: connect() rejected a mismatched host-key fingerprint")
}

// 3. A real connect + exec round trip: the mock server accepts any public
//    key and echoes the command it received as JSON.
let sessionId = try! client.connect(
  host: "127.0.0.1", port: port, username: "treq",
  privateKeyPem: deviceKey.privateKeyPem,
  expectedFingerprintSha256: fingerprint)
let result = try! client.execCommand(sessionId: sessionId, argv: ["treq", "workspace", "list"])
guard result.exitStatus == 0 else {
  fatalError("expected exit status 0, got \(result.exitStatus)")
}
guard result.stdout.contains("'treq' 'workspace' 'list'") else {
  fatalError("expected the mock server's echoed command in stdout, got: \(result.stdout)")
}
print("OK: connect + execCommand round-tripped over a real SSH session")

// 3b. connectWithCertificate: a real OpenSSH user certificate, signed by
//     shelling out to `mock_ssh_server sign-cert` (Swift has no
//     certificate-building library of its own), presented over a real SSH
//     session.
let certProcess = Process()
certProcess.executableURL = URL(fileURLWithPath: mockServerPath)
certProcess.arguments = ["sign-cert", deviceKey.publicKeyOpenssh]
let certPipe = Pipe()
certProcess.standardOutput = certPipe
try! certProcess.run()
certProcess.waitUntilExit()
guard certProcess.terminationStatus == 0 else {
  fatalError("mock_ssh_server sign-cert exited non-zero")
}
let certData = certPipe.fileHandleForReading.readDataToEndOfFile()
let certificate = String(data: certData, encoding: .utf8)!.trimmingCharacters(in: .whitespacesAndNewlines)
guard certificate.hasPrefix("ssh-ed25519-cert-v01@openssh.com ") else {
  fatalError("expected a real OpenSSH certificate, got: \(certificate)")
}
let certSessionId = try! client.connectWithCertificate(
  host: "127.0.0.1", port: port, username: "treq",
  privateKeyPem: deviceKey.privateKeyPem,
  certificateOpenssh: certificate,
  expectedFingerprintSha256: fingerprint)
let certResult = try! client.execCommand(sessionId: certSessionId, argv: ["treq", "workspace", "list"])
guard certResult.exitStatus == 0 else {
  fatalError("expected exit status 0 for cert session, got \(certResult.exitStatus)")
}
client.disconnect(sessionId: certSessionId)
print("OK: connectWithCertificate authenticated with a real signed certificate")

// 4. disconnect() really tears the session down.
client.disconnect(sessionId: sessionId)
do {
  _ = try client.execCommand(sessionId: sessionId, argv: ["treq"])
  fatalError("expected execCommand() to fail on a disconnected session")
} catch SshError.SessionNotFound {
  print("OK: execCommand() failed on a disconnected session")
}

print("ALL SWIFT FFI CHECKS PASSED")
