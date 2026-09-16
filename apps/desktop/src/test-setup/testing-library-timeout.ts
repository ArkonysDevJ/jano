/**
 * Raises Testing Library's default async-utility timeout
 * (`findBy*`/`waitFor`, default 1000ms) for this project's whole test
 * run.
 *
 * Several spec files run against a REAL `EngineClient`/Worker doing
 * REAL Argon2id (`DEFAULT_ARGON2ID_PARAMS`: 64 MiB, 3 iterations --
 * see engine/kek.ts) rather than a mocked/fast KDF, by this project's
 * own deliberate choice (see those files' own header comments: real
 * crypto end-to-end, not a mock of the protocol). With enough spec
 * files running in parallel workers (each spawning its own real
 * hashing), that CPU contention alone can push a single Argon2id call
 * past 1000ms even though nothing is actually broken -- confirmed
 * happening on UnlockScreen.test.tsx's create-vault test once the
 * suite grew past ~15 files (see docs/TESTING-01.md's changelog for
 * that entry). Bumping the default here, once, is more robust than
 * patching a `{ timeout }` option onto every individual slow
 * assertion and re-discovering this same flake in the next new spec
 * file that also happens to hit real Argon2id under load.
 */
import { configure } from '@testing-library/dom';

configure({ asyncUtilTimeout: 5000 });
