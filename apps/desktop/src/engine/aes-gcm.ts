/**
 * Content encryption -- AES-256-GCM via native WebCrypto.
 * Reference: docs/ARCHITECTURE-01.md, section 5.
 *
 * Random 96-bit nonce (CSPRNG) per operation, both for content and for
 * DEK wrapping. A monotonic counter was explicitly rejected by the
 * architecture -- it requires cross-device state synchronization,
 * incompatible with offline-first.
 */

import type { AesGcmSealed, Bytes } from './types';

const NONCE_BYTES = 12; // 96 bits

async function importAesKey(rawKey: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypts `plaintext` under `rawKey`. Generates a new nonce on every call. */
export async function aesGcmSeal(
  rawKey: Bytes,
  plaintext: Bytes,
): Promise<AesGcmSealed> {
  const key = await importAesKey(rawKey);
  const nonce: Bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext: Bytes = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  );
  return { nonce, ciphertext };
}

/** Decrypts and verifies the authentication tag. Throws if the tag doesn't validate. */
export async function aesGcmOpen(
  rawKey: Bytes,
  sealed: AesGcmSealed,
): Promise<Bytes> {
  const key = await importAesKey(rawKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.nonce },
    key,
    sealed.ciphertext,
  );
  return new Uint8Array(plaintext);
}

/**
 * Packs nonce + ciphertext into a single buffer for persistence
 * (vault_items.ciphertext, vault_keys.wrapped_dek -- section 12).
 */
export function packSealed(sealed: AesGcmSealed): Bytes {
  const packed: Bytes = new Uint8Array(sealed.nonce.length + sealed.ciphertext.length);
  packed.set(sealed.nonce, 0);
  packed.set(sealed.ciphertext, sealed.nonce.length);
  return packed;
}

export function unpackSealed(packed: Bytes): AesGcmSealed {
  return {
    nonce: packed.slice(0, NONCE_BYTES),
    ciphertext: packed.slice(NONCE_BYTES),
  };
}
