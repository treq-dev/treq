import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConnectScreen } from '../screens/ConnectScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { ManagedConnectScreen } from '../screens/ManagedConnectScreen';
import { WorkspacesScreen } from '../screens/WorkspacesScreen';
import { WorkspaceDetailScreen } from '../screens/WorkspaceDetailScreen';
import { DiffScreen } from '../screens/DiffScreen';
import { CommitsScreen } from '../screens/CommitsScreen';
import { ConflictsScreen } from '../screens/ConflictsScreen';
import { AgentScreen } from '../screens/AgentScreen';

export type RootStackParamList = {
  Connect: undefined;
  SignIn: undefined;
  ManagedConnect: undefined;
  Workspaces: { sessionId: string };
  WorkspaceDetail: { sessionId: string; repo: string; workspaceId: number; workspaceName: string };
  Diff: { sessionId: string; repo: string; workspaceId: number; path: string };
  Commits: { sessionId: string; repo: string; workspaceId: number };
  Conflicts: { sessionId: string; repo: string; workspaceId: number };
  Agent: { sessionId: string; repo: string; workspaceId: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="Connect">
      <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect' }} />
      <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign in' }} />
      <Stack.Screen name="ManagedConnect" component={ManagedConnectScreen} options={{ title: 'Managed instance' }} />
      <Stack.Screen name="Workspaces" component={WorkspacesScreen} options={{ title: 'Workspaces' }} />
      <Stack.Screen name="WorkspaceDetail" component={WorkspaceDetailScreen} options={{ title: 'Workspace' }} />
      <Stack.Screen name="Diff" component={DiffScreen} options={{ title: 'Diff' }} />
      <Stack.Screen name="Commits" component={CommitsScreen} options={{ title: 'Commits' }} />
      <Stack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: 'Conflicts' }} />
      <Stack.Screen name="Agent" component={AgentScreen} options={{ title: 'Agent' }} />
    </Stack.Navigator>
  );
}
