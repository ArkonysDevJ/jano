import { describe, expect, it } from 'vitest';
import { installFakeIndexedDB } from './support/fake-indexeddb';
import { IndexedDbPendingRotationStore } from '../indexeddb-pending-rotation-store';

describe('IndexedDbPendingRotationStore', () => {
  it('returns null when nothing has been saved yet', async () => {
    installFakeIndexedDB(); // fresh in-memory registry per test
    const store = new IndexedDbPendingRotationStore();
    expect(await store.load()).toBeNull();
  });

  it('round-trips bytes through save/load', async () => {
    installFakeIndexedDB();
    const store = new IndexedDbPendingRotationStore();
    const packed = new Uint8Array([1, 2, 3, 4, 5]);

    await store.save(packed);
    const loaded = await store.load();

    expect(loaded).toEqual(packed);
  });

  it('clear() removes the record -- load() goes back to null', async () => {
    installFakeIndexedDB();
    const store = new IndexedDbPendingRotationStore();
    await store.save(new Uint8Array([9, 9, 9]));

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('a fresh instance against the SAME db/key sees data saved by a previous instance', async () => {
    installFakeIndexedDB();
    // Exercises that this class opens/closes a connection per call
    // rather than assuming one long-lived handle -- a real app
    // reopens across page loads / app restarts, not within one
    // in-memory object's lifetime.
    const first = new IndexedDbPendingRotationStore('device-a');
    await first.save(new Uint8Array([7, 7]));

    const second = new IndexedDbPendingRotationStore('device-a');
    expect(await second.load()).toEqual(new Uint8Array([7, 7]));
  });

  it('different keys in the same database do not collide', async () => {
    installFakeIndexedDB();
    const storeA = new IndexedDbPendingRotationStore('device-a');
    const storeB = new IndexedDbPendingRotationStore('device-b');

    await storeA.save(new Uint8Array([1]));
    await storeB.save(new Uint8Array([2]));

    expect(await storeA.load()).toEqual(new Uint8Array([1]));
    expect(await storeB.load()).toEqual(new Uint8Array([2]));

    await storeA.clear();
    expect(await storeA.load()).toBeNull();
    expect(await storeB.load()).toEqual(new Uint8Array([2])); // untouched
  });
});
