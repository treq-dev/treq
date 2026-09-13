import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { listConflictsArgv, parseConflicts } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Conflicts'>;

// Conflict detail (per-file conflict marker regions) is shown by tapping
// through to DiffScreen, which renders `conflictRegions` for that path -
// there is no separate per-commit conflict command in the remote CLI
// protocol to call instead (see prds/mobile.md's Phase 3 section).
export function ConflictsScreen({ navigation, route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId } = route.params;
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await TreqSsh.execCommand(sessionId, listConflictsArgv(repo, workspaceId));
        if (result.exitStatus !== 0) {
          throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
        }
        setConflicts(parseConflicts(result.stdout));
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
      {conflicts ? (
        <FlatList
          data={conflicts}
          keyExtractor={(p) => p}
          ListEmptyComponent={<Text style={styles.label}>No conflicts.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('Diff', { sessionId, repo, workspaceId, path: item })}
            >
              <Text style={styles.mono}>{item}</Text>
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
  mono: { fontFamily: 'Courier', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
