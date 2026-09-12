import React from 'react';
import { render } from '@testing-library/react-native';
import { WorkspacesScreen } from '../WorkspacesScreen';

describe('WorkspacesScreen', () => {
  it('renders the session id from route params', () => {
    const { getByText } = render(
      <WorkspacesScreen
        navigation={{} as any}
        route={{ key: 'workspaces', name: 'Workspaces', params: { sessionId: 'session-42' } } as any}
      />,
    );

    expect(getByText('Connected. Session: session-42')).toBeTruthy();
  });
});
