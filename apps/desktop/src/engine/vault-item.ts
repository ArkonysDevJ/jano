/**
 * Serialization of {@link VaultItemPlaintext} to/from the `Bytes` that
 * `KeyManager.encryptItem`/`decryptItem` operate on.
 * Reference: docs/ARCHITECTURE-01.md, section 12; types.ts for why
 * this shape exists only client-side.
 *
 * Plain JSON, not a denser binary format -- this object never touches
 * disk or the wire unencrypted (it only ever exists in memory while
 * the vault is unlocked), so there's no real cost to it and it stays
 * trivially inspectable while debugging.
 */

import { VAULT_ITEM_SCHEMA_VERSION } from './types';
import type { Bytes, VaultItemPlaintext } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serializes a plaintext vault item, ready for `KeyManager.encryptItem()`. */
export function serializeVaultItem(item: VaultItemPlaintext): Bytes {
  return encoder.encode(JSON.stringify(item));
}

/**
 * Reverses `serializeVaultItem`, after `KeyManager.decryptItem()`.
 *
 * Throws on a `schemaVersion` this build doesn't recognize -- refusing
 * to guess at an unknown or newer shape is safer than silently
 * returning a malformed `VaultItemPlaintext` (e.g. `undefined` fields
 * a caller assumes are present).
 */
export function deserializeVaultItem(bytes: Bytes): VaultItemPlaintext {
  const parsed = JSON.parse(decoder.decode(bytes)) as VaultItemPlaintext;
  if (parsed.schemaVersion !== VAULT_ITEM_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported VaultItemPlaintext.schemaVersion: ${String(parsed.schemaVersion)} ` +
        `(this build reads version ${VAULT_ITEM_SCHEMA_VERSION}).`,
    );
  }
  return parsed;
}
