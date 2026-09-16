import { describe, expect, it } from 'vitest';
import {
  deserializeVaultItem,
  serializeVaultItem,
} from '../vault-item';
import { VAULT_ITEM_SCHEMA_VERSION } from '../types';
import type { VaultItemPlaintext } from '../types';

/**
 * Round-trip + schema-guard coverage for the plain-JSON serialization
 * that sits between VaultItemPlaintext and KeyManager.encryptItem() /
 * decryptItem() (see vault-item.ts). Does not touch KeyManager or
 * WebCrypto at all -- that pairing is already covered by
 * key-manager.test.ts; this file only tests the shape <-> Bytes step.
 */
describe('serializeVaultItem / deserializeVaultItem', () => {
  it('round-trips every field, including the optional ones', () => {
    const item: VaultItemPlaintext = {
      schemaVersion: VAULT_ITEM_SCHEMA_VERSION,
      title: 'Example bank',
      username: 'andre@example.com',
      password: 'correct-horse-battery-staple',
      url: 'https://example.com/login',
      notes: 'Security questions kept in the recovery note.',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    };

    const bytes = serializeVaultItem(item);
    expect(bytes).toBeInstanceOf(Uint8Array);

    const roundTripped = deserializeVaultItem(bytes);
    expect(roundTripped).toEqual(item);
  });

  it('round-trips with the optional fields absent', () => {
    const item: VaultItemPlaintext = {
      schemaVersion: VAULT_ITEM_SCHEMA_VERSION,
      title: 'Minimal entry',
      username: 'user',
      password: 'hunter2',
    };

    const roundTripped = deserializeVaultItem(serializeVaultItem(item));
    expect(roundTripped).toEqual(item);
    expect(roundTripped.url).toBeUndefined();
    expect(roundTripped.notes).toBeUndefined();
    expect(roundTripped.totpSecret).toBeUndefined();
  });

  /**
   * Guards the explicit refuse-to-guess behavior in deserializeVaultItem:
   * an unrecognized schemaVersion must throw, never silently return a
   * shape the caller assumes is current.
   */
  it('throws on an unrecognized schemaVersion', () => {
    const encoder = new TextEncoder();
    const futureItem = encoder.encode(
      JSON.stringify({
        schemaVersion: 2,
        title: 'From a future build',
        username: 'user',
        password: 'x',
      }),
    );

    expect(() => deserializeVaultItem(futureItem)).toThrow(
      /Unsupported VaultItemPlaintext.schemaVersion/,
    );
  });
});
