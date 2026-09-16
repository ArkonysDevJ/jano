import type { Pool } from 'pg';
import type { DeviceRecord } from '../entities.js';
import type { DevicesRepository } from '../repositories.js';

interface DeviceRow {
  readonly id: string;
  readonly user_id: string;
  readonly label: string | null;
  readonly last_seen_at: Date | null;
  readonly created_at: Date;
}

function toRecord(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** Postgres implementation over docs/schema.sql's `devices` table -- see PgPoolManager. */
export class PostgresDevicesRepository implements DevicesRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: Omit<DeviceRecord, 'id' | 'createdAt' | 'lastSeenAt'>,
  ): Promise<DeviceRecord> {
    const { rows } = await this.pool.query<DeviceRow>(
      'INSERT INTO devices (user_id, label) VALUES ($1, $2) RETURNING *',
      [input.userId, input.label ?? null],
    );
    return toRecord(rows[0]);
  }

  async findById(id: string): Promise<DeviceRecord | null> {
    const { rows } = await this.pool.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [id]);
  }

  async setPendingRotationChallenge(deviceId: string, challenge: Uint8Array): Promise<void> {
    await this.pool.query(
      'UPDATE devices SET pending_rotation_challenge = $1, pending_rotation_challenge_at = now() WHERE id = $2',
      [Buffer.from(challenge), deviceId],
    );
  }

  async getPendingRotationChallenge(deviceId: string): Promise<Uint8Array | null> {
    const { rows } = await this.pool.query<{ pending_rotation_challenge: Buffer | null }>(
      'SELECT pending_rotation_challenge FROM devices WHERE id = $1',
      [deviceId],
    );
    return rows[0]?.pending_rotation_challenge ?? null;
  }

  async clearPendingRotationChallenge(deviceId: string): Promise<void> {
    await this.pool.query(
      'UPDATE devices SET pending_rotation_challenge = NULL, pending_rotation_challenge_at = NULL WHERE id = $1',
      [deviceId],
    );
  }
}
