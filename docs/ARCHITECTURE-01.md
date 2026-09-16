# [DOC-ID: ARCHITECTURE-01] -- Jano -- Technical Architecture

**Status:** Finalized -- version 1.3, closed 2026-09-10.

**Domain:** Arkonys Product 2 -- local-first password vault
**Version:** 1.3 (finalized)
**Date:** 2026-09-10

This document is the sanitized, English technical architecture for
Jano. It supersedes any direct reference to the original sealed design
document as the repo's public architecture reference; the original
document, with its full internal review history, is kept outside this
repository. This is the first and, for now, only architecture document
of its kind -- future documents in the same series will be numbered
`ARCHITECTURE-02`, `-03`, and so on.

This document reproduces the substantive technical content of the
finalized design: threat model, authentication, encryption, sync
engine, key lifecycle, rate limiting, the open UI/clipboard item, the
base database schema, the offline key-rotation state machine, and the
content conflict-resolution algorithm. Internal review process,
reviewer identities, and governance ceremony are intentionally left
out of this document -- they belong to internal process records, not
to the public technical architecture.

## Document history (summary)

The design went through several review rounds before being finalized
as version 1.3. At a technical level, the changes that shaped the
current architecture were:

- The wrapped-key model was corrected from one wrapping per vault item
  to a single wrapping per vault (section 7).
- Master-key and recovery-key versioning were split into two
  independent fields, since rotating one must never affect the other
  (section 3).
- An explicit mechanism for the client to transmit its active
  `master_key_version` to the server was added, since the reconciliation
  gate (section 7) cannot function without it.
- The KEK and DEK lifecycles were explicitly separated -- a single
  combined lifecycle is incompatible with per-record sync granularity
  (section 9).
- The `Uint8Array`-only interface rule for the engine-to-UI boundary was
  established from the initial design, rather than left as a later
  refinement (section 10).
- A base database schema was added (section 12).
- An offline master-key rotation deadlock was identified and closed
  with the `pending_opaque_rotation` state machine and its authorization
  policy (section 13).
- A content conflict-resolution algorithm (conflict-fork) was added,
  explicitly replacing WatermelonDB's default last-write-wins behavior,
  which the architecture does not consider acceptable for vault content
  (section 14).
- The Web/Desktop distinction for clipboard-clearing verification was
  clarified against official clipboard API documentation (section 10).

## 1. Goal and scope

Local-first password manager, real zero-knowledge: the backend never
has the ability to decrypt the vault, even if fully compromised. The
cloud copy is exactly as secure as the local copy -- not a backup that
lowers the protection level.

Product goal: a public repository, with the security design rationale
visible and auditable in the code itself -- not an isolated exercise
kept separate from the system. The engineering rigor behind the design
operates as an invisible layer: the review process itself doesn't
appear in the repo, but its effect does.

Explicitly out of scope: integration with browser or OS autofill. That
reopens exactly the risk surface the overall design is meant to avoid
-- if added in the future, it requires a new, explicit evaluation,
never a default.

## 2. Threat model

Primary vector: infostealers (RedLine/Raccoon-class) running with user
permissions (no admin), capable of calling browser password-manager
internal APIs without triggering prompts. A dedicated password manager
requires an independent secret that OS login alone does not provide.

Secondary vector, confirmed during review: process memory dumps (RAM
dumps) by user-permission malware -- this applies both to the derived
key and to individual credentials revealed in the UI.

## 3. Master-key unrecoverability (non-negotiable)

Chosen model: pure zero-knowledge with a user-custodied recovery kit.
An additional random secret, generated offline, printable, never
transmitted -- it acts as a second KEK. The DEK is wrapped twice: once
under the KEK derived from the master password (Argon2id), and once
under the KEK derived from the recovery kit. This does not break
zero-knowledge -- the server still never sees either key, it only
stores two encrypted wrappings of the same DEK. Equivalent pattern to
Bitwarden's "emergency kit".

If the user loses both the master password and the recovery kit: total,
irrecoverable loss, by design. This must be communicated explicitly to
the user during kit generation, not buried in fine print.

Dual role: the recovery kit does not only cover the "legitimate user
forgot their master password" scenario -- it is the system's
alternative root of trust, and as such it also serves as an account
recovery path if the OPAQUE `registration_record` was hijacked (see
section 13). This dual function is an explicit design decision, not an
implicit extension -- it must be communicated as such in any
user-facing documentation.

