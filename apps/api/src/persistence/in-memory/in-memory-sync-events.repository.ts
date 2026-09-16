import { randomUUID } from 'node:crypto';
import type { SyncEventRecord } from '../entities.js';
import type { SyncEventsRepository } from '../repositories.js';

/** In-memory implementation -- see the scope note in in-memory-users.repository.ts. */
export class InMemorySyncEventsRepository implements SyncEventsRepository {
  private readonly events: SyncEventRecord[] = [];

  async record(userId: string, deviceId: string, masterKeyVersion: number): Promise<SyncEventRecord> {
    const record: SyncEventRecord = {
      id: randomUUID(),
      userId,
      deviceId,
      masterKeyVersion,
      updatedAtServer: new Date(),
    };
    this.events.push(record);
    return record;
  }
}
