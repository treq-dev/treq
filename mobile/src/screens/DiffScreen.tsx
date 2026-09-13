import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { DiffHunk, FileLines, FileRevision, diffFileArgv, parseDiffHunks, parseFileLines, readFileArgv } from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Diff'>;

export function DiffScreen({ route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId, path } = route.params;
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState<{ revision: FileRevision; fileLines: FileLines } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

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

  const loadContext = async (revision: FileRevision) => {
    setContextBusy(true);
    setContextError(null);
    try {
      const result = await TreqSsh.execCommand(sessionId, readFileArgv(repo, path, revision, workspaceId));
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setContext({ revision, fileLines: parseFileLines(result.stdout) });
    } catch (e) {
      setContextError(e instanceof Error ? e.message : String(e));
    } finally {
      setContextBusy(false);
    }
  };

  const hasConflicts = hunks?.some((h) => h.conflictRegions.length > 0) ?? false;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.label}>{path}</Text>
      {busy ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hasConflicts ? <Text style={styles.conflictBanner}>This file has unresolved conflicts.</Text> : null}

      {hunks?.map((hunk) => (
        <View key={hunk.id} style={styles.hunk}>
          <Text style={styles.header}>{hunk.header}</Text>
          <Text style={styles.mono}>{hunk.patch}</Text>
          {hunk.conflictRegions.map((region) => (
            <View key={region.id} style={styles.conflictRegion}>
              <Text style={styles.conflictLabel}>
                Conflict {region.conflictNumber} of {region.totalConflicts}
              </Text>
              <Text style={styles.mono}>{region.content}</Text>
            </View>
          ))}
        </View>
      ))}
      {hunks && hunks.length === 0 ? <Text style={styles.label}>No hunks.</Text> : null}

      <Text style={styles.label}>File context</Text>
      <View style={styles.navRow}>
        <Button title="Working copy" onPress={() => loadContext('workingCopy')} disabled={contextBusy} />
        <Button title="Parent" onPress={() => loadContext('parent')} disabled={contextBusy} />
      </View>
      {contextBusy ? <ActivityIndicator /> : null}
      {contextError ? <Text style={styles.error}>{contextError}</Text> : null}
      {context ? (
        <View style={styles.hunk}>
          <Text style={styles.header}>
            {context.revision === 'workingCopy' ? 'Working copy' : 'Parent'} (lines {context.fileLines.startLine}-
            {context.fileLines.endLine})
          </Text>
          <Text style={styles.mono}>{context.fileLines.lines.join('\n')}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 8, fontWeight: '600' },
  header: { fontFamily: 'Courier', fontWeight: '600', marginTop: 12 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  hunk: { marginBottom: 12 },
  conflictBanner: { color: '#a15c00', fontWeight: '600', marginVertical: 8 },
  conflictRegion: { marginTop: 8, padding: 8, backgroundColor: '#fff4e0', borderRadius: 6 },
  conflictLabel: { fontWeight: '600', marginBottom: 4 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
});
