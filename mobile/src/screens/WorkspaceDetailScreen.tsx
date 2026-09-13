import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { generateIdempotencyKey } from '../lib/controlPlane';
import { FileChange, gitPushArgv, listChangesArgv, parseFileChanges, rebaseWorkspaceArgv } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkspaceDetail'>;

export function WorkspaceDetailScreen({ navigation, route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId, workspaceName } = route.params;
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [rebasePromptVisible, setRebasePromptVisible] = useState(false);
  const [rebaseTarget, setRebaseTarget] = useState('');

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

  const runMutation = async (label: string, action: () => Promise<void>) => {
    setMutationBusy(true);
    setError(null);
    try {
      await action();
      await loadChanges();
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMutationBusy(false);
    }
  };

  const handleRebase = () =>
    runMutation('Rebase', async () => {
      const result = await TreqSsh.execCommand(
        sessionId,
        rebaseWorkspaceArgv(repo, workspaceId, rebaseTarget.trim(), generateIdempotencyKey()),
      );
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setRebasePromptVisible(false);
      setRebaseTarget('');
    });

  const handlePush = () =>
    Alert.alert('Push bookmark', `Push this workspace's bookmark to the remote?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Push',
        onPress: () =>
          runMutation('Push', async () => {
            const result = await TreqSsh.execCommand(sessionId, gitPushArgv(repo, generateIdempotencyKey(), workspaceId));
            if (result.exitStatus !== 0) {
              throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
            }
          }),
      },
    ]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{workspaceName}</Text>

      <View style={styles.navRow}>
        <Button title="Commits" onPress={() => navigation.navigate('Commits', { sessionId, repo, workspaceId })} />
        <Button title="Conflicts" onPress={() => navigation.navigate('Conflicts', { sessionId, repo, workspaceId })} />
        <Button title="Agent" onPress={() => navigation.navigate('Agent', { sessionId, repo, workspaceId })} />
      </View>
      <View style={styles.navRow}>
        <Button title="Rebase" onPress={() => setRebasePromptVisible(true)} disabled={mutationBusy} />
        <Button title="Push" onPress={handlePush} disabled={mutationBusy} />
        <Button title="Refresh" onPress={loadChanges} />
      </View>

      <Modal visible={rebasePromptVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.label}>Rebase onto branch</Text>
            <TextInput
              style={styles.input}
              value={rebaseTarget}
              onChangeText={setRebaseTarget}
              autoCapitalize="none"
              placeholder="main"
            />
            <View style={styles.navRow}>
              <Button title="Cancel" onPress={() => setRebasePromptVisible(false)} />
              <Button title="Rebase" onPress={handleRebase} disabled={!rebaseTarget.trim() || mutationBusy} />
            </View>
          </View>
        </View>
      </Modal>

      {(busy || mutationBusy) ? <ActivityIndicator /> : null}
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: 'white', borderRadius: 8, padding: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginVertical: 8 },
});
