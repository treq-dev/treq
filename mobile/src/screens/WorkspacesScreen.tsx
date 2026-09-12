import React, { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh, { ExecResult } from '../native/TreqSsh';

type Props = NativeStackScreenProps<RootStackParamList, 'Workspaces'>;

// Temporary raw-command runner: proves the UI can drive a real SSH exec
// end to end (see mobile/README.md "What's tested"). Structured workspace
// listing over `treq workspace list --format=json` (prds/mobile.md Phase 3)
// replaces this free-text input once it lands.
export function WorkspacesScreen({ route }: Props): React.JSX.Element {
  const { sessionId } = route.params;
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const argv = command.trim().split(/\s+/).filter(Boolean);
      const execResult = await TreqSsh.execCommand(sessionId, argv);
      setResult(execResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text>Connected. Session: {sessionId}</Text>

      <Text style={styles.label}>Command</Text>
      <TextInput
        style={styles.input}
        value={command}
        onChangeText={setCommand}
        autoCapitalize="none"
        placeholder="treq workspace list"
      />
      {busy ? <ActivityIndicator /> : <Button title="Run" onPress={handleRun} disabled={!command.trim()} />}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <View style={styles.result}>
          <Text style={styles.label}>Exit status: {result.exitStatus}</Text>
          <Text style={styles.label}>stdout</Text>
          <Text style={styles.mono}>{result.stdout}</Text>
          {result.stderr ? (
            <>
              <Text style={styles.label}>stderr</Text>
              <Text style={styles.mono}>{result.stderr}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  result: { marginTop: 16 },
});
