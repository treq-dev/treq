import React, { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuthStore } from '../lib/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

// Managed-instance path (prds/mobile.md Phase 2). Real Supabase auth: opens
// the same web sign-in page desktop does, but takes the resulting one-time
// token via manual paste rather than a deep link, since no native iOS/
// Android project has been generated yet to register a URL scheme in - see
// src/lib/authStore.ts's module doc for why this is temporary, not a
// design choice.
export function SignInScreen({ navigation }: Props): React.JSX.Element {
  const { session, loading, error, beginSignIn, completeSignIn } = useAuthStore();
  const [token, setToken] = useState('');

  if (session) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>Signed in as {session.user.email ?? session.user.id}</Text>
        <Button title="Continue" onPress={() => navigation.navigate('ManagedConnect')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>1. Sign in in your browser</Text>
      <Button title="Open sign-in page" onPress={() => beginSignIn()} />

      <Text style={styles.label}>2. Paste the token shown after sign-in</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        placeholder="one-time sign-in token"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator /> : (
        <Button title="Complete sign-in" onPress={() => completeSignIn(token)} disabled={!token.trim()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  label: { marginTop: 16, marginBottom: 4, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  error: { color: 'crimson', marginVertical: 12 },
});
