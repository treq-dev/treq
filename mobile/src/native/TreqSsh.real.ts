import { randomUUID } from 'node:crypto';
import type { DeviceKeyInfo, ExecResult, TreqSshModule } from './TreqSsh';

/**
 * Test-only stand-in for the native module boundary, used by
 * jest.config.real.js (see mobile/README.md "What's tested"). Loads the
 * *real* compiled `treq-mobile-ssh` Rust crate (built with `npm run
 * build:native-test`, feature `napi`) via Node's N-API instead of a
 * hand-written mock, so a Jest test exercises real SSH connect/exec logic.
 *
 * It also does the one thing a real native bridge (TreqSshBridge.swift,
 * TreqSshModule.kt) is responsible for that the Rust crate deliberately
 * is not: keeping the generated private key out of anything resembling
 * the JS layer. Here that means an in-memory Map keyed by a random
 * `keyHandle`, mirroring (in spirit, not in security properties - this is
 * a test double, not Keychain/Keystore) what those bridges do by sealing
 * into platform secure storage.
 *
 * This does NOT exercise Swift/Kotlin marshalling, RCTBridgeModule/
 * ReactMethod plumbing, or anything iOS/Android-specific - see
 * .github/workflows/mobile.yml's kotlin-ffi/swift-ffi jobs for that.
 */

type NativeDeviceKeyInfo = {
  publicKeyOpenssh: string;
  fingerprintSha256: string;
  privateKeyPem: string;
};

type NativeExecResult = {
  exitStatus: number;
  stdout: string;
  stderr: string;
};

type NativeSshClient = {
  generateDeviceKey(): NativeDeviceKeyInfo;
  connect(
    host: string,
    port: number,
    username: string,
    privateKeyPem: string,
    expectedFingerprintSha256: string,
  ): bigint;
  connectWithCertificate(
    host: string,
    port: number,
    username: string,
    privateKeyPem: string,
    certificateOpenssh: string,
    expectedFingerprintSha256: string,
  ): bigint;
  execCommand(sessionId: bigint, argv: string[]): NativeExecResult;
  disconnect(sessionId: bigint): void;
};

type NativeAddon = { SshClient: new () => NativeSshClient };

const addon: NativeAddon = require('../../native-test/treq_mobile_ssh.node');
const client = new addon.SshClient();

const privateKeysByHandle = new Map<string, string>();

const TreqSshReal: TreqSshModule = {
  async generateDeviceKey(): Promise<DeviceKeyInfo> {
    const info = client.generateDeviceKey();
    const keyHandle = randomUUID();
    privateKeysByHandle.set(keyHandle, info.privateKeyPem);
    return {
      publicKeyOpenSsh: info.publicKeyOpenssh,
      fingerprintSha256: info.fingerprintSha256,
      keyHandle,
    };
  },

  async connect(
    host: string,
    port: number,
    username: string,
    keyHandle: string,
    expectedFingerprintSha256: string,
  ): Promise<string> {
    const privateKeyPem = privateKeysByHandle.get(keyHandle);
    if (!privateKeyPem) {
      throw new Error(`device key not found for handle ${keyHandle}`);
    }
    const sessionId = client.connect(host, port, username, privateKeyPem, expectedFingerprintSha256);
    return sessionId.toString();
  },

  async connectWithCertificate(
    host: string,
    port: number,
    username: string,
    keyHandle: string,
    certificateOpenSsh: string,
    expectedFingerprintSha256: string,
  ): Promise<string> {
    const privateKeyPem = privateKeysByHandle.get(keyHandle);
    if (!privateKeyPem) {
      throw new Error(`device key not found for handle ${keyHandle}`);
    }
    const sessionId = client.connectWithCertificate(
      host, port, username, privateKeyPem, certificateOpenSsh, expectedFingerprintSha256,
    );
    return sessionId.toString();
  },

  async execCommand(sessionId: string, argv: string[]): Promise<ExecResult> {
    const result = client.execCommand(BigInt(sessionId), argv);
    return result;
  },

  async disconnect(sessionId: string): Promise<void> {
    client.disconnect(BigInt(sessionId));
  },
};

export default TreqSshReal;
