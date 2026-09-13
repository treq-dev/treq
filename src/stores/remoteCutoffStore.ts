// Frontend reauthentication-required state for the "Hard cutoff on
// revocation or expiry" PRD section. Listens for the Rust transport's
// `remote://cutoff` Tauri event (emitted by `remote_force_cutoff` in
// `src-tauri/src/commands/remote_control.rs`, which the certificate-renewal
// loop in `src/lib/remote-cert-lifecycle.ts` calls whenever renewal is
// refused or a certificate lapses unrenewed) and tracks which endpoints are
// currently blocked behind a reauthentication prompt.
//
// Not yet wired into a specific screen - like the rest of the native SSH
// transport (see `commands::remote_dispatch_over_ssh`'s own doc comment),
// binding this to the actual remote workspace UI is Phase 6/later work. This
// store is the real, callable piece that UI work hangs off of: components
// read `useRemoteCutoffStore((s) => s.cutoffs[endpointId])` to decide
// whether to show a blocking reauth prompt for that endpoint.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { remoteClearCutoff } from "../lib/api-extra";
import type { CutoffReason } from "../lib/remote-cert-lifecycle";

export const REMOTE_CUTOFF_EVENT = "remote://cutoff";

interface RemoteCutoffEventPayload {
  endpoint_id: string;
  reason: CutoffReason;
}

interface RemoteCutoffState {
  /** endpoint id -> why it was cut off. Absence means not cut off. */
  cutoffs: Record<string, CutoffReason>;
  unlisten: UnlistenFn | null;
  /** In-flight `listen()` call, if any, so concurrent `startListening`
   * callers await the same registration instead of each registering their
   * own listener. */
  starting: Promise<void> | null;
  /** Starts listening for `remote://cutoff` events. Idempotent, including
   * against concurrent callers. */
  startListening: () => Promise<void>;
  stopListening: () => void;
  /** Records a cutoff without waiting for the event (e.g. right after
   * calling `remote_force_cutoff` locally). */
  recordCutoff: (endpointId: string, reason: CutoffReason) => void;
  /** Clears local cutoff state and the transport-level cutoff for
   * `endpointId` after the user reauthenticates and a fresh certificate is
   * issued through the normal registration and issuance flow. */
  clearCutoff: (endpointId: string) => Promise<void>;
}

export const useRemoteCutoffStore = create<RemoteCutoffState>((set, get) => {
  const handleCutoffEvent = (event: { payload: RemoteCutoffEventPayload }) => {
    set((state) => ({
      cutoffs: {
        ...state.cutoffs,
        [event.payload.endpoint_id]: event.payload.reason,
      },
    }));
  };

  const registerListener = async () => {
    const unlisten = await listen<RemoteCutoffEventPayload>(
      REMOTE_CUTOFF_EVENT,
      handleCutoffEvent,
    );
    set({ unlisten, starting: null });
  };

  return {
    cutoffs: {},
    unlisten: null,
    starting: null,
    startListening: async () => {
      if (get().unlisten) return;
      const inFlight = get().starting;
      if (inFlight) return inFlight;

      const registration = registerListener();
      set({ starting: registration });
      return registration;
    },
    stopListening: () => {
      get().unlisten?.();
      set({ unlisten: null, starting: null });
    },
    recordCutoff: (endpointId, reason) => {
      set((state) => ({
        cutoffs: { ...state.cutoffs, [endpointId]: reason },
      }));
    },
    clearCutoff: async (endpointId) => {
      await remoteClearCutoff(endpointId);
      set((state) => {
        const next = { ...state.cutoffs };
        delete next[endpointId];
        return { cutoffs: next };
      });
    },
  };
});
