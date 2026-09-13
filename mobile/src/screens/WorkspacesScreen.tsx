import React, { useState } from 'react';
import { ActivityIndicator, Button, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh, { ExecResult } from '../native/TreqSsh';
import { listWorkspacesArgv, parseWorkspaces, Workspace } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Workspaces'>;

export function WorkspacesScreen({ navigation, route }: Props): React.JSX.Element {
  const { sessionId } = route.params;
  const [repo, setRepo] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [command, setCommand] = useState('');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [rawBusy, setRawBusy] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  const handleLoadWorkspaces = async () => {
    setBusy(true);
    setError(null);
    setWorkspaces(null);
    try {
      const execResult = await TreqSsh.execCommand(sessionId, listWorkspacesArgv(repo));
      if (execResult.exitStatus !== 0) {
        throw new Error(execResult.stderr || `treq exited with status ${execResult.exitStatus}`);
      }
      setWorkspaces(parseWorkspaces(execResult.stdout));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRunRaw = async () => {
    setRawBusy(true);
    setRawError(null);
    setResult(null);
    try {
      const argv = command.trim().split(/\s+/).filter(Boolean);
      const execResult = await TreqSsh.execCommand(sessionId, argv);
      setResult(execResult);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : String(e));
    } finally {
      setRawBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text>Connected. Session: {sessionId}</Text>

      <Text style={styles.label}>Repository path</Text>
      <TextInput
        style={styles.input}
        value={repo}
        onChangeText={setRepo}
        autoCapitalize="none"
        placeholder="/home/treq/repos/my-project"
      />
      {busy ? <ActivityIndicator /> : <Button title="Load workspaces" onPress={handleLoadWorkspaces} disabled={!repo.trim()} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {workspaces ? (
        <FlatList
          data={workspaces}
          keyExtractor={(w) => String(w.id)}
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.label}>No workspaces found.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.workspaceRow}
              onPress={() =>
                navigation.navigate('WorkspaceDetail', {
                  sessionId,
                  repo,
                  workspaceId: item.id,
                  workspaceName: item.workspaceName,
                })
              }
            >
              <Text style={styles.workspaceTitle}>{item.title}</Text>
              <Text style={styles.mono}>{item.branchName}</Text>
            </TouchableOpacity>
          )}
        />
      ) : null}

      <Text style={styles.label}>Raw command (temporary)</Text>
      <TextInput
        style={styles.input}
        value={command}
        onChangeText={setCommand}
        autoCapitalize="none"
        placeholder="treq workspace list"
      />
      {rawBusy ? <ActivityIndicator /> : <Button title="Run" onPress={handleRunRaw} disabled={!command.trim()} />}
      {rawError ? <Text style={styles.error}>{rawError}</Text> : null}
      {result ? (
        <View style={styles.result}>
          <Text style={styles.label}>Exit status: {result.exitStatus}</Text>
          <Text style={styles.label}>stdout</Text>
          <Text style={styles.mono}>{result.stdout}</Text>
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
  workspaceRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  workspaceTitle: { fontWeight: '600' },
});
