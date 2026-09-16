# Jano API -- Bruno collection

Manual, runnable exercise of every endpoint built so far (auth, vault
items, vault-keys, sync, rotation). This does NOT replace the real
unit-test suite (`npm run test --workspace=apps/api`) -- it exercises
the HTTP layer (DTO validation, guards, status codes) end-to-end against
a running server, the way a real client eventually would.

## Before you start

1. Persistence is IN-MEMORY (no database wired yet -- see
   `persistence/persistence.module.ts`). Every server restart wipes all
   users, items and keys. There is nothing to "reset" beyond restarting
   the server.
2. Start the server: `npm run start:dev --workspace=apps/api`, with a
   real `.env` (`JWT_SECRET`, and the three `OPAQUE_*` vars from
   `node apps/api/scripts/generate-opaque-server-secrets.mjs` -- see
   `.env.example`).
3. Open this folder (`apps/api/bruno`) as a collection in Bruno, select
   the **local** environment.

## Why /auth/register and /auth/login aren't plain Bruno requests

`auth.module.ts` binds the REAL `CloudflareOpaqueServerProvider`, not
the fake. Those four endpoints expect bytes that are the output of real
OPAQUE protocol math (OPRF blinding, envelope creation/recovery) run by
an actual `OpaqueClient` -- there's no reasonable way to fake that from
inside a Bruno request body.

So: run the fixture script FIRST, once per server run:

```
node apps/api/scripts/opaque-bruno-fixture.mjs
```

It performs a full register + login using the real `@cloudflare/opaque-ts`
client (same library the server already depends on), then prints
`userId` / `deviceId` / `sessionToken` / `refreshToken`. Paste those
into the **local** environment's variables in Bruno. Every other request
in this collection (`vault-items/*`, `vault-keys/*`, `sync/*`,
`rotation/*`) is plain JSON + a Bearer token from there on -- no OPAQUE
math needed, which is exactly what makes them runnable directly in
Bruno.

Optional arguments: `node apps/api/scripts/opaque-bruno-fixture.mjs
<email> <password> <deviceLabel>`. Re-run with a fresh email if you get
"Cannot complete registration" (that email already exists on the
currently-running, in-memory server).

## Collection layout

Numbered for portfolio readability, in the order you'd actually run
them: `00-health` -> `01-vault-keys` -> `02-vault` -> `03-sync` ->
`04-rotation`, with the OPAQUE-only `auth` requests kept separate since
they aren't run directly from Bruno (see above).

A note on how that numbering is implemented: Bruno's sidebar shows each
folder's `name` field (in its `folder.bru`), which is independent of
its actual directory name on disk. The physical directories are still
called `vault-keys/`, `vault-items/`, `sync/`, `rotation/` (and the new
`health/`) -- only their displayed names were changed to
`01-vault-keys`, `02-vault`, etc. Renaming the directories themselves
would mean deleting the old ones on your machine, and `device_bash` is
still down as of this handoff (see the project handoff notes) -- so
this was the safe way to get the numbered, readable ordering you asked
for without leaving orphaned duplicate folders behind. If you'd rather
have the directories themselves renamed to match once `device_bash` is
back, just say so.

- `health/` (shown as **00-health**) -- `liveness`: plain `GET /health`,
  no auth. Run this first to confirm the server is actually up before
  debugging anything else.
- `auth/` (shown as **reference-auth**, kept out of the numbered
  sequence, see above) -- the four OPAQUE endpoints, kept for
  reference/reading even though you won't run them directly.
  `register-finish` documents the optional `continuitySecret` field --
  add it (any base64 string) to opt that account into section 13's
  "hardened mode" before exercising `04-rotation`'s Factor 2 path.
- `vault-keys/` (shown as **01-vault-keys**) -- registers the master and
  recovery DEK wrappings (section 3) at `keyVersion: 1`. Run both
  `upsert-*` requests before `03-sync`'s push/pull --
  `SyncService`'s reconciliation gate 404s otherwise ("no master vault
  key registered for this user yet").
- `vault-items/` (shown as **02-vault**) -- `create` runs first and
  captures the new item's `id` into the `itemId` environment variable
  (post-response script), so `get`/`update` work immediately after
  without manual copy-pasting. `ciphertext` fields throughout this
  collection are base64 of arbitrary bytes -- the server never inspects
  vault content (zero-knowledge, section 3), so any bytes exercise the
  endpoint correctly.
- `sync/` (shown as **03-sync**) -- `push` (no `itemId` = create; add
  one from `02-vault` to exercise the conflict-fork path with a stale
  `lastSeenItemVersion`) and `pull`.
- `rotation/` (shown as **04-rotation**) -- `start` captures
  `continuityChallenge` into the environment (present only if the
  account has hardened mode enabled; otherwise it's empty and `finish`
  doesn't need a signature). `finish`, as shipped, assumes Factor 1
  only (no hardened mode) -- see the request's own notes for how to add
  a Factor 2 `continuitySignature` by hand for that path (computing the
  real HMAC needs the client's `continuitySecret`, which this
  collection has no reason to persist).
