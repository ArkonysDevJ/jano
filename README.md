# Jano

Local-first password manager, real zero-knowledge — Arkonys Product 2.
The backend never has the ability to decrypt the vault, even if fully
compromised. Cloud copy at the same protection level as the local copy,
not a backup that reduces security.

Public repository under the `ArkonysDevJ` brand — the security design
rationale is visible and auditable in the code itself, not in a document
separate from the system.

*Versión en español: [`README.es.md`](README.es.md).*

## Status

Technical architecture **finalized** (V1.3, closed 2026-09-10) — see
[`docs/ARCHITECTURE-01.md`](docs/ARCHITECTURE-01.md) for the full
architecture: threat model, authentication (OPAQUE + Argon2id),
encryption (AES-256-GCM), sync engine (WatermelonDB), key rotation, and
the open item on credential exposure in the UI (section 10). See
[`docs/TESTING-01.md`](docs/TESTING-01.md) for how to run and verify
all of it -- test commands, live-server setup, and the Bruno collection.

`apps/api`'s domain modules are implemented and tested against a real,
running server:

- **Auth** -- OPAQUE (aPAKE) registration/login via
  `@cloudflare/opaque-ts`, session/refresh JWTs.
- **Vault** -- blind CRUD over opaque ciphertext blobs; the server
  never sees plaintext.
- **VaultKeys** -- master/recovery DEK wrapping registration,
  independently versioned (section 3).
- **Sync** -- key-version reconciliation gate and conflict-fork
  (section 14), replacing last-write-wins.
- **Rotation** -- offline `pending_opaque_rotation` re-registration
  (section 13), with rate limiting on `/auth/rotate/*`.

`apps/desktop`'s encryption engine (`src/engine/`) covers Argon2id
derivation (KEK), AES-256-GCM wrapping/unwrapping, KEK/DEK lifecycle
(section 9), vault creation (dual master/recovery envelopes), the
offline rotation state machine, and the reconnection orchestrator that
wires that state machine to a real OPAQUE server over HTTP (with an
IndexedDB-backed pending-rotation store, storage- and
network-agnostic by design) -- see
[`apps/desktop/README.md`](apps/desktop/README.md).

Test suite: 102/102 passing (38 in `apps/api`, 64 in `apps/desktop`,
including a real OPAQUE cryptographic round-trip, real
Argon2id/WebCrypto, a real-Web-Worker integration test of the
engine<->UI RPC boundary (section 9), and real-engine component tests
of the unlock screen and the credential reveal/copy view (Fase 1) --
see `docs/TESTING-01.md` section 3 for the per-file breakdown).

Not yet built: the asymmetric (Ed25519/P-256) upgrade for rotation's
Factor 2, which currently uses a documented-as-provisional shared HMAC
secret (explicitly deferred to the final hardening phase); WatermelonDB
wiring and real vault-item storage; and Fase 2 (visual identity,
DOCVIS-JANO-01) for the desktop UI. Fase 1 (functional, unstyled, the
unlock screen and single-credential reveal/copy view) and the Tauri
desktop packaging are done and closed -- see
`docs/TESTING-01.md` section 3.4.

## Structure

```
jano/
├── apps/
│   ├── api/       NestJS — blind server (OPAQUE, Vault, Sync, VaultKeys, Rotation)
│   └── desktop/   Tauri (pending init) + encryption engine
├── docs/
│   ├── ARCHITECTURE-01.md
│   ├── TESTING-01.md
│   └── schema.sql
```

## Stack

- Backend: NestJS + Fastify + PostgreSQL (real persistence, see
  `docs/TESTING-01.md`)
- Client: Tauri + WatermelonDB
- Auth: OPAQUE (aPAKE) for online sync, Argon2id for local offline
  unlock -- two physically distinct planes, not interchangeable
  (section 4)
- Encryption: AES-256-GCM, 96-bit nonce, CSPRNG, per operation
  (section 5)

## Development

```
npm install
npm run dev:api               # apps/api — dev server, watch mode
npm run test --workspace=apps/api
npm run test:desktop          # apps/desktop — encryption engine tests
```

Requires Node 22 (see `.node-version`). `apps/api` is a native ESM
package (required by the installed NestJS major, which ships ESM-only).
`apps/desktop` doesn't have a runnable app yet -- it needs the Tauri
toolchain first, see its README.

See [`docs/TESTING-01.md`](docs/TESTING-01.md) for full verification
procedures: environment setup (`.env`, OPAQUE server secrets),
exercising the live API with real OPAQUE cryptography, and the
numbered Bruno collection (`apps/api/bruno/`).

## License

MIT -- see [`LICENSE`](LICENSE).
