import type { Session, User } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { create } from 'zustand';
import { environment } from './env';
import { exchangeToken as exchangeTokenWithControlPlane } from './controlPlane';
import { supabase } from './supabaseClient';

/**
 * Mirrors `src/stores/authStore.ts` (desktop). The one real difference:
 * desktop opens a browser window and gets a token back via its own
 * protocol handler; mobile has no generated native project yet to
 * register a URL scheme in (see mobile/README.md "Status"), so
 * `completeSignIn` takes a manually pasted token instead of a deep link -
 * the same kind of deliberate, documented temporary stand-in as
 * `parseConnectionString.ts`. Swapping in `Linking.addEventListener('url',
 * ...)` here later does not change anything below it (`exchangeToken`,
 * session state) once that native project exists.
 */
export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  beginSignIn: () => Promise<void>;
  completeSignIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: false,
  error: null,

  beginSignIn: async () => {
    await Linking.openURL(`${environment.webUrl}/sign-in?source=mobile`);
  },

  completeSignIn: async (token: string) => {
    set({ loading: true, error: null });
    try {
      await exchangeTokenWithControlPlane(token);
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, user: data.session?.user ?? null, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
      throw e;
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },

  restoreSession: async () => {
    set({ loading: true });
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, loading: false });
  },
}));
