/**
 * Shared types for Jano's encryption engine.
 * Reference: docs/ARCHITECTURE-01.md
 *
 * Hard rule (sections 9/10): no derived key (KEK/DEK) and no decrypted
 * credential crosses the engine -> UI boundary as a `string`. Always
 * `Uint8Array`. Conversion to string, when unavoidable (DOM rendering,
 * clipboard), is the exclusive responsibility of the UI layer and must
 * be declared explicitly there -- never assumed in the engine.
 */

/**
 * Alias for the byte buffer that crosses every engine interface.
 *
 * Technical note (not Blueprint architecture, an implementation
 * decision): since TypeScript 5.7, `Uint8Array` is generic over its
 * backing buffer type, and the WebCrypto APIs (`BufferSource`)
 * specifically require `Uint8Array<ArrayBuffer>` -- a bare, unannotated
 * `Uint8Array` is not enough and fails compilation against
 * `crypto.subtle.*`. Pinned here as a single alias so it isn't
 * repeated in every file. Requires `typescript` >= 5.7 (see
 * package.json).
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export type KekPurpose = 'master' | 'recovery';

/** Persisted wrapping of the vault's SINGLE DEK (sections 3, 7, 12). */
export interface WrappedDek {
  /** Output of aes-gcm.ts packSealed(): nonce (12 bytes) + ciphertext + tag. */
  readonly ciphertext: Bytes;
  readonly purpose: KekPurpose;
  /** master_key_version or recovery_key_version depending on `purpose` (section 3). */
  readonly keyVersion: number;
}

/** Result of an AES-256-GCM operation before packing for persistence. */
export interface AesGcmSealed {
  /** 96 bits / 12 bytes, CSPRNG, unique per operation (section 5). */
  readonly nonce: Bytes;
  /** Includes the authentication tag -- WebCrypto appends it at the end. */
  readonly ciphertext: Bytes;
}

export interface Argon2idParams {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
  /** 32 bytes so the result can be used directly as an AES-256 key. */
  readonly hashLengthBytes: number;
}

/**
 * Current version of {@link VaultItemPlaintext}'s shape. Bump this
 * whenever a field is added, renamed, or removed -- see
 * `deserializeVaultItem` (vault-item.ts), which refuses to read a
 * `schemaVersion` it doesn't recognize rather than silently
 * misinterpreting an old or newer shape.
 */
export const VAULT_ITEM_SCHEMA_VERSION = 1;

/**
 * Plaintext shape of a single vault entry -- the thing a user actually
 * thinks of as "a saved password". This exists ONLY on the client,
 * in memory, while the vault is unlocked: `apps/api`'s `vault_items`
 * table has no concept of these fields at all (section 12 defines it
 * purely as opaque `ciphertext` bytes) -- the server never sees this
 * shape, serialized or not.
 *
 * `serializeVaultItem`/`deserializeVaultItem` (vault-item.ts) are the
 * pair that converts between this object and the `Bytes` that
 * `KeyManager.encryptItem`/`decryptItem` operate on. Note that this is
 * NOT itself the engine -> UI boundary the hard rule above governs --
 * that rule constrains whatever future function hands a *decrypted*
 * item to the UI layer (it must still cross as `Bytes`, with parsing
 * into this shape as the UI's own explicit, declared step). This type
 * and its serialization pair are what that future function would use
 * internally.
 *
 * `url`, `notes`, and `totpSecret` are optional -- not every saved
 * credential has a TOTP secret or notes, and modeling that as
 * required-but-empty-string would make "the user has one" and "the
 * user set it to nothing" indistinguishable for no benefit.
 */
export interface VaultItemPlaintext {
  readonly schemaVersion: typeof VAULT_ITEM_SCHEMA_VERSION;
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly url?: string;
  readonly notes?: string;
  readonly totpSecret?: string;
}