Independent versioning per KEK type: the two DEK wrappings do not share
a single `key_version` -- each carries its own field
(`master_key_version`, `recovery_key_version`), incremented only when
its corresponding KEK rotates. Rotating the master password must not
affect the recovery-kit wrapping's version, and vice versa -- these are
independent secrets by design, and the data schema must reflect that
independence explicitly. The reconciliation gate in section 7 operates,
on the normal sync path, exclusively against `master_key_version` --
`recovery_key_version` is an emergency path, not part of everyday sync.

## 4. Authentication: OPAQUE (online) vs. local Argon2id (offline)

Two physically distinct planes, not interchangeable:

- **Offline flow (local unlock):** Argon2id derives the local KEK from
  the master password plus a local salt persisted to disk (protected by
  the OS-level keychain where available). Never depends on the network.
  The local vault must be fully functional with the network off.
- **Online flow (sync authentication):** OPAQUE (aPAKE) authorizes the
  sync session against the backend -- push/pull of encrypted blobs. It
  decrypts nothing, and does not gate local unlock.

Mandatory domain separation for derivation: the input to OPAQUE is the
raw master password (by protocol design, never the derived key), with a
salt/derivation domain distinct from the one Argon2id uses for the
local KEK. An attacker who compromises the OPAQUE backend must gain
nothing over the local vault -- this must be demonstrated in the
detailed implementation, never assumed.

Recommended library: `@cloudflare/opaque-ts` (maintained by Cloudflare,
with documented production drivers) or `@47ng/opaque-server` /
`@47ng/opaque-client` (a WASM wrapper over Meta's `opaque-ke`,
equivalent to the "audited binding over Rust/C" pattern already
recommended as the minimum acceptable floor). Neither has formal NIST
certification; Cloudflare has the stronger organizational backing of
the two.

## 5. Content encryption

AES-256-GCM. Random 96-bit nonce, CSPRNG, per operation -- both for
content encryption (frequent) and for DEK wrapping (infrequent, only
during master-key rotation). A monotonic counter is explicitly
rejected: it requires strict cross-device state synchronization,
incompatible with the multi-device offline-first model.

Rationale for choosing AES-GCM over XChaCha20-Poly1305 (evaluated and
discarded): the verified NIST limit of 2^32 (~4.3 billion) encryptions
per key with a random 96-bit nonce -- a volume a personal vault never
comes close to reaching, especially since the DEK rotates on every
master-password change. AES-GCM is native to WebCrypto/Node;
XChaCha20-Poly1305 requires an external dependency
(`libsodium-wrappers`, WASM loading) -- an integration cost not
justified by the actual risk in this use case.

## 6. Sync engine: WatermelonDB

Chosen over PowerSync -- not for pedagogical reasons, but because it
keeps the versioned-key reconciliation logic (section 7), which is the
single most security-critical piece of the whole system, visible in the
public repository itself. With PowerSync that same logic would still be
necessary, but it would live in a client layer over its stream --
invisible to an external reviewer auditing the repo.

MIT license, with no future license transition to track (unlike
PowerSync, which is FSL converting to Apache 2.0 after 2 years -- not
the reason for the choice, but a consistent point in its favor).

## 7. Sync granularity and master-key rotation

Sync at the individual-record level, not full-database blobs.

Single DEK per vault, not per record: there is exactly ONE DEK per
vault (consistent with the foundational promise of envelope encryption
-- the advantage is precisely not having to re-encrypt every record on
a password rotation). `vault_items` never contains a key wrapping --
see the corrected schema in section 12.

Explicit KEK versioning: the DEK wrapping, in `vault_keys`, carries a
`master_key_version` / `recovery_key_version` field per section 3.
Master-password rotation is an atomic operation on a single
`vault_keys` row -- it never touches `vault_items`, regardless of how
many records the vault has.

A distinct, rare event: rotating the DEK itself (cryptographic hygiene,
or recovery after a suspected compromise). Since atomically
re-encrypting every record isn't practical, migration is incremental --
new records are encrypted under the new DEK and carry a `dek_version`
field (a generation tag, not a wrapping) in `vault_items`; the client
re-encrypts old records in the background until convergence, at which
point the old `vault_keys` row can be purged.

