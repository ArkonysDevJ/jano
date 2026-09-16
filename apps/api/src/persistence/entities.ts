/**
 * In-memory entities of the persistence domain -- mirror the tables in
 * docs/schema.sql (section 12), but as TypeScript types, not raw SQL
 * rows. The repositories (repositories.ts) work with these types; the
 * concrete implementations (in-memory/ for now, Postgres in a later
 * handoff) are the ones translating to/from real storage.
 */

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly clientPublicKey?: Uint8Array;
  /**
   * OPAQUE record the client issues when finishing registration
   * (section 4). This is what the server uses on every login to
   * validate the handshake; it never allows reconstructing the
   * password or any vault key.
   *
   * There is NO per-user `oprfSeed` field here -- real correction
   * (2026-09-11) after reading @cloudflare/opaque-ts@0.7.5's .d.ts
   * files: `oprf_seed` is a secret UNIQUE to the whole server
   * deployment, not per user. It lives in environment variables
   * (OPAQUE_OPRF_SEED_B64, see cloudflare-opaque-server-provider.ts),
   * never in this table. See docs/schema.sql.
   */
  registrationRecord?: Uint8Array;
  readonly createdAt: Date;
  /**
   * Section 13, Factor 2 ("hardened mode"), opt-in at registration.
   * When set, `pending_opaque_rotation` re-registration additionally
   * requires a continuity signature proving possession of
   * `continuitySecret` over a server-issued nonce -- see
   * rotation/rotation.service.ts for the full authorization policy and
   * an explicit note on why this stores a shared secret rather than a
   * pure asymmetric verifier.
   */
  hardenedModeEnabled?: boolean;
  continuitySecret?: Uint8Array;
}

export interface DeviceRecord {
  readonly id: string;
  readonly userId: string;
  readonly label?: string;
  lastSeenAt?: Date;
  readonly createdAt: Date;
}

export type VaultKeyPurpose = 'master' | 'recovery';

/** Persisted wrapping of the vault's SINGLE DEK (sections 3, 7, 12). */
export interface VaultKeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly purpose: VaultKeyPurpose;
  readonly wrappedDek: Uint8Array;
  readonly keyVersion: number;
  readonly updatedAt: Date;
}

/** Individual credential record (sections 7, 12) -- never contains a key wrapping. */
export interface VaultItemRecord {
  readonly id: string;
  readonly userId: string;
  readonly ciphertext: Uint8Array;
  readonly dekVersion: number;
  /** Native to WatermelonDB on the client (`_version`), used by conflict-fork (section 14). */
  readonly itemVersion: number;
  readonly conflictOf?: string;
  readonly updatedAt: Date;
}

/**
 * Per-operation sync metadata (sections 7, 12). The key-reconciliation
 * gate compares against this to decide whether a device may push or
 * pull -- blind metadata (a version number), never vault content, so
 * logging it doesn't touch zero-knowledge.
 */
export interface SyncEventRecord {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly masterKeyVersion: number;
  readonly updatedAtServer: Date;
}
