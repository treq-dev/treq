import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConnectScreen } from '../screens/ConnectScreen';
import { WorkspacesScreen } from '../screens/WorkspacesScreen';
import { WorkspaceDetailScreen } from '../screens/WorkspaceDetailScreen';
import { DiffScreen } from '../screens/DiffScreen';
import { CommitsScreen } from '../screens/CommitsScreen';
import { ConflictsScreen } from '../screens/ConflictsScreen';

export type RootStackParamList = {
  Connect: undefined;
  Workspaces: { sessionId: string };
  WorkspaceDetail: { sessionId: string; repo: string; workspaceId: number; workspaceName: string };
  Diff: { sessionId: string; repo: string; workspaceId: number; path: string };
  Commits: { sessionId: string; repo: string; workspaceId: number };
  Conflicts: { sessionId: string; repo: string; workspaceId: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="Connect">
      <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect' }} />
      <Stack.Screen name="Workspaces" component={WorkspacesScreen} options={{ title: 'Workspaces' }} />
      <Stack.Screen name="WorkspaceDetail" component={WorkspaceDetailScreen} options={{ title: 'Workspace' }} />
      <Stack.Screen name="Diff" component={DiffScreen} options={{ title: 'Diff' }} />
      <Stack.Screen name="Commits" component={CommitsScreen} options={{ title: 'Commits' }} />
      <Stack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: 'Conflicts' }} />
    </Stack.Navigator>
  );
}
