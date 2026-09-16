# Jano — Desktop (Tauri)

## Estado de este folder

`src/engine/` es el motor de cifrado (§9/§10 de la arquitectura) —
TypeScript puro, sin dependencia de framework de UI ni de Tauri. Se
puede probar de forma aislada (`npm test`) antes de que exista ninguna
pantalla.

Lo que este handoff NO incluye: el andamiaje real de Tauri (`src-tauri/`,
`tauri.conf.json`, `Cargo.toml`) ni el framework de UI (React/Svelte/
etc. — no está decidido en la arquitectura). No lo generé a mano porque
requiere el toolchain de Rust y el comando oficial, y es preferible no
fabricar un `Cargo.toml`/`tauri.conf.json` desde memoria que pueda
quedar desalineado con la versión real de Tauri que instales — mejor que
salga de la herramienta oficial que de una suposición sobre algo que no
se puede verificar desde este entorno.

## Próximo paso (manual, en tu máquina)

1. Instalar prerequisitos de Tauri (Rust + deps del SO):
   https://v2.tauri.app/start/prerequisites/
2. Desde `apps/desktop/`:
   ```
   npm create tauri-app@latest .
   ```
   (o `cargo tauri init` si preferís empezar solo con el lado Rust)
3. Elegir el framework de frontend ahí — el motor en `src/engine/` no
   depende de esa elección, se importa igual desde cualquiera.
4. Una vez armado `src-tauri/`, la limpieza de portapapeles nativa (§10,
   distinción Web/Desktop) se implementa como Tauri command en Rust, no
   vía `navigator.clipboard` — evita la restricción de foco de la API
   web que describe esa sección.

## `src/engine/`

- `types.ts` — tipos compartidos (`WrappedDek`, `AesGcmSealed`,
  `Argon2idParams`). Regla dura: ninguna clave cruza la interfaz como
  `string`.
- `aes-gcm.ts` — sellado/apertura AES-256-GCM vía WebCrypto nativo
  (`crypto.subtle`), nonce de 96 bits por operación (§5).
- `kek.ts` — derivación Argon2id (KEK maestro y de recuperación, §3/§4)
  con `hash-wasm`. Los parámetros por defecto (`DEFAULT_ARGON2ID_PARAMS`)
  son una propuesta inicial, **pendiente de revisión técnica todavía** —
  ver el comentario en el archivo antes de usarlos en producción.
- `key-manager.ts` — ciclo de vida KEK/DEK (§9): `KeyManager` desenvuelve
  la DEK al desbloqueo, la mantiene en memoria durante la sesión, cifra/
  descifra ítems individuales, y zeroiza en `lock()`.
- `__tests__/key-manager.test.ts` — test de humo del ciclo completo.

No implementado todavía en este folder: OPAQUE (vive en `apps/api` +
la parte cliente del protocolo), integración con WatermelonDB, la
máquina de estados de rotación offline (§13), ni el algoritmo de
conflict-fork (§14) del lado cliente.
