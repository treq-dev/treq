import Foundation
import Security

// Calls into the UniFFI Swift bindings generated from
// `crates/treq-mobile-ssh` (see mobile/README.md "Building the Rust side"
// for the `uniffi-bindgen generate --language swift` step that produces
// `TreqMobileSsh.swift`, which this file depends on but does not vendor).
//
// Responsible for the one thing the Rust crate deliberately does not own:
// keeping the device private key out of the React Native JS layer. A
// generated key's PEM never leaves this file - it is stored in the
// Keychain immediately and only an opaque `keyHandle` (the Keychain
// account name) crosses the RN bridge.
// Phase 7 ("Full PTY streaming and reattach"): extends the bridge with
// open_pty/pty_write/pty_resize/close_pty plus a background poll loop that
// emits a `TreqSshPtyEvent` RN event for each drained `PtyEvent` - the
// native-bridge half of `poll_pty_events`'s documented "spike result: no
// practical UniFFI async callback interface at this UDL-scaffolding
// version, so poll instead" decision. `RCTEventEmitter` (rather than plain
// `NSObject`) is what lets this module call `sendEvent(withName:body:)`.
//
// NOT built/run on a device or simulator in this environment (no macOS
// runner available here, same constraint Phase 2's PRD write-up notes for
// this file's original methods) - written to the same generated-bindings
// contract as the methods above, but unverified beyond compiling by eye
// against the UniFFI Swift codegen shape.
@objc(TreqSsh)
class TreqSshBridge: RCTEventEmitter {
  private let client = SshClient()
  private let keychainService = "com.treq.mobile-device-key"
  private var activePtyStreams: [String: Bool] = [:]
  private let ptyStreamQueue = DispatchQueue(label: "com.treq.mobile.pty-stream")