Mandatory reconciliation gate: a device reconnecting with an outdated
`key_version` CANNOT push or accept writes until it re-derives against
the current version -- an explicit blocking state, never a silent
merge. This logic lives in the NestJS backend (visible in the repo --
see section 6).

Content-conflict resolution (timestamp/metadata) and key-version
conflict resolution are distinct axes -- they do not share a
"most-recent-wins" mechanism. The concrete content-reconciliation
algorithm (WatermelonDB's default last-write-wins is explicitly
replaced) lives in section 14.

Version-transmission mechanism: the blind server cannot run the
reconciliation gate without knowing the connecting device's
`master_key_version`. The client sends its active `master_key_version`
as signed metadata alongside the authentication token on every
push/pull attempt. This metadata is a version number, not vault content
-- it does not compromise the zero-knowledge model, the same principle
that already governs timestamp-based conflict resolution in section 7.
The backend validates that metadata against the stored
`master_key_version` for that vault (blind data, no decryption
required) before accepting or rejecting the operation.

## 8. Rate limiting on the OPAQUE endpoint

MUST-HAVE, not an open item: rate limiting by IP + account identifier
at the NestJS/gateway layer, exponential backoff, with a CAPTCHA or
proof-of-work threshold as fallback. OPAQUE protects the password's
content in transit, but it does not protect the endpoint from mass
attempts or from compute exhaustion (OPAQUE is CPU-intensive).

## 9. Client-side key custody

The derived key (decrypted KEK/DEK) is never a string -- exclusively
`Uint8Array`. Declared as a good-faith mitigation, not as certified
secure erasure (there is no formal guarantee that V8 hasn't copied the
buffer during compaction/JIT/generational GC).

Distinct lifecycles for KEK and DEK: treating them as a single entity
with one lifecycle is incompatible with section 7 (granular per-record
sync). Argon2id is deliberately expensive -- re-deriving the KEK on
every operation against an individual credential is impractical.

- **KEK:** single-use -- unwraps/re-wraps the DEK at unlock and during
  rotation events. `.fill(0)` immediately after each of those two
  single-use events, never kept in memory outside of them.
- **DEK:** persists in memory (`Uint8Array`, inside the Worker) for the
  whole active session -- used repeatedly to encrypt and decrypt
  individual records. Cleared only at logout or when the inactivity
  timeout expires, not after each individual operation.

Honest limit of the `Uint8Array` boundary: the `Uint8Array` interface at
the engine-to-UI boundary is correct as an API design practice (it
avoids a string existing longer than necessary, avoids it living in a
global React store) -- but it is not a mitigation for the memory-leak
vector once the value crosses into DOM rendering or into the clipboard
on a web target. `navigator.clipboard.writeText()` only accepts
`DOMString`; any DOM text node only accepts a string. At the moment the
buffer is decoded for either use, an immutable string is born on the
V8 heap, with no possible `.fill(0)`, at the mercy of generational GC --
a physical limit of the JavaScript engine, not an avoidable design flaw
within a web target. The real mitigation for that final stretch lives
in section 10, not here.

Web Worker: mandatory. It genuinely isolates against script injection
in the main thread (XSS, a malicious extension). It does not solve the
full-process RAM-dump vector (user-permission malware) -- the Worker
and the main thread share an OS process and address space in the
standard browser/Electron/Tauri-webview model. This limit must be
declared explicitly in any security documentation -- the Worker must
never be presented as a solution to the RAM-dump vector.

Persistence: the derived key never touches disk. It lives exclusively
in volatile memory, per session, with an inactivity timeout to be
defined during implementation. If a "persistent unlocked session"
feature is added in the future, the only acceptable surface is the
OS's native keystore (Keychain/Credential Manager/Secret Service) -- an
explicit design decision, never a silent default, because it changes
the threat model (from "live session" to "OS user-level access").

Open, unresolved condition: if Jano ships via Tauri, moving
derivation/decryption to a native Rust layer (`zeroize`, no
non-deterministic GC) addresses the root cause instead of mitigating it
inside V8 -- to be evaluated once the packaging target is confirmed.

## 10. Open item -- credential exposure in the UI/clipboard

Not resolved. Distinct from section 9 (custody of the master key): this
is about the exposure of each individual decrypted credential shown to
the user -- which happens far more often than key derivation (once per
session vs. every view/copy).

