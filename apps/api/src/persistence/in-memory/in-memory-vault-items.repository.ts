import { randomUUID } from 'node:crypto';
import type { VaultItemRecord } from '../entities.js';
import type { VaultItemsRepository } from '../repositories.js';

/** In-memory implementation -- see the scope note in in-memory-users.repository.ts. */
export class InMemoryVaultItemsRepository implements VaultItemsRepository {
  private readonly byId = new Map<string, VaultItemRecord>();

  async create(userId: string, ciphertext: Uint8Array, dekVersion: number): Promise<VaultItemRecord> {
    const record: VaultItemRecord = {
      id: randomUUID(),
      userId,
      ciphertext,
      dekVersion,
      itemVersion: 1,
      updatedAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async listByUser(userId: string): Promise<VaultItemRecord[]> {
    return [...this.byId.values()].filter((record) => record.userId === userId);
  }

  async getById(id: string, userId: string): Promise<VaultItemRecord | null> {
    const record = this.byId.get(id);
    return record && record.userId === userId ? record : null;
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<Pick<VaultItemRecord, 'ciphertext' | 'dekVersion' | 'itemVersion' | 'conflictOf'>>,
  ): Promise<VaultItemRecord> {
    const record = this.byId.get(id);
    if (!record || record.userId !== userId) {
      throw new Error(`Item ${id} does not exist for this user.`);
    }
    const updated: VaultItemRecord = { ...record, ...patch, updatedAt: new Date() };
    this.byId.set(id, updated);
    return updated;
  }

  async createFork(
    userId: string,
    ciphertext: Uint8Array,
    dekVersion: number,
    conflictOf: string,
  ): Promise<VaultItemRecord> {
    const record: VaultItemRecord = {
      id: randomUUID(),
      userId,
      ciphertext,
      dekVersion,
      itemVersion: 1,
      conflictOf,
      updatedAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }
}
