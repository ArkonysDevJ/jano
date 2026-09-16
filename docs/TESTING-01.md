# [DOC-ID: TESTING-01] -- Jano -- Testing & Verification Procedures

**Status:** Living document -- version 1.5, updated 2026-09-16.

**Domain:** Arkonys Product 2 -- local-first password vault
**Version:** 1.5
**Date:** 2026-09-16

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
- **Docker:** required only for section 5 onward (running the API
  against real persistence). The automated suites in section 3 need
  neither Docker nor a running database.

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

Coverage as of this version: 38/38 tests across 7 spec files:

| Spec file | Tests | Covers |
|---|---|---|
| `rate-limit.store.spec.ts` | 6 | Sliding-window limiter, bucket reset, per-key isolation |
| `auth.service.spec.ts` | 6 | Registration/login orchestration, single-use login state, and rejection of a structurally invalid `registrationRecord` at `registerFinish` |
| `sync.service.spec.ts` | 8 | Key-version reconciliation gate (§7), conflict-fork creation (§14) |
| `vault.service.spec.ts` | 4 | Blind CRUD over opaque ciphertext blobs |
| `vault-keys.service.spec.ts` | 4 | Independent master/recovery key versioning (§3) |
| `rotation.service.spec.ts` | 7 | Idempotent re-registration, Factor 2 challenge/response (§13), registrationRecord well-formedness guard |
| `cloudflare-opaque-server-provider.spec.ts` | 3 | Real OPAQUE round-trip, wrong-password rejection, and a clean `BadRequestException` for a malformed `registrationRequest` (see 3.3) |

All five persistence repositories (`postgres/*.repository.ts`) are
exercised through the service specs above via `new InMemory*Repository()`,
never through `PersistenceModule` -- see section 5.1 for why the real
Postgres path is verified live instead of by these specs.

### 3.2 `apps/desktop` (client engine)

```
npm run test --workspace=apps/desktop
```

Coverage as of this version: 64/64 tests across 18 spec files:

