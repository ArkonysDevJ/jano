import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../guards/session.guard.js';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js';
import { RateLimitStore } from './rate-limit.store.js';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new RateLimitStore();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true; // no @RateLimit -- no dedicated limit on this endpoint

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ip = request.ip ?? 'unknown';
    const body = request.body as { email?: string } | undefined;
    // Public OPAQUE endpoints (register/login) key by email from the body;
    // authenticated endpoints (rotation) have no email in the body, but DO
    // have `request.auth.userId` -- set by whichever auth guard the route
    // declares BEFORE this one in @UseGuards() (see rotation.controller.ts,
    // which orders RotationAuthGuard first for exactly this reason).
    const identity = body?.email ?? request.auth?.userId ?? '';
    const key = `${context.getClass().name}:${context.getHandler().name}:${ip}:${identity}`;

    const result = this.store.check(key, options.limit, options.windowMs);
    if (!result.allowed) {
      throw new HttpException(
        { message: 'Too many attempts. Try again later.', retryAfterMs: result.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
