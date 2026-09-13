import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { Commit, listCommitsArgv, parseCommits } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Commits'>;

export function CommitsScreen({ route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId } = route.params;
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await TreqSsh.execCommand(sessionId, listCommitsArgv(repo, workspaceId));
        if (result.exitStatus !== 0) {
          throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
        }
        setCommits(parseCommits(result.stdout));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [sessionId, repo, workspaceId]);

  return (
    <View style={styles.container}>
      {busy ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {commits ? (
        <FlatList
          data={commits}
          keyExtractor={(c) => c.commitId}
          ListEmptyComponent={<Text style={styles.label}>No commits.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.mono}>{item.shortId}</Text>
              <Text>{item.description || '(no description)'}</Text>
              <Text style={styles.meta}>
                {item.authorName} · {item.timestamp}
                {item.hasConflicts ? ' · conflicts' : ''}
              </Text>
            </View>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 8, marginBottom: 8, fontWeight: '600' },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  meta: { color: '#666', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
