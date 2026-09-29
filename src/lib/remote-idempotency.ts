// Idempotency keys for user-initiated remote mutations
// (prds/remote-development.md, "Structured command protocol" > "Retrying
// after network loss").
//
// The VM uses the key to recognise a repeat of a command it has already
// run. A key built from `Date.now()` changes on every tap, so when a user
// taps "Confirm" again after an ambiguous result the VM sees a new command
// and can run it twice. The key must instead belong to the user's action:
// the same inputs, retried before any confirmed outcome, reuse the same
// key. A confirmed outcome ends the action, so the next tap starts a new
// one with a new key.

import { useState } from "react";
import type { MutationDispatchResult } from "./remote-dispatch";

export class ActionIdempotencyKeys {
  /** Unconfirmed actions: input fingerprint -> the key they were sent with. */
  private readonly pending = new Map<string, string>();
  private readonly newId: () => string;

  constructor(newId: () => string = () => crypto.randomUUID()) {
    this.newId = newId;
  }

  /**
   * The key for an action with these inputs. Returns the earlier key while
   * an action with the same inputs has no confirmed outcome; otherwise
   * starts a new action.
   */
  keyFor(prefix: string, inputs: readonly unknown[]): string {
    const fingerprint = JSON.stringify([prefix, ...inputs]);
    let key = this.pending.get(fingerprint);
    if (!key) {
      key = `${prefix}:${this.newId()}`;
      this.pending.set(fingerprint, key);
    }
    return key;
  }

  /**
   * Records the outcome of the dispatch sent with `key`. Only a confirmed
   * outcome ends the action: after an ambiguous result or an error the user
   * may retry, and that retry must carry the same key.
   */
  settle(key: string, result: MutationDispatchResult<unknown>): void {
    if (result.status === "ambiguous") return;
    for (const [fingerprint, pendingKey] of this.pending) {
      if (pendingKey === key) this.pending.delete(fingerprint);
    }
  }
}

/** One `ActionIdempotencyKeys` per component instance. */
export function useActionIdempotencyKeys(): ActionIdempotencyKeys {
  const [keys] = useState(() => new ActionIdempotencyKeys());
  return keys;
}
