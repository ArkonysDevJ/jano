import type {
  DeviceRecord,
  SyncEventRecord,
  UserRecord,
  VaultItemRecord,
  VaultKeyPurpose,
  VaultKeyRecord,
} from './entities.js';

/**
 * Repository interfaces -- Auth and Vault depend ONLY on these
 * interfaces (injected by token, see tokens.ts), never on a concrete
 * class. That's what lets today's in-memory implementations be
 * replaced by real repositories over PostgreSQL (section 12) in a
 * later handoff without touching AuthService or VaultService.
 */

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: Omit<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord>;
  /**
   * Section 13: replaces the OPAQUE `registration_record` after a
   * successful `pending_opaque_rotation` re-registration. Nothing else
   * about the user changes -- this is deliberately narrow, not a
   * general-purpose update method.
   */
  replaceRegistrationRecord(userId: string, registrationRecord: Uint8Array): Promise<void>;
}

export interface DevicesRepository {
  create(input: Omit<DeviceRecord, 'id' | 'createdAt' | 'lastSeenAt'>): Promise<DeviceRecord>;
  findById(id: string): Promise<DeviceRecord | null>;
  touchLastSeen(id: string): Promise<void>;
  /**
   * Section 13, Factor 2 ("hardened mode"): persists this device's
   * single outstanding re-registration challenge server-side, so it
   * survives a process restart between rotate/start and rotate/finish
   * (see rotation.service.ts, and docs/schema.sql's
   * pending_rotation_challenge columns). Calling this again before
   * finish SUPERSEDES the previous challenge -- it never accumulates.
   */
  setPendingRotationChallenge(deviceId: string, challenge: Uint8Array): Promise<void>;
  /** Null when no rotation is currently pending for this device. */
  getPendingRotationChallenge(deviceId: string): Promise<Uint8Array | null>;
  /** Single-use: callers clear this only after a genuine (non-idempotent) success. */
  clearPendingRotationChallenge(deviceId: string): Promise<void>;
}

export interface VaultKeysRepository {
  upsert(
    userId: string,
    purpose: VaultKeyPurpose,
    wrappedDek: Uint8Array,
    keyVersion: number,
  ): Promise<VaultKeyRecord>;
  getByUserAndPurpose(userId: string, purpose: VaultKeyPurpose): Promise<VaultKeyRecord | null>;
  listByUser(userId: string): Promise<VaultKeyRecord[]>;
}

export interface VaultItemsRepository {
  create(userId: string, ciphertext: Uint8Array, dekVersion: number): Promise<VaultItemRecord>;
  listByUser(userId: string): Promise<VaultItemRecord[]>;
  getById(id: string, userId: string): Promise<VaultItemRecord | null>;
  update(
    id: string,
    userId: string,
    patch: Partial<Pick<VaultItemRecord, 'ciphertext' | 'dekVersion' | 'itemVersion' | 'conflictOf'>>,
  ): Promise<VaultItemRecord>;
  /**
   * Creates a conflict-fork record (section 14): a brand-new item with
   * `conflictOf` pointing at the original, at itemVersion 1. Never
   * overwrites the original -- that's precisely the point of forking
   * instead of merging.
   */
  createFork(
    userId: string,
    ciphertext: Uint8Array,
    dekVersion: number,
    conflictOf: string,
  ): Promise<VaultItemRecord>;
}

export interface SyncEventsRepository {
  record(userId: string, deviceId: string, masterKeyVersion: number): Promise<SyncEventRecord>;
}
