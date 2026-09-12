import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Workspaces'>;

// Placeholder for the connected session: workspace listing over
// `TreqSsh.execCommand` (`treq workspace list --format=json`) lands in a
// later milestone (see prds/mobile.md Phase 3).
export function WorkspacesScreen({ route }: Props): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Connected. Session: {route.params.sessionId}</Text>
      <Text style={styles.todo}>Workspace listing not implemented yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  todo: { marginTop: 8, color: '#666' },
});
