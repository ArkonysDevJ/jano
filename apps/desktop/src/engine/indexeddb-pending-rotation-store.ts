/**
 * Concrete `PendingRotationStore` (see rotation-state-machine.ts) backed
 * by IndexedDB. Resolves the "WHERE this gets persisted locally...
 * open, unresolved condition per section 9" that file's header comment
 * flagged -- deliberately conservatively, for this phase.
 *
 * Why IndexedDB, not the OS keychain (section 9's stated "only
 * acceptable surface" for a PERSISTENT unlocked session) -- that's a
 * DIFFERENT problem. The record this store holds is already encrypted
 * under the new KEK before it ever reaches here (see
 * rotation-state-machine.ts's `beginOfflineRotation`): "protected by
 * the same trust boundary that already protects the rest of the vault,
 * not a new surface" (section 13's own words). There is no plaintext
 * secret exposure here to justify OS-keychain complexity for what's
 * meant to be a short-lived, single-slot, auto-clearing ciphertext blob.
 *
 * Why IndexedDB, not a native SQLite plugin -- IndexedDB is available,
 * with zero native dependencies, in BOTH targets this codebase needs
 * right now: a pure Web build (the Vercel demo) and Tauri's webview
 * (Tauri's webview is a real browser context -- same reasoning
 * rotation-http-client.ts already used for plain `fetch` over a Tauri
 * command). A native SQLite plugin would only earn its cost for
 * capabilities IndexedDB doesn't have; this store's actual need (one
 * small blob, one key, three operations) isn't one of them. Revisit
 * only if/when apps/desktop needs real relational storage for
 * something else entirely (WatermelonDB's own persistence adapter --
 * not this).
 */

import type { PendingRotationStore } from './rotation-state-machine';
import type { Bytes } from './types';

const DEFAULT_DB_NAME = 'jano-engine';
const DB_VERSION = 1;
const STORE_NAME = 'pendingRotation';

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export class IndexedDbPendingRotationStore implements PendingRotationStore {
  /**
   * `key` and `dbName` default to a single shared slot -- section 13's
   * state machine only ever tracks ONE outstanding rotation per device
   * at a time, matching this store's single-slot design. Both are
   * still constructor parameters, not hardcoded, so a future need (e.g.
   * multiple local accounts sharing one browser profile) doesn't
   * require touching this class or the `PendingRotationStore`
   * interface -- only how the caller instantiates it.
   */
  constructor(
    private readonly key: string = 'default',
    private readonly dbName: string = DEFAULT_DB_NAME,
  ) {}

  async save(packed: Bytes): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(packed, this.key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save pending rotation record.'));
      });
    } finally {
      db.close();
    }
  }

  async load(): Promise<Bytes | null> {
    const db = await openDatabase(this.dbName);
    try {
      return await new Promise<Bytes | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(this.key);
        request.onsuccess = () => resolve((request.result as Bytes | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to load pending rotation record.'));
      });
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(this.key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to clear pending rotation record.'));
      });
    } finally {
      db.close();
    }
  }
}
