import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SYNC_EVENTS_REPOSITORY, VAULT_ITEMS_REPOSITORY, VAULT_KEYS_REPOSITORY } from '../persistence/tokens.js';
import type { SyncEventsRepository, VaultItemsRepository, VaultKeysRepository } from '../persistence/repositories.js';
import type { VaultItemRecord } from '../persistence/entities.js';

export interface PushInput {
  readonly itemId?: string;
  readonly ciphertext: Uint8Array;
  readonly dekVersion: number;
  readonly lastSeenItemVersion?: number;
  readonly masterKeyVersion: number;
}

export interface PushResult {
  readonly item: VaultItemRecord;
  /** True when this push produced a conflict fork instead of overwriting the target item (section 14). */
  readonly conflict: boolean;
}

export interface PullResult {
  readonly items: VaultItemRecord[];
  readonly masterKeyVersion: number;
}

/**
 * Sync core (sections 7, 14): the master_key_version reconciliation
 * gate, and the conflict-fork algorithm that replaces WatermelonDB's
 * default last-write-wins for vault_items. The server stays blind
 * throughout -- every decision here is made on version numbers and
 * identifiers, never on decrypted content.
 *
 * Registration of the master vault_keys row itself is NOT this file's
 * responsibility -- see vault-keys/vault-keys.service.ts (VaultKeysModule),
 * a bare SessionGuard-protected upsert over the same VAULT_KEYS_REPOSITORY
 * this gate reads from. This file's tests still populate the repository
 * directly via `upsert()` rather than going through that module, for
 * isolation -- both paths write the same shape of record.
 */
@Injectable()
export class SyncService {
  constructor(
    @Inject(VAULT_KEYS_REPOSITORY) private readonly vaultKeys: VaultKeysRepository,
    @Inject(VAULT_ITEMS_REPOSITORY) private readonly items: VaultItemsRepository,
    @Inject(SYNC_EVENTS_REPOSITORY) private readonly syncEvents: SyncEventsRepository,
  ) {}

  /**
   * The reconciliation gate (section 7): a device connecting with an
   * outdated master_key_version cannot push or accept writes until it
   * re-derives against the current version -- an explicit blocking
   * state, never a silent merge. A sync_event is logged either way
   * (section 12) -- that's blind metadata (a version number), never
   * vault content, so logging it doesn't touch zero-knowledge.
   */
  private async assertReconciled(
    userId: string,
    deviceId: string,
    clientMasterKeyVersion: number,
  ): Promise<void> {
    await this.syncEvents.record(userId, deviceId, clientMasterKeyVersion);

    const masterKey = await this.vaultKeys.getByUserAndPurpose(userId, 'master');
    if (!masterKey) {
      throw new NotFoundException(
        'No master vault key registered for this user yet -- nothing to reconcile against.',
      );
    }

    if (clientMasterKeyVersion !== masterKey.keyVersion) {
      throw new ConflictException({
        message: 'Outdated master_key_version -- re-derive against the current version before syncing.',
        currentMasterKeyVersion: masterKey.keyVersion,
      });
    }
  }

  /**
   * Push, sections 7/14. Creating a new item (no `itemId`) never
   * conflicts -- there is nothing to compare against yet. Updating an
   * existing item compares the server's current itemVersion against
   * what the client last saw (`lastSeenItemVersion`): if the server has
   * moved on without the client's knowledge, this is a genuine conflict
   * -- the incoming write becomes a fork (`conflictOf` pointing at the
   * original) instead of overwriting it, and the original is left
   * intact, with no data loss (section 14, steps 2-3). Never a silent
   * merge.
   */
  async push(userId: string, deviceId: string, input: PushInput): Promise<PushResult> {
    await this.assertReconciled(userId, deviceId, input.masterKeyVersion);

    if (!input.itemId) {
      const created = await this.items.create(userId, input.ciphertext, input.dekVersion);
      return { item: created, conflict: false };
    }

    const existing = await this.items.getById(input.itemId, userId);
    if (!existing) {
      throw new NotFoundException('Item not found.');
    }

    const lastSeen = input.lastSeenItemVersion ?? 0;
    const conflictDetected = existing.itemVersion > lastSeen;

    if (conflictDetected) {
      const fork = await this.items.createFork(userId, input.ciphertext, input.dekVersion, existing.id);
      return { item: fork, conflict: true };
    }

    const updated = await this.items.update(input.itemId, userId, {
      ciphertext: input.ciphertext,
      dekVersion: input.dekVersion,
      itemVersion: existing.itemVersion + 1,
    });
    return { item: updated, conflict: false };
  }

  /**
   * Pull, section 7: gated the same as push -- a device with an
   * outdated master_key_version cannot "accept writes" either, since it
   * would be unable to correctly re-wrap or verify content against a
   * KEK it hasn't re-derived yet. Items themselves are opaque ciphertext
   * either way; resolving any `conflict_of` a client finds is a
   * client-side, manual step (section 14, step 4) -- only the client
   * holds the key to decrypt both versions and decide.
   */
  async pull(userId: string, deviceId: string, clientMasterKeyVersion: number): Promise<PullResult> {
    await this.assertReconciled(userId, deviceId, clientMasterKeyVersion);
    const items = await this.items.listByUser(userId);
    return { items, masterKeyVersion: clientMasterKeyVersion };
  }
}
