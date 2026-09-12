import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConnectScreen } from '../screens/ConnectScreen';
import { WorkspacesScreen } from '../screens/WorkspacesScreen';

export type RootStackParamList = {
  Connect: undefined;
  Workspaces: { sessionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="Connect">
      <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect' }} />
      <Stack.Screen name="Workspaces" component={WorkspacesScreen} options={{ title: 'Workspaces' }} />
    </Stack.Navigator>
  );
}
