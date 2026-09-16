import { randomUUID } from 'node:crypto';
import type { DeviceRecord } from '../entities.js';
import type { DevicesRepository } from '../repositories.js';

/** In-memory implementation -- see the scope note in in-memory-users.repository.ts. */
export class InMemoryDevicesRepository implements DevicesRepository {
  private readonly byId = new Map<string, DeviceRecord>();
  // Kept separate from DeviceRecord itself -- narrow, dedicated storage
  // for a narrow, dedicated concern, same reasoning as
  // replaceRegistrationRecord() not living on UserRecord's own shape.
  private readonly pendingRotationChallenges = new Map<string, Uint8Array>();

  async create(
    input: Omit<DeviceRecord, 'id' | 'createdAt' | 'lastSeenAt'>,
  ): Promise<DeviceRecord> {
    const record: DeviceRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<DeviceRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async touchLastSeen(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record) record.lastSeenAt = new Date();
  }

  async setPendingRotationChallenge(deviceId: string, challenge: Uint8Array): Promise<void> {
    this.pendingRotationChallenges.set(deviceId, challenge);
  }

  async getPendingRotationChallenge(deviceId: string): Promise<Uint8Array | null> {
    return this.pendingRotationChallenges.get(deviceId) ?? null;
  }

  async clearPendingRotationChallenge(deviceId: string): Promise<void> {
    this.pendingRotationChallenges.delete(deviceId);
  }
}