  override func supportedEvents() -> [String]! {
    return ["TreqSshPtyEvent"]
  }

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(generateDeviceKey:rejecter:)
  func generateDeviceKey(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let info = try client.generateDeviceKey()
      let keyHandle = UUID().uuidString
      try storeInKeychain(account: keyHandle, secret: info.privateKeyPem)
      resolve([
        "publicKeyOpenSsh": info.publicKeyOpenssh,
        "fingerprintSha256": info.fingerprintSha256,
        "keyHandle": keyHandle,
      ])
    } catch {
      reject("generate_device_key_failed", error.localizedDescription, error)
    }
  }

  @objc(connect:port:username:keyHandle:expectedFingerprintSha256:resolver:rejecter:)
  func connect(
    host: String,
    port: NSNumber,
    username: String,
    keyHandle: String,
    expectedFingerprintSha256: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let privateKeyPem = try loadFromKeychain(account: keyHandle)
      let sessionId = try client.connect(
        host: host,
        port: UInt16(truncating: port),
        username: username,
        privateKeyPem: privateKeyPem,
        expectedFingerprintSha256: expectedFingerprintSha256
      )
      resolve(String(sessionId))
    } catch {
      reject("connect_failed", error.localizedDescription, error)
    }
  }

  @objc(connectWithCertificate:port:username:keyHandle:certificateOpenSsh:expectedFingerprintSha256:resolver:rejecter:)
  func connectWithCertificate(
    host: String,
    port: NSNumber,
    username: String,
    keyHandle: String,
    certificateOpenSsh: String,
    expectedFingerprintSha256: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let privateKeyPem = try loadFromKeychain(account: keyHandle)
      let sessionId = try client.connectWithCertificate(
        host: host,
        port: UInt16(truncating: port),
        username: username,
        privateKeyPem: privateKeyPem,
        certificateOpenssh: certificateOpenSsh,
        expectedFingerprintSha256: expectedFingerprintSha256
      )
      resolve(String(sessionId))
    } catch {
      reject("connect_with_certificate_failed", error.localizedDescription, error)
    }
  }

  @objc(execCommand:argv:resolver:rejecter:)
  func execCommand(
    sessionId: String,
    argv: [String],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = UInt64(sessionId) else {
      reject("invalid_session_id", "sessionId is not a valid u64", nil)
      return
    }
    do {
      let result = try client.execCommand(sessionId: id, argv: argv)
      resolve([
        "exitStatus": result.exitStatus,
        "stdout": result.stdout,
        "stderr": result.stderr,
      ])
    } catch {
      reject("exec_command_failed", error.localizedDescription, error)
    }
  }

  @objc(disconnect:resolver:rejecter:)
  func disconnect(
    sessionId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = UInt64(sessionId) else {
      reject("invalid_session_id", "sessionId is not a valid u64", nil)
      return
    }
    client.disconnect(sessionId: id)
    resolve(nil)
  }

  // MARK: - Phase 7: PTY streaming

  @objc(openPty:term:cols:rows:command:resolver:rejecter:)
  func openPty(
    sessionId: String,
    term: String,
    cols: NSNumber,
    rows: NSNumber,
    command: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let sid = UInt64(sessionId) else {
      reject("invalid_session_id", "sessionId is not a valid u64", nil)
      return
    }
    do {
      let ptyId = try client.openPty(
        sessionId: sid,
        term: term,
        cols: UInt16(truncating: cols),
        rows: UInt16(truncating: rows),
        command: command
      )
      resolve(String(ptyId))
    } catch {
      reject("open_pty_failed", error.localizedDescription, error)
    }
  }

  @objc(ptyWrite:dataBase64:resolver:rejecter:)
  func ptyWrite(
    ptyId: String,
    dataBase64: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = UInt64(ptyId), let data = Data(base64Encoded: dataBase64) else {
      reject("invalid_arguments", "ptyId or dataBase64 is invalid", nil)
      return
    }
    do {
      try client.ptyWrite(ptyId: id, data: [UInt8](data))
      resolve(nil)
    } catch {
      reject("pty_write_failed", error.localizedDescription, error)
    }
  }

  @objc(ptyResize:cols:rows:resolver:rejecter:)
  func ptyResize(
    ptyId: String,
    cols: NSNumber,
    rows: NSNumber,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = UInt64(ptyId) else {
      reject("invalid_pty_id", "ptyId is not a valid u64", nil)
      return
    }
    do {
      try client.ptyResize(ptyId: id, cols: UInt16(truncating: cols), rows: UInt16(truncating: rows))
      resolve(nil)
    } catch {
      reject("pty_resize_failed", error.localizedDescription, error)
    }
  }

  @objc(closePty:resolver:rejecter:)
  func closePty(
    ptyId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    ptyStreamQueue.sync { activePtyStreams[ptyId] = false }
    if let id = UInt64(ptyId) {
      client.closePty(ptyId: id)
    }
    resolve(nil)
  }

  @objc(startPtyEventStream:resolver:rejecter:)
  func startPtyEventStream(
    ptyId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = UInt64(ptyId) else {
      reject("invalid_pty_id", "ptyId is not a valid u64", nil)
      return
    }
    ptyStreamQueue.sync { activePtyStreams[ptyId] = true }
    // Background poll loop: repeatedly calls `poll_pty_events` (which
    // itself blocks briefly server-side, see its doc comment) and emits
    // each drained event, until `stopPtyEventStream`/`closePty` clears
    // `activePtyStreams[ptyId]` or a `Closed` event is observed.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
      while self.ptyStreamQueue.sync(execute: { self.activePtyStreams[ptyId] ?? false }) {
        let events: [PtyEvent]
        do {
          events = try self.client.pollPtyEvents(ptyId: id, timeoutMs: 1000, maxEvents: 64)
        } catch {
          break
        }
        var shouldStop = false
        for event in events {
          switch event {
          case .data(let bytes):
            self.sendEvent(withName: "TreqSshPtyEvent", body: [
              "ptyId": ptyId, "type": "data",
              "dataBase64": Data(bytes).base64EncodedString(),
            ])
          case .exitStatus(let code):
            self.sendEvent(withName: "TreqSshPtyEvent", body: [
              "ptyId": ptyId, "type": "exit", "code": code,
            ])
          case .closed:
            self.sendEvent(withName: "TreqSshPtyEvent", body: ["ptyId": ptyId, "type": "closed"])
            shouldStop = true
          }
        }
        if shouldStop { break }
      }
      self.ptyStreamQueue.sync { self.activePtyStreams[ptyId] = false }
    }
    resolve(nil)
  }

  @objc(stopPtyEventStream:resolver:rejecter:)
  func stopPtyEventStream(
    ptyId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    ptyStreamQueue.sync { activePtyStreams[ptyId] = false }
    resolve(nil)
  }

  // MARK: - Keychain

  private func storeInKeychain(account: String, secret: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecValueData as String: Data(secret.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "TreqSsh", code: Int(status), userInfo: [
        NSLocalizedDescriptionKey: "failed to store device key in Keychain (status \(status))",
      ])
    }
  }

  private func loadFromKeychain(account: String) throws -> String {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "TreqSsh", code: Int(status), userInfo: [
        NSLocalizedDescriptionKey: "device key not found in Keychain for handle \(account)",
      ])
    }
    return secret
  }
}
