import type { Session, User } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { create } from 'zustand';
import { environment } from './env';
import { exchangeToken as exchangeTokenWithControlPlane } from './controlPlane';
import { supabase } from './supabaseClient';

/**
 * Mirrors `src/stores/authStore.ts` (desktop). Desktop opens a browser
 * window and gets a token back via its own protocol handler; mobile does
 * the same now via the `treqmobile://sign-in?token=...` deep link
 * registered in `android/app/src/main/AndroidManifest.xml` (intent-filter)
 * and `ios/TreqMobile/Info.plist` (`CFBundleURLTypes`) - see
 * `listenForSignInDeepLink` below. `completeSignIn` (manual token paste)
 * remains as a fallback for a device/simulator where the deep link isn't
 * delivered (e.g. this repo's own automated tests, which have no real
 * native runtime to fire a `Linking` `url` event through).
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

/** Extracts a `token` query parameter from a `treqmobile://sign-in?...`
 * deep link, without pulling in a URL-parsing dependency for one field. */
export function extractSignInToken(url: string): string | null {
  const match = /[?&]token=([^&]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Registers a `Linking` listener that completes sign-in automatically
 * when the OS delivers the `treqmobile://sign-in?token=...` redirect from
 * the web sign-in page. Call once, e.g. from `SignInScreen`'s mount
 * effect; returns the unsubscribe function. */
export function listenForSignInDeepLink(): () => void {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    const token = extractSignInToken(url);
    if (token) {
      void useAuthStore.getState().completeSignIn(token);
    }
  });
  return () => subscription.remove();
}
