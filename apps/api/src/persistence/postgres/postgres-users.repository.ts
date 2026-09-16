import type { Pool } from 'pg';
import type { UserRecord } from '../entities.js';
import type { UsersRepository } from '../repositories.js';

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly client_public_key: Buffer | null;
  readonly registration_record: Buffer | null;
  readonly created_at: Date;
  readonly hardened_mode_enabled: boolean;
  readonly continuity_secret: Buffer | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    clientPublicKey: row.client_public_key ?? undefined,
    registrationRecord: row.registration_record ?? undefined,
    createdAt: row.created_at,
    hardenedModeEnabled: row.hardened_mode_enabled,
    continuitySecret: row.continuity_secret ?? undefined,
  };
}

/** Postgres implementation over docs/schema.sql's `users` table -- see PgPoolManager. */
export class PostgresUsersRepository implements UsersRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [
      email,
    ]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: Omit<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (email, client_public_key, registration_record, hardened_mode_enabled, continuity_secret)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.email,
          input.clientPublicKey ? Buffer.from(input.clientPublicKey) : null,
          input.registrationRecord ? Buffer.from(input.registrationRecord) : null,
          input.hardenedModeEnabled ?? false,
          input.continuitySecret ? Buffer.from(input.continuitySecret) : null,
        ],
      );
      return toRecord(rows[0]);
    } catch (error) {
      // 23505 = unique_violation -- the `users.email` UNIQUE constraint.
      // Re-thrown with the same message InMemoryUsersRepository already
      // uses, so callers (AuthService) don't need to know which
      // repository is behind the interface.
      if ((error as { code?: string }).code === '23505') {
        throw new Error(`A user with email ${input.email} already exists`);
      }
      throw error;
    }
  }

  async replaceRegistrationRecord(userId: string, registrationRecord: Uint8Array): Promise<void> {
    const { rowCount } = await this.pool.query('UPDATE users SET registration_record = $1 WHERE id = $2', [
      Buffer.from(registrationRecord),
      userId,
    ]);
    if (!rowCount) {
      throw new Error(`No user with id ${userId}`);
    }
  }
}
