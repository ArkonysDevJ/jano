import { randomUUID } from 'node:crypto';
import type { UserRecord } from '../entities.js';
import type { UsersRepository } from '../repositories.js';

/**
 * In-memory implementation -- ONLY for development and tests, until
 * the real repository over PostgreSQL exists (docs/schema.sql). Does
 * not persist across processes, is not safe for production, and
 * applies none of the RLS guarantees André's other projects require --
 * there is no real multi-tenancy here, it's just an in-memory Map.
 */
export class InMemoryUsersRepository implements UsersRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: Omit<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord> {
    if (this.byEmail.has(input.email)) {
      throw new Error(`A user with email ${input.email} already exists`);
    }
    const record: UserRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    this.byId.set(record.id, record);
    this.byEmail.set(record.email, record.id);
    return record;
  }

  async replaceRegistrationRecord(userId: string, registrationRecord: Uint8Array): Promise<void> {
    const record = this.byId.get(userId);
    if (!record) {
      throw new Error(`No user with id ${userId}`);
    }
    record.registrationRecord = registrationRecord;
  }
}
