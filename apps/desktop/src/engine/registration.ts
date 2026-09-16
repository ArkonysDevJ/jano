/**
 * New-vault creation ceremony (sections 3, 9).
 * Reference: docs/ARCHITECTURE-01.md.
 *
 * Generates the vault's SINGLE DEK and wraps it TWICE -- once under the
 * master-password KEK, once under the recovery-kit KEK (section 3, the
 * dual-role, non-negotiable recovery model). Both wrappings start at
 * keyVersion 1 and are meant to be pushed to the server via
 * `POST /vault-keys` (see apps/api/src/vault-keys) right after
 * register/finish + the first login -- this module does not call the
 * network itself, it only produces the material that call needs.
 */

import { aesGcmSeal, packSealed } from './aes-gcm';
import { deriveMasterKek, deriveRecoveryKek, DEFAULT_ARGON2ID_PARAMS } from './kek';
import { KeyManager } from './key-manager';
import type { Argon2idParams, Bytes, WrappedDek } from './types';

const DEK_BYTES = 32; // AES-256
const SALT_BYTES = 16;
const RECOVERY_SECRET_BYTES = 32;

export interface NewVaultMaterial {
  /** Already unlocked with the freshly-generated DEK -- ready to encrypt items immediately. */
  readonly manager: KeyManager;
  /** Persist alongside the local account record -- not secret, but never reuse across accounts. */
  readonly localSalt: Bytes;
  /** Persist alongside the recovery kit metadata -- not secret either. */
  readonly recoverySalt: Bytes;
  /**
   * Show to the user ONCE (the printable recovery kit, section 3) and
   * then discard -- this module never persists it, and after this call
   * returns, nothing in the engine retains a copy.
   */
  readonly recoveryKitSecret: Bytes;
  /** Send to POST /vault-keys with purpose: 'master', keyVersion: 1. */
  readonly wrappedMasterDek: WrappedDek;
  /** Send to POST /vault-keys with purpose: 'recovery', keyVersion: 1. */
  readonly wrappedRecoveryDek: WrappedDek;
}

/**
 * Creates a brand-new vault: a fresh random DEK, wrapped under a
 * freshly-derived master KEK (from `masterPassword`) and a freshly-
 * derived recovery KEK (from a freshly-generated `recoveryKitSecret`).
 * Both KEKs are zeroized before this function returns -- only the DEK
 * (inside the returned, already-unlocked `manager`) and the wrapped
 * blobs survive.
 */
export async function createNewVault(
  masterPassword: string,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<NewVaultMaterial> {
  const dek: Bytes = crypto.getRandomValues(new Uint8Array(DEK_BYTES));
  const localSalt: Bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const recoverySalt: Bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const recoveryKitSecret: Bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_SECRET_BYTES));

  const masterKek = await deriveMasterKek(masterPassword, localSalt, params);
  const recoveryKek = await deriveRecoveryKek(recoveryKitSecret, recoverySalt, params);

  const masterSealed = await aesGcmSeal(masterKek, dek);
  const recoverySealed = await aesGcmSeal(recoveryKek, dek);
  masterKek.fill(0);
  recoveryKek.fill(0);

  const wrappedMasterDek: WrappedDek = {
    ciphertext: packSealed(masterSealed),
    purpose: 'master',
    keyVersion: 1,
  };
  const wrappedRecoveryDek: WrappedDek = {
    ciphertext: packSealed(recoverySealed),
    purpose: 'recovery',
    keyVersion: 1,
  };

  const manager = new KeyManager();
  manager.loadDek(dek);

  return { manager, localSalt, recoverySalt, recoveryKitSecret, wrappedMasterDek, wrappedRecoveryDek };
}
