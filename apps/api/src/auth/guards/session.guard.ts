import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TokenService } from '../token.service.js';

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: { userId: string; deviceId: string };
}

/**
 * Validates the sessionToken issued by AuthService.loginFinish. OPAQUE
 * doesn't gate this directly (section 4) -- it gates token issuance
 * during the login handshake; this guard only verifies the resulting
 * JWT's signature/expiry/type on each subsequent request (used by
 * VaultModule).
 */
@Injectable()
export class SessionGuard implements CanActivate {
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
      throw new UnauthorizedException('Invalid or expired session token.');
    }

    if (payload.type !== 'session') {
      throw new UnauthorizedException('Token is not a session token.');
    }

    request.auth = { userId: payload.sub, deviceId: payload.deviceId };
    return true;
  }
}
