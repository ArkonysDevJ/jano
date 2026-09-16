import type { Pool } from 'pg';
import type { VaultKeyPurpose, VaultKeyRecord } from '../entities.js';
import type { VaultKeysRepository } from '../repositories.js';

interface VaultKeyRow {
  readonly id: string;
  readonly user_id: string;
  readonly purpose: VaultKeyPurpose;
  readonly wrapped_dek: Buffer;
  readonly key_version: number;
  readonly updated_at: Date;
}

function toRecord(row: VaultKeyRow): VaultKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    wrappedDek: row.wrapped_dek,
    keyVersion: row.key_version,
    updatedAt: row.updated_at,
  };
}

/** Postgres implementation over docs/schema.sql's `vault_keys` table -- see PgPoolManager. */
export class PostgresVaultKeysRepository implements VaultKeysRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(
    userId: string,
    purpose: VaultKeyPurpose,
    wrappedDek: Uint8Array,
    keyVersion: number,
  ): Promise<VaultKeyRecord> {
    // The UNIQUE (user_id, purpose) constraint (schema.sql) is exactly
    // the ON CONFLICT target -- one active wrapping per user/purpose,
    // same "upsert" semantics InMemoryVaultKeysRepository already has.
    const { rows } = await this.pool.query<VaultKeyRow>(
      `INSERT INTO vault_keys (user_id, purpose, wrapped_dek, key_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, purpose)
       DO UPDATE SET wrapped_dek = EXCLUDED.wrapped_dek, key_version = EXCLUDED.key_version, updated_at = now()
       RETURNING *`,
      [userId, purpose, Buffer.from(wrappedDek), keyVersion],
    );
    return toRecord(rows[0]);
  }

  async getByUserAndPurpose(
    userId: string,
    purpose: VaultKeyPurpose,
  ): Promise<VaultKeyRecord | null> {
    const { rows } = await this.pool.query<VaultKeyRow>(
      'SELECT * FROM vault_keys WHERE user_id = $1 AND purpose = $2',
      [userId, purpose],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<VaultKeyRecord[]> {
    const { rows } = await this.pool.query<VaultKeyRow>('SELECT * FROM vault_keys WHERE user_id = $1', [
      userId,
    ]);
    return rows.map(toRecord);
  }
}
