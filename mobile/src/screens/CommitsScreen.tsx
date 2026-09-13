import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { generateIdempotencyKey } from '../lib/controlPlane';
import { Commit, createCommitArgv, listCommitsArgv, parseCommits, resolveConflictArgv } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Commits'>;

export function CommitsScreen({ route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId } = route.params;
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const loadCommits = async () => {
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
  };

  useEffect(() => {
    loadCommits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repo, workspaceId]);

  const handleResolve = (commit: Commit) =>
    Alert.alert('Resolve conflict', `Resolve conflicts in ${commit.shortId} using the CLI's default resolution?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resolve',
        onPress: async () => {
          setError(null);
          try {
            const result = await TreqSsh.execCommand(
              sessionId,
              resolveConflictArgv(repo, commit.changeId, generateIdempotencyKey()),
            );
            if (result.exitStatus !== 0) {
              throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
            }
            await loadCommits();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  const handleCreateCommit = async () => {
    setCreateBusy(true);
    setError(null);
    try {
      const result = await TreqSsh.execCommand(
        sessionId,
        createCommitArgv(repo, message.trim(), generateIdempotencyKey(), workspaceId),
      );
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setMessage('');
      await loadCommits();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>New commit</Text>
      <TextInput
        style={styles.input}
        value={message}
        onChangeText={setMessage}
        placeholder="Commit message"
      />
      {createBusy ? (
        <ActivityIndicator />
      ) : (
        <Button title="Commit" onPress={handleCreateCommit} disabled={!message.trim()} />
      )}

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
              {item.hasConflicts ? <Button title="Resolve" onPress={() => handleResolve(item)} /> : null}
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
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginBottom: 8 },
});
