/**
 * Offline master-key rotation state machine (`pending_opaque_rotation`).
 * Reference: docs/ARCHITECTURE-01.md, section 13.
 *
 * Storage-agnostic on purpose: WHERE this gets persisted locally (OS
 * keychain, Tauri's secure storage, IndexedDB) is an open, unresolved
 * condition per section 9 ("to be evaluated once the packaging target
 * is confirmed") -- this module takes a `PendingRotationStore` the
 * caller supplies, instead of guessing a storage technology today.
 *
 * Likewise network-agnostic: completing a pending rotation means
 * calling POST /auth/rotate/start and /auth/rotate/finish
 * (apps/api/src/rotation) with real OPAQUE client math in between --
 * that needs an HTTP layer apps/desktop hasn't chosen yet (fetch vs a
 * Tauri command). Injected here as `OpaqueRotationClient` so this
 * file's actual decision logic (what to persist, when to clear it, the
 * two-phase idempotency guarantee) is real and testable today, without
 * blocking on that unmade choice. See opaque-client.ts for the OPAQUE
 * crypto primitives that client will eventually wrap.
 */

import { aesGcmOpen, aesGcmSeal, packSealed, unpackSealed } from './aes-gcm';
import { deriveMasterKek, DEFAULT_ARGON2ID_PARAMS } from './kek';
import type { KeyManager } from './key-manager';
import type { Argon2idParams, Bytes, WrappedDek } from './types';

export interface PendingRotationStore {
  save(packed: Bytes): Promise<void>;
  load(): Promise<Bytes | null>;
  clear(): Promise<void>;
}

export interface BeginOfflineRotationInput {
  /** Must already be unlocked (`manager.hasUnlockedDek === true`). */
  readonly manager: KeyManager;
  readonly newMasterPassword: string;
  readonly newLocalSalt: Bytes;
  /** The caller-tracked next master_key_version (server confirms it later, at reconnection -- see section 7). */
  readonly newKeyVersion: number;
  /** Incremented on every offline rotation (section 13) -- caller tracks and persists this across rotations. */
  readonly localRotationEpoch: number;
  readonly params?: Argon2idParams;
  readonly store: PendingRotationStore;
}

export interface BeginOfflineRotationResult {
  /** The new local unlock wrapping -- persist it, replacing whatever wrapped the DEK before. */
  readonly wrappedMasterDek: WrappedDek;
}

/**
 * Step 1-2 of section 13: offline, no network. Re-wraps the DEK under
 * the new KEK (an atomic operation, section 7), and separately persists
 * -- under that SAME new KEK, not a new trust boundary -- the minimum
 * material needed to complete OPAQUE re-registration later: the new
 * password itself. OPAQUE's registration handshake is interactive by
 * design and cannot be precomputed offline (the doc's own reasoning for
 * why this exception to "never hold the plaintext password" exists at
 * all) -- there is no way around needing it again at reconnection.
 */
export async function beginOfflineRotation(
  input: BeginOfflineRotationInput,
): Promise<BeginOfflineRotationResult> {
  const params = input.params ?? DEFAULT_ARGON2ID_PARAMS;
  const newKek = await deriveMasterKek(input.newMasterPassword, input.newLocalSalt, params);

  const payload = JSON.stringify({
    newPassword: input.newMasterPassword,
    localRotationEpoch: input.localRotationEpoch,
  });
  const payloadSealed = await aesGcmSeal(newKek.slice(), new TextEncoder().encode(payload));
  await input.store.save(packSealed(payloadSealed));

  // rewrapUnder() zeroizes the kek it receives -- the copy above already
  // did the payload encryption, so it's safe to hand over the original.
  const wrappedMasterDek = await input.manager.rewrapUnder(newKek, 'master', input.newKeyVersion);

  return { wrappedMasterDek };
}

export interface OpaqueRotationClient {
  /**
   * NOT IMPLEMENTED YET (see this file's header comment) -- runs
   * POST /auth/rotate/start -> answer any Factor 2 challenge -> POST
   * /auth/rotate/finish against the recovered password.
   */
  reregister(recoveredPassword: string): Promise<void>;
}

export interface CompleteOfflineRotationInput {
  /**
   * The currently-active local unlock KEK -- i.e. the NEW one, already
   * derived by the caller's normal unlock flow after the offline
   * rotation. NOT zeroized by this function (unlike `unlockWith`) --
   * that stays the caller's responsibility, consistent with how
   * `aesGcmOpen` itself never consumes its key argument.
   */
  readonly kek: Bytes;
  readonly store: PendingRotationStore;
  readonly client: OpaqueRotationClient;
}

export interface CompleteOfflineRotationResult {
  /** False when there was no pending rotation to complete -- not an error, the common case. */
  readonly completed: boolean;
}

/**
 * Step 3 of section 13: on reconnection, before any normal sync
 * authentication. Two-phase and idempotent by construction: the local
 * pending record is cleared ONLY after `client.reregister()` resolves
 * successfully. A network interruption mid-call simply leaves the
 * pending record in place for the next reconnection attempt to retry --
 * never a state where the server was updated but the local record
 * already forgotten, or the reverse.
 */
export async function completeOfflineRotation(
  input: CompleteOfflineRotationInput,
): Promise<CompleteOfflineRotationResult> {
  const packed = await input.store.load();
  if (!packed) {
    return { completed: false };
  }

  const payloadBytes = await aesGcmOpen(input.kek, unpackSealed(packed));
  const { newPassword } = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
    newPassword: string;
    localRotationEpoch: number;
  };

  await input.client.reregister(newPassword);
  await input.store.clear();

  return { completed: true };
}
