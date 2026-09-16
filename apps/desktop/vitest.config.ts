/**
 * Separate from vite.config.ts on purpose: `@vitest/web-worker`
 * (setupFiles below) only matters to the test run -- it patches the
 * global `Worker` so engine-client.test.ts can spin up a REAL
 * engine.worker.ts inside Vitest, instead of asserting against a
 * hand-written mock of the message protocol. Doesn't need JSDom
 * (per its own docs) -- it simulates the Worker in the same thread.
 * `environment: 'node'` matches every other spec file in this folder:
 * Node's global WebCrypto/TextEncoder are enough, same as the
 * pure-crypto engine tests -- no DOM emulation needed here either.
 *
 * `src/test-setup/testing-library-timeout.ts` raises Testing
 * Library's default async-utility timeout -- see that file's own
 * header comment for why (real Argon2id under parallel test-worker
 * CPU contention, not a logic bug).
 *
 * `testTimeout` below raises Vitest's OWN per-test timeout for the
 * same underlying reason, but a different mechanism: some specs
 * (`reconnection.e2e.test.ts` in particular) chain multiple real
 * Argon2id derivations (create vault, offline rotation, reconnect)
 * plus real OPAQUE math in a single test, awaited serially. Under
 * enough parallel test-worker CPU contention that legitimately
 * exceeds Vitest's 5000ms default even though nothing is broken --
 * confirmed happening once this suite grew past ~17 files (see
 * docs/TESTING-01.md's changelog for that entry). Same fix
 * philosophy as the Testing Library timeout above: raise the default
 * once, rather than re-discovering this flake in the next new spec
 * file that also happens to chain real KDF calls under load.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['@vitest/web-worker', './src/test-setup/testing-library-timeout.ts'],
    testTimeout: 20_000,
  },
});
