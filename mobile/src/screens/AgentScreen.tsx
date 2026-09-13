import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh from '../native/TreqSsh';
import { generateIdempotencyKey } from '../lib/controlPlane';
import { runMutationWithRetry } from '../lib/mutationRetry';
import {
  AgentStatus,
  agentInputArgv,
  agentLogsArgv,
  agentStartArgv,
  agentStatusArgv,
  agentStopArgv,
  parseAgentLogs,
  parseAgentStatus,
} from '../lib/treqCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Agent'>;

const POLL_INTERVAL_MS = 4000;
// Allow-listed agent names, mirroring `resolve_agent_binary` in
// `core::agent_supervisor` - a caller-supplied binary path is never trusted.
const AGENT_NAMES = ['claude', 'codex', 'cursor-agent', 'copilot'];

/**
 * Phase 4 of prds/mobile.md: start, inspect, attach to (via `input`), and
 * stop a remote coding agent, driving the same VM-local supervisor
 * (`core::agent_supervisor`) desktop's remote review surface uses, over
 * mobile's own SSH exec channel rather than Tauri IPC.
 */
export function AgentScreen({ route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId } = route.params;
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState('');
  const [agentName, setAgentName] = useState(AGENT_NAMES[0]);
  const [prompt, setPrompt] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const result = await TreqSsh.execCommand(sessionId, agentStatusArgv(repo, workspaceId));
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      const parsed = parseAgentStatus(result.stdout);
      setStatus(parsed);
      if (parsed.running) {
        const logsResult = await TreqSsh.execCommand(sessionId, agentLogsArgv(repo, workspaceId));
        if (logsResult.exitStatus === 0) {
          setLogs(parseAgentLogs(logsResult.stdout));
        }
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repo, workspaceId]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () =>
    runAction('Start agent', async () => {
      const argv = agentStartArgv(repo, workspaceId, agentName, prompt, generateIdempotencyKey());
      const result = await runMutationWithRetry(sessionId, argv);
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setPrompt('');
    });

  const handleSendInput = () =>
    runAction('Send input', async () => {
      const argv = agentInputArgv(repo, workspaceId, input, generateIdempotencyKey());
      const result = await runMutationWithRetry(sessionId, argv);
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      setInput('');
    });

  const handleStop = () =>
    Alert.alert('Stop agent', 'Stop the running agent for this workspace?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: () =>
          runAction('Stop agent', async () => {
            // Naturally idempotent (core::agent_supervisor::stop_agent
            // reports "not running" rather than erroring on a repeat call),
            // so retrying after a dropped connection is always safe.
            const result = await runMutationWithRetry(sessionId, agentStopArgv(repo, workspaceId));
            if (result.exitStatus !== 0) {
              throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
            }
          }),
      },
    ]);

  const running = status?.running ?? false;

  return (
    <ScrollView style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Status</Text>
      {status ? (
        <Text style={styles.mono}>
          {running
            ? `running: ${status.agent} (pid ${status.pid}) since ${status.startedAt}`
            : 'not running'}
        </Text>
      ) : (
        <ActivityIndicator />
      )}

      {running ? (
        <>
          <Text style={styles.label}>Send input</Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Reply to the agent"
            autoCapitalize="none"
          />
          <Button title="Send" onPress={handleSendInput} disabled={busy || !input.trim()} />
          <View style={styles.spacer} />
          <Button title="Stop agent" color="crimson" onPress={handleStop} disabled={busy} />

          <Text style={styles.label}>Logs</Text>
          <Text style={styles.mono}>{logs || '(no output yet)'}</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>Agent</Text>
          <View style={styles.agentRow}>
            {AGENT_NAMES.map((name) => (
              <Button
                key={name}
                title={name}
                color={name === agentName ? '#007aff' : '#888'}
                onPress={() => setAgentName(name)}
              />
            ))}
          </View>

          <Text style={styles.label}>Prompt</Text>
          <TextInput
            style={styles.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should the agent do?"
            multiline
          />
          <Button title="Start agent" onPress={handleStart} disabled={busy || !prompt.trim()} />
        </>
      )}
      {busy ? <ActivityIndicator /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  error: { color: 'crimson', marginVertical: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, minHeight: 40 },
  agentRow: { flexDirection: 'row', justifyContent: 'space-between' },
  spacer: { height: 8 },
});
