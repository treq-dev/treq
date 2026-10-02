// Local unit tests for instance-store lookups. A fake query builder applies
// the filters to in-memory rows, so no Supabase project is needed.
//
// Run with: `deno test supabase/functions/tests/remote_instance_store.test.ts`

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import { getInstanceForOwner } from "../_shared/remote/instance-store.ts";

type Row = Record<string, unknown>;

function fakeClient(rows: Row[]): SupabaseClient {
  const query = (matching: Row[]) => ({
    select: () => query(matching),
    eq: (col: string, v: unknown) => query(matching.filter((r) => r[col] === v)),
    neq: (col: string, v: unknown) => query(matching.filter((r) => r[col] !== v)),
    maybeSingle: () =>
      Promise.resolve(
        matching.length > 1
          ? { data: null, error: { message: "multiple rows" } }
          : { data: matching[0] ?? null, error: null },
      ),
  });
  return { from: () => query(rows) } as unknown as SupabaseClient;
}

const deleted = { id: "old", owner_user_id: "u1", status: "deleted" };
const live = { id: "new", owner_user_id: "u1", status: "ready" };

Deno.test("an owner whose only instance was deleted has no instance", async () => {
  assertEquals(await getInstanceForOwner(fakeClient([deleted]), "u1"), null);
});

Deno.test("the recreated instance wins over deleted history", async () => {
  const instance = await getInstanceForOwner(
    fakeClient([deleted, { ...deleted, id: "older" }, live]),
    "u1",
  );
  assertEquals(instance?.id, "new");
});
