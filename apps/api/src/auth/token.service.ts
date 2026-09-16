import { Injectable } from '@nestjs/common';
import jwt, { type SignOptions } from 'jsonwebtoken';

export interface SessionTokenPayload {
  /** userId */
  sub: string;
  deviceId: string;
  type: 'session' | 'refresh';
}

/**
 * Thin wrapper over `jsonwebtoken` -- chosen over @nestjs/jwt to avoid
 * adding another unverified API layer in this handoff (same reasoning
 * as in opaque-server-provider.ts): `jsonwebtoken` is the base, stable
 * dependency that @nestjs/jwt depends on anyway, with an API that
 * hasn't changed in years.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured (see apps/api/.env.example).');
    }
    this.secret = secret;
  }

  // `expiresIn` is typed via jsonwebtoken's own `SignOptions['expiresIn']`
  // (a `number` of seconds, or a template-literal duration string like
  // "15m"/"30d") rather than plain `string` -- @types/jsonwebtoken tightened
  // this type, and a bare `string` no longer satisfies the `jwt.sign`
  // overload (TS2769). Callers already pass literal duration strings
  // ('15m', '30d'), which satisfy the narrower type as-is.
  sign(payload: SessionTokenPayload, expiresIn: SignOptions['expiresIn']): string {
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  verify(token: string): SessionTokenPayload {
    return jwt.verify(token, this.secret) as SessionTokenPayload;
  }
}
