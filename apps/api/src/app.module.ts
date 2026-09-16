import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { AuthModule } from './auth/auth.module.js';
import { VaultModule } from './vault/vault.module.js';
import { SyncModule } from './sync/sync.module.js';
import { VaultKeysModule } from './vault-keys/vault-keys.module.js';
import { RotationModule } from './rotation/rotation.module.js';

/**
 * Handoff -- ARCHITECTURE-01, updated 2026-09-12.
 *
 * - PersistenceModule -- repositories (section 12), IN MEMORY for now. See
 *   persistence/persistence.module.ts for the exact status and what's
 *   missing for real PostgreSQL.
 * - AuthModule -- OPAQUE (section 4) + custom rate limiting (section 8) +
 *   session/refresh token issuance. OPAQUE_SERVER_PROVIDER is now bound
 *   to CloudflareOpaqueServerProvider -- its real round-trip test
 *   (registration + login, both directions) has been run and confirmed
 *   passing against the actual installed library. See auth/auth.module.ts.
 * - VaultModule -- CRUD for vault_items (sections 7, 12), protected by SessionGuard.
 * - SyncModule -- master_key_version reconciliation gate and conflict-fork
 *   algorithm (sections 7, 14).
 * - VaultKeysModule -- registers/replaces the vault's two DEK wrappings
 *   (purpose 'master' / 'recovery', section 3), protected by SessionGuard.
 *   This closes the gap SyncModule's reconciliation gate previously
 *   assumed away -- see vault-keys/vault-keys.service.ts.
 * - RotationModule -- pending_opaque_rotation re-registration (section 13):
 *   Factor 1 (mandatory, RotationAuthGuard -- session OR refresh token) and
 *   Factor 2 ("hardened mode", opt-in HMAC nonce-challenge). See
 *   rotation/rotation.service.ts for the exact authorization policy and an
 *   explicit note on how Factor 2's construction departs from the
 *   architecture doc's word "verifier" (shared secret + nonce, not an
 *   asymmetric signature -- flagged, not silently downgraded).
 *
 * Pending, not implemented yet:
 * - The client-side registration ceremony that calls VaultKeysModule's
 *   POST /vault-keys twice (master + recovery) after register/finish +
 *   first login -- apps/desktop engine territory, not started.
 * - RotationModule's out-of-band notification hardening (email/push to
 *   another device on every re-registration) -- explicitly optional per
 *   the architecture doc, logged as a future improvement there too.
 *
 * Does not exist in this commit -- added in an explicit later commit,
 * not inferred without confirmation.
 */
@Module({
  imports: [PersistenceModule, AuthModule, VaultModule, SyncModule, VaultKeysModule, RotationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
