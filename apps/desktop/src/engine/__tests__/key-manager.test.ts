import { describe, expect, it } from 'vitest';
import { aesGcmSeal, packSealed } from '../aes-gcm';
import { KeyManager } from '../key-manager';

/**
 * Smoke test of the KEK -> DEK -> item cycle. Does not replace the
 * pending technical review of the Argon2id parameters (see kek.ts) nor
 * does it cover the full offline rotation flow (section 13) -- that
 * belongs to a later commit, once the sync module exists.
 */
describe('KeyManager', () => {
  it('unlocks with a KEK, encrypts and decrypts an item, and locks cleanly', async () => {
    const sealingKek = crypto.getRandomValues(new Uint8Array(32));
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const sealedDek = await aesGcmSeal(sealingKek, dek);
    const wrapped = {
      ciphertext: packSealed(sealedDek),
      purpose: 'master' as const,
      keyVersion: 1,
    };

    const manager = new KeyManager();
    expect(manager.hasUnlockedDek).toBe(false);

    // unlockWith zeroizes the KEK it receives -- pass a copy.
    await manager.unlockWith(sealingKek.slice(), wrapped);
    expect(manager.hasUnlockedDek).toBe(true);

    const plaintext = new TextEncoder().encode(
      'email@example.com:a-test-password',
    );
    const encrypted = await manager.encryptItem(plaintext);
    const decrypted = await manager.decryptItem(encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe(
      'email@example.com:a-test-password',
    );

    manager.lock();
    expect(manager.hasUnlockedDek).toBe(false);
    await expect(manager.encryptItem(plaintext)).rejects.toThrow();
  });

  /**
   * Verifies the authentication property of AES-256-GCM (section 5):
   * the tag is not a decorative checksum, it's what makes a tampered
   * ciphertext physically unrecoverable, not merely "suspicious". We
   * corrupt the last byte of the packed buffer (packSealed puts the
   * tag at the end of the ciphertext, which in turn goes after the
   * nonce -- see aes-gcm.ts) and require WebCrypto to reject it, not
   * return garbage or an empty string.
   */
  it('rejects decryption and throws if the ciphertext is tampered with (auth tag validation)', async () => {
    const sealingKek = crypto.getRandomValues(new Uint8Array(32));
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const sealedDek = await aesGcmSeal(sealingKek, dek);
    const wrapped = {
      ciphertext: packSealed(sealedDek),
      purpose: 'master' as const,
      keyVersion: 1,
    };

    const manager = new KeyManager();
    await manager.unlockWith(sealingKek.slice(), wrapped);

    const plaintext = new TextEncoder().encode('critical-test-secret');
    const encrypted = await manager.encryptItem(plaintext);

    // ATTACK: corrupt a single bit of the ciphertext/tag (the end of the buffer).
    const corrupted = new Uint8Array(encrypted);
    corrupted[corrupted.length - 1] ^= 1;

    // AES-GCM's physics must reject the operation instantly.
    // No returning garbage or empty strings. We require a hard rejection.
    await expect(manager.decryptItem(corrupted)).rejects.toThrow();
  });
});
