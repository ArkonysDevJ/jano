import type { Pool } from 'pg';
import type { SyncEventRecord } from '../entities.js';
import type { SyncEventsRepository } from '../repositories.js';

interface SyncEventRow {
  readonly id: string;
  readonly user_id: string;
  readonly device_id: string;
  readonly master_key_version: number;
  readonly updated_at_server: Date;
}

function toRecord(row: SyncEventRow): SyncEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    masterKeyVersion: row.master_key_version,
    updatedAtServer: row.updated_at_server,
  };
}

/** Postgres implementation over docs/schema.sql's `sync_events` table -- see PgPoolManager. */
export class PostgresSyncEventsRepository implements SyncEventsRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, deviceId: string, masterKeyVersion: number): Promise<SyncEventRecord> {
    const { rows } = await this.pool.query<SyncEventRow>(
      'INSERT INTO sync_events (user_id, device_id, master_key_version) VALUES ($1, $2, $3) RETURNING *',
      [userId, deviceId, masterKeyVersion],
    );
    return toRecord(rows[0]);
  }
}
