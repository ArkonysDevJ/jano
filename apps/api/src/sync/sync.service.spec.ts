import { beforeEach, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { InMemoryVaultKeysRepository } from '../persistence/in-memory/in-memory-vault-keys.repository.js';
import { InMemoryVaultItemsRepository } from '../persistence/in-memory/in-memory-vault-items.repository.js';
import { InMemorySyncEventsRepository } from '../persistence/in-memory/in-memory-sync-events.repository.js';

describe('SyncService', () => {
  let service: SyncService;
  let vaultKeys: InMemoryVaultKeysRepository;
  let items: InMemoryVaultItemsRepository;
  const userId = 'user-1';
  const deviceId = 'device-1';

  beforeEach(async () => {
    vaultKeys = new InMemoryVaultKeysRepository();
    items = new InMemoryVaultItemsRepository();
    service = new SyncService(vaultKeys, items, new InMemorySyncEventsRepository());
    // Simulates a user who already has a registered master key at
    // version 1 (see the module's known-gap note: no real endpoint
    // does this registration yet).
    await vaultKeys.upsert(userId, 'master', new Uint8Array([1, 2, 3]), 1);
  });

  it('rejects push and pull when the client presents an outdated master_key_version', async () => {
    await expect(
      service.push(userId, deviceId, {
        ciphertext: new TextEncoder().encode('x'),
        dekVersion: 1,
        masterKeyVersion: 2, // server is at 1
      }),
    ).rejects.toThrow();

    await expect(service.pull(userId, deviceId, 2)).rejects.toThrow();
  });

  it('allows push and pull when the client is reconciled with the server', async () => {
    const result = await service.push(userId, deviceId, {
      ciphertext: new TextEncoder().encode('x'),
      dekVersion: 1,
      masterKeyVersion: 1,
    });
    expect(result.conflict).toBe(false);

    const pulled = await service.pull(userId, deviceId, 1);
    expect(pulled.items).toHaveLength(1);
    expect(pulled.masterKeyVersion).toBe(1);
  });

  it('creates a new item without conflict when no itemId is given', async () => {
    const result = await service.push(userId, deviceId, {
      ciphertext: new TextEncoder().encode('new-item'),
      dekVersion: 1,
      masterKeyVersion: 1,
    });
    expect(result.conflict).toBe(false);
    expect(result.item.itemVersion).toBe(1);
    expect(result.item.conflictOf).toBeUndefined();
  });

  it('updates an existing item without conflict when the client saw the latest version', async () => {
    const created = await service.push(userId, deviceId, {
      ciphertext: new TextEncoder().encode('v1'),
      dekVersion: 1,
      masterKeyVersion: 1,
    });

    const updated = await service.push(userId, deviceId, {
      itemId: created.item.id,
      ciphertext: new TextEncoder().encode('v2'),
      dekVersion: 1,
      lastSeenItemVersion: created.item.itemVersion, // saw version 1, which is current
      masterKeyVersion: 1,
    });

    expect(updated.conflict).toBe(false);
    expect(updated.item.id).toBe(created.item.id);
    expect(updated.item.itemVersion).toBe(2);
  });

  it('forks into a new record instead of overwriting when the server moved on without the client (section 14)', async () => {
    const created = await service.push(userId, deviceId, {
      ciphertext: new TextEncoder().encode('v1'),
      dekVersion: 1,
      masterKeyVersion: 1,
    });

    // A second device pushes an update the first device never saw --
    // the server's itemVersion moves to 2.
    await service.push(userId, 'device-b', {
      itemId: created.item.id,
      ciphertext: new TextEncoder().encode('v2-from-device-b'),
      dekVersion: 1,
      lastSeenItemVersion: created.item.itemVersion,
      masterKeyVersion: 1,
    });

    // The first device now pushes its own edit, still believing the
    // item is at version 1 -- it never pulled device B's update.
    const conflicted = await service.push(userId, deviceId, {
      itemId: created.item.id,
      ciphertext: new TextEncoder().encode('v2-from-device-a'),
      dekVersion: 1,
      lastSeenItemVersion: created.item.itemVersion, // still 1
      masterKeyVersion: 1,
    });

    expect(conflicted.conflict).toBe(true);
    expect(conflicted.item.id).not.toBe(created.item.id);
    expect(conflicted.item.conflictOf).toBe(created.item.id);
    expect(new TextDecoder().decode(conflicted.item.ciphertext)).toBe('v2-from-device-a');

    // The original item, at its last accepted version, is left intact
    // -- no data loss (section 14, step 3).
    const original = await items.getById(created.item.id, userId);
    expect(original?.itemVersion).toBe(2);
    expect(new TextDecoder().decode(original!.ciphertext)).toBe('v2-from-device-b');
  });

  it('throws if pushing an update for an item that does not exist', async () => {
    await expect(
      service.push(userId, deviceId, {
        itemId: 'does-not-exist',
        ciphertext: new TextEncoder().encode('x'),
        dekVersion: 1,
        lastSeenItemVersion: 1,
        masterKeyVersion: 1,
      }),
    ).rejects.toThrow();
  });

  it('throws if the user has no registered master vault key yet', async () => {
    const freshService = new SyncService(
      new InMemoryVaultKeysRepository(),
      new InMemoryVaultItemsRepository(),
      new InMemorySyncEventsRepository(),
    );
    await expect(
      freshService.push('new-user', deviceId, {
        ciphertext: new TextEncoder().encode('x'),
        dekVersion: 1,
        masterKeyVersion: 1,
      }),
    ).rejects.toThrow();
  });

  it('isolates items by user, same as VaultService', async () => {
    await vaultKeys.upsert('user-2', 'master', new Uint8Array([9, 9, 9]), 1);
    await service.push(userId, deviceId, {
      ciphertext: new TextEncoder().encode('user-1-item'),
      dekVersion: 1,
      masterKeyVersion: 1,
    });

    const pulledForOtherUser = await service.pull('user-2', deviceId, 1);
    expect(pulledForOtherUser.items).toHaveLength(0);
  });
});
