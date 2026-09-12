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
@objc(TreqSsh)
class TreqSshBridge: NSObject {
  private let client = SshClient()
  private let keychainService = "com.treq.mobile-device-key"

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
