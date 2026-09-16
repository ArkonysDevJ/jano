import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
}

/** Marks an endpoint with its own limit (section 8) -- see RateLimitGuard. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