| Spec file | Tests | Covers |
|---|---|---|
| `key-manager.test.ts` | 2 | KEK/DEK unwrap-encrypt-decrypt lifecycle, memory zeroization on lock, tampered-ciphertext (auth-tag) rejection |
| `registration.test.ts` | 2 | Dual envelope (master + recovery KEK) unwrap to the same DEK; fresh salts/nonces per call |
| `vault-item.test.ts` | 3 | `VaultItemPlaintext` <-> `Bytes` JSON serialization round-trip (including optional fields), and the refuse-to-guess guard on an unrecognized `schemaVersion` |
| `rotation-state-machine.test.ts` | 4 | Offline `pending_opaque_rotation` record encryption, two-phase idempotent resume after a mid-process failure |
| `rotation-http-client.test.ts` | 4 | `HttpOpaqueRotationClient` against real OPAQUE crypto: Factor-1-only happy path (exact fetch calls/headers asserted), hardened-mode refusal (finish never called when a Factor 2 challenge is present), HTTP-error surfacing, and a `toBase64`/`fromBase64` round-trip |
| `indexeddb-pending-rotation-store.test.ts` | 5 | `IndexedDbPendingRotationStore`: null when empty, save/load round-trip, clear, cross-instance persistence (same key/db reopened), key isolation between instances |
| `reconnection.test.ts` | 1 | `reconnect()` is a no-op and never touches the network when nothing is pending |
| `reconnection.e2e.test.ts` | 2 | Full offline-rotation -> reconnect pipeline: real `IndexedDbPendingRotationStore` (fake IndexedDB) + real OPAQUE server round-trip -- happy path (record cleared only after the server confirms) and failure path (record stays in the store on server rejection) |
| `engine-client.test.ts` (`src/worker/__tests__/`) | 3 | `EngineClient` <-> `engine.worker.ts` over a REAL Web Worker (via `@vitest/web-worker`, not a mock of the message protocol): create-vault -> encrypt -> decrypt round-trip through the resident DEK -> `lock()` -> confirms the DEK is actually gone; unlock with the correct master password; rejection on the wrong one |
| `indexeddb-vault-account-store.test.ts` | 5 | `IndexedDbVaultAccountStore`: null when empty, save/load round-trip, clear, cross-instance persistence, key isolation between instances (same shape of coverage as the pending-rotation store, applied to the local unlock record) |
| `UnlockScreen.test.tsx` (`src/ui/__tests__/`) | 3 | `UnlockScreen` against a REAL `EngineClient`/Worker (only the local store is an in-memory fake): full create-vault -> recovery-kit-shown-once -> handed-off-working-client path; password-mismatch validation that never touches the engine; unlock with the wrong password followed by the correct one |
| `web-clipboard-adapter.test.ts` (`src/clipboard/__tests__/`) | 4 | `WebClipboardAdapter` against `navigator.clipboard`: pass-through writeText/readText, null-instead-of-throw on a refused read (e.g. no document focus), and clear() as an empty-string overwrite |
| `tauri-clipboard-adapter.test.ts` (`src/clipboard/__tests__/`) | 4 | `TauriClipboardAdapter` against a mocked `@tauri-apps/plugin-clipboard-manager` (no real Tauri IPC in Vitest): pass-through writeText/readText/clear, and null-instead-of-throw on a failed read |
| `schedule-clipboard-auto-clear.test.ts` (`src/clipboard/__tests__/`) | 6 | `scheduleClipboardAutoClear`'s copy-then-verify-before-clear decision, with fake timers: clears on a match, never clears on a mismatch or an unverifiable (`null`) read, doesn't fire early, arms the pending-clipboard-clear registry immediately (so an early flush still clears), and disarms it once its own timer has fired |
| `pending-clipboard-clear.test.ts` (`src/clipboard/__tests__/`) | 4 | The single-slot registry itself: no-op when nothing armed, runs and consumes the armed flush exactly once, a newer `arm()` replaces an older one, `disarm()` prevents a later flush from running anything |
| `clear-on-exit.test.ts` (`src/clipboard/__tests__/`) | 3 | `installClipboardClearOnExit` against mocked `@tauri-apps/api/core`/`window` (no real Tauri IPC in Vitest): installs nothing on Web (`isTauri()` false), a real close request flushes the pending clear BEFORE destroying the window (call order asserted, not just that both happened), and the window still gets destroyed when nothing was pending |
| `CredentialRevealView.test.tsx` (`src/ui/__tests__/`) | 4 | `CredentialRevealView` against a REAL `EngineClient`/Worker (only the `ClipboardAdapter` is a fake): real decrypt-on-reveal, DOM node destroyed on blur (not just hidden), auto-mask after the configured timeout, and copy writing the real password with a text confirmation carrying both a `[COPIED]` text glyph and a `data-copy-confirmed` attribute (the functional hook Fase 2 styles as a 1px->2px border) |
| `VaultStatusIndicator.test.tsx` (`src/ui/__tests__/`) | 5 | `VaultStatusIndicator` against injectable fakes for `PendingRotationStore` and `navigator.onLine`: each of the three DOCVIS-JANO-01 states in isolation, live reaction to `online`/`offline` window events, and that a pending rotation is never clobbered by a connectivity event |

These run against real Argon2id (`hash-wasm`), real WebCrypto, and (for
the OPAQUE-touching files) a real `@cloudflare/opaque-ts` client/server
pair -- not mocked -- so a pass here is a real cryptographic
verification, not just a control-flow check.

`opaque-client.ts` (the real `@cloudflare/opaque-ts` wrapper used for
registration/login and rotation on the desktop side) has NO dedicated
unit test file as of this version -- it is exercised indirectly through
`rotation-http-client.test.ts` and `reconnection.e2e.test.ts`'s
real-crypto paths, and through the live-server fixture script
(section 5.3). Treat those as this file's verification for now, not a
substitute for eventually adding a scripted test of its own.

### 3.3 What "real" means in these suites

Several specs are worth calling out because they do NOT mock the
cryptography they test, which is deliberate given OPAQUE's protocol
complexity -- a mocked round-trip would only prove the mock is
consistent with itself:

