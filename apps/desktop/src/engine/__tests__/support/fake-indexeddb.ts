/**
 * Minimal fake of the browser's IndexedDB API -- ONLY the surface
 * indexeddb-pending-rotation-store.ts actually uses (a single object
 * store keyed by a string, put/get/delete, one database version, no
 * indexes, no cursors, no multi-store transactions). NOT a general
 * IndexedDB polyfill -- narrow by design, same philosophy as this
 * codebase's other test doubles (FakeOpaqueServerProvider,
 * InMemory*Repository): exactly enough surface to exercise the real
 * adapter's logic against, nothing that invites depending on
 * unverified browser behavior. Real IndexedDB behavior (in an actual
 * browser or Tauri webview) is what ultimately matters -- this fake
 * only proves indexeddb-pending-rotation-store.ts's OWN logic (request
 * wiring, key handling, close-on-every-call) is correct against the
 * shape of that API.
 */

type RawStore = Map<string, unknown>;

class FakeIDBRequest<T = unknown> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private readonly data: RawStore) {}

  put(value: unknown, key: string): FakeIDBRequest<string> {
    const request = new FakeIDBRequest<string>();
    this.data.set(key, value);
    queueMicrotask(() => {
      request.result = key;
      request.onsuccess?.();
    });
    return request;
  }

  get(key: string): FakeIDBRequest<unknown> {
    const request = new FakeIDBRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.data.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  delete(key: string): FakeIDBRequest<undefined> {
    const request = new FakeIDBRequest<undefined>();
    this.data.delete(key);
    queueMicrotask(() => {
      request.onsuccess?.();
    });
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;

  constructor(private readonly stores: Map<string, RawStore>) {
    // Real IDB transactions auto-commit once the call stack that issued
    // their requests returns to the event loop. Two chained
    // queueMicrotask calls -- one lets this transaction's own
    // put/get/delete request callbacks fire first, the second commits
    // -- approximates that ordering closely enough for this store's
    // single-request transactions.
    queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
  }

  objectStore(name: string): FakeObjectStore {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return new FakeObjectStore(store);
  }
}

class FakeDatabase {
  constructor(private readonly stores: Map<string, RawStore>) {}

  get objectStoreNames() {
    const stores = this.stores;
    return { contains: (name: string) => stores.has(name) };
  }

  createObjectStore(name: string): FakeObjectStore {
    const store = new Map<string, unknown>();
    this.stores.set(name, store);
    return new FakeObjectStore(store);
  }

  transaction(_name: string, _mode: 'readonly' | 'readwrite'): FakeTransaction {
    return new FakeTransaction(this.stores);
  }

  close(): void {
    // Nothing to release in the fake -- real connections are finite
    // resources, this map-backed one isn't.
  }
}

/**
 * Installs a fake `indexedDB` global backed by an in-memory registry of
 * named databases -- data persists across separate `indexedDB.open()`
 * calls within the same test (as real IndexedDB does across
 * open/close), but never across separate `installFakeIndexedDB()`
 * calls, so each test that calls this starts from a clean slate.
 */
export function installFakeIndexedDB(): void {
  const databases = new Map<string, Map<string, RawStore>>();

  const fakeIndexedDB = {
    open(name: string, _version: number) {
      const request = new FakeIDBRequest<FakeDatabase>() as FakeIDBRequest<FakeDatabase> & {
        onupgradeneeded: (() => void) | null;
      };
      request.onupgradeneeded = null;

      let stores = databases.get(name);
      const isNewDatabase = !stores;
      if (!stores) {
        stores = new Map();
        databases.set(name, stores);
      }
      const db = new FakeDatabase(stores);
      request.result = db;

      queueMicrotask(() => {
        if (isNewDatabase) request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    },
  };

  (globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB;
}
