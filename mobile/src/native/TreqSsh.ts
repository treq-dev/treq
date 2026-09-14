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

  // -- Phase 7: full PTY streaming (`crates/treq-mobile-ssh`'s
  // open_pty/pty_write/pty_resize/poll_pty_events/close_pty) --
  //
  // `command` is the literal command line `pty-remote attach-command`
  // returned (see `mobile/src/lib/ptyRemoteCli.ts`'s `ptyAttachCommandArgv`
  // / `parsePtyAttachCommand`), never assembled client-side.
  openPty(sessionId: string, term: string, cols: number, rows: number, command: string): Promise<string>;
  ptyWrite(ptyId: string, dataBase64: string): Promise<void>;
  ptyResize(ptyId: string, cols: number, rows: number): Promise<void>;
  closePty(ptyId: string): Promise<void>;
  // Starts the native side's background poll-and-emit loop for `ptyId`,
  // which repeatedly calls the Rust crate's `poll_pty_events` and emits
  // each drained event as a `TreqSshPtyEvent` NativeEventEmitter event
  // (see `PtyEventPayload` below) — the native-bridge half of the
  // "spike result: polling, not a pushed UniFFI callback" decision
  // documented in `crates/treq-mobile-ssh/src/lib.rs`'s `poll_pty_events`.
  // Call `stopPtyEventStream` (or `closePty`, which implies it) to stop.
  startPtyEventStream(ptyId: string): Promise<void>;
  stopPtyEventStream(ptyId: string): Promise<void>;
};

/**
 * Payload of the `TreqSshPtyEvent` event `startPtyEventStream` emits via
 * `NativeEventEmitter(NativeModules.TreqSsh)`, mirroring
 * `treq_mobile_ssh::PtyEvent` (`Data`/`ExitStatus`/`Closed`). `dataBase64`
 * is present only for `type: 'data'` — PTY output is arbitrary binary
 * (raw ANSI/control bytes), so it crosses the RN bridge as base64 rather
 * than a JS string, the same reasoning `execCommand`'s stdout/stderr
 * being UTF-8-lossy on the Rust side does not apply to interactive PTY
 * output.
 */
export type PtyEventPayload =
  | { ptyId: string; type: 'data'; dataBase64: string }
  | { ptyId: string; type: 'exit'; code: number }
  | { ptyId: string; type: 'closed' };

const { TreqSsh: NativeTreqSsh } = NativeModules as { TreqSsh?: TreqSshModule };

if (!NativeTreqSsh) {
  throw new Error(
    'TreqSsh native module is not linked. Build the iOS/Android native ' +
      'projects with the treq-mobile-ssh bridge (see mobile/README.md).',
  );
}

const TreqSsh: TreqSshModule = NativeTreqSsh;

export default TreqSsh;