- `cloudflare-opaque-server-provider.ts` is exercised in
  `cloudflare-opaque-server-provider.spec.ts` against a REAL
  `OpaqueClient` and `OpaqueServer` from `@cloudflare/opaque-ts` --
  full registration + login, asserting both sides derive the same
  `sessionKey`, a wrong-password rejection case (see section 8's
  second invariant for exactly how that rejection surfaces), and a
  malformed-`registrationRequest` case asserting a clean
  `BadRequestException` instead of an uncaught crash.
- `registration.test.ts` and `rotation-state-machine.test.ts` (desktop)
  run real Argon2id and WebCrypto key wrapping/unwrapping.
- `rotation-http-client.test.ts` and `reconnection.e2e.test.ts`
  (desktop) run a real `OpaqueClient`/`OpaqueServer` pair in-process
  and only fake the network transport (`fetchImpl`) and, in the e2e
  file, IndexedDB itself -- everything either side of those two seams
  is the real implementation.

Everything else in the suites (`AuthService`'s control flow,
`RotationService`'s HMAC challenge/response, sync's conflict-fork
logic, vault-keys, rate limiting) is tested with a fake OPAQUE provider
or plain unit fixtures where the cryptographic backend itself isn't
the thing under test -- this keeps the suite fast without weakening
the specific tests that exist to catch a real cryptographic
regression.

### 3.4 Fase 1 (desktop UI) closeout status

