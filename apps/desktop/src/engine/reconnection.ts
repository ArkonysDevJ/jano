/**
 * Reconnection orchestrator (section 13, step 3): what apps/desktop
 * runs when the client regains network access, BEFORE any normal sync
 * authentication. Wires together the three pieces that, until now,
 * only existed in isolation:
 *
 * - rotation-state-machine.ts: the local decision logic (is there a
 *   pending rotation? what to persist, when to clear it, the
 *   two-phase idempotency guarantee).
 * - opaque-client.ts: the OPAQUE protocol math, wrapped by --
 * - rotation-http-client.ts: the actual network calls to
 *   apps/api/src/rotation.
 *
 * Deliberately does NOT obtain the session/refresh token itself --
 * that's the normal OPAQUE login flow (opaque-client.ts's
 * startLogin/finishLogin against /auth/login/*), a separate concern
 * this orchestrator assumes the caller already handles (fresh login
 * this session, or a token read from local storage -- that storage
 * choice is still an open item, see rotation-state-machine.ts's
 * `PendingRotationStore` comment on section 9). `getToken` in
 * `RotationHttpConfig` models exactly that indirection: reconnection
 * only concerns the ADDITIONAL step a pending offline rotation
 * requires before that token can be trusted for sync -- login itself
 * still needs to happen either way, whether or not anything was
 * pending here.
 */

import { completeOfflineRotation } from './rotation-state-machine';
import type { CompleteOfflineRotationResult, PendingRotationStore } from './rotation-state-machine';
import { HttpOpaqueRotationClient } from './rotation-http-client';
import type { RotationHttpConfig } from './rotation-http-client';
import type { Bytes } from './types';

export interface ReconnectInput {
  /** The currently-active local unlock KEK, already derived by the caller's normal unlock flow. */
  readonly kek: Bytes;
  readonly store: PendingRotationStore;
  readonly http: RotationHttpConfig;
}

/**
 * Runs step 3 of section 13 against the real API. Safe to call on
 * every reconnection unconditionally -- `completeOfflineRotation`
 * itself is a no-op (`completed: false`) when there is nothing
 * pending, so callers don't need to track locally whether a rotation
 * happened before deciding whether to call this.
 */
export async function reconnect(input: ReconnectInput): Promise<CompleteOfflineRotationResult> {
  const client = new HttpOpaqueRotationClient(input.http);
  return completeOfflineRotation({ kek: input.kek, store: input.store, client });
}
