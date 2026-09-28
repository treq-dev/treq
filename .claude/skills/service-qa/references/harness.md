# How the harness works

Part of the `service-qa` skill.

1. **Local stack** — `supabase start` (Makefile `make start`) brings up API
   `:54321`, DB `:54322`, Studio `:54323`, Inbucket `:54324`, and the local
   Edge runtime. `supabase db reset --local` applies
   `supabase/migrations/**` + `supabase/seed.sql`.
2. **Health gate** — `scripts/service-qa/health.ts` (loaded from
   `test/setup.service-qa.ts`) fails the run immediately if
   `127.0.0.1:54321` is down, with instructions to run
   `npm run service-qa:up`.
3. **Clients** — `getAnonClient()` / `getServiceClient()` read keys from
   `supabase status -o env` when available, falling back to the standard local
   demo JWTs (same anon key as `package.json` → `env.dev.supabase`).
4. **Seed helpers** — `createTestUser` (email/password `signUp`),
   `signInWithEmailPassword`, `linkGithubRepo`, `withMergeQueueFixture`
   (setup + teardown). Profile rows are auto-created by `handle_new_user`.
   Edge Functions import `@supabase/supabase-js` from
   `supabase/functions/node_modules` (see `deno.json` import map); `service-qa:up`
   runs `npm install --prefix supabase/functions`.
5. **`recordOutcome(name, { expectations, details })`** — writes
   `scripts/service-qa/.generated/<name>.json`. Like app-qa's
   `captureDocument` expectations, these are plain-English claims for the
   agent checklist in step 5 — complementary to the Vitest `expect` calls,
   not a replacement.

`vitest.service-qa.config.ts` uses the **node** environment (not jsdom) and is
**excluded** from `npm test`, so the main suite stays runnable without Docker.