Fase 1 (functional/memory-safe, unstyled, test-verified --
DOCVIS-JANO-01's companion checklist) is CLOSED as of this version.
Status per checklist item:

| # | Item | Status | Tests | Notes |
|---|---|---|---|---|
| 1 | Engine<->UI interface contract | Done | Enforced by the TypeScript type system (`Bytes = Uint8Array<ArrayBuffer>` at every `KeyManager`/`EngineClient` boundary -- a `string` there fails compilation) and exercised in practice by every `worker/__tests__/engine-client.test.ts` and `ui/__tests__/*.test.tsx` case, all of which cross real ciphertext/plaintext `Bytes` through the real Worker boundary | Pre-verified before any Fase 1 code was written -- `KeyManager.decryptItem()` already returned `Promise<Bytes>`, never `string` |
| 2 | Unlock screen | Done | `ui/__tests__/UnlockScreen.test.tsx` (3), `engine/__tests__/indexeddb-vault-account-store.test.ts` (5) | Confirmed live in the packaged Tauri window: create, recovery-kit-once, lock, re-unlock |
| 3 | Single-credential reveal/copy view | Done | `ui/__tests__/CredentialRevealView.test.tsx` (4), `clipboard/__tests__/*` (12) | Confirmed live: reveal, copy, manual 10s auto-mask, blur-destroys-node, native Tauri clipboard compiling and running |
| 4 | Telemetry log (optional this phase) | Deferred | -- | Explicit product decision (2026-09-16): deferred to a later optimization pass, per DOCVIS-JANO-01 section 3's own framing of this item as optional for Fase 1. Not started -- no code, no stub. |
| 5 | Fase 1 closeout | Done | This section + the audit below | -- |

**No Fase-1 component imports Fase-2 visual tokens.** Confirmed by
direct audit of `apps/desktop/src` (not assumed): no `.css`/`.scss`
files exist anywhere in the tree, no `className` or `style` props
appear in any component, no hex color literals, no `font-family`
declarations, and no styling library (`tailwind`, `styled-components`,
`emotion`, `sass`, `postcss`) is a dependency in `package.json`. Every
mention of "DOCVIS"/"Fase 2"/"token" in `src/ui`, `src/clipboard`,
`src/worker`, and `src/config.ts` is a code comment explicitly
documenting the deliberate ABSENCE of Fase-2 styling, not a real
import. Re-run to confirm on a later pass:

```
find src -iname "*.css" -o -iname "*.scss"
grep -rnE "className|style=|#[0-9a-fA-F]{3,8}|font-family" src
grep -iE "tailwind|styled-components|emotion|sass|postcss" package.json
```

All three should return nothing.

### 3.5 Fase 2 prerequisite functional additions (built before styling)

Fase 2's checklist (Tokens Esteticos) assumed two pieces of Fase 1
functionality that, on audit, had never actually been built: a vault
sync status indicator (checklist section 3) and a copy-confirmation
mechanism with a real state hook, not just text (part of checklist
section 4). Per explicit product decision (2026-09-16), both were
built as their own functional, tested work -- still unstyled, same
Fase 1 discipline -- BEFORE any Fase 2 visual token was applied.

- **`VaultStatusIndicator.tsx`** (new) -- computes exactly one of the
  three DOCVIS-JANO-01 text states (`NODE: SYNCHRONIZED`,
  `NODE: AUTONOMOUS (LOCAL DEK ACTIVE)`,
  `PENDING SYNC: N ATOMIC ROTATION`) from real signals: a
  `PendingRotationStore.load()` result (presence, not content -- the
  record is sealed under a KEK this component has no business
  holding) and `navigator.onLine` (injectable), re-evaluated live on
  `online`/`offline` window events. `N` is always `1` when a rotation
  is pending, not an arbitrary choice: `IndexedDbPendingRotationStore`
  is a deliberate single-slot design (its own header comment -- one
  outstanding rotation per device, by construction of section 13's
  state machine), so there is no real plural count to report yet.
- **`CredentialRevealView.tsx`'s copy confirmation** -- extended, not
  replaced: the confirmation `<p>` now also carries a
  `data-copy-confirmed` boolean attribute and a `[COPIED]` text glyph
  alongside the existing "Copied to clipboard." text. The attribute is
  the real functional hook Fase 2's checklist assumed already existed
  as a 1px->2px border change -- that border is a Fase-2 visual token
  applied on top of this attribute later, not built here.

Both were caught needing a follow-up fix after the first
`npm test` run reported them:

- `VaultStatusIndicator.test.tsx`'s own "reacts live to online/offline
  events" case had a bug in the TEST, not the component: its
  `isOnline` fake was a fixed `() => true`, which cannot observe a
  reaction to a dispatched `offline` event at all. Fixed by making the
  fake read a mutable variable the test flips before each dispatch.
- `UnlockScreen.test.tsx`'s pre-existing create-vault test started
  timing out under the heavier CPU load of 16 parallel test-worker
  processes each doing real Argon2id (`DEFAULT_ARGON2ID_PARAMS`: 64
  MiB, 3 iterations) -- not a logic regression (the captured DOM
  showed the correct in-progress "Unlocking vault..." state). Fixed by
  raising Testing Library's default `findBy*`/`waitFor` timeout
  globally, in a new `src/test-setup/testing-library-timeout.ts`
  (registered in `vitest.config.ts`'s `setupFiles`), rather than
  patching a one-off timeout onto individual slow assertions.

### 3.6 Fase 2 (Tokens Esteticos) status

Fase 2's approved design decision (2026-09-16): a single accent
(desaturated phosphor green, `#10b981`), a zinc/graphite base
(`#09090b` to `#121214`), one geometric-sans stack for human UI text
and one monospace stack exclusively for data crossing the engine's
`Uint8Array` contract -- all as CSS custom properties in
`src/ui/theme.css`, the first real stylesheet in this project
(imported once, in `src/main.tsx`). Applied via `className`/
`data-*` attribute only to `App.tsx`, `UnlockScreen.tsx`,
`CredentialRevealView.tsx`, and `VaultStatusIndicator.tsx` (also
wired into `App.tsx`'s authenticated view for the first time this
pass) -- no component's actual behavior changed for this styling
pass, confirmed by the full suite staying green across it
(section 3.2's 64/64) and live in the packaged Tauri window.

All colors verified against the real WCAG 2.x relative-luminance
formula (not eyeballed): text-primary 18.1:1, text-secondary 7.76:1,
text-danger 7.19:1, and the phosphor accent 7.84:1 -- all against the
base background, and all comfortably clearing AA's 4.5:1. The
copy-confirmation border color (`--color-border-emphasis`, zinc-500)
deliberately fails that same 4.5:1 threshold (4.12:1) -- it is never
used for text, only for a non-text border state, where it clears
WCAG 1.4.11's 3:1 non-text-contrast threshold instead.

The phosphor accent is applied via a `data-crypto-active="true"`
attribute components set for the exact duration of a real
cryptographic operation ONLY -- `UnlockScreen.tsx`'s submit button
while Argon2id derives the KEK, and `CredentialRevealView.tsx`'s
reveal button while the real decrypt call is in flight. Confirmed
live: the accent border/text appears on "Unlocking vault..." and
disappears the instant that resolves. `VaultStatusIndicator.tsx`
never carries the accent, in any of its three states -- a status
readout is not an active event, per the checklist's strict rule that
the accent is never decorative or informational.

Section 0's guards were verified by direct audit, not assumed:

```
grep -nE "transition|animation|@keyframes" src/ui/theme.css
```

The only matches are inside this file's own header comment
explaining their deliberate absence -- no actual CSS rule defines
either property. `CredentialRevealView.tsx`'s on-blur/auto-mask
destruction (section 3.5) is untouched by this pass -- still a plain
conditional render, never wrapped in a transition.

**Security hardening found during live Fase 2 verification, not
originally in the checklist:** testing the copy-then-auto-clear flow
live surfaced a real gap -- closing the app's window before
`CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS` (20s) elapsed left the credential
sitting in the OS clipboard with nothing left running to clear it.
Fixed with `src/clipboard/pending-clipboard-clear.ts` (a one-slot
registry of whatever clipboard auto-clear is currently armed) and
`src/clipboard/clear-on-exit.ts` (a Tauri `onCloseRequested` hook,
installed once from `main.tsx`, gated by `isTauri()` so Web installs
nothing): on a real close request, it flushes the pending clear
immediately, THEN allows the window to close. `scheduleClipboardAutoClear`
now arms/disarms this same registry around its own timer, sharing one
`verifyThenClearClipboard` implementation rather than two copies of
the copy-then-verify-before-clear rule. Confirmed live on André's
machine: copy a credential, close the window before 20s, the
clipboard no longer holds it. Required adding
`"core:window:allow-destroy"` and `"core:window:allow-close"` to
`src-tauri/capabilities/default.json` -- `core:default` alone did not
grant the JS-side `window.destroy()` call used to actually let the
window close after the flush.

Stated limit, not glossed over: this covers only a graceful
window-close request. A force-kill, a crash, or a power loss cannot
run any userspace cleanup code -- true of this app and of every other
clipboard-based password manager, not a gap specific to this
implementation. Keeping a background process alive past window close
to wait out the remainder of the 20s was considered and rejected: it
does not cover that same force-kill/crash floor either, while adding
a real cost (a process that visibly outlives the closed window is
exactly what a security-conscious user or auditor flags as
suspicious on a password manager).

## 4. Environment setup (required before any live/manual test)

Automated tests (section 3) do not need a running server, `.env`, or
Docker -- they either use in-memory fakes or construct their subject
directly. Everything from section 5 onward (running the API, the Bruno
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
4. Start Postgres, from the repo root:
   ```
   docker compose up -d
   ```
   This uses the credentials and port already set in
   `apps/api/.env.example`'s `DATABASE_URL` (`localhost:55432`, not
   Postgres's default `5432` -- see `docker-compose.yml`'s comment on
   why the host port is deliberately non-default). `docs/schema.sql`
   is applied automatically the first time the container's data
   volume is created.

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

Persistence is real PostgreSQL (`persistence/postgres/*`, wired
through `PersistenceModule` via a single shared `pg` Pool --
`PgPoolManager`). Data now survives a server restart: `Ctrl+C` and
re-running `npm run dev:api` does NOT wipe users, devices, vault
items, or vault keys.

To actually reset the data (e.g. to clear out test registrations),
stop the container and drop its volume:

```
docker compose down -v
```

then `docker compose up -d` again to get a fresh, empty database with
`docs/schema.sql` freshly applied. Do **not** reach for this as a
routine step -- `docker compose down` (no `-v`) or `docker compose
stop` both stop the container while keeping the named volume intact,
which is almost always what you actually want between sessions. Editing
`docs/schema.sql` after the volume already exists does not re-apply
it either way; that also needs the `-v` reset (or a hand-applied `psql`
diff once real migrations exist).

### 5.2 Why `/auth/*` can't be tested directly from Bruno

`AuthModule` binds the real `CloudflareOpaqueServerProvider`. The four
`/auth/*` endpoints expect request bodies that are the OUTPUT of real
OPAQUE protocol math (OPRF blinding, envelope creation/recovery) run
by an actual `OpaqueClient` -- there is no way to hand-craft those
bytes from inside a Bruno request body. A hand-crafted or placeholder
body (e.g. pasting the literal example text from a `.bru` file) is now
rejected as a clean `400 Bad Request` rather than crashing the server
with a `500` -- see the `04-rotation/start` entry in section 6.2 and
the 2026-09-15 entry in section 9.

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

Re-run this script with a fresh, not-previously-used email if you get
"Cannot complete registration" -- with real Postgres persistence, that
email already exists from a previous run and stays registered across
server restarts (it is no longer cleared just by restarting the
server; see section 5.1). A timestamp-suffixed email
(e.g. `bruno-fixture-<timestamp>@example.com`) is the simplest way to
get a guaranteed-fresh one for a throwaway run.  `sessionToken` expires
15 minutes after issuance (`refreshToken` after 30 days) -- re-run the
script for a fresh session token if a manual testing session runs
long.

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
  needs no signature). Its `docs{}` block explicitly warns that the
  request body must be a `registrationRequest` produced by a real
  `OpaqueClient`, exactly like initial registration -- a hand-crafted
  or placeholder body now gets a clean `400 Bad Request`
  ("registrationRequest is not well-formed OPAQUE protocol data")
  instead of crashing the server (see section 9, 2026-09-15). `finish`,
  as shipped, assumes Factor 1 only -- see that request's own `docs{}`
  block for how to add a Factor 2 `continuitySignature` by hand
  (computing the real HMAC needs the client's `continuitySecret`,
  which this collection does not persist).

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

- **Persistence is real PostgreSQL, but only one environment's worth.**
  `docker-compose.yml` runs a single local `postgres:16-alpine`
  container with one named volume -- there is no migration tool yet
  (`docs/schema.sql` is applied once, on first container start, by
  Postgres's own init-script mechanism), so schema changes during
  local development require `docker compose down -v` (section 5.1),
  not an incremental migration.
- **`apps/api` is a native ESM package** (`"type": "module"` in its
  `package.json`) because `@nestjs/common`/`core`/`platform-fastify`
  at the installed major version ship ESM-only, with no CommonJS
  build. Every relative import in `apps/api/src/` carries an explicit
  `.js` extension as a result (required by
  `moduleResolution: "node16"` once the package is real ESM) -- this
  is intentional and matches how TypeScript's Node16/NodeNext
  resolution mode works, not an inconsistency to "clean up".
- **Rate limiting is in-memory and per-process**
  (`rate-limit.store.ts`) -- restarting the server resets rate limit
  counters even though vault/auth data itself now persists in
  Postgres. This is a separate, still-open gap, not an oversight
  carried over from before persistence was real.
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
  password, or note (`vault/dto/*.dto.ts`, `persistence/entities.ts`,
  `docs/schema.sql`).
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
- **Malformed OPAQUE protocol bytes never reach an uncaught 500.**
  `CloudflareOpaqueServerProvider.createRegistrationResponse` wraps
  its deserialization/evaluation call in a try/catch and re-throws as
  `BadRequestException` -- confirm no other entry point into
  `@cloudflare/voprf-ts`/`@cloudflare/opaque-ts` deserialization was
  added later without the same guard.
- **Fase 1 UI carries no Fase-2 aesthetic tokens.** DOCVIS-JANO-01's
  build sequence requires Fase 1 (functional) and Fase 2 (visual) to
  stay separable -- no `.css`/`.scss` file, `className`/`style` prop,
  hex color literal, `font-family` declaration, or styling library
  dependency should exist under `apps/desktop/src` while Fase 1 is the
  active phase (see section 3.4 for the exact commands and the
  confirmed-clean result as of this version). Re-run those commands
  before trusting that this still holds on a later pass -- Fase 2 work
  landing in the same files is exactly the failure mode this invariant
  catches.

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
| 2026-09-12 | Manual review | Persistence was in-memory only; a server restart wiped all data, with no real-database story to audit. | Added real PostgreSQL persistence: `docker-compose.yml` (local `postgres:16-alpine`), `docs/schema.sql`, `PgPoolManager`, and five `Postgres*Repository` classes wired through `PersistenceModule`, with `InMemory*Repository` kept only as the test double the specs already used directly. |
| 2026-09-14 | `docker compose up -d` | A native/other Postgres already listening on the host's `5432` silently won the connection ahead of the `jano-postgres` container -- same host, same port, two listeners -- with `docker compose ps` still reporting the container "healthy", so the collision was invisible there; surfaced only as a `28P01 password authentication failed` from the app. | Remapped the container's host-side port to `55432` in `docker-compose.yml` and `apps/api/.env.example`'s `DATABASE_URL`, documented the reasoning inline in both files. |
| 2026-09-15 | Bruno, `04-rotation/start` | Sending a hand-crafted/placeholder body (not real OPAQUE-client output) to `/auth/rotate/start` crashed several frames deep inside `@cloudflare/voprf-ts`'s `Group.deserialize` with an uncaught exception, surfacing as an opaque, unhelpful HTTP `500`. | Wrapped `CloudflareOpaqueServerProvider.createRegistrationResponse`'s deserialization/evaluation call in a try/catch, re-thrown as a clean `BadRequestException` (HTTP 400); documented the real-client-body requirement directly in `04-rotation/start`'s `docs{}` block. |
| 2026-09-15/16 | `npm run test:desktop` | The desktop reconnection path (state machine -> real HTTP -> a persisted pending-rotation record) had no wiring or storage adapter yet. | Added `rotation-http-client.ts` (fetch-based `OpaqueRotationClient`), `indexeddb-pending-rotation-store.ts` (IndexedDB-backed `PendingRotationStore`, chosen over the OS keychain per §13's "same trust perimeter as the vault" reasoning, and over native SQLite to stay dependency-free on both the Vercel web demo and Tauri desktop), and `reconnection.ts` composing both against the state machine -- closed with `reconnection.e2e.test.ts`'s full real-crypto round-trip. |
| 2026-09-16 | `npm run test --workspace=apps/api` / `npm run test:desktop`, run on André's machine | -- | Confirmed 38/38 (`apps/api`) and 23/23 (`apps/desktop`) passing against the real Vitest CLI and real dependencies, matching this document's section 3 tables exactly -- the sandbox used to build this suite could not run the real Vitest CLI itself (missing native `rolldown` binding), so this run is the suite's first confirmation on real tooling. |
| 2026-09-16 | `npm test --workspace=apps/desktop`, run on André's machine | -- | Confirmed 26/26 in `apps/desktop` passing (up from 23/23) after adding `src/worker/`'s engine Worker + hand-rolled `postMessage` RPC (section 9's DEK-isolation requirement) and its 3-test real-worker integration spec (`@vitest/web-worker`, not a mock of the message protocol). `apps/api`'s 38/38 unaffected -- combined total now 64/64. |
| 2026-09-16 | `npm test --workspace=apps/desktop`, run on André's machine | -- | Confirmed 34/34 in `apps/desktop` passing (up from 26/26) after adding Fase 1 checklist item 2's unlock screen (`src/ui/UnlockScreen.tsx`) and its local persistence adapter (`src/engine/indexeddb-vault-account-store.ts`): 5 new store tests, 3 new component tests against a real `EngineClient`/Worker. First run caught a real test-file bug (not an app bug): `@testing-library/react`'s auto-cleanup never registered because this repo keeps `test.globals: false`, so renders leaked across tests within the same file -- fixed with an explicit `afterEach(cleanup)`. `apps/api`'s 38/38 unaffected -- combined total now 72/72. |
| 2026-09-16 | `npm test --workspace=apps/desktop`, run on André's machine | -- | Confirmed 50/50 in `apps/desktop` passing (up from 34/34) after adding Fase 1 checklist item 3's credential reveal/copy view (`src/ui/CredentialRevealView.tsx`), the Web/Tauri `ClipboardAdapter` pair (`src/clipboard/`), and the native `tauri-plugin-clipboard-manager` (`src-tauri/Cargo.toml` + `lib.rs` + `capabilities/default.json`) -- confirmed compiling clean and working live (reveal, copy, manual 10s auto-mask, blur-destroys-node) in the packaged Tauri window, not just under test. First test run caught a real test-file bug (not an app bug): mixing `vi.useFakeTimers()` with Testing Library's polling-based `findBy*`/`waitFor` did not reliably fire an already-scheduled `setTimeout` on manual advance -- fixed by making the component's auto-mask timeout an injectable prop (default `UI_AUTO_MASK_TIMEOUT_MS`) and using a short REAL timeout in that one test instead. `apps/api`'s 38/38 unaffected -- combined total now 88/88. |
| 2026-09-16 | `npm test --workspace=apps/desktop` and `npm test --workspace=apps/api`, both run on André's machine | -- | Confirmed 55/55 in `apps/desktop` passing (up from 50/50) after adding the two Fase-2-prerequisite functional pieces (section 3.5): `VaultStatusIndicator.tsx` (+5 tests) and the `data-copy-confirmed`/`[COPIED]` extension to `CredentialRevealView.tsx`'s copy confirmation (same 4 tests, extended assertion). First run of the new suite caught two real bugs, both fixed and reconfirmed green: (1) `VaultStatusIndicator.test.tsx`'s own connectivity-reaction test used a fixed `isOnline` fake that could never observe a dispatched `offline` event -- a test bug, not a component bug; (2) `UnlockScreen.test.tsx`'s pre-existing create-vault test timed out under the added CPU contention of 16 parallel real-Argon2id test workers -- fixed by raising Testing Library's default async-utility timeout globally (`src/test-setup/testing-library-timeout.ts`) rather than the component having an actual defect. `apps/api`'s 38/38 unaffected -- combined total now 93/93. |
| 2026-09-16 | `npm test --workspace=apps/desktop`, live manual verification in the packaged Tauri window on André's machine | -- | Confirmed 64/64 in `apps/desktop` passing (up from 55/55) after Fase 2's palette/typography tokens (`src/ui/theme.css`, section 3.6) and the clipboard-clear-on-exit security hardening (`src/clipboard/pending-clipboard-clear.ts` + `clear-on-exit.ts`, +7 tests). Live verification, not just automated: the phosphor accent confirmed appearing only during `data-crypto-active` (real KEK derivation / decrypt), never as decoration; `VaultStatusIndicator` and the copy-confirmation border confirmed rendering correctly; and the clipboard-clear-on-exit fix confirmed end to end -- copied a credential, closed the window before the 20s auto-clear, clipboard no longer held it. One real environment-load flake hit along the way and fixed: `reconnection.e2e.test.ts` (chains 3 real Argon2id derivations plus real OPAQUE math in one test) exceeded Vitest's own 5000ms default `testTimeout` once the suite grew to 18 parallel workers -- fixed by raising `testTimeout` to 20000ms globally in `vitest.config.ts`, same fix philosophy as the Testing Library timeout entry above. `apps/api`'s 38/38 unaffected -- combined total now 102/102. |
| 2026-09-16 | Direct audit of `apps/desktop/src` (checklist item 5, Fase 1 closeout) -- `find`/`grep` commands in section 3.4, run against the real repo, not assumed | -- | Confirmed clean: no `.css`/`.scss` files, no `className`/`style` props, no hex color literals, no `font-family` declarations, no styling-library dependency in `package.json`. Every "DOCVIS"/"Fase 2"/"token" mention in the audited files is a comment documenting the deliberate absence, not a real import. Fase 1 checklist item 4 (telemetry log) formally deferred to a later optimization pass per André's explicit decision -- not started, no stub. Fase 1 is CLOSED as of this entry; Fase 2 (visual tokens, DOCVIS-JANO-01) is next. |
