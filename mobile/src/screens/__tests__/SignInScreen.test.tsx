jest.mock('../../lib/authStore');

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SignInScreen } from '../SignInScreen';
import { useAuthStore } from '../../lib/authStore';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <SignInScreen navigation={{ navigate: mockNavigate } as any} route={{ key: 'sign-in', name: 'SignIn' } as any} />,
  );
}

describe('SignInScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the sign-in page and completes sign-in with a pasted token', async () => {
    const beginSignIn = jest.fn();
    const completeSignIn = jest.fn().mockResolvedValue(undefined);
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      session: null, loading: false, error: null, beginSignIn, completeSignIn,
    });

    const { getByText, getByPlaceholderText } = renderScreen();

    fireEvent.press(getByText('Open sign-in page'));
    expect(beginSignIn).toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('one-time sign-in token'), 'the-token');
    fireEvent.press(getByText('Complete sign-in'));

    await waitFor(() => expect(completeSignIn).toHaveBeenCalledWith('the-token'));
  });

  it('surfaces an error from the store', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      session: null, loading: false, error: 'invalid token', beginSignIn: jest.fn(), completeSignIn: jest.fn(),
    });

    const { getByText } = renderScreen();
    expect(getByText('invalid token')).toBeTruthy();
  });

  it('shows a Continue button once signed in', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      session: { user: { id: 'u1', email: 'a@b.com' } }, loading: false, error: null,
      beginSignIn: jest.fn(), completeSignIn: jest.fn(),
    });

    const { getByText } = renderScreen();
    expect(getByText('Signed in as a@b.com')).toBeTruthy();

    fireEvent.press(getByText('Continue'));
    expect(mockNavigate).toHaveBeenCalledWith('ManagedConnect');
  });
});
