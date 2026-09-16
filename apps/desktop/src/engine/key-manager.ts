/**
 * KEK/DEK lifecycle within an active session.
 * Reference: docs/ARCHITECTURE-01.md, section 9.
 *
 * - KEK: single-use -- unwraps/re-wraps the DEK at unlock and during
 *   rotation. Zeroized immediately after each of those two events,
 *   never kept in memory outside of them.
 * - DEK: persists in memory for the whole active session (intended to
 *   live inside a Web Worker -- see this folder's README). Cleared
 *   only on logout or inactivity timeout (by calling `lock()`), not
 *   after each individual operation.
 *
 * Explicitly declared limit (section 9): `.fill(0)` is a good-faith
 * mitigation, not certified secure erasure -- V8 may have copied the
 * buffer during compaction/JIT/generational GC. This class does not
 * promise more than it can guarantee.
 */

import { aesGcmOpen, aesGcmSeal, packSealed, unpackSealed } from './aes-gcm';
import type { Bytes, KekPurpose, WrappedDek } from './types';

export class KeyManager {
  #dek: Bytes | null = null;

  get hasUnlockedDek(): boolean {
    return this.#dek !== null;
  }

  /**
   * Unwraps the DEK with the given KEK and keeps it resident in memory
   * for the active session. The passed-in KEK is zeroized inside this
   * call -- the caller must not retain its own copy of the KEK beyond
   * this point (pass a copy if it's needed for something else).
   */
  async unlockWith(kek: Bytes, wrapped: WrappedDek): Promise<void> {
    const sealed = unpackSealed(wrapped.ciphertext);
    const dek = await aesGcmOpen(kek, sealed);
    this.#setDek(dek);
    zeroize(kek);
  }

  /**
   * Loads a DEK that was just GENERATED, not unwrapped from storage --
   * the one path where there's nothing to decrypt yet (new-vault
   * creation, see registration.ts's `createNewVault()`). Deliberately
   * separate from `unlockWith()`: that method's contract is "unwrap
   * this existing wrapping", and conflating the two would blur which
   * KEK, if any, the caller is responsible for zeroizing.
   */
  loadDek(dek: Bytes): void {
    this.#setDek(dek);
  }

  /**
   * Re-wraps the current DEK under a new KEK (rotation, section 7 --
   * the DEK itself doesn't change; only which KEK protects it changes).
   * Corresponds to an atomic operation on ONE `vault_keys` row (section
   * 7, V1.2 correction: single DEK per vault, never per item) --
   * persisting that row is the caller's responsibility, not this
   * class's.
   */
  async rewrapUnder(
    newKek: Bytes,
    purpose: KekPurpose,
    newKeyVersion: number,
  ): Promise<WrappedDek> {
    const dek = this.#requireDek();
    const sealed = await aesGcmSeal(newKek, dek);
    zeroize(newKek);
    return { ciphertext: packSealed(sealed), purpose, keyVersion: newKeyVersion };
  }

  /** Encrypts a single record (vault_items.ciphertext, section 12) with the active DEK. */
  async encryptItem(plaintext: Bytes): Promise<Bytes> {
    const dek = this.#requireDek();
    return packSealed(await aesGcmSeal(dek, plaintext));
  }

  /** Decrypts a single record with the active DEK. */
  async decryptItem(packed: Bytes): Promise<Bytes> {
    const dek = this.#requireDek();
    return aesGcmOpen(dek, unpackSealed(packed));
  }

  /** Logout or inactivity timeout -- the only point where the DEK is cleared (section 9). */
  lock(): void {
    if (this.#dek) {
      zeroize(this.#dek);
      this.#dek = null;
    }
  }

  #setDek(dek: Bytes): void {
    if (this.#dek) zeroize(this.#dek); // defensive -- shouldn't happen in normal use
    this.#dek = dek;
  }

  #requireDek(): Bytes {
    if (!this.#dek) {
      throw new Error('Vault locked -- no DEK in memory.');
    }
    return this.#dek;
  }
}

/** Good-faith mitigation (section 9) -- not certified secure erasure. See the class docstring. */
function zeroize(buf: Bytes): void {
  buf.fill(0);
}
