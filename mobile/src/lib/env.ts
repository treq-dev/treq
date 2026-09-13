/**
 * Mirrors the `env` field in the root `package.json` (`src/lib/supabase.ts`
 * reads it the same way, keyed by `import.meta.env.PROD`). Mobile is a
 * separate npm project (no Vite `import.meta.env`), so this is __DEV__-keyed
 * instead and the values themselves are duplicated here rather than shared
 * at build time - keep in sync with the root `package.json`'s `env.dev`/
 * `env.prod` if those ever change.
 */
export type Environment = {
  webUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const dev: Environment = {
  webUrl: 'http://localhost:3001',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};

const prod: Environment = {
  webUrl: 'https://treq.dev',
  supabaseUrl: 'https://xnlljmfiqyumiyexydyl.supabase.co',
  supabaseAnonKey: 'sb_publishable_pLkrXd6cs1V7Ot6Dnowmtw_KBgFf88E',
};

export const environment: Environment = __DEV__ ? dev : prod;
