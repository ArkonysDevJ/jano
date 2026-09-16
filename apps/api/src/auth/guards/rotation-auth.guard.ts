import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../token.service.js';
import type { AuthenticatedRequest } from './session.guard.js';

/**
 * Factor 1 of section 13's re-registration authorization policy. Unlike
 * SessionGuard (session tokens only, 15m), this accepts EITHER a
 * session or a refresh token (30d) -- the scenario it guards is a
 * device reconnecting after an OFFLINE master-key rotation, which may
 * well have outlasted its short-lived session token. Per the
 * architecture doc: an attacker who steals only this token produces,
 * at worst, a denial of sync service -- it cannot decrypt the vault,
 * since the KEK never leaves the client. Factor 2 (hardened mode), when
 * enabled, is enforced by RotationService itself, not here.
 */
@Injectable()
export class RotationAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing Authorization header.');
    }

    let payload;
    try {
      payload = this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    if (payload.type !== 'session' && payload.type !== 'refresh') {
      throw new UnauthorizedException('Token is not a valid session or refresh token.');
    }

    request.auth = { userId: payload.sub, deviceId: payload.deviceId };
    return true;
  }
}
