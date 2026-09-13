import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { listenForSignInDeepLink, useAuthStore } from '../lib/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

// Managed-instance path (prds/mobile.md Phase 2). Real Supabase auth: opens
// the same web sign-in page desktop does. The web page's success redirect
// (treqmobile://sign-in?token=...) completes sign-in automatically via
// `listenForSignInDeepLink` (see src/lib/authStore.ts) - the manual paste
// field below is a fallback for a device/simulator where that deep link
// isn't delivered, kept rather than removed since this repo's own tests
// have no real native runtime to fire the event through.
export function SignInScreen({ navigation }: Props): React.JSX.Element {
  const { session, loading, error, beginSignIn, completeSignIn } = useAuthStore();
  const [token, setToken] = useState('');

  useEffect(() => listenForSignInDeepLink(), []);

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

      <Text style={styles.label}>2. Return to this app automatically, or paste the token shown after sign-in</Text>
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
