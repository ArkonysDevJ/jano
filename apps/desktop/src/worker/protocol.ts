/**
 * Typed request/response protocol for the engine Worker.
 * Reference: docs/ARCHITECTURE-01.md, section 9 (the DEK must live
 * inside a dedicated Web Worker, isolated from the main/UI thread) and
 * section 4 (Argon2id -- 64 MiB / 3 iterations by default, see
 * engine/kek.ts -- must not block the UI thread).
 *
 * Deliberately hand-rolled instead of a library like Comlink (see
 * apps/desktop/README.md for the full rationale): every message that
 * crosses this boundary is a plain, explicit, structurally-cloneable
 * object -- no proxies, no implicit function marshaling. `EngineClient`
 * (engine-client.ts) is the only thing on the main-thread side allowed
 * to `postMessage` to the worker; `engine.worker.ts` is the only thing
 * that listens on the worker side. UI code should not import this
 * file's types to reach into the worker directly -- it calls
 * `EngineClient`'s methods.
 *
 * Scope of THIS protocol version, intentionally: vault creation,
 * unlock, item encrypt/decrypt, and lock -- exactly what Fase 1's
 * unlock screen and single-credential reveal view need (DOCVIS-JANO-01's
 * companion checklist). Offline rotation (engine/rotation-state-machine.ts)
 * is NOT wired into the worker yet -- it mixes network calls and a
 * caller-supplied persisted store that don't map cleanly onto this
 * boundary as-is, and is deliberately left for its own pass rather than
 * guessed at here.
 */

import type { Argon2idParams, Bytes, WrappedDek } from '../engine/types';

/** One entry per exposed engine operation: its request payload and its result payload. */
export interface EngineOpMap {
  /** engine/registration.ts's createNewVault() -- generates and unlocks a brand-new vault. */
  createNewVault: {
    request: { readonly masterPassword: string; readonly params?: Argon2idParams };
    result: {
      readonly localSalt: Bytes;
      readonly recoverySalt: Bytes;
      /** Show to the user ONCE (section 3) -- the caller's responsibility, not this worker's. */
      readonly recoveryKitSecret: Bytes;
      readonly wrappedMasterDek: WrappedDek;
      readonly wrappedRecoveryDek: WrappedDek;
    };
  };

  /** Derives the master KEK and unwraps an existing vault's DEK (engine/key-manager.ts's unlockWith()). */
  unlockWithPassword: {
    request: {
      readonly masterPassword: string;
      readonly localSalt: Bytes;
      readonly wrapped: WrappedDek;
      readonly params?: Argon2idParams;
    };
    /** No DEK in the result, ever -- it stays resident inside the worker (section 9). */
    result: { readonly unlocked: true };
  };

  /** engine/key-manager.ts's lock() -- zeroizes the resident DEK. */
  lock: {
    request: Record<string, never>;
    result: { readonly locked: true };
  };

  /** engine/key-manager.ts's encryptItem() against the resident DEK. */
  encryptItem: {
    request: { readonly plaintext: Bytes };
    result: { readonly ciphertext: Bytes };
  };

  /** engine/key-manager.ts's decryptItem() against the resident DEK. */
  decryptItem: {
    request: { readonly packed: Bytes };
    result: { readonly plaintext: Bytes };
  };
}

export type EngineOp = keyof EngineOpMap;

/** Sent main thread -> worker. `id` correlates it to exactly one `EngineResponseMessage`. */
export interface EngineRequestMessage<Op extends EngineOp = EngineOp> {
  readonly id: number;
  readonly op: Op;
  readonly payload: EngineOpMap[Op]['request'];
}

/**
 * Sent worker -> main thread. Errors cross as a plain string
 * (`error.message`, or `String(error)` for a non-Error throw) -- never
 * the original Error/exception object, which is not guaranteed
 * structurally cloneable and may carry engine-internal detail this
 * boundary has no reason to leak to the UI layer.
 */
export type EngineResponseMessage<Op extends EngineOp = EngineOp> =
  | { readonly id: number; readonly ok: true; readonly result: EngineOpMap[Op]['result'] }
  | { readonly id: number; readonly ok: false; readonly error: string };
