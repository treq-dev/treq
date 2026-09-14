import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Alert, StyleSheet, View } from 'react-native';
// react-native-webview's bundled types resolve to `never` props against
// this project's React/RN version combination (a peer-typing mismatch,
// not a real API incompatibility - the component works at runtime) so the
// element below is cast; see mobile/README.md for the exact versions.
import { WebView as WebViewUntyped } from 'react-native-webview';
const WebView = WebViewUntyped as unknown as React.ComponentType<Record<string, unknown>>;
import { NativeEventEmitter, NativeModules } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import TreqSsh, { PtyEventPayload } from '../native/TreqSsh';
import { ptyAttachCommandArgv, ptyStopArgv, parsePtyAttachCommand } from '../lib/ptyRemoteCli';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

/**
 * Full interactive PTY terminal (mobile PRD Phase 7 "Terminal UX").
 *
 * ## Terminal emulation: WebView + xterm.js
 *
 * Of the PRD's open options (a hand-rolled RN ANSI renderer vs. a WebView
 * hosting xterm.js), this picks WebView + xterm.js: real ANSI/VT100
 * handling (cursor movement, colors, alt-screen apps like `vim`/`less`,
 * which agent TUIs and ad hoc shell use both need per "Terminal UX")
 * would otherwise mean re-implementing a terminal emulator from scratch.
 * xterm.js is loaded from a CDN inside the WebView's HTML rather than
 * bundled, so this is a network-dependent MVP, not a final offline-capable
 * shape - see `mobile/README.md`'s "Status" section for what that implies.
 *
 * PTY output (`PtyEventPayload` with `type: 'data'`, base64-encoded raw
 * bytes) is forwarded into the WebView via `postMessage` and written
 * straight to the xterm.js instance; keystrokes flow the other way via
 * xterm's `onData` calling back through `window.ReactNativeWebView`.
 *
 * NOT verified against a running WebView (no device/simulator available in
 * this environment) - see the PRD's Phase 7 write-up for exactly what was
 * and was not exercised.
 */
export function TerminalScreen({ navigation, route }: Props): React.JSX.Element {
  const { sessionId, repo, workspaceId, label, remoteDir, command } = route.params;
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'attached' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<{ postMessage: (msg: string) => void } | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  const attach = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    try {
      const attachArgv = ptyAttachCommandArgv(repo, workspaceId, label, {
        remoteDir,
        command,
        cols: 80,
        rows: 24,
      });
      const result = await TreqSsh.execCommand(sessionId, attachArgv);
      if (result.exitStatus !== 0) {
        throw new Error(result.stderr || `treq exited with status ${result.exitStatus}`);
      }
      const literalCommand = parsePtyAttachCommand(result.stdout);
      const id = await TreqSsh.openPty(sessionId, 'xterm-256color', 80, 24, literalCommand);
      ptyIdRef.current = id;
      setPtyId(id);
      await TreqSsh.startPtyEventStream(id);
      setStatus('attached');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [sessionId, repo, workspaceId, label, remoteDir, command]);

  useEffect(() => {
    attach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reattach on foreground, mirroring `certRenewal.ts`'s AppState
  // "active" listener pattern - a session detached by app suspension
  // reattaches to the still-running remote tmux/screen session as soon as
  // the user comes back, rather than requiring a manual tap.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && status === 'error') {
        attach();
      }
    });
    return () => subscription.remove();
  }, [attach, status]);

  useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.TreqSsh);
    const subscription = emitter.addListener('TreqSshPtyEvent', (event: PtyEventPayload) => {
      if (event.ptyId !== ptyIdRef.current) return;
      if (event.type === 'data') {
        webviewRef.current?.postMessage(JSON.stringify({ type: 'data', dataBase64: event.dataBase64 }));
      } else if (event.type === 'exit' || event.type === 'closed') {
        setStatus('error');
        setError('Session ended');
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return () => {
      // Detach (not stop) on unmount: closing this screen must not kill the
      // persistent VM-local session - that is what makes reattach possible.
      if (ptyIdRef.current) {
        TreqSsh.stopPtyEventStream(ptyIdRef.current).catch(() => {});
        TreqSsh.closePty(ptyIdRef.current).catch(() => {});
      }
    };
  }, []);

  const handleTerminalInput = useCallback(
    (dataBase64: string) => {
      if (ptyId) {
        TreqSsh.ptyWrite(ptyId, dataBase64).catch(() => {});
      }
    },
    [ptyId],
  );

  const handleDetach = () => {
    // Leaves the backend `pty-remote` session running; navigating back
    // alone (via the cleanup effect above) already detaches.
    navigation.goBack();
  };

  const handleStop = () => {
    Alert.alert('Stop session', `Stop the "${label}" session? This ends the remote process.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          try {
            await TreqSsh.execCommand(sessionId, ptyStopArgv(repo, workspaceId, label));
          } finally {
            navigation.goBack();
          }
        },
      },
    ]);
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => null, // Buttons rendered in-body below to keep this testable without a real header.
    });
  }, [navigation]);

  const html = buildTerminalHtml();

  return (
    <View style={styles.container} testID="terminal-screen">
      <View style={styles.toolbar}>
        <View testID="terminal-status">{status}</View>
        <View testID="terminal-detach-button" onTouchEnd={handleDetach} />
        <View testID="terminal-stop-button" onTouchEnd={handleStop} />
      </View>
      {error ? <View testID="terminal-error">{error}</View> : null}
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(event: { nativeEvent: { data: string } }) => {
          try {
            const parsed = JSON.parse(event.nativeEvent.data) as { type: string; dataBase64?: string };
            if (parsed.type === 'input' && parsed.dataBase64) {
              handleTerminalInput(parsed.dataBase64);
            }
          } catch {
            // Ignore malformed bridge messages rather than crashing the screen.
          }
        }}
        style={styles.webview}
      />
    </View>
  );
}

/**
 * Minimal xterm.js host page. Loads xterm.js from a CDN (see module doc
 * comment for why this is not yet a bundled/offline asset) and wires
 * `window.ReactNativeWebView.postMessage` both ways: RN -> WebView writes
 * arrive via `window.document.addEventListener('message', ...)` (Android)
 * / `window.addEventListener('message', ...)` (iOS), and keystrokes flow
 * back out through xterm's `onData`.
 */
function buildTerminalHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
<style>html,body,#term{height:100%;margin:0;background:#000;}</style>
</head>
<body>
<div id="term"></div>
<script>
  const term = new Terminal({ convertEol: true });
  term.open(document.getElementById('term'));
  term.onData((data) => {
    const bytes = new TextEncoder().encode(data);
    const dataBase64 = btoa(String.fromCharCode(...bytes));
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', dataBase64 }));
  });
  function handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data' && msg.dataBase64) {
        const binary = atob(msg.dataBase64);
        term.write(binary);
      }
    } catch (e) {}
  }
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  toolbar: { flexDirection: 'row', padding: 8, gap: 12 },
  webview: { flex: 1 },
});
