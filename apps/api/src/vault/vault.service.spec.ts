import { beforeEach, describe, expect, it } from 'vitest';
import { VaultService } from './vault.service.js';
import { InMemoryVaultItemsRepository } from '../persistence/in-memory/in-memory-vault-items.repository.js';

describe('VaultService', () => {
  let service: VaultService;
  const userId = 'user-1';

  beforeEach(() => {
    service = new VaultService(new InMemoryVaultItemsRepository());
  });

  it('creates, lists and updates an item, bumping itemVersion on each update', async () => {
    const ciphertext = new TextEncoder().encode('encrypted-blob');
    const created = await service.createItem(userId, ciphertext, 1);
    expect(created.itemVersion).toBe(1);
    expect(created.ciphertext).toEqual(ciphertext);

    const listed = await service.listItems(userId);
    expect(listed).toHaveLength(1);

    const newCiphertext = new TextEncoder().encode('encrypted-blob-v2');
    const updated = await service.updateItem(userId, created.id, newCiphertext, 1);
    expect(updated.itemVersion).toBe(2);
    expect(updated.ciphertext).toEqual(newCiphertext);
  });

  it('isolates items by user -- another user cannot read or update them', async () => {
    const created = await service.createItem(userId, new TextEncoder().encode('x'), 1);

    await expect(service.getItem('another-user', created.id)).rejects.toThrow();
    await expect(
      service.updateItem('another-user', created.id, new TextEncoder().encode('y'), 1),
    ).rejects.toThrow();

    // the real owner can still do it -- confirms the rejection above is
    // due to tenant isolation, not a bug that breaks the item itself.
    await expect(service.getItem(userId, created.id)).resolves.toBeTruthy();
  });

  it('throws NotFoundException (via throw) when requesting a nonexistent item', async () => {
    await expect(service.getItem(userId, 'does-not-exist')).rejects.toThrow();
  });

  it('listItems for a user with no items returns an empty array, not undefined', async () => {
    const items = await service.listItems('new-user');
    expect(items).toEqual([]);
  });
});
