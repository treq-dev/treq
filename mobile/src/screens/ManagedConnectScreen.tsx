import React, { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { generateIdempotencyKey, issueCertificate, registerClientKey } from '../lib/controlPlane';

type Props = NativeStackScreenProps<RootStackParamList, 'ManagedConnect'>;

// Managed-instance path (prds/mobile.md Phase 2): generate a device key,
// register its public key with the control plane, request a short-lived
// certificate for the given instance, and connect using that certificate
// rather than a manually pinned host-key fingerprint - the fingerprint
// comes from the certificate response's trusted endpoint metadata instead.
export function ManagedConnectScreen({ navigation }: Props): React.JSX.Element {
  const [instanceId, setInstanceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus('Generating device key...');
      const deviceKey = await TreqSsh.generateDeviceKey();

      setStatus('Registering device key with the control plane...');
      const clientKey = await registerClientKey({
        public_key: deviceKey.publicKeyOpenSsh,
        comment: 'React Native device',
        idempotency_key: generateIdempotencyKey(),
      });

      setStatus('Requesting a certificate for this instance...');
      const certResponse = await issueCertificate({
        instance_id: instanceId,
        key_id: clientKey.id,
      });

      const hostKey = certResponse.endpoint.host_keys[0];
      if (!hostKey) {
        throw new Error('Certificate response carried no trusted host key');
      }

      setStatus('Connecting...');
      const sessionId = await TreqSsh.connectWithCertificate(
        certResponse.endpoint.hostname,
        certResponse.endpoint.port,
        certResponse.endpoint.username,
        deviceKey.keyHandle,
        certResponse.certificate,
        hostKey.fingerprint_sha256,
      );

      navigation.navigate('Workspaces', { sessionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Managed instance ID</Text>
      <TextInput
        style={styles.input}
        value={instanceId}
        onChangeText={setInstanceId}
        autoCapitalize="none"
        placeholder="instance-id"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? (
        <>
          <ActivityIndicator />
          {status ? <Text style={styles.label}>{status}</Text> : null}
        </>
      ) : (
        <Button title="Connect" onPress={handleConnect} disabled={!instanceId.trim()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  error: { color: 'crimson', marginVertical: 12 },
});
