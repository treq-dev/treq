import { NativeModules } from 'react-native';

/**
 * JS-facing surface for the native `TreqSsh` module, backed by
 * `crates/treq-mobile-ssh` (russh + UniFFI) via a thin Swift (iOS) /
 * Kotlin (Android) bridge — see mobile/ios/TreqMobile/TreqSshBridge.swift
 * and mobile/android/app/src/main/java/com/treq/mobile/TreqSshModule.kt.
 *
 * The device private key never crosses this bridge: `generateDeviceKey`
 * returns only the public key and fingerprint, the native side moves the
 * private key straight into Keychain / Android Keystore, and `connect`
 * takes an opaque `keyHandle` rather than key material.
 */
export type DeviceKeyInfo = {
  publicKeyOpenSsh: string;
  fingerprintSha256: string;
  keyHandle: string;
};

export type ExecResult = {
  exitStatus: number;
  stdout: string;
  stderr: string;
};

export type TreqSshModule = {
  generateDeviceKey(): Promise<DeviceKeyInfo>;
  connect(
    host: string,
    port: number,
    username: string,
    keyHandle: string,
    expectedFingerprintSha256: string,
  ): Promise<string>;
  // Managed-instance path (prds/mobile.md Phase 2): authenticates with a
  // short-lived OpenSSH certificate (from controlPlane.issueCertificate)
  // plus the device's own key, instead of direct public-key auth.
  connectWithCertificate(
    host: string,
    port: number,
    username: string,
    keyHandle: string,
    certificateOpenSsh: string,
    expectedFingerprintSha256: string,
  ): Promise<string>;
  execCommand(sessionId: string, argv: string[]): Promise<ExecResult>;
  disconnect(sessionId: string): Promise<void>;
};

const { TreqSsh: NativeTreqSsh } = NativeModules as { TreqSsh?: TreqSshModule };

if (!NativeTreqSsh) {
  throw new Error(
    'TreqSsh native module is not linked. Build the iOS/Android native ' +
      'projects with the treq-mobile-ssh bridge (see mobile/README.md).',
  );
}

const TreqSsh: TreqSshModule = NativeTreqSsh;

export default TreqSsh;
