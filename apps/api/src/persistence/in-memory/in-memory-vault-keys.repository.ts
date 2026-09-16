import { randomUUID } from 'node:crypto';
import type { VaultKeyPurpose, VaultKeyRecord } from '../entities.js';
import type { VaultKeysRepository } from '../repositories.js';

/** In-memory implementation -- see the scope note in in-memory-users.repository.ts. */
export class InMemoryVaultKeysRepository implements VaultKeysRepository {
  private readonly byUserAndPurpose = new Map<string, VaultKeyRecord>();

  private key(userId: string, purpose: VaultKeyPurpose): string {
    return `${userId}:${purpose}`;
  }

  async upsert(
    userId: string,
    purpose: VaultKeyPurpose,
    wrappedDek: Uint8Array,
    keyVersion: number,
  ): Promise<VaultKeyRecord> {
    const key = this.key(userId, purpose);
    const existing = this.byUserAndPurpose.get(key);
    const record: VaultKeyRecord = {
      id: existing?.id ?? randomUUID(),
      userId,
      purpose,
      wrappedDek,
      keyVersion,
      updatedAt: new Date(),
    };
    this.byUserAndPurpose.set(key, record);
    return record;
  }

  async getByUserAndPurpose(
    userId: string,
    purpose: VaultKeyPurpose,
  ): Promise<VaultKeyRecord | null> {
    return this.byUserAndPurpose.get(this.key(userId, purpose)) ?? null;
  }

  async listByUser(userId: string): Promise<VaultKeyRecord[]> {
    return [...this.byUserAndPurpose.values()].filter((record) => record.userId === userId);
  }
}
