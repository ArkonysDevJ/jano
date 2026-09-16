import type { Pool } from 'pg';
import type { VaultItemRecord } from '../entities.js';
import type { VaultItemsRepository } from '../repositories.js';

interface VaultItemRow {
  readonly id: string;
  readonly user_id: string;
  readonly ciphertext: Buffer;
  readonly dek_version: number;
  // `item_version` is `bigint` in schema.sql -- node-postgres returns
  // bigint columns as STRINGS by default (to avoid silent precision
  // loss above Number.MAX_SAFE_INTEGER), never as `number`. Converting
  // with Number() here is a deliberate, pragmatic choice: this counter
  // realistically never approaches 2^53, and entities.ts's
  // VaultItemRecord.itemVersion is typed as `number` throughout the
  // codebase (WatermelonDB's own `_version` is a JS number too) -- but
  // it IS a real gap if this repository is ever pointed at a dataset
  // with astronomical version counts. Flagged here, not silently cast.
  readonly item_version: string;
  readonly conflict_of: string | null;
  readonly updated_at: Date;
}

function toRecord(row: VaultItemRow): VaultItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    ciphertext: row.ciphertext,
    dekVersion: row.dek_version,
    itemVersion: Number(row.item_version),
    conflictOf: row.conflict_of ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** Postgres implementation over docs/schema.sql's `vault_items` table -- see PgPoolManager. */
export class PostgresVaultItemsRepository implements VaultItemsRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, ciphertext: Uint8Array, dekVersion: number): Promise<VaultItemRecord> {
    const { rows } = await this.pool.query<VaultItemRow>(
      'INSERT INTO vault_items (user_id, ciphertext, dek_version) VALUES ($1, $2, $3) RETURNING *',
      [userId, Buffer.from(ciphertext), dekVersion],
    );
    return toRecord(rows[0]);
  }

  async listByUser(userId: string): Promise<VaultItemRecord[]> {
    const { rows } = await this.pool.query<VaultItemRow>('SELECT * FROM vault_items WHERE user_id = $1', [
      userId,
    ]);
    return rows.map(toRecord);
  }

  async getById(id: string, userId: string): Promise<VaultItemRecord | null> {
    const { rows } = await this.pool.query<VaultItemRow>(
      'SELECT * FROM vault_items WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<Pick<VaultItemRecord, 'ciphertext' | 'dekVersion' | 'itemVersion' | 'conflictOf'>>,
  ): Promise<VaultItemRecord> {
    // Dynamic SET list -- only the fields actually present in `patch`
    // are updated, mirroring InMemoryVaultItemsRepository's shallow
    // `{ ...record, ...patch }` merge semantics (a field the caller
    // omits is left untouched, not reset to NULL/0).
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (patch.ciphertext !== undefined) {
      sets.push(`ciphertext = $${paramIndex++}`);
      values.push(Buffer.from(patch.ciphertext));
    }
    if (patch.dekVersion !== undefined) {
      sets.push(`dek_version = $${paramIndex++}`);
      values.push(patch.dekVersion);
    }
    if (patch.itemVersion !== undefined) {
      sets.push(`item_version = $${paramIndex++}`);
      values.push(patch.itemVersion);
    }
    if (patch.conflictOf !== undefined) {
      sets.push(`conflict_of = $${paramIndex++}`);
      values.push(patch.conflictOf);
    }
    sets.push('updated_at = now()');

    const idParam = paramIndex++;
    const userIdParam = paramIndex++;
    values.push(id, userId);

    const { rows } = await this.pool.query<VaultItemRow>(
      `UPDATE vault_items SET ${sets.join(', ')} WHERE id = $${idParam} AND user_id = $${userIdParam} RETURNING *`,
      values,
    );
    if (!rows[0]) {
      throw new Error(`Item ${id} does not exist for this user.`);
    }
    return toRecord(rows[0]);
  }

  async createFork(
    userId: string,
    ciphertext: Uint8Array,
    dekVersion: number,
    conflictOf: string,
  ): Promise<VaultItemRecord> {
    const { rows } = await this.pool.query<VaultItemRow>(
      'INSERT INTO vault_items (user_id, ciphertext, dek_version, conflict_of) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, Buffer.from(ciphertext), dekVersion, conflictOf],
    );
    return toRecord(rows[0]);
  }
}
