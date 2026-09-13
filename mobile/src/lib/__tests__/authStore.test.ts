jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn(), signOut: jest.fn() },
  },
}));
jest.mock('../controlPlane', () => ({
  exchangeToken: jest.fn(),
}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));

import { Linking } from 'react-native';
import { supabase } from '../supabaseClient';
import { exchangeToken } from '../controlPlane';
import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ user: null, session: null, loading: false, error: null });
  });

  it('beginSignIn opens the web sign-in page with source=mobile', async () => {
    await useAuthStore.getState().beginSignIn();
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/sign-in?source=mobile'));
  });

  it('completeSignIn exchanges the token and stores the resulting session', async () => {
    (exchangeToken as jest.Mock).mockResolvedValue(undefined);
    const fakeSession = { user: { id: 'u1', email: 'a@b.com' }, access_token: 'at' };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: fakeSession } });

    await useAuthStore.getState().completeSignIn('one-time-token');

    expect(exchangeToken).toHaveBeenCalledWith('one-time-token');
    expect(useAuthStore.getState().session).toEqual(fakeSession);
    expect(useAuthStore.getState().user).toEqual(fakeSession.user);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('completeSignIn surfaces an error and clears loading on failure', async () => {
    (exchangeToken as jest.Mock).mockRejectedValue(new Error('bad token'));

    await expect(useAuthStore.getState().completeSignIn('bad')).rejects.toThrow('bad token');

    expect(useAuthStore.getState().error).toBe('bad token');
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('signOut clears session state', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    useAuthStore.setState({ session: { access_token: 'at' } as any, user: { id: 'u1' } as any });

    await useAuthStore.getState().signOut();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