Resolved at the UI level -- interface hygiene, not cryptography: since
the string is physically unavoidable in the final stretch (section 9),
the real mitigation is UI behavior, not data type:

- Masked by default -- the credential is not rendered in clear text
  unless the user explicitly acts.
- Short-lived rendering: the DOM node containing the decrypted value is
  destroyed on blur or after a short timeout, it does not persist while
  the view stays open.
- Clipboard clearing with content verification: after a timeout since a
  credential was copied, overwrite the clipboard with an empty payload
  only if it still contains the value Jano wrote (compared against the
  value or a hash briefly kept in the engine, never by reinserting the
  secret). Without this check, Jano could silently erase something the
  user copied afterward from another source.

What remains is an implementation detail, not architecture: exact
timeout parameters (on-screen visibility, clipboard clearing) -- product
values, not security values, to be defined without blocking
implementation.

Web/Desktop distinction (verified against official documentation):
`navigator.clipboard.readText()` requires the document to have active
focus -- it throws `NotAllowedError: Document is not focused` if the
window lost focus, confirmed behavior in Chrome, Firefox, and Edge. On
a pure Web target, content verification before clearing the clipboard
cannot run in the background against an arbitrary `setTimeout` -- it
must be chained to `window.onfocus`, or accept a blind clear if the
user doesn't return to the tab within the timeout. On Desktop/Tauri,
the native backend can inspect the clipboard without this restriction
-- no behavioral difference between platforms if implemented via a
Tauri command instead of the standard web API.

Interface condition, not blocking but mandatory from the start: this
open item does not block starting implementation with the engine
(derivation, wrapping, sync, reconciliation) -- it is presentation-layer
work, separable from the bulk of the system's real complexity and risk.
But the contract of the function that returns a decrypted credential to
the frontend must be declared with `Uint8Array` from the engine's
initial design, never `string` -- even though the "reveal and
auto-clear" UI policy is not resolved yet. Designing the interface with
the wrong type now would force touching the engine's signature later,
not just the UI layer, once this item is resolved.

## 11. Base database schema

Minimal DDL, so implementation doesn't make undeclared schema
decisions. Core tables, without exhaustive secondary columns (indexes,
audit timestamps, etc. -- an implementation detail, not architecture):

- **`users`** -- the user's OPAQUE identity, plus the OPAQUE
  `registration_record` issued by the client when finishing
  registration (see section 4). Note: the OPRF seed and the OPAQUE
  server's AKE keypair are NOT per-user data -- they are secrets unique
  to the whole server deployment, loaded from environment variables
  (see `.env.example` and `cloudflare-opaque-server-provider.ts`), not
  stored per row.
- **`devices`** -- devices registered per user, for multi-device sync
  traceability, and as the anchor for Factor 1 of OPAQUE re-registration
  (section 13 -- a valid session/refresh token per device).
- **`vault_items`** -- individual credential records. NEVER contains a
  wrapping of any key. Fields: `id`, `ciphertext` (output of
  AES-256-GCM under the current DEK: nonce + ciphertext + authentication
  tag, see section 5), `dek_version` (a DEK generation tag, only
  relevant during the rare full-DEK-rotation event -- not a wrapping,
  see section 7), `_version` (native to WatermelonDB, used by the
  conflict algorithm in section 14), `conflict_of` (nullable -- points
  to the original item when this record is a conflict fork, see section
  14).
- **`vault_keys`** -- this, and only this, is where the wrappings of
  the vault's SINGLE DEK live. One row per (KEK type, version):
  normally 2 active rows (`master`, `recovery`), each wrapping the same
  DEK under its corresponding KEK, with its own
  `master_key_version`/`recovery_key_version` (section 3).
- **`sync_events`** -- per-operation sync metadata: `updated_at_server`,
  the `master_key_version` received from the client (section 7), so the
  key-reconciliation gate has something to compare against without
  touching content.

Detailed index, constraint, and migration design is an implementation
task on top of this base, not part of this document. See
`docs/schema.sql` for the concrete DDL.

## 12. State machine: offline master-key rotation

Real deadlock: if the master password rotates without network access
and the old password material is cleared immediately (per section 9's
requirement), the client reconnects with no way to authenticate the
sync session -- not with the old one (erased), and not with the new one
(never registered against the server, since OPAQUE is interactive by
design, not precomputable offline).

A declared, narrowly scoped exception to the immediate-wipe rule --
`pending_opaque_rotation`:

