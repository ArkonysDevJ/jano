/**
 * Real-worker integration test -- `@vitest/web-worker` (vitest.config.ts)
 * patches the global `Worker` so this spins up the ACTUAL
 * engine.worker.ts, not a mock of the message protocol. Covers the
 * full path Fase 1's unlock screen and single-credential reveal view
 * need: create a vault, encrypt/decrypt a real item against the
 * resident DEK, lock, and confirm the DEK is really gone afterwards.
 */
import { describe, expect, it } from 'vitest';
import { EngineClient } from '../engine-client';

describe('EngineClient <-> engine.worker (real worker, real crypto)', () => {
  it('creates a vault, round-trips an item through the resident DEK, then locks', async () => {
    const client = new EngineClient();
    try {
      const vault = await client.createNewVault('correct horse battery staple');
      expect(vault.wrappedMasterDek.purpose).toBe('master');
      expect(vault.wrappedMasterDek.keyVersion).toBe(1);
      expect(vault.wrappedRecoveryDek.purpose).toBe('recovery');
      expect(vault.localSalt).toBeInstanceOf(Uint8Array);
      expect(vault.recoveryKitSecret).toBeInstanceOf(Uint8Array);

      const plaintext = new TextEncoder().encode('a real vault item, not a mock');
      const ciphertext = await client.encryptItem(plaintext);
      expect(ciphertext).not.toEqual(plaintext);

      const decrypted = await client.decryptItem(ciphertext);
      expect(decrypted).toEqual(plaintext);

      await client.lock();
      // Locked -- the resident KeyManager has no DEK anymore, so this
      // must reject rather than silently return old/garbage data.
      await expect(client.encryptItem(plaintext)).rejects.toThrow(/locked/i);
    } finally {
      client.terminate();
    }
  });

  it('unlocks an existing vault with the same master password that created it', async () => {
    const creator = new EngineClient();
    let wrapped;
    let localSalt;
    try {
      const vault = await creator.createNewVault('another real password, not reused elsewhere');
      wrapped = vault.wrappedMasterDek;
      localSalt = vault.localSalt;
    } finally {
      creator.terminate();
    }

    const client = new EngineClient();
    try {
      await client.unlockWithPassword('another real password, not reused elsewhere', localSalt, wrapped);
      const plaintext = new TextEncoder().encode('proof this is the same DEK');
      const ciphertext = await client.encryptItem(plaintext);
      const decrypted = await client.decryptItem(ciphertext);
      expect(decrypted).toEqual(plaintext);
    } finally {
      client.terminate();
    }
  });

  it('rejects unlockWithPassword with the wrong master password', async () => {
    const creator = new EngineClient();
    let wrapped;
    let localSalt;
    try {
      const vault = await creator.createNewVault('the real password');
      wrapped = vault.wrappedMasterDek;
      localSalt = vault.localSalt;
    } finally {
      creator.terminate();
    }

    const client = new EngineClient();
    try {
      await expect(client.unlockWithPassword('a wrong password', localSalt, wrapped)).rejects.toThrow();
    } finally {
      client.terminate();
    }
  });
});
