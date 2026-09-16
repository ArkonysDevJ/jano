import { describe, expect, it } from 'vitest';
import { beginOfflineRotation, completeOfflineRotation } from '../rotation-state-machine';
import { createNewVault } from '../registration';
import { deriveMasterKek, DEFAULT_ARGON2ID_PARAMS } from '../kek';
import type { PendingRotationStore } from '../rotation-state-machine';
import type { Bytes } from '../types';

/**
 * NOT verified in the sandbox this was written in -- same Argon2id/
 * hash-wasm limitation as registration.test.ts. Must be confirmed with
 * `npm run test --workspace=apps/desktop` on a real machine.
 */
class InMemoryPendingRotationStore implements PendingRotationStore {
  private packed: Bytes | null = null;

  async save(packed: Bytes): Promise<void> {
    this.packed = packed;
  }
  async load(): Promise<Bytes | null> {
    return this.packed;
  }
  async clear(): Promise<void> {
    this.packed = null;
  }
}

describe('offline master-key rotation (section 13)', () => {
  it('re-wraps the DEK under the new KEK and persists a decryptable pending-rotation record', async () => {
    const oldPassword = 'old-master-password';
    const material = await createNewVault(oldPassword, DEFAULT_ARGON2ID_PARAMS);

    const newPassword = 'new-master-password-after-offline-rotation';
    const newLocalSalt = crypto.getRandomValues(new Uint8Array(16));
    const store = new InMemoryPendingRotationStore();

    const result = await beginOfflineRotation({
      manager: material.manager,
      newMasterPassword: newPassword,
      newLocalSalt,
      newKeyVersion: 2,
      localRotationEpoch: 1,
      store,
    });

    expect(result.wrappedMasterDek.purpose).toBe('master');
    expect(result.wrappedMasterDek.keyVersion).toBe(2);

    // The vault stays usable, still with the SAME DEK, immediately after
    // rotation -- only which KEK protects it changed (section 7).
    const encrypted = await material.manager.encryptItem(new TextEncoder().encode('still-works'));
    const decrypted = await material.manager.decryptItem(encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe('still-works');

    // A store entry now exists, encrypted under the NEW KEK.
    const pending = await store.load();
    expect(pending).not.toBeNull();
  });

  it('completes a pending rotation by handing the recovered password to the injected client, then clears the record', async () => {
    const oldPassword = 'old-master-password';
    const material = await createNewVault(oldPassword, DEFAULT_ARGON2ID_PARAMS);

    const newPassword = 'new-master-password-after-offline-rotation';
    const newLocalSalt = crypto.getRandomValues(new Uint8Array(16));
    const store = new InMemoryPendingRotationStore();

    await beginOfflineRotation({
      manager: material.manager,
      newMasterPassword: newPassword,
      newLocalSalt,
      newKeyVersion: 2,
      localRotationEpoch: 1,
      store,
    });

    const newKek = await deriveMasterKek(newPassword, newLocalSalt, DEFAULT_ARGON2ID_PARAMS);

    let recoveredPassword: string | undefined;
    const fakeClient = {
      async reregister(password: string): Promise<void> {
        recoveredPassword = password;
      },
    };

    const result = await completeOfflineRotation({ kek: newKek, store, client: fakeClient });

    expect(result.completed).toBe(true);
    expect(recoveredPassword).toBe(newPassword);
    expect(await store.load()).toBeNull(); // single-use -- cleared only after the client confirms
  });

  it('does nothing (completed: false) when there is no pending rotation', async () => {
    const store = new InMemoryPendingRotationStore();
    const fakeClient = { reregister: async () => { throw new Error('should not be called'); } };

    const result = await completeOfflineRotation({
      kek: crypto.getRandomValues(new Uint8Array(32)),
      store,
      client: fakeClient,
    });

    expect(result.completed).toBe(false);
  });

  it('leaves the pending record in place if the client fails (retry-safe, never half-applied)', async () => {
    const oldPassword = 'old-master-password';
    const material = await createNewVault(oldPassword, DEFAULT_ARGON2ID_PARAMS);
    const newPassword = 'new-master-password';
    const newLocalSalt = crypto.getRandomValues(new Uint8Array(16));
    const store = new InMemoryPendingRotationStore();

    await beginOfflineRotation({
      manager: material.manager,
      newMasterPassword: newPassword,
      newLocalSalt,
      newKeyVersion: 2,
      localRotationEpoch: 1,
      store,
    });

    const newKek = await deriveMasterKek(newPassword, newLocalSalt, DEFAULT_ARGON2ID_PARAMS);
    const failingClient = {
      async reregister(): Promise<void> {
        throw new Error('network dropped mid-rotation');
      },
    };

    await expect(completeOfflineRotation({ kek: newKek, store, client: failingClient })).rejects.toThrow();
    expect(await store.load()).not.toBeNull(); // still there for the next reconnection attempt
  });
});
