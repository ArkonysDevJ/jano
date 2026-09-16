# Jano -- Desktop (Tauri)

*Versión en español: [`README.es.md`](README.es.md).*

## Status of this folder

`src/engine/` is the encryption engine (sections 9/10 of the
architecture) -- pure TypeScript, no dependency on a UI framework or on
Tauri. It can be tested in isolation (`npm test`) before any screen
exists.

What this handoff does NOT include: the actual Tauri scaffolding
(`src-tauri/`, `tauri.conf.json`, `Cargo.toml`) or the UI framework
(React/Svelte/etc. -- not decided in the architecture). It wasn't
hand-generated because that requires the Rust toolchain and the
official command, and it's better not to fabricate a
`Cargo.toml`/`tauri.conf.json` from memory that could end up misaligned
with the real Tauri version you install -- better for it to come from
the official tool than from an assumption about something that can't be
verified from this environment.

## Next step (manual, on your machine)

1. Install Tauri prerequisites (Rust + OS deps):
   https://v2.tauri.app/start/prerequisites/
2. From `apps/desktop/`:
   ```
   npm create tauri-app@latest .
   ```
   (or `cargo tauri init` if you'd rather start with just the Rust side)
3. Choose the frontend framework there -- the engine in `src/engine/`
   doesn't depend on that choice, it imports the same way from any of
   them.
4. Once `src-tauri/` is set up, native clipboard clearing (section 10,
   Web/Desktop distinction) is implemented as a Tauri command in Rust,
   not via `navigator.clipboard` -- this avoids the focus restriction of
   the web API described in that section.

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
- `__tests__/key-manager.test.ts` -- smoke test of the full cycle.

Not implemented yet in this folder: OPAQUE (lives in `apps/api` + the
protocol's client side), WatermelonDB integration, the offline rotation
state machine (section 13), or the client-side conflict-fork algorithm
(section 14).
