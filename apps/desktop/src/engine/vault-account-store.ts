/**
 * Local unlock record for an EXISTING vault -- what the UnlockScreen
 * needs on every app restart to know "there's already a vault here,
 * ask for the master password" instead of "no vault yet, run the
 * creation ceremony" (registration.ts's `createNewVault`).
 * Reference: docs/ARCHITECTURE-01.md, section 3.
 *
 * Deliberately narrow, matching this codebase's other storage
 * interfaces (see rotation-state-machine.ts's `PendingRotationStore`):
 * a caller-supplied implementation, not a hardcoded technology, so
 * Fase 1's IndexedDB choice (indexeddb-vault-account-store.ts) can be
 * swapped later without touching the UI layer that calls this
 * interface.
 *
 * Deliberately NOT included here (out of scope for this record):
 * `recoverySalt` / `wrappedRecoveryDek` -- registration.ts's own
 * comments say those are meant for the server (`POST /vault-keys`),
 * and `recoveryKitSecret` -- shown to the user ONCE and never
 * persisted anywhere, by design (section 3).
 */

import type { Bytes, WrappedDek } from './types';

export interface VaultAccountRecord {
  readonly localSalt: Bytes;
  readonly wrappedMasterDek: WrappedDek;
}

export interface VaultAccountStore {
  save(record: VaultAccountRecord): Promise<void>;
  load(): Promise<VaultAccountRecord | null>;
  clear(): Promise<void>;
}
