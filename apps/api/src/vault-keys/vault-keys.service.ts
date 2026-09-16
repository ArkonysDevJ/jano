import { Inject, Injectable } from '@nestjs/common';
import { VAULT_KEYS_REPOSITORY } from '../persistence/tokens.js';
import type { VaultKeysRepository } from '../persistence/repositories.js';
import type { VaultKeyPurpose, VaultKeyRecord } from '../persistence/entities.js';

/**
 * Registers the vault's DEK wrappings (sections 3, 7, 12). This is the
 * endpoint earlier handoffs (04, 05) flagged as missing: SyncService's
 * reconciliation gate compares an incoming `masterKeyVersion` against
 * the `vault_keys` row this module writes -- without it, no real user
 * could ever pass the gate, only tests that populate the repository
 * directly.
 *
 * Deliberately thin: this is a blind upsert, keyed by (userId, purpose).
 * The server never validates the wrapping's content -- it cannot, by
 * design (zero-knowledge, section 3) -- it only stores what the client
 * sends and the version tag alongside it.
 *
 * Client-side registration flow this supports (not enforced here, that's
 * the client engine's responsibility): after register/finish + a first
 * login, the client calls this twice -- once with purpose 'master' (DEK
 * wrapped under the Argon2id-derived master KEK) and once with purpose
 * 'recovery' (DEK wrapped under the recovery-kit KEK) -- both at
 * keyVersion 1. Section 13's offline-rotation state machine
 * (`pending_opaque_rotation`) is NOT implemented yet and does NOT reuse
 * this endpoint as-is -- that flow needs its own authorization policy
 * (Factor 1/Factor 2), not a bare SessionGuard upsert.
 */
@Injectable()
export class VaultKeysService {
  constructor(@Inject(VAULT_KEYS_REPOSITORY) private readonly vaultKeys: VaultKeysRepository) {}

  async upsert(
    userId: string,
    purpose: VaultKeyPurpose,
    wrappedDek: Uint8Array,
    keyVersion: number,
  ): Promise<VaultKeyRecord> {
    return this.vaultKeys.upsert(userId, purpose, wrappedDek, keyVersion);
  }

  async list(userId: string): Promise<VaultKeyRecord[]> {
    return this.vaultKeys.listByUser(userId);
  }
}
