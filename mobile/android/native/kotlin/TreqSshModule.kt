package com.treq.mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Calls into the UniFFI Kotlin bindings generated from
// `crates/treq-mobile-ssh` (see mobile/README.md "Building the Rust side"
// for the `uniffi-bindgen generate --language kotlin` step that produces
// `uniffi.treq_mobile_ssh.SshClient`, which this file depends on but does
// not vendor).
//
// A generated device private key never crosses the RN bridge: it is
// immediately sealed with an Android Keystore-backed AES key and the
// ciphertext is written to app-private storage, keyed by an opaque
// `keyHandle` (a UUID) that is the only thing returned to JS.
class TreqSshModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "TreqSsh"

  private val client = SshClient()
  private val androidKeystoreAlias = "com.treq.mobile-device-key"

  @ReactMethod
  fun generateDeviceKey(promise: Promise) {
    try {
      val info = client.generateDeviceKey()
      val keyHandle = UUID.randomUUID().toString()
      sealAndStore(keyHandle, info.privateKeyPem)

      val result = Arguments.createMap().apply {
        putString("publicKeyOpenSsh", info.publicKeyOpenssh)
        putString("fingerprintSha256", info.fingerprintSha256)
        putString("keyHandle", keyHandle)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("generate_device_key_failed", e.message, e)
    }
  }

  @ReactMethod
  fun connect(
    host: String,
    port: Int,
    username: String,
    keyHandle: String,
    expectedFingerprintSha256: String,
    promise: Promise,
  ) {
    try {
      val privateKeyPem = unsealFromStore(keyHandle)
      val sessionId = client.connect(host, port.toUShort(), username, privateKeyPem, expectedFingerprintSha256)
      promise.resolve(sessionId.toString())
    } catch (e: Exception) {
      promise.reject("connect_failed", e.message, e)
    }
  }

  @ReactMethod
  fun connectWithCertificate(
    host: String,
    port: Int,
    username: String,
    keyHandle: String,
    certificateOpenSsh: String,
    expectedFingerprintSha256: String,
    promise: Promise,
  ) {
    try {
      val privateKeyPem = unsealFromStore(keyHandle)
      val sessionId = client.connectWithCertificate(
        host, port.toUShort(), username, privateKeyPem, certificateOpenSsh, expectedFingerprintSha256,
      )
      promise.resolve(sessionId.toString())
    } catch (e: Exception) {
      promise.reject("connect_with_certificate_failed", e.message, e)
    }
  }

  @ReactMethod
  fun execCommand(sessionId: String, argv: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    try {
      val id = sessionId.toULong()
      val args = (0 until argv.size()).map { argv.getString(it) as String }
      val result = client.execCommand(id, args)

      val out = Arguments.createMap().apply {
        putInt("exitStatus", result.exitStatus)
        putString("stdout", result.stdout)
        putString("stderr", result.stderr)
      }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("exec_command_failed", e.message, e)
    }
  }

  @ReactMethod
  fun disconnect(sessionId: String, promise: Promise) {
    try {
      client.disconnect(sessionId.toULong())
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("disconnect_failed", e.message, e)
    }
  }

  // MARK: - Android Keystore-backed sealed storage
  //
  // Sealed ciphertext lives in this module's private storage rather than
  // Keychain (there is no Android equivalent); the AES key protecting it
  // never leaves the Android Keystore's hardware-backed store.

  private fun androidKeystoreKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(androidKeystoreAlias, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        androidKeystoreAlias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }

  private fun sealAndStore(keyHandle: String, secret: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, androidKeystoreKey())
    val ciphertext = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
    val prefs = reactApplicationContext.getSharedPreferences("treq_mobile_device_keys", 0)
    prefs.edit()
      .putString("$keyHandle.iv", android.util.Base64.encodeToString(cipher.iv, android.util.Base64.NO_WRAP))
      .putString("$keyHandle.ciphertext", android.util.Base64.encodeToString(ciphertext, android.util.Base64.NO_WRAP))
      .apply()
  }

  private fun unsealFromStore(keyHandle: String): String {
    val prefs = reactApplicationContext.getSharedPreferences("treq_mobile_device_keys", 0)
    val ivB64 = prefs.getString("$keyHandle.iv", null)
      ?: error("device key not found for handle $keyHandle")
    val ciphertextB64 = prefs.getString("$keyHandle.ciphertext", null)
      ?: error("device key not found for handle $keyHandle")

    val iv = android.util.Base64.decode(ivB64, android.util.Base64.NO_WRAP)
    val ciphertext = android.util.Base64.decode(ciphertextB64, android.util.Base64.NO_WRAP)

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, androidKeystoreKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }
}
