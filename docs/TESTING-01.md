# [DOC-ID: TESTING-01] -- Jano -- Testing & Verification Procedures

**Status:** Living document -- version 1.1, opened 2026-09-12.

**Domain:** Arkonys Product 2 -- local-first password vault
**Version:** 1.1
**Date:** 2026-09-12

## 1. Purpose and audience

This document is the procedural base for verifying Jano's backend
(`apps/api`) and desktop engine (`apps/desktop`): what test suites
exist, the exact commands to run them, how to exercise the API live
with real OPAQUE cryptography, how the Bruno collection is organized
and operated, and what invariants an auditor should check the code
against. It is written so that an audit -- internal or external -- can
reproduce every verification step described here without needing prior
context on how the suites were built.

It does NOT cover architecture or design rationale (see
`ARCHITECTURE-01.md`) or governance process. It also does not narrate
the development history of any given feature -- it describes the
CURRENT verification procedure, kept up to date as the procedure
itself changes. Section 9 is the exception: a short, append-only log
of verification-relevant findings, kept for audit traceability rather
than narrative interest.

## 2. Prerequisites and installation

- **Node.js:** `v22` (pinned in the repo root's `.node-version`).
- **Package manager:** `npm` workspaces (root `package.json` declares
  `apps/*` as workspaces -- there is no separate per-app install step).

From the repo root:

```
npm install
```

## 3. Test suites

Jano has two independently runnable automated test suites, one per
workspace. Both use Vitest.

### 3.1 `apps/api` (backend)

```
npm run test --workspace=apps/api
```

Or, from inside `apps/api`:

```
cd apps/api
npm test
```

Watch mode: `npm run test:watch --workspace=apps/api`.

Coverage as of this version: 35/35 tests across 7 spec files:

| Spec file | Tests | Covers |
|---|---|---|
| `rate-limit.store.spec.ts` | 6 | Sliding-window limiter, bucket reset, per-key isolation |
| `auth.service.spec.ts` | 5 | Registration/login orchestration, single-use login state |
| `sync.service.spec.ts` | 8 | Key-version reconciliation gate (§7), conflict-fork creation (§14) |
| `vault.service.spec.ts` | 4 | Blind CRUD over opaque ciphertext blobs |
| `vault-keys.service.spec.ts` | 4 | Independent master/recovery key versioning (§3) |
| `rotation.service.spec.ts` | 6 | Idempotent re-registration, Factor 2 challenge/response (§13) |
| `cloudflare-opaque-server-provider.spec.ts` | 2 | Real OPAQUE round-trip, see 3.3 |

### 3.2 `apps/desktop` (client engine)

```
npm run test --workspace=apps/desktop
```

Coverage as of this version: 8/8 tests across 3 spec files:

| Spec file | Tests | Covers |
|---|---|---|
| `key-manager.test.ts` | 2 | KEK/DEK unwrap-encrypt-decrypt lifecycle, memory zeroization on lock, tampered-ciphertext (auth-tag) rejection |
| `registration.test.ts` | 2 | Dual envelope (master + recovery KEK) unwrap to the same DEK; fresh salts/nonces per call |
| `rotation-state-machine.test.ts` | 4 | Offline `pending_opaque_rotation` record encryption, two-phase idempotent resume after a mid-process failure |

These run against real Argon2id (`hash-wasm`) and real WebCrypto -- not
mocked -- so a pass here is a real cryptographic verification, not
just a control-flow check.

`opaque-client.ts` (the real `@cloudflare/opaque-ts` wrapper used for
registration/login on the desktop side) has NO dedicated unit test as
of this version -- it needs a live server round-trip to verify
meaningfully, which is exactly what section 5.3's fixture script
provides. Treat a successful fixture-script run as this file's
verification, not a substitute for eventually adding a scripted test
once the desktop app has a concrete HTTP layer to call it through.

### 3.3 What "real" means in these suites

Two specs are worth calling out because they do NOT mock the
cryptography they test, which is deliberate given OPAQUE's protocol
complexity -- a mocked round-trip would only prove the mock is
consistent with itself:

- `cloudflare-opaque-server-provider.ts` is exercised in
  `cloudflare-opaque-server-provider.spec.ts` against a REAL
  `OpaqueClient` and `OpaqueServer` from `@cloudflare/opaque-ts` --
  full registration + login, asserting both sides derive the same
  `sessionKey`, plus a wrong-password rejection case (see section 8's
  second invariant for exactly how that rejection surfaces).
- `registration.test.ts` and `rotation-state-machine.test.ts` (desktop)
  run real Argon2id and WebCrypto key wrapping/unwrapping.

Everything else in the suites (`AuthService`'s control flow,
`RotationService`'s HMAC challenge/response, sync's conflict-fork
logic, vault-keys, rate limiting) is tested with a fake OPAQUE provider
or plain unit fixtures where the cryptographic backend itself isn't
the thing under test -- this keeps the suite fast without weakening
the specific tests that exist to catch a real cryptographic
regression.

## 4. Environment setup (required before any live/manual test)

Automated tests (section 3) do not need a running server or `.env` --
they either use in-memory fakes or construct their subject directly.
Everything from section 5 onward (running the API, the Bruno
collection) does.

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Set `JWT_SECRET` to a real secret, generated per environment --
   never reuse the example value:
   ```
   openssl rand -base64 48
   ```
3. Generate the OPAQUE server's lifetime secrets, ONCE per environment:
   ```
   node apps/api/scripts/generate-opaque-server-secrets.mjs
   ```
   Paste its three printed lines (`OPAQUE_OPRF_SEED_B64`,
   `OPAQUE_AKE_PRIVATE_KEY_B64`, `OPAQUE_AKE_PUBLIC_KEY_B64`) into
   `apps/api/.env`.

   **Do not re-run step 3 against an environment that already has
   real registrations** -- regenerating these secrets invalidates
   every existing OPAQUE registration at once (see the comment in
   `cloudflare-opaque-server-provider.ts` for why). This is a one-time
   setup step per environment, not a startup or maintenance script.

`.env` is loaded automatically by `apps/api/src/main.ts`
(`import 'dotenv/config'` as its first line) -- no manual `export` is
needed in the shell.

## 5. Running the API and exercising it live

### 5.1 Start the server

```
npm run dev:api
```

(equivalent to `npm run start:dev --workspace=apps/api`, i.e.
`nest start --watch`). Watches `.ts` files and recompiles on change --
it does NOT watch `.env`; changing `.env` requires a manual restart
(`Ctrl+C`, then re-run the command).

Confirm the server is actually up before debugging anything else:

```
curl http://localhost:3000/health
```

Expected response: `{"status":"ok","service":"jano-api"}`.

Persistence is in-memory (see `persistence/persistence.module.ts`) --
there is no database wired yet, and every server restart wipes all
users, devices, vault items, and vault keys. There is nothing to
"reset" beyond restarting the server.

### 5.2 Why `/auth/*` can't be tested directly from Bruno

`AuthModule` binds the real `CloudflareOpaqueServerProvider`. The four
`/auth/*` endpoints expect request bodies that are the OUTPUT of real
OPAQUE protocol math (OPRF blinding, envelope creation/recovery) run
by an actual `OpaqueClient` -- there is no way to hand-craft those
bytes from inside a Bruno request body.

### 5.3 The fixture script

```
node apps/api/scripts/opaque-bruno-fixture.mjs [email] [password] [deviceLabel]
```

Defaults: `bruno-fixture@example.com` / `a-test-password-not-real` /
`bruno-fixture-device`. Override the API base with the `API_BASE_URL`
env var (default `http://localhost:3000`).

Runs a full registration + login against the RUNNING server using the
same `@cloudflare/opaque-ts` client library the server depends on, then
prints:

```
userId=...
deviceId=...
sessionToken=...
refreshToken=...
```

Paste those four values into the Bruno **local** environment (see
section 6). Every other endpoint (vault items, vault-keys, sync,
rotation) is plain JSON plus a Bearer token from there on -- no OPAQUE
math needed, which is what makes them runnable directly in Bruno.

Re-run this script with a fresh email if you get "Cannot complete
registration" -- that email already exists on the currently-running,
in-memory server. `sessionToken` expires 15 minutes after issuance
(`refreshToken` after 30 days) -- re-run the script for a fresh session
token if a manual testing session runs long.

## 6. The Bruno collection

Location: `apps/api/bruno/`. Open that folder as a collection in
Bruno; select the **local** environment before running anything.

### 6.1 Layout and numbering

Numbered for audit/portfolio readability, in the order they are meant
to be run:

```
00-health -> 01-vault-keys -> 02-vault -> 03-sync -> 04-rotation
```

with the OPAQUE-only `auth` requests kept separate (shown as
**reference-auth**, sequence 99) since they cannot be run directly
(section 5.2).

Implementation note for anyone editing this collection: Bruno's
sidebar displays each folder's `name` field, set in that folder's own
`folder.bru` -- independent of the folder's actual name on disk. The
physical directories are `health/`, `vault-keys/`, `vault-items/`,
`sync/`, `rotation/`, `auth/`; only the displayed names carry the
numbering. Keep this in mind before assuming a directory rename is
needed to reorder the sidebar -- editing `folder.bru`'s `name` field is
enough, and `seq` in the same file controls sidebar order directly.

### 6.2 Folder-by-folder

- **`health/` (00-health)** -- `liveness`: plain `GET /health`, no
  auth. Run first to confirm the server is actually up.
- **`auth/` (reference-auth, not run directly)** -- the four OPAQUE
  endpoints, kept for reading the expected request/response shapes.
  `register-finish` documents the optional `continuitySecret` field --
  add it (any base64 string) when registering via the fixture script
  to opt an account into hardened mode before exercising
  `04-rotation`'s Factor 2 path (the fixture script itself does not
  set it; add it by hand if you need a hardened-mode account, or edit
  the fixture script's `register/finish` call).
- **`vault-keys/` (01-vault-keys)** -- registers the master and
  recovery DEK wrappings at `keyVersion: 1`. Run BOTH `upsert-*`
  requests before touching `03-sync` -- `SyncService`'s reconciliation
  gate returns 404 ("no master vault key registered for this user
  yet") otherwise.
- **`vault-items/` (02-vault)** -- `create` runs first and captures the
  new item's `id` into the `itemId` environment variable via a
  post-response script, so `get`/`update` work immediately after
  without manual copy-pasting. `ciphertext` fields are base64 of
  arbitrary bytes throughout this collection -- the server never
  inspects vault content (zero-knowledge by design), so any bytes
  exercise the endpoint correctly.
- **`sync/` (03-sync)** -- `push` (omit `itemId` to create; supply one
  from `02-vault` with a stale `lastSeenItemVersion` to exercise the
  conflict-fork path) and `pull`. Both requests carry `masterKeyVersion`
  as a JSON body field (`push`) or query string parameter (`pull`) --
  it is application data, not an HTTP header.
- **`rotation/` (04-rotation)** -- `start` captures
  `continuityChallenge` into the environment (present only if the
  account has hardened mode enabled; otherwise empty, and `finish`
  needs no signature). `finish`, as shipped, assumes Factor 1 only --
  see that request's own `docs{}` block for how to add a Factor 2
  `continuitySignature` by hand (computing the real HMAC needs the
  client's `continuitySecret`, which this collection does not
  persist).

### 6.3 Environment variables (`environments/local.bru`)

| Variable | Set by |
|---|---|
| `baseUrl` | Fixed, points at the local dev server |
| `email`, `userId`, `deviceId`, `sessionToken`, `refreshToken` | Pasted by hand from the fixture script (section 5.3) |
| `itemId` | Captured automatically by `02-vault/create`'s post-response script |
| `continuityChallenge` | Captured automatically by `04-rotation/start`'s post-response script |

## 7. Known limitations and operational notes

These are standing facts about the current verification setup, kept
here so an auditor does not mistake them for defects:

- **No database yet.** All persistence is in-memory
  (`persistence/in-memory/*`). Every server restart is a full data
  wipe. There is currently no migration or seed-data story to audit
  because there is no database.
- **`apps/api` is a native ESM package** (`"type": "module"` in its
  `package.json`) because `@nestjs/common`/`core`/`platform-fastify`
  at the installed major version ship ESM-only, with no CommonJS
  build. Every relative import in `apps/api/src/` carries an explicit
  `.js` extension as a result (required by
  `moduleResolution: "node16"` once the package is real ESM) -- this
  is intentional and matches how TypeScript's Node16/NodeNext
  resolution mode works, not an inconsistency to "clean up".
- **Rate limiting is in-memory and per-process**
  (`rate-limit.store.ts`) -- restarting the server also resets rate
  limit counters. This is consistent with the rest of the current
  persistence story, not a separate gap.
- **Hardened-mode (OPAQUE rotation Factor 2) uses a shared HMAC
  secret**, explicitly documented in `rotation.service.ts` as a
  provisional measure with a migration path to an asymmetric
  signature once the desktop engine's key format is finalized. See
  that file's header comment for the full reasoning -- it is not
  reproduced here since it belongs to design rationale, not test
  procedure.

## 8. Architectural invariants for auditors

Beyond passing tests, an auditor evaluating this codebase should
confirm these properties hold directly in the code -- each one is a
core claim of the architecture, not an implementation detail:

- **No plaintext in transit or storage.** `vault_items` accepts and
  returns exclusively ciphertext (base64-encoded bytes) plus version
  metadata (`dekVersion`, `itemVersion`, `conflictOf`). There is no
  field anywhere in the schema or DTOs for a plaintext username,
  password, or note (`vault/dto/*.dto.ts`, `persistence/entities.ts`).
- **Client-side envelope recovery, not a server-side password check.**
  A wrong password never reaches the server as a distinguishable
  signal: `OpaqueClient.authFinish()` resolves with an `EnvelopeRecoveryError`
  instance (it does not throw or reject the promise -- see the
  established call-shape notes in
  `cloudflare-opaque-server-provider.spec.ts`) when the client-side
  envelope recovery fails, entirely before any `KE3` message would be
  sent. Verify that calling code checks `result instanceof Error`
  rather than assuming success.
- **Key-version reconciliation gate.** `SyncService` rejects a push or
  pull carrying a `masterKeyVersion` that is behind the vault's active
  version with `ConflictException` (HTTP 409) --
  `sync.service.ts`'s `NotFoundException`/`ConflictException` throws
  are the two gate outcomes to check, not a generic error.
- **Conflict forking, not last-write-wins.** A push with a stale
  `lastSeenItemVersion` produces a NEW record with `conflictOf` set to
  the original item's id (`sync.service.spec.ts`'s conflict-fork test
  is the executable specification of this). Confirm no code path
  silently overwrites a divergent item.
- **Single DEK per vault.** Exactly one active DEK is wrapped and
  stored per vault, versioned via `keyVersion` in `vault_keys` --
  individual vault items reference a `dekVersion`, they do not each
  wrap their own key (`vault-keys.service.ts`, section 3 of
  `ARCHITECTURE-01.md`).

## 9. Verification findings log

Append-only. Each entry is a real, reproducible finding surfaced
specifically through the procedures in this document -- kept for audit
traceability, not as a development narrative (that lives in project
handoff notes, outside this repo). Entries are terse by design.

| Date | Found via | Finding | Resolution |
|---|---|---|---|
| 2026-09-12 | `npm run dev:api` | `apps/api/tsconfig.json` had no `include`/`exclude`; TypeScript's default `**/*` include pulled in the sibling `vitest.config.mts`, violating `rootDir: "./src"` (`TS6059`). | Added `"include": ["src/**/*"]` to `tsconfig.json`. |
| 2026-09-12 | `npm run dev:api` | `@nestjs/common`/`core`/`platform-fastify` at the installed version are ESM-only; `apps/api` was still an implicit CommonJS package, so every `@nestjs/*` import failed (`TS1479`). | Added `"type": "module"` to `apps/api/package.json`; added explicit `.js` extensions to every relative import across `apps/api/src/` (required by `moduleResolution: "node16"` under real ESM). |
| 2026-09-12 | `npm run dev:api` | `RotationService` injects `OPAQUE_SERVER_PROVIDER` via `AuthModule`, but `AuthModule` did not export it -- `UnknownDependenciesException` at boot. | Added `OPAQUE_SERVER_PROVIDER` to `AuthModule`'s `exports`. |
| 2026-09-12 | `npm run dev:api` | `TokenService.sign()`'s `expiresIn: string` parameter no longer satisfied the installed `@types/jsonwebtoken`'s narrower `SignOptions['expiresIn']` type (`TS2769`). | Typed the parameter as `SignOptions['expiresIn']` instead of `string`. |
| 2026-09-12 | `opaque-bruno-fixture.mjs` | `/auth/register/start` returned a generic HTTP 500 -- `OPAQUE_OPRF_SEED_B64`/`OPAQUE_AKE_*_B64` were still blank in `.env` (step 3 of section 4 had not been run yet). | Operational, not a code fix -- ran `generate-opaque-server-secrets.mjs`, populated `.env`, restarted the server. |
| 2026-09-12 | `opaque-bruno-fixture.mjs` | -- | First full real OPAQUE round-trip (registration + login) confirmed end-to-end against the live server, producing valid session/refresh tokens. |
