import { describe, expect, it } from 'vitest';
import { createNewVault } from '../registration';
import { aesGcmOpen, unpackSealed } from '../aes-gcm';
import { deriveMasterKek, deriveRecoveryKek, DEFAULT_ARGON2ID_PARAMS } from '../kek';

/**
 * NOT verified in the sandbox this was written in -- real Argon2id via
 * hash-wasm needs the package actually installed, which needs network
 * this sandbox doesn't have (same limitation as every OPAQUE-touching
 * test in apps/api). Must be run and confirmed with
 * `npm run test --workspace=apps/desktop` on a real machine, same
 * discipline as cloudflare-opaque-server-provider.spec.ts.
 */
describe('createNewVault', () => {
  it('produces a vault whose master and recovery wrappings both unwrap to the SAME DEK', async () => {
    const masterPassword = 'a-test-master-password';
    const material = await createNewVault(masterPassword, DEFAULT_ARGON2ID_PARAMS);

    expect(material.manager.hasUnlockedDek).toBe(true);
    expect(material.wrappedMasterDek.purpose).toBe('master');
    expect(material.wrappedMasterDek.keyVersion).toBe(1);
    expect(material.wrappedRecoveryDek.purpose).toBe('recovery');
    expect(material.wrappedRecoveryDek.keyVersion).toBe(1);

    // Independently re-derive both KEKs and unwrap both wrappings --
    // section 3's requirement that EITHER path recovers the identical DEK.
    const masterKek = await deriveMasterKek(masterPassword, material.localSalt, DEFAULT_ARGON2ID_PARAMS);
    const dekViaMaster = await aesGcmOpen(masterKek, unpackSealed(material.wrappedMasterDek.ciphertext));

    const recoveryKek = await deriveRecoveryKek(
      material.recoveryKitSecret,
      material.recoverySalt,
      DEFAULT_ARGON2ID_PARAMS,
    );
    const dekViaRecovery = await aesGcmOpen(recoveryKek, unpackSealed(material.wrappedRecoveryDek.ciphertext));

    expect(dekViaMaster).toEqual(dekViaRecovery);

    // And the manager returned by createNewVault is already usable with
    // that same DEK, without a separate unlock step.
    const plaintext = new TextEncoder().encode('a-fresh-vault-item');
    const encrypted = await material.manager.encryptItem(plaintext);
    const decryptedViaMasterDek = await aesGcmOpen(dekViaMaster, unpackSealed(encrypted));
    expect(new TextDecoder().decode(decryptedViaMasterDek)).toBe('a-fresh-vault-item');
  });

  it('generates independent salts and a fresh recovery secret on every call', async () => {
    const a = await createNewVault('password-a');
    const b = await createNewVault('password-b');

    expect(a.localSalt).not.toEqual(b.localSalt);
    expect(a.recoverySalt).not.toEqual(b.recoverySalt);
    expect(a.recoveryKitSecret).not.toEqual(b.recoveryKitSecret);
  });
});
