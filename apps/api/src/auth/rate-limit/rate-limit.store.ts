interface Bucket {
  count: number;
  windowStartedAt: number;
  blockedUntil?: number;
  /**
   * How many consecutive lockout cycles this key has been through,
   * WITHOUT a clean window (no violation) in between. This is what
   * makes the backoff genuinely increase across a persistent
   * attacker's retries -- not just within a single window. See the
   * design note below: without this field, waiting out the lockout
   * and retrying was always treated as a first offense again.
   */
  violationStreak: number;
}

export interface RateLimitCheckResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/**
 * Custom rate limiter (section 8), in memory, per process -- fixed
 * window + exponential backoff on repeated violations. Chosen over
 * @nestjs/throttler to avoid adding another unverified external
 * library API in this handoff (same reasoning as in
 * OpaqueServerProvider and TokenService) -- this logic is simple,
 * self-contained, and fully testable without depending on anything
 * external.
 *
 * Design note (found by running the tests, not just writing them --
 * see the 2026-09-11 conversation): an earlier version of this file
 * reset all violation memory as soon as the window expired, even if
 * it expired in the middle of an active lockout. An attacker who
 * simply waited out the lockout and tried again always received the
 * base backoff, never a larger one -- the "exponential" the
 * architecture calls for (section 8) didn't hold across cycles.
 * `violationStreak` is what fixes it: it only resets when a window
 * completes WITHOUT any violation (clean behavior), not by the mere
 * passage of time.
 *
 * Does not replace the CAPTCHA/proof-of-work fallback the architecture
 * leaves as an additional threshold (section 8) -- that remains
 * explicitly pending, for when real traffic justifies it.
 *
 * Declared limitation: in memory per instance -- if `apps/api` runs
 * across more than one process/replica, each counts separately (same
 * limitation already declared for pendingLogins in AuthService).
 * Acceptable for this handoff, not for multi-instance production.
 */
export class RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitCheckResult {
    const bucket = this.buckets.get(key);

    if (bucket?.blockedUntil !== undefined && bucket.blockedUntil > now) {
      return { allowed: false, retryAfterMs: bucket.blockedUntil - now };
    }

    const windowExpired = !bucket || now - bucket.windowStartedAt >= windowMs;

    if (windowExpired) {
      // The streak only resets if the previous bucket NEVER reached a
      // lockout (clean window) -- if it did reach a lockout, the streak
      // carries over to the new bucket, even if the lockout has since
      // expired by time.
      const previousWasClean = !bucket || bucket.blockedUntil === undefined;
      const violationStreak = previousWasClean ? 0 : bucket!.violationStreak;
      this.buckets.set(key, { count: 1, windowStartedAt: now, violationStreak });
      return { allowed: true, retryAfterMs: 0 };
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      bucket.violationStreak += 1;
      // Exponential backoff: each new lockout cycle doubles the
      // previous one, base = windowMs.
      const backoffMs = windowMs * 2 ** Math.min(bucket.violationStreak, 10); // capped to avoid overflow
      bucket.blockedUntil = now + backoffMs;
      return { allowed: false, retryAfterMs: backoffMs };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
