import { describe, expect, it } from 'vitest';
import { RateLimitStore } from './rate-limit.store.js';

describe('RateLimitStore', () => {
  it('allows up to the limit within the window and blocks right after', () => {
    const store = new RateLimitStore();
    const start = 1_000_000;

    for (let i = 0; i < 5; i++) {
      expect(store.check('k', 5, 60_000, start + i).allowed).toBe(true);
    }

    const blocked = store.check('k', 5, 60_000, start + 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('a second lockout, in a later cycle, escalates the backoff -- it does not just repeat the same one', () => {
    // Regression for the real finding from the 2026-09-11 conversation:
    // the first version of RateLimitStore reset violationStreak as soon
    // as the window's time passed, even if that time passed WHILE a
    // lockout was still active -- an attacker who waited out the
    // lockout always received the base backoff again. This test
    // simulates exactly that: exhausts the limit, gets locked out,
    // WAITS for the lockout to genuinely expire, and violates again --
    // the second backoff must be larger.
    const store = new RateLimitStore();
    const limit = 3;
    const windowMs = 1000;

    for (let i = 0; i < limit; i++) store.check('k2', limit, windowMs, i);
    const firstBlock = store.check('k2', limit, windowMs, limit); // 4th request -> violates

    const afterFirstBlockExpires = limit + firstBlock.retryAfterMs + 10;
    for (let i = 0; i < limit; i++) {
      store.check('k2', limit, windowMs, afterFirstBlockExpires + i);
    }
    const secondBlock = store.check(
      'k2',
      limit,
      windowMs,
      afterFirstBlockExpires + limit,
    );

    expect(firstBlock.allowed).toBe(false);
    expect(secondBlock.allowed).toBe(false);
    expect(secondBlock.retryAfterMs).toBeGreaterThan(firstBlock.retryAfterMs);
  });

  it('a fully clean window (no violation) resets the streak', () => {
    const store = new RateLimitStore();
    const limit = 3;
    const windowMs = 1000;

    for (let i = 0; i < limit; i++) store.check('k5', limit, windowMs, i);
    const firstBlock = store.check('k5', limit, windowMs, limit);
    const afterFirstBlockExpires = limit + firstBlock.retryAfterMs + 10;

    // This time we do NOT violate in the second cycle -- we stay under the limit.
    for (let i = 0; i < limit - 1; i++) {
      store.check('k5', limit, windowMs, afterFirstBlockExpires + i);
    }

    // A third cycle, with clean behavior in between, should get the
    // BASE backoff again if violated -- not keep escalating.
    const thirdCycleStart = afterFirstBlockExpires + windowMs + 10;
    for (let i = 0; i < limit; i++) {
      store.check('k5', limit, windowMs, thirdCycleStart + i);
    }
    const thirdBlock = store.check('k5', limit, windowMs, thirdCycleStart + limit);

    expect(thirdBlock.retryAfterMs).toBe(firstBlock.retryAfterMs);
  });

  it('once the window has passed with no further violations, it allows again', () => {
    const store = new RateLimitStore();
    store.check('k3', 1, 1000, 0);
    const violated = store.check('k3', 1, 1000, 1);
    expect(violated.allowed).toBe(false);

    const afterBackoff = store.check('k3', 1, 1000, violated.retryAfterMs + 2);
    expect(afterBackoff.allowed).toBe(true);
  });

  it('reset() explicitly clears the bucket', () => {
    const store = new RateLimitStore();
    store.check('k4', 1, 1000, 0);
    store.check('k4', 1, 1000, 1); // violation
    store.reset('k4');

    expect(store.check('k4', 1, 1000, 2).allowed).toBe(true);
  });

  it('distinct keys do not interfere with each other', () => {
    const store = new RateLimitStore();
    store.check('a', 1, 1000, 0);
    store.check('a', 1, 1000, 1); // 'a' violated

    expect(store.check('b', 1, 1000, 1).allowed).toBe(true); // 'b' is unaffected
  });
});
