import { describe, expect, it } from 'vitest';
import { installFakeIndexedDB } from './support/fake-indexeddb';
import { IndexedDbVaultAccountStore } from '../indexeddb-vault-account-store';
import type { VaultAccountRecord } from '../vault-account-store';

function sampleRecord(): VaultAccountRecord {
  return {
    localSalt: new Uint8Array([1, 2, 3, 4]),
    wrappedMasterDek: {
      ciphertext: new Uint8Array([5, 6, 7, 8, 9]),
      purpose: 'master',
      keyVersion: 1,
    },
  };
}

describe('IndexedDbVaultAccountStore', () => {
  it('returns null when no vault has been created yet', async () => {
    installFakeIndexedDB();
    const store = new IndexedDbVaultAccountStore();
    expect(await store.load()).toBeNull();
  });

  it('round-trips a record through save/load', async () => {
    installFakeIndexedDB();
    const store = new IndexedDbVaultAccountStore();
    const record = sampleRecord();

    await store.save(record);
    const loaded = await store.load();

    expect(loaded).toEqual(record);
  });

  it('clear() removes the record -- load() goes back to null', async () => {
    installFakeIndexedDB();
    const store = new IndexedDbVaultAccountStore();
    await store.save(sampleRecord());

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('a fresh instance against the SAME db/key sees a record saved by a previous instance', async () => {
    installFakeIndexedDB();
    // Exercises that this class opens/closes a connection per call --
    // a real app reopens this store across app restarts, not within
    // one in-memory object's lifetime.
    const record = sampleRecord();
    const first = new IndexedDbVaultAccountStore('device-a');
    await first.save(record);

    const second = new IndexedDbVaultAccountStore('device-a');
    expect(await second.load()).toEqual(record);
  });

  it('different keys do not collide', async () => {
    installFakeIndexedDB();
    const storeA = new IndexedDbVaultAccountStore('device-a');
    const storeB = new IndexedDbVaultAccountStore('device-b');
    const recordA = sampleRecord();
    const recordB = { ...sampleRecord(), localSalt: new Uint8Array([9, 9]) };

    await storeA.save(recordA);
    await storeB.save(recordB);

    expect(await storeA.load()).toEqual(recordA);
    expect(await storeB.load()).toEqual(recordB);
  });
});
