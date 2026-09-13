import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Button, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import {
  deleteInstance,
  ensureInstance,
  generateIdempotencyKey,
  getInstanceStatus,
  issueCertificate,
  listRegions,
  listSizePresets,
  registerClientKey,
  wakeInstance,
} from '../lib/controlPlane';
import { CertificateRenewalManager } from '../lib/certRenewal';
import { useAuthStore } from '../lib/authStore';
import type { InstanceStatusResponse, RegionCode, SizePreset } from '../../../src/lib/api-types-remote';

type Props = NativeStackScreenProps<RootStackParamList, 'ManagedConnect'>;

const POLL_INTERVAL_MS = 3000;

// Managed-instance path (prds/mobile.md Phase 2): finds or provisions the
// user's single managed instance (prds/remote-ssh.md's "one managed
// instance per user"), then generates a device key, registers its public
// key with the control plane, requests a short-lived certificate, and
// connects using that certificate rather than a manually pinned host-key
// fingerprint - the fingerprint comes from the certificate response's
// trusted endpoint metadata instead.
export function ManagedConnectScreen({ navigation }: Props): React.JSX.Element {
  const [status, setStatus] = useState<InstanceStatusResponse | null>(null);
  const [regions, setRegions] = useState<RegionCode[]>([]);
  const [sizePresets, setSizePresets] = useState<SizePreset[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<RegionCode | null>(null);
  const [selectedSize, setSelectedSize] = useState<SizePreset | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatus = useCallback(async () => {
    const result = await getInstanceStatus();
    setStatus(result);
    return result;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [result, regionList, sizeList] = await Promise.all([
          refreshStatus(),
          listRegions(),
          listSizePresets(),
        ]);
        setRegions(regionList);
        setSizePresets(sizeList);
        setSelectedRegion(regionList[0] ?? null);
        setSelectedSize(sizeList[0] ?? null);
        schedulePollIfTransient(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function schedulePollIfTransient(result: InstanceStatusResponse) {
    const transient = result.instance?.status && [
      'provisioning', 'bootstrapping', 'installing_access', 'verifying', 'waking', 'reprovisioning',
    ].includes(result.instance.status);
    if (!transient) {
      return;
    }
    pollTimer.current = setTimeout(async () => {
      try {
        const next = await refreshStatus();
        schedulePollIfTransient(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, POLL_INTERVAL_MS);
  }

  const handleProvision = async () => {
    if (!selectedRegion || !selectedSize) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureInstance({ region: selectedRegion, size_preset: selectedSize, idempotency_key: generateIdempotencyKey() });
      const result = await refreshStatus();
      schedulePollIfTransient(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleWake = async () => {
    if (!status?.instance) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await wakeInstance({ instance_id: status.instance.instance_id, idempotency_key: generateIdempotencyKey() });
      const result = await refreshStatus();
      schedulePollIfTransient(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    if (!status?.instance || status.instance.status !== 'ready') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setProgress('Generating device key...');
      const deviceKey = await TreqSsh.generateDeviceKey();

      setProgress('Registering device key with the control plane...');
      const clientKey = await registerClientKey({
        public_key: deviceKey.publicKeyOpenSsh,
        comment: 'React Native device',
        idempotency_key: generateIdempotencyKey(),
      });

      setProgress('Requesting a certificate for this instance...');
      const certResponse = await issueCertificate({
        instance_id: status.instance.instance_id,
        key_id: clientKey.id,
      });

      const hostKey = certResponse.endpoint.host_keys[0];
      if (!hostKey) {
        throw new Error('Certificate response carried no trusted host key');
      }

      setProgress('Connecting...');
      const sessionId = await TreqSsh.connectWithCertificate(
        certResponse.endpoint.hostname,
        certResponse.endpoint.port,
        certResponse.endpoint.username,
        deviceKey.keyHandle,
        certResponse.certificate,
        hostKey.fingerprint_sha256,
      );

      // Silent renewal (prds/remote-ssh.md "Silent renewal while the
      // session is active"): the manager's timers run independently of
      // this component's lifecycle, so it keeps renewing after
      // navigation away from this screen. On an unrecoverable failure it
      // disconnects the session outright (the PRD's "hard cutoff") -
      // there is no screen left mounted here to navigate back to a
      // reconnect flow from, so later screens simply see a
      // SessionNotFound error the next time they call TreqSsh, the same
      // as any other disconnected session.
      const renewalManager = new CertificateRenewalManager({
        instanceId: status.instance.instance_id,
        keyId: clientKey.id,
        sessionId,
        initialLease: { issuedAt: Date.now(), expiresAt: Date.parse(certResponse.expires_at) },
        isSessionValid: () => useAuthStore.getState().session !== null,
        issue: (instanceId, keyId) => issueCertificate({ instance_id: instanceId, key_id: keyId, renewal: true }),
        onRenewed: () => {},
        onCutoff: () => TreqSsh.disconnect(sessionId),
      });

      // A suspended app's setTimeout can fire very late (or the JS
      // context can be recreated entirely) once resumed, so re-anchor the
      // renewal schedule to the current clock on every foreground
      // transition rather than trusting the timer set before suspension -
      // see `CertificateRenewalManager.onAppForeground`'s doc comment.
      AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          renewalManager.onAppForeground();
        }
      });

      navigation.navigate('Workspaces', { sessionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleDelete = () => {
    if (!status?.instance) {
      return;
    }
    Alert.alert(
      'Delete instance',
      'This tears down the managed instance and any state on it. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await deleteInstance({
                instance_id: status.instance!.instance_id,
                idempotency_key: generateIdempotencyKey(),
              });
              await refreshStatus();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (busy && !status) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!status?.instance ? (
        <>
          <Text style={styles.label}>No managed instance yet - choose a region and size</Text>
          <Text style={styles.sublabel}>Region</Text>
          <View style={styles.chipRow}>
            {regions.map((region) => (
              <TouchableOpacity
                key={region}
                style={[styles.chip, selectedRegion === region && styles.chipSelected]}
                onPress={() => setSelectedRegion(region)}
              >
                <Text>{region}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sublabel}>Size</Text>
          <View style={styles.chipRow}>
            {sizePresets.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.chip, selectedSize === size && styles.chipSelected]}
                onPress={() => setSelectedSize(size)}
              >
                <Text>{size}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {busy ? <ActivityIndicator /> : <Button title="Provision managed instance" onPress={handleProvision} />}
        </>
      ) : (
        <>
          <Text style={styles.label}>Instance status: {status.instance.status}</Text>
          {status.instance.status === 'suspended' ? (
            busy ? <ActivityIndicator /> : <Button title="Wake instance" onPress={handleWake} />
          ) : null}
          {['provisioning', 'bootstrapping', 'installing_access', 'verifying', 'waking', 'reprovisioning'].includes(
            status.instance.status,
          ) ? (
            <ActivityIndicator />
          ) : null}
          {status.instance.status === 'ready' ? (
            busy ? (
              <>
                <ActivityIndicator />
                {progress ? <Text style={styles.label}>{progress}</Text> : null}
              </>
            ) : (
              <Button title="Connect" onPress={handleConnect} />
            )
          ) : null}
          {!busy ? (
            <View style={styles.deleteButton}>
              <Button title="Delete instance" color="crimson" onPress={handleDelete} />
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  sublabel: { marginTop: 8, marginBottom: 4 },
  error: { color: 'crimson', marginVertical: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipSelected: { borderColor: '#007AFF', backgroundColor: '#e6f0ff' },
  deleteButton: { marginTop: 24 },
});
