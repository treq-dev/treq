import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { DiffHunk, diffFileArgv, parseDiffHunks } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Diff'>;

export function DiffScreen({ route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId, path } = route.params;
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await TreqSsh.execCommand(sessionId, diffFileArgv(repo, path, workspaceId));
        if (result.exitStatus !== 0) {
          throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
        }
        setHunks(parseDiffHunks(result.stdout));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [sessionId, repo, workspaceId, path]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.label}>{path}</Text>
      {busy ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hunks?.map((hunk) => (
        <View key={hunk.id} style={styles.hunk}>
          <Text style={styles.header}>{hunk.header}</Text>
          <Text style={styles.mono}>{hunk.patch}</Text>
        </View>
      ))}
      {hunks && hunks.length === 0 ? <Text style={styles.label}>No hunks.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 8, marginBottom: 8, fontWeight: '600' },
  header: { fontFamily: 'Courier', fontWeight: '600', marginTop: 12 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  hunk: { marginBottom: 12 },
});
