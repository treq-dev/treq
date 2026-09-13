import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { environment } from './env';

/**
 * Unlike desktop (`src/lib/supabase.ts`, `persistSession: false` - it
 * manages its own SQLite-backed session persistence), mobile uses
 * supabase-js's built-in AsyncStorage-backed session persistence and
 * auto-refresh, since there is no equivalent local database here to persist
 * into manually.
 */
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
