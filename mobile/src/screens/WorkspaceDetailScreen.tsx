import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { FileChange, listChangesArgv, parseFileChanges } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkspaceDetail'>;

export function WorkspaceDetailScreen({ navigation, route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId, workspaceName } = route.params;
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChanges = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await TreqSsh.execCommand(sessionId, listChangesArgv(repo, workspaceId));
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setChanges(parseFileChanges(result.stdout));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{workspaceName}</Text>

      <View style={styles.navRow}>
        <Button title="Commits" onPress={() => navigation.navigate('Commits', { sessionId, repo, workspaceId })} />
        <Button title="Conflicts" onPress={() => navigation.navigate('Conflicts', { sessionId, repo, workspaceId })} />
        <Button title="Refresh" onPress={loadChanges} />
      </View>

      {busy ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {changes ? (
        <FlatList
          data={changes}
          keyExtractor={(f) => f.path}
          ListEmptyComponent={<Text style={styles.label}>No changed files.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.fileRow}
              onPress={() => navigation.navigate('Diff', { sessionId, repo, workspaceId, path: item.path })}
            >
              <Text style={styles.mono}>{item.path}</Text>
              <Text style={styles.status}>{item.status} ({item.changedLineCount})</Text>
            </TouchableOpacity>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 8, marginBottom: 8, fontWeight: '600' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  status: { color: '#666', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
