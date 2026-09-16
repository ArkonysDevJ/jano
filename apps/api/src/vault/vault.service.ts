import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { VAULT_ITEMS_REPOSITORY } from '../persistence/tokens.js';
import type { VaultItemsRepository } from '../persistence/repositories.js';
import type { VaultItemRecord } from '../persistence/entities.js';

/**
 * CRUD over vault_items (sections 7, 12). The server never sees
 * plaintext: ciphertext is an opaque blob (output of aesGcmSeal +
 * packSealed in the apps/desktop engine) and dekVersion is blind
 * metadata -- a generation tag, not a key (section 7). There is no
 * conflict detection here (that belongs to SyncModule, section 14) nor
 * a master_key_version gate (that also belongs to Sync, section 7) --
 * this module assumes a single write at a time.
 */
@Injectable()
export class VaultService {
  constructor(@Inject(VAULT_ITEMS_REPOSITORY) private readonly items: VaultItemsRepository) {}

  async createItem(userId: string, ciphertext: Uint8Array, dekVersion: number): Promise<VaultItemRecord> {
    return this.items.create(userId, ciphertext, dekVersion);
  }

  async listItems(userId: string): Promise<VaultItemRecord[]> {
    return this.items.listByUser(userId);
  }

  async getItem(userId: string, itemId: string): Promise<VaultItemRecord> {
    const item = await this.items.getById(itemId, userId);
    if (!item) throw new NotFoundException('Item not found.');
    return item;
  }

  async updateItem(
    userId: string,
    itemId: string,
    ciphertext: Uint8Array,
    dekVersion: number,
  ): Promise<VaultItemRecord> {
    const existing = await this.items.getById(itemId, userId);
    if (!existing) throw new NotFoundException('Item not found.');
    return this.items.update(itemId, userId, {
      ciphertext,
      dekVersion,
      itemVersion: existing.itemVersion + 1,
    });
  }
}
