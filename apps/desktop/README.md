# Jano -- Desktop (Tauri)

*Versión en español: [`README.es.md`](README.es.md).*

## Status of this folder

`src/engine/` is the encryption engine (sections 9/10 of the
architecture) -- pure TypeScript, no dependency on a UI framework or on
Tauri. It can be tested in isolation (`npm test`) before any screen
exists.

The UI framework decision is made: **Vite + React** (plain client-only
SPA, static build), chosen over Next.js because this app has nothing to
server-render -- 100% client-side cryptography, zero-knowledge by
design -- and over other frameworks because it's what `create-tauri-app`
itself offers as a first-class template, keeping the desktop and future
web-demo targets on the same tooling. The scaffold (`index.html`,
`vite.config.ts`, `src/main.tsx`, `src/ui/App.tsx`) is in this folder
now -- `npm run dev` starts it, `npm run build` produces a static
`dist/`. It is intentionally a bare placeholder: no screen from the
Fase 1 checklist (DOCVIS-JANO-01's companion doc) is built yet.

`src/worker/` (below) now exists and wires a real engine Worker end to
end -- a dedicated Worker + a small hand-rolled `postMessage` RPC,
chosen over a library like Comlink specifically to keep the engine<->UI
boundary explicit rather than transparent, and to avoid adding a new
dependency as a new security-relevant surface. `src/ui/App.tsx` does
not import `EngineClient` yet -- that's the unlock screen's job, not
this placeholder's.

What this handoff still does NOT include: the actual Tauri scaffolding
(`src-tauri/`, `tauri.conf.json`, `Cargo.toml`). It wasn't hand-generated
because that requires the Rust toolchain and the official command, and
it's better not to fabricate a `Cargo.toml`/`tauri.conf.json` from
memory that could end up misaligned with the real Tauri version you
install -- better for it to come from the official tool than from an
assumption about something that can't be verified from this
environment.

## Next step (manual, on your machine)

1. Install Tauri prerequisites (Rust + OS deps):
   https://v2.tauri.app/start/prerequisites/
2. From `apps/desktop/`, add Tauri to this ALREADY-EXISTING project with
   `npm run tauri -- init` -- **not** `npm create tauri-app`. That
   command targets an empty/fresh directory and doesn't document safe
   behavior against a folder that already has a real `package.json` and
   `src/` (this one does); `tauri init` is Tauri's own documented path
   for adding it to an existing frontend, and it only adds `src-tauri/`
   alongside what's already here -- it does not touch `package.json` or
   `src/`. See https://v2.tauri.app/start/create-project/ (the "already
   have an existing frontend" path). `@tauri-apps/cli` is already a
   devDependency (`npm install` at the repo root gets it) precisely so
   this doesn't need a global `tauri`/`cargo tauri` install on your
   machine -- confirmed working: `npm run tauri -- --version` prints
   `tauri-cli 2.11.4`. (`cargo tauri init` is the alternative if you'd
   rather go through `cargo install tauri-cli` instead, but it isn't
   required.)
3. When it asks for the dev server URL and frontend dist folder, answer
   `http://localhost:1420` (the port `vite.config.ts` is already pinned
   to, precisely so this step needs no extra configuration) and `dist`.
4. Once `src-tauri/` is set up, native clipboard clearing (section 10,
   Web/Desktop distinction) is implemented as a Tauri command in Rust,
   not via `navigator.clipboard` -- this avoids the focus restriction of
   the web API described in that section.

## `src/worker/`

Real Web Worker wiring for `src/engine/` (sections 9/10) -- see
protocol.ts's own header comment for the full rationale on the
hand-rolled RPC over a library like Comlink.

- `protocol.ts` -- `EngineOpMap`: one entry per exposed operation, each
  with its own request/result payload shape. `EngineRequestMessage`/
  `EngineResponseMessage` are the two envelope types that actually cross
  `postMessage` -- everything on this boundary is a plain, explicit,
  structurally-cloneable object correlated by a numeric `id`, nothing
  implicit. Scope of this first pass, intentionally: vault creation,
  unlock, item encrypt/decrypt, and lock -- exactly what Fase 1's unlock
  screen and single-credential reveal view need. Offline rotation
  (`engine/rotation-state-machine.ts`) is NOT wired in yet -- it mixes
  network calls and a caller-supplied store that don't map cleanly onto
  this boundary as-is; left for its own pass rather than guessed at
  here.
- `engine.worker.ts` -- the worker side. Holds the ONE resident
  `KeyManager` for the active session (module-level, replaced wholesale
  by `createNewVault()`, otherwise the same instance for the worker's
  whole life) and never posts the DEK, a KEK, or the `KeyManager`
  instance itself back to the main thread -- only what each operation's
  contract in `protocol.ts` declares.
- `engine-client.ts` -- `EngineClient`, the ONLY thing the UI layer
  should use to talk to the engine. Spawns the worker via Vite's
  `new URL(..., import.meta.url)` construction (works unchanged in a
  plain browser tab and inside a Tauri webview -- it's a standard Web
  Worker either way, no Tauri API involved), correlates responses back
  to their caller by `id`, and rejects every in-flight call if the
  worker itself crashes (`onerror`, which has no request `id` to
  correlate to a single caller). Exposes named methods
  (`createNewVault`, `unlockWithPassword`, `lock`, `encryptItem`,
  `decryptItem`) over a lower-level generic `call()` escape hatch.
- `index.ts` -- barrel export (`EngineClient` + the `protocol.ts`
  types), same pattern as `engine/index.ts`.
- `__tests__/engine-client.test.ts` -- integration test against a REAL
  worker (via `@vitest/web-worker`, see `vitest.config.ts`), not a mock
  of the message protocol: create-vault -> encrypt -> decrypt round-trip
  -> lock -> confirm the DEK is actually gone, plus unlock-with-correct-
  password and reject-wrong-password cases. Confirmed passing on a real
  machine (`npm test`, 2026-09-16) -- see
  [`../../docs/TESTING-01.md`](../../docs/TESTING-01.md) section 3.2 for
  the current 26/26 total across all 9 `apps/desktop` spec files.

## `src/engine/`

- `types.ts` -- shared types (`WrappedDek`, `AesGcmSealed`,
  `Argon2idParams`). Hard rule: no key crosses the interface as a
  `string`.
- `aes-gcm.ts` -- AES-256-GCM sealing/opening via native WebCrypto
  (`crypto.subtle`), 96-bit nonce per operation (section 5).
- `kek.ts` -- Argon2id derivation (master and recovery KEK, sections
  3/4) with `hash-wasm`. The default parameters
  (`DEFAULT_ARGON2ID_PARAMS`) are an initial proposal, **technical
  review still pending** -- see the comment in the file before using
  them in production.
- `key-manager.ts` -- KEK/DEK lifecycle (section 9): `KeyManager`
  unwraps the DEK at unlock, keeps it in memory for the session,
  encrypts/decrypts individual items, and zeroizes on `lock()`.
- `registration.ts` -- `createNewVault`: dual master/recovery KEK
  envelopes wrapping the same DEK (section 3).
- `vault-item.ts` -- plain-JSON serialization between
  `VaultItemPlaintext` and the `Bytes` that `KeyManager.encryptItem`/
  `decryptItem` operate on, with an explicit, refuse-to-guess guard on
  `schemaVersion`.
- `opaque-client.ts` -- thin wrapper around the real
  `@cloudflare/opaque-ts` client used for registration/login and
  rotation on this side of the protocol.
- `rotation-state-machine.ts` -- the offline `pending_opaque_rotation`
  state machine (section 13): `beginOfflineRotation` re-wraps the DEK
  under a new KEK and persists an encrypted pending record with no
  network access; `completeOfflineRotation` hands the recovered
  password to an injected client once reconnected, then clears the
  record -- retry-safe if the client call fails partway through.
- `rotation-http-client.ts` -- `HttpOpaqueRotationClient`: the
  `OpaqueRotationClient` the state machine calls on completion, talking
  to the real `/auth/rotate/*` endpoints over standard `fetch` (works
  unchanged in a browser tab or inside a Tauri webview -- no native
  command needed).
- `indexeddb-pending-rotation-store.ts` -- `IndexedDbPendingRotationStore`,
  the default `PendingRotationStore`: the pending record is already
  encrypted under the new KEK, so it's stored in IndexedDB rather than
  the OS keychain (section 13: "protected by the same trust perimeter
  as the vault, not a new surface") or native SQLite -- keeping this
  adapter dependency-free on both the Vercel web demo and Tauri
  desktop targets.
- `reconnection.ts` -- `reconnect()`: composes
  `HttpOpaqueRotationClient` + `IndexedDbPendingRotationStore` (or any
  other `PendingRotationStore`) with the state machine into the single
  call a reconnecting client makes; a no-op, with no network access,
  when nothing is pending.
- `vault-account-store.ts` -- `VaultAccountStore`/`VaultAccountRecord`:
  the local unlock record (`localSalt` + `wrappedMasterDek`) that
  `UnlockScreen` (`src/ui/`) reads on every app restart to decide
  "vault already exists, ask for the master password" vs. "no vault
  yet, run the creation ceremony". Deliberately does NOT include
  `recoverySalt`/`wrappedRecoveryDek` (registration.ts says those are
  for the server, `POST /vault-keys`) or `recoveryKitSecret` (shown to
  the user once, never persisted, section 3).
- `indexeddb-vault-account-store.ts` -- `IndexedDbVaultAccountStore`,
  the default `VaultAccountStore`. Its own database
  (`jano-vault-account`), separate from
  `indexeddb-pending-rotation-store.ts`'s `jano-engine` -- two
  independent classes with independent schemas, kept from having to
  coordinate one shared `DB_VERSION`/`onupgradeneeded`.
- `__tests__/` -- one spec file per module above (9 files, 28 tests as
  of this version, including two real-crypto end-to-end tests of the
  full offline-rotation -> reconnect pipeline) -- see
  [`../../docs/TESTING-01.md`](../../docs/TESTING-01.md) section 3.2
  for the full breakdown.

## `src/ui/`

- `theme.css` -- Fase 2's tokens (approved 2026-09-16): a zinc/graphite
  palette (`#09090b` to `#121214`, WCAG AA verified against real
  relative-luminance math, not eyeballed), one geometric-sans stack
  for human UI text, one monospace stack exclusively for data crossing
  the engine's `Uint8Array` contract (revealed credentials, the
  recovery kit's base64), and the phosphor accent (`#10b981`) gated
  behind a `data-crypto-active="true"` attribute components set only
  for the exact duration of a real cryptographic operation -- never
  decoratively. System font stacks only, no CDN -- see the file's own
  header comment for why (this app's local-first, no-incidental-
  network-calls posture). The first real stylesheet in this project;
  imported once, in `src/main.tsx`.
- `UnlockScreen.tsx` -- Fase 1 checklist item 2 (DOCVIS-JANO-01's
  companion doc). Fase 2's palette/typography tokens (`theme.css`,
  above) are applied here via `className`/`data-crypto-active` only --
  every flow below is unchanged from Fase 1's verified behavior. Two
  real flows against a real `EngineClient` (`src/worker/`): create a
  new vault (then show the recovery kit exactly once, section 3) when
  `VaultAccountStore.load()` finds nothing locally, or ask for the
  master password when it does. Feedback while the worker is busy is
  ONE stable message ("Unlocking vault...") in both flows -- no
  granular phase detail surfaces here, per DOCVIS-JANO-01's
  non-negotiable on that point.
- `bytes-to-base64.ts` -- tiny `btoa`-based helper for displaying the
  recovery kit as text. Duplicated from (not imported from)
  `engine/rotation-http-client.ts`'s own `toBase64` on purpose -- that
  file is a network client; pulling it into the UI layer for three
  lines would add a dependency this layer has no other reason to have.
- `CredentialRevealView.tsx` -- Fase 1 checklist item 3. Fase 2's
  tokens applied the same way as `UnlockScreen.tsx` -- `className`/
  `data-crypto-active`/`data-copy-confirmed` only, no behavior change.
  Masked by default; `revealPassword()` is the caller's own
  decrypt step (composed in `App.tsx` from `EngineClient.decryptItem`
  + `deserializeVaultItem` -- this component only ever holds a plain
  `string` it was explicitly handed, matching types.ts's rule that
  turning engine `Bytes` into a `string` is the UI layer's declared
  job, not the engine's). The revealed node is removed from the DOM
  (not just hidden) on blur, or after `UI_AUTO_MASK_TIMEOUT_MS`
  (`../config.ts`) while still focused. Copying arms
  `scheduleClipboardAutoClear` (`../clipboard/`) and shows a
  confirmation that is never color alone (DOCVIS-JANO-01's
  accessibility requirement): a "Copied to clipboard." text node, a
  `[COPIED]` glyph, and a `data-copy-confirmed` attribute on the
  wrapping `<p>` -- that attribute is the real functional hook Fase 2's
  checklist (section 4) assumed already existed as a 1px->2px border
  change; the border itself is a Fase-2 visual token applied on top of
  this attribute later, not built here.
- `VaultStatusIndicator.tsx` -- the functional piece Fase 2's checklist
  (section 3) assumed already existed; it didn't. Unstyled by design,
  same rule as the rest of this directory. Computes exactly one of the
  three DOCVIS-JANO-01 text states from real signals: a
  `PendingRotationStore.load()` result (presence only -- that record is
  sealed under a KEK this component has no business holding, see
  `engine/rotation-state-machine.ts`) and `navigator.onLine`
  (injectable via `isOnline`), re-evaluated live on `online`/`offline`
  window events. `N` in `PENDING SYNC: N ATOMIC ROTATION` is always `1`
  when a rotation is pending -- not arbitrary, but a direct consequence
  of `IndexedDbPendingRotationStore` being a deliberate single-slot
  design (one outstanding rotation per device, by construction).
- `App.tsx` -- root component. Renders `UnlockScreen` until an
  `EngineClient` comes back unlocked. Once unlocked, also renders
  `VaultStatusIndicator` above the demo credential (its first real
  wiring into the shell). There's still no real vault-item
  storage (WatermelonDB isn't built -- see below), so once unlocked it
  encrypts ONE demo item through the real resident DEK and renders
  `CredentialRevealView` against that real ciphertext -- nothing here
  persists across a lock/unlock cycle, which is exactly right for a
  placeholder standing in for a storage layer that doesn't exist yet.
  Also has the `Lock` button (`client.lock()` + `client.terminate()`)
  for manually exercising the full create/unlock/reveal/lock cycle end
  to end.
- `__tests__/UnlockScreen.test.tsx` -- component test against a REAL
  `EngineClient`/Worker (only the local store is a simple in-memory
  fake, injected via `UnlockScreenProps.store`): full create-vault ->
  recovery-kit -> handed-off-working-client path, password-mismatch
  validation that never touches the engine, and unlock with a wrong
  password followed by the correct one.
- `__tests__/CredentialRevealView.test.tsx` -- component test against
  a REAL `EngineClient`/Worker (only the `ClipboardAdapter` is a
  simple fake): real decrypt-on-reveal, DOM-destruction on blur,
  auto-mask after `UI_AUTO_MASK_TIMEOUT_MS`, and copy writing the real
  password to the (fake) clipboard with a text confirmation carrying
  both the `[COPIED]` glyph and the `data-copy-confirmed` attribute.
- `__tests__/VaultStatusIndicator.test.tsx` -- covers each of the
  three states in isolation against injectable fakes for
  `PendingRotationStore` and `navigator.onLine`, live reaction to
  `online`/`offline` window events, and that a pending rotation is
  never clobbered by a connectivity event.

## `src/clipboard/`

Web-vs-Tauri clipboard distinction, ARCHITECTURE-01.md section 10 --
backs `CredentialRevealView.tsx`'s copy button, and (this pass)
guarantees that copy gets cleared on a real app close, not just after
`CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS` elapses.

- `clipboard-adapter.ts` -- the shared `ClipboardAdapter` interface
  (`writeText`/`readText`/`clear`) both implementations satisfy, plus
  `getClipboardAdapter()`: picks the real one at runtime via
  `@tauri-apps/api/core`'s `isTauri()`, using a dynamic `import()` per
  branch so the Web bundle never loads
  `@tauri-apps/plugin-clipboard-manager`'s JS (and vice versa).
- `web-clipboard-adapter.ts` -- `navigator.clipboard`. `readText()`
  returns `null` instead of throwing when the browser refuses (most
  commonly: no document focus, section 10's own stated limitation);
  `clear()` overwrites with an empty string -- there's no real "clear
  the clipboard" primitive on the Web platform.
- `tauri-clipboard-adapter.ts` -- `@tauri-apps/plugin-clipboard-manager`
  (added this pass: `src-tauri/Cargo.toml`, registered on the builder
  in `src-tauri/src/lib.rs`, permissions granted in
  `src-tauri/capabilities/default.json`). A real OS clipboard command,
  including a real `clear()` -- not an empty-string overwrite. **Not
  verified in this sandbox** (same discipline as `engine/opaque-
  client.ts`): confirmed against the real npm package's own
  `dist-js/index.d.ts` function signatures, but needs a real Tauri
  build to actually invoke anything.
- `schedule-clipboard-auto-clear.ts` -- arms a delayed clear
  (`CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS`, `../config.ts`) that only
  actually clears if the clipboard still holds exactly what was
  copied -- "copy-then-verify-before-clear" per the Fase 1 checklist.
  Never clears content it didn't verify it put there itself. Also arms
  `pending-clipboard-clear.ts`'s registry with that same check
  (extracted into `verifyThenClearClipboard`) for the whole delay
  window, disarming it once its own timer fires.
- `pending-clipboard-clear.ts` -- a one-slot registry: whoever copies
  something arms the function that knows how to clear that specific
  copy; whoever needs to close the app can flush it immediately
  without knowing anything about React or which component armed it.
  Deliberately not disarmed on a component unmount -- closing the app
  should still flush a clear that a since-unmounted `CredentialRevealView`
  armed.
- `clear-on-exit.ts` -- `installClipboardClearOnExit()`, called once
  from `main.tsx`: on a real Tauri window-close request
  (`onCloseRequested`), flushes the pending clipboard clear (if any)
  BEFORE letting the window actually close, instead of leaving a
  copied credential in the OS clipboard for the rest of
  `CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS` after the app has already closed.
  Gated by `isTauri()` -- installs nothing on Web (`beforeunload`
  doesn't reliably wait for async cleanup in a browser, so there's no
  equivalent there). Covers only a graceful close -- a force-kill,
  crash, or power loss can't run any userspace cleanup, in this app or
  any other clipboard-based password manager; a background process
  kept alive to "wait out" the timeout was considered and rejected
  (doesn't cover that same floor, adds a process that visibly outlives
  the closed window). Confirmed live: copy a credential, close the
  window before 20s, the clipboard no longer holds it. Needed
  `"core:window:allow-destroy"` and `"core:window:allow-close"` added
  to `src-tauri/capabilities/default.json` -- `core:default` alone
  didn't cover the JS-side `window.destroy()` call this makes after
  flushing.
- `__tests__/` -- `web-clipboard-adapter.test.ts` and
  `tauri-clipboard-adapter.test.ts` (the latter necessarily mocks the
  plugin -- there's no real Tauri IPC in Vitest, same as this
  codebase's other tests that fake an external system it can't reach
  directly) each cover their own pass-through/null-on-failure logic;
  `schedule-clipboard-auto-clear.test.ts` covers the verify-before-clear
  decision itself (clears on a match, never clears on a mismatch or an
  unverifiable read, arms/disarms the pending-clear registry correctly)
  with fake timers; `pending-clipboard-clear.test.ts` covers the
  registry alone (no-op when empty, runs-once, newer-replaces-older,
  disarm prevents a later run); `clear-on-exit.test.ts` covers
  `installClipboardClearOnExit` against mocked
  `@tauri-apps/api/core`/`window` (installs nothing on Web, flushes
  before destroying on a real close request -- call order asserted,
  not just that both happened -- and still destroys when nothing was
  pending).

Not implemented yet in this folder: WatermelonDB integration, the
client-side conflict-fork algorithm (section 14), and the asymmetric
(Ed25519/P-256) upgrade for rotation's Factor 2 -- that last one is
implemented server-side too as a documented-as-provisional shared HMAC
secret, deliberately deferred to the final hardening phase.