1. On offline rotation: the client derives the new KEK (Argon2id),
   re-wraps the SINGLE DEK under the new KEK (an atomic operation,
   section 7), and updates local unlock -- no network involved, no
   change to what's already established.
2. Additionally, the client encrypts and persists, under the
   newly-derived KEK, a record with the minimum material needed to
   complete OPAQUE registration against the server on the next
   connection -- never the plaintext password held indefinitely,
   protected by the same trust boundary that already protects the rest
   of the vault, not a new surface. It's tagged with a
   `local_rotation_epoch`, incremented on every offline rotation.
3. On reconnection: before any normal OPAQUE sync authentication, the
   client checks whether a `pending_opaque_rotation` exists. If it does,
   it attempts OPAQUE re-registration under the authorization policy
   defined below -- only after successful authorization is the old
   `registration_record` replaced and the process confirmed; only after
   server confirmation is the local pending record deleted (a two-phase
   protocol, idempotent endpoint, so a network interruption mid-process
   never leaves the client without a pending record and without an
   updated server simultaneously).

**Re-registration authorization policy (user-configurable MFA):**

Without proof of continuity, this endpoint is an unauthenticated
account-takeover vector -- anyone who knows the account identifier
could replace the legitimate owner's `registration_record`. This is not
"optional hardening" -- minimum authorization is mandatory; only the
strength of the mechanism is configurable.

- **Factor 1, always mandatory:** the client must present a valid
  session/refresh token, issued during that specific device's last
  successful connection, along with the re-registration request.
  Without this factor, the mutation is rejected without exception. An
  attacker who steals only this token produces, at worst, a denial of
  sync service against the legitimate owner -- it does not compromise
  zero-knowledge confidentiality, because the KEK never travels to the
  server and the attacker cannot decrypt the vault.
- **Factor 2, optional user configuration ("hardened mode"):** a
  continuity signature derived from the rotation material, encrypted
  under the new KEK (see step 2), verified against a verifier stored
  server-side from the original registration. When the user enables
  this option, both factors are required (AND, not OR) -- the system
  captures and persists the signature material on every offline
  rotation only if this setting is active, so the memory/complexity
  cost isn't imposed on users who didn't opt into it.

Unified scenario -- absence of valid proof of continuity: whether the
refresh token expired during the offline period (a device that rotated
and took too long to reconnect) or it's a second device that never saw
the original rotation and presents its local copy of the old password
("Device B") -- both cases fall into the same failure category, with no
separate special handling: no automatic mutation proceeds. The device
enters a manual recovery flow -- revoking its sync state, forced
logout, and re-authentication from scratch using the current credential
(if the user knows it) or the section 3 recovery kit as the alternative
root of trust (its dual role, as established there).

Additional hardening, genuinely optional, not required for this
version: out-of-band notification (email/push to another already
authenticated device) on every `registration_record` re-registration
event, as an additional detection layer independent of the two
authorization factors. Logged as a future improvement.

## 13. Content conflict-reconciliation algorithm

The server is blind by design -- it cannot and must not attempt
semantic merging of opaque blobs. Any automatic merge would either
require server-side decryption (breaking zero-knowledge) or would
produce incorrect merges over data the server doesn't understand.
Last-write-wins (WatermelonDB's default) is explicitly replaced by
conflict forking, never silent loss:

1. Every `vault_items` row carries `_version` (native to WatermelonDB);
   each client records the last `_version` it saw for each item at its
   last successful sync.
2. On push: if the `_version` the server has stored is greater than the
   last one the client saw, and the client also brings an unsynced
   local modification to the same item -> a conflict is detected.
3. The server accepts the incoming write as a new record, with
   `conflict_of` pointing to the original item and non-sensitive
   metadata (originating device, timestamp) -- the original item, at
   its last accepted version, is left intact, with no data loss.
4. On the next login, a client that finds a `conflict_of` shows it to
   the user as a labeled duplicate (e.g. "[Conflict - Device X]") --
   the user, the only party able to decrypt both versions, manually
   decides which to keep or merges by hand. Consistent with
   zero-knowledge: semantic resolution can only happen where the key
   exists.

This is custom logic layered on top of WatermelonDB, not native library
behavior -- it must be documented as such in the implementation. It
lives both in NestJS (version detection, creation of the `conflict_of`
record) and on the client (presentation and manual resolution).
