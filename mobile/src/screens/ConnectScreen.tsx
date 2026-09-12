import React, { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { parseConnectionString } from '../lib/parseConnectionString';

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>;

export function ConnectScreen({ navigation }: Props): React.JSX.Element {
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [keyHandle, setKeyHandle] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleParseConnectionString = () => {
    try {
      const parsed = parseConnectionString(connectionString);
      setUsername(parsed.username);
      setHost(parsed.host);
      setPort(String(parsed.port));
      setFingerprint(parsed.fingerprintSha256);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleGenerateKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await TreqSsh.generateDeviceKey();
      setKeyHandle(info.keyHandle);
      setPublicKey(info.publicKeyOpenSsh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    if (!keyHandle) {
      setError('Generate a device key first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sessionId = await TreqSsh.connect(host, Number(port) || 22, username, keyHandle, fingerprint);
      navigation.navigate('Workspaces', { sessionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Connection string (temporary quick-fill)</Text>
      <TextInput
        style={styles.input}
        value={connectionString}
        onChangeText={setConnectionString}
        autoCapitalize="none"
        placeholder="treq@127.0.0.1:2222#SHA256:abc123"
      />
      <Button title="Parse connection string" onPress={handleParseConnectionString} />

      <Text style={styles.label}>Device key</Text>
      <Button title={publicKey ? 'Regenerate device key' : 'Generate device key'} onPress={handleGenerateKey} disabled={busy} />
      {publicKey ? <Text style={styles.mono}>{publicKey}</Text> : null}

      <Text style={styles.label}>Host</Text>
      <TextInput style={styles.input} value={host} onChangeText={setHost} autoCapitalize="none" placeholder="vm.example.com" />

      <Text style={styles.label}>Port</Text>
      <TextInput style={styles.input} value={port} onChangeText={setPort} keyboardType="number-pad" />

      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="treq" />

      <Text style={styles.label}>Expected host key fingerprint (SHA256)</Text>
      <TextInput style={styles.input} value={fingerprint} onChangeText={setFingerprint} autoCapitalize="none" placeholder="SHA256:..." />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator /> : <Button title="Connect" onPress={handleConnect} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  mono: { fontFamily: 'Courier', fontSize: 12, marginTop: 4 },
  error: { color: 'crimson', marginVertical: 12 },
});
