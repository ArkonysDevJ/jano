/**
 * Concrete `VaultAccountStore` backed by IndexedDB.
 * Reference: vault-account-store.ts for what this persists and why;
 * indexeddb-pending-rotation-store.ts for the IndexedDB-not-OS-keychain
 * rationale (that file's header comment) -- it applies here too, and
 * for the same reason: nothing this store holds is plaintext.
 * `wrappedMasterDek.ciphertext` is already AES-256-GCM output; it's
 * useless without the master password the user still has to type in
 * every time, which this store never sees.
 *
 * Deliberately its OWN database (`jano-vault-account`), separate from
 * `indexeddb-pending-rotation-store.ts`'s `jano-engine` -- these are
 * two independent classes with independent schemas, and sharing one
 * database name would mean coordinating a single `DB_VERSION` and
 * `onupgradeneeded` between files that otherwise have no reason to
 * know about each other.
 */

import type { VaultAccountRecord, VaultAccountStore } from './vault-account-store';

const DEFAULT_DB_NAME = 'jano-vault-account';
const DB_VERSION = 1;
const STORE_NAME = 'vaultAccount';

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

export class IndexedDbVaultAccountStore implements VaultAccountStore {
  /** Single-slot by default -- Fase 1 is one local account per device (see checklist). */
  constructor(
    private readonly key: string = 'default',
    private readonly dbName: string = DEFAULT_DB_NAME,
  ) {}

  async save(record: VaultAccountRecord): Promise<void> {
    const db = await openDatabase(this.dbName);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record, this.key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save vault account record.'));
      });
    } finally {
      db.close();
    }
  }

  async load(): Promise<VaultAccountRecord | null> {
    const db = await openDatabase(this.dbName);
    try {
      return await new Promise<VaultAccountRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(this.key);
        request.onsuccess = () => resolve((request.result as VaultAccountRecord | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to load vault account record.'));
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
        tx.onerror = () => reject(tx.error ?? new Error('Failed to clear vault account record.'));
      });
    } finally {
      db.close();
    }
  }
}
