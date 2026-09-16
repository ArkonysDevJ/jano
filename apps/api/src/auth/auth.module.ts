import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { SessionGuard } from './guards/session.guard.js';
import { RotationAuthGuard } from './guards/rotation-auth.guard.js';
import { RateLimitGuard } from './rate-limit/rate-limit.guard.js';
import { OPAQUE_SERVER_PROVIDER } from './opaque/opaque-server-provider.js';
import { CloudflareOpaqueServerProvider } from './opaque/cloudflare-opaque-server-provider.js';

/**
 * STATUS (2026-09-11): OPAQUE_SERVER_PROVIDER now points at the real
 * CloudflareOpaqueServerProvider. Its round-trip test
 * (cloudflare-opaque-server-provider.spec.ts) has been run on André's
 * machine against the actual installed @cloudflare/opaque-ts@0.7.5 and
 * both cases pass: a full registration + login deriving a matching
 * sessionKey on both sides, and a wrong-password login correctly
 * rejected (client-side envelope recovery failure -- see that file's
 * comments for why the rejection happens there, not server-side).
 *
 * FakeOpaqueServerProvider (opaque/fake-opaque-server-provider.ts) is
 * kept in the codebase -- it's still what auth.service.spec.ts
 * constructs directly (bypassing this module's DI entirely) to test
 * AuthService's control flow without paying OPAQUE's real
 * cryptographic cost on every test run. It is no longer bound here.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionGuard,
    RotationAuthGuard,
    RateLimitGuard,
    { provide: OPAQUE_SERVER_PROVIDER, useClass: CloudflareOpaqueServerProvider },
  ],
  // OPAQUE_SERVER_PROVIDER exported too: RotationModule injects it directly
  // into RotationService (rotate/start needs createRegistrationResponse)
  // and only imports AuthModule, never binds its own instance -- without
  // this export Nest can't resolve it there (UnknownDependenciesException).
  exports: [TokenService, SessionGuard, RotationAuthGuard, OPAQUE_SERVER_PROVIDER],
})
export class AuthModule {}
