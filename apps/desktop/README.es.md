# Jano — Desktop (Tauri)

## Estado de este folder

`src/engine/` es el motor de cifrado (§9/§10 de la arquitectura) —
TypeScript puro, sin dependencia de framework de UI ni de Tauri. Se
puede probar de forma aislada (`npm test`) antes de que exista ninguna
pantalla.

La decisión de framework de UI ya está tomada: **Vite + React** (SPA
pura del lado cliente, build estático), elegido en vez de Next.js porque
esta app no tiene nada que renderizar en servidor -- 100% criptografía
del lado cliente, zero-knowledge por diseño -- y en vez de otros
frameworks porque es lo que `create-tauri-app` ofrece como template de
primera clase, manteniendo el target desktop y el futuro demo web sobre
el mismo tooling. El scaffold (`index.html`, `vite.config.ts`,
`src/main.tsx`, `src/ui/App.tsx`) ya está en este folder -- `npm run
dev` lo levanta, `npm run build` genera un `dist/` estático. Es a
propósito un placeholder vacío: todavía no se construyó ninguna pantalla
del checklist de Fase 1 (documento complementario de DOCVIS-JANO-01).

`src/worker/` (más abajo) ya existe y cablea un Worker real de punta a
punta -- un Worker dedicado + un RPC propio sobre `postMessage`, elegido
en vez de una librería como Comlink específicamente para mantener el
límite motor↔UI explícito en vez de transparente, y para no sumar una
dependencia nueva como superficie de seguridad nueva. `src/ui/App.tsx`
todavía no importa `EngineClient` -- eso es trabajo de la pantalla de
unlock, no de este placeholder.

Lo que este handoff todavía NO incluye: el andamiaje real de Tauri
(`src-tauri/`, `tauri.conf.json`, `Cargo.toml`). No lo generé a mano
porque requiere el toolchain de Rust y el comando oficial, y es
preferible no fabricar un `Cargo.toml`/`tauri.conf.json` desde memoria
que pueda quedar desalineado con la versión real de Tauri que instales
— mejor que salga de la herramienta oficial que de una suposición sobre
algo que no se puede verificar desde este entorno.

## Próximo paso (manual, en tu máquina)

1. Instalar prerequisitos de Tauri (Rust + deps del SO):
   https://v2.tauri.app/start/prerequisites/
2. Desde `apps/desktop/`, agregar Tauri a este proyecto YA EXISTENTE con
   `npm run tauri -- init` — **no** `npm create tauri-app`. Ese comando
   apunta a una carpeta vacía/nueva y no documenta un comportamiento
   seguro contra una carpeta que ya tiene un `package.json` y un `src/`
   reales (que es exactamente este caso); `tauri init` es el camino que
   la propia documentación de Tauri define para agregarlo a un frontend
   ya existente, y solo agrega `src-tauri/` al lado de lo que ya está —
   no toca `package.json` ni `src/`. Ver
   https://v2.tauri.app/start/create-project/ (la ruta para quien "ya
   tiene un frontend existente"). `@tauri-apps/cli` ya es una
   devDependency (`npm install` en la raíz del repo la trae) justamente
   para no necesitar una instalación global de `tauri`/`cargo tauri` en
   tu máquina — confirmado funcionando: `npm run tauri -- --version`
   imprime `tauri-cli 2.11.4`. (`cargo tauri init` es la alternativa si
   preferís pasar por `cargo install tauri-cli`, pero no hace falta.)
3. Cuando pregunte por la URL del dev server y la carpeta de build,
   respondé `http://localhost:1420` (el puerto al que `vite.config.ts`
   ya está fijado, justo para que este paso no necesite configuración
   extra) y `dist`.
4. Una vez armado `src-tauri/`, la limpieza de portapapeles nativa (§10,
   distinción Web/Desktop) se implementa como Tauri command en Rust, no
   vía `navigator.clipboard` — evita la restricción de foco de la API
   web que describe esa sección.

## `src/worker/`

Cableado real de Web Worker para `src/engine/` (secciones 9/10) -- ver
el comentario de cabecera de protocol.ts para la justificación completa
del RPC hecho a mano en vez de una librería como Comlink.

- `protocol.ts` -- `EngineOpMap`: una entrada por cada operación
  expuesta, cada una con su propia forma de payload de request/result.
  `EngineRequestMessage`/`EngineResponseMessage` son los dos tipos de
  sobre que realmente cruzan por `postMessage` -- todo en este límite es
  un objeto plano, explícito, clonable estructuralmente, correlacionado
  por un `id` numérico, nada implícito. Alcance de este primer pase, a
  propósito: creación de bóveda, unlock, cifrado/descifrado de ítems, y
  lock -- exactamente lo que necesitan la pantalla de unlock y la vista
  de revelación de una sola credencial de Fase 1. La rotación offline
  (`engine/rotation-state-machine.ts`) todavía NO está cableada -- mezcla
  llamadas de red y un store que aporta el caller, que no mapean
  limpiamente sobre este límite tal como está; se deja para su propio
  pase en vez de adivinarla aquí.
- `engine.worker.ts` -- el lado del worker. Mantiene el ÚNICO
  `KeyManager` residente para la sesión activa (a nivel de módulo,
  reemplazado por completo por `createNewVault()`, la misma instancia
  durante toda la vida del worker en cualquier otro caso) y nunca envía
  la DEK, una KEK, ni la instancia de `KeyManager` misma de vuelta al
  hilo principal -- solo lo que el contrato de cada operación en
  `protocol.ts` declara.
- `engine-client.ts` -- `EngineClient`, lo ÚNICO que la capa de UI debería
  usar para hablar con el motor. Levanta el worker vía el patrón de
  construcción de Vite `new URL(..., import.meta.url)` (funciona igual
  en una pestaña de navegador normal y dentro de un webview de Tauri --
  es un Web Worker estándar en ambos casos, sin ninguna API de Tauri de
  por medio), correlaciona las respuestas de vuelta a su caller por
  `id`, y rechaza todas las llamadas en vuelo si el worker mismo se
  cae (`onerror`, que no tiene ningún `id` de request con el que
  correlacionar a un caller específico). Expone métodos nombrados
  (`createNewVault`, `unlockWithPassword`, `lock`, `encryptItem`,
  `decryptItem`) sobre un `call()` genérico de más bajo nivel, como
  válvula de escape.
- `index.ts` -- barrel export (`EngineClient` + los tipos de
  `protocol.ts`), mismo patrón que `engine/index.ts`.
- `__tests__/engine-client.test.ts` -- test de integración contra un
  worker REAL (vía `@vitest/web-worker`, ver `vitest.config.ts`), no un
  mock del protocolo de mensajes: crear bóveda -> cifrar -> descifrar ->
  lock -> confirmar que la DEK realmente desapareció, más los casos de
  unlock-con-password-correcta y rechazo-con-password-incorrecta.
  Confirmado pasando en una máquina real (`npm test`, 2026-09-16) -- ver
  [`../../docs/TESTING-01.md`](../../docs/TESTING-01.md) sección 3.2
  para el total actual de 26/26 en los 9 archivos de spec de
  `apps/desktop`.

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
- `registration.ts` — `createNewVault`: envolturas duales (KEK maestra
  y de recuperación) que envuelven la misma DEK (§3).
- `vault-item.ts` — serialización JSON plana entre `VaultItemPlaintext`
  y los `Bytes` sobre los que operan `KeyManager.encryptItem`/
  `decryptItem`, con una guarda explícita de "no adivinar" sobre
  `schemaVersion`.
- `opaque-client.ts` — envoltorio delgado sobre el cliente real de
  `@cloudflare/opaque-ts`, usado para registro/login y rotación en este
  lado del protocolo.
- `rotation-state-machine.ts` — la máquina de estados de rotación
  offline `pending_opaque_rotation` (§13): `beginOfflineRotation`
  re-envuelve la DEK bajo una nueva KEK y persiste un registro pendiente
  cifrado sin acceso a red; `completeOfflineRotation` le entrega la
  contraseña recuperada a un cliente inyectado una vez reconectado, y
  recién ahí limpia el registro — resistente a reintentos si la llamada
  al cliente falla a mitad de camino.
- `rotation-http-client.ts` — `HttpOpaqueRotationClient`: el
  `OpaqueRotationClient` que la máquina de estados invoca al completar,
  hablando con los endpoints reales `/auth/rotate/*` vía `fetch`
  estándar (funciona igual en una pestaña de navegador que dentro de un
  webview de Tauri — no necesita un comando nativo).
- `indexeddb-pending-rotation-store.ts` — `IndexedDbPendingRotationStore`,
  el `PendingRotationStore` por defecto: el registro pendiente ya está
  cifrado bajo la nueva KEK, así que se guarda en IndexedDB en lugar del
  Keychain del SO (§13: "protegido por el mismo perímetro que la
  bóveda, no una superficie nueva") o SQLite nativo — esto mantiene el
  adaptador libre de dependencias tanto en la Demo Web de Vercel como
  en Tauri Desktop.
- `reconnection.ts` — `reconnect()`: compone
  `HttpOpaqueRotationClient` + `IndexedDbPendingRotationStore` (o
  cualquier otro `PendingRotationStore`) con la máquina de estados en la
  única llamada que hace un cliente al reconectarse; no hace nada, sin
  tocar la red, cuando no hay nada pendiente.
- `vault-account-store.ts` — `VaultAccountStore`/`VaultAccountRecord`:
  el registro local de unlock (`localSalt` + `wrappedMasterDek`) que
  `UnlockScreen` (`src/ui/`) lee en cada reinicio de la app para
  decidir entre "ya existe una bóveda, pedí la master password" y "no
  hay bóveda todavía, corré la ceremonia de creación". A propósito NO
  incluye `recoverySalt`/`wrappedRecoveryDek` (registration.ts dice que
  esos son para el servidor, `POST /vault-keys`) ni `recoveryKitSecret`
  (se muestra al usuario una sola vez, nunca se persiste, sección 3).
- `indexeddb-vault-account-store.ts` — `IndexedDbVaultAccountStore`, el
  `VaultAccountStore` por defecto. Tiene su propia base de datos
  (`jano-vault-account`), separada de la `jano-engine` de
  `indexeddb-pending-rotation-store.ts` — dos clases independientes con
  esquemas independientes, evitando que tengan que coordinar un mismo
  `DB_VERSION`/`onupgradeneeded`.
- `__tests__/` — un archivo de test por cada módulo anterior (9
  archivos, 28 tests a la fecha de esta versión, incluyendo dos tests
  end-to-end con criptografía real del pipeline completo de rotación
  offline -> reconexión) — ver
  [`../../docs/TESTING-01.md`](../../docs/TESTING-01.md) sección 3.2
  para el desglose completo.

## `src/ui/`

- `UnlockScreen.tsx` — ítem 2 del checklist de Fase 1 (documento
  complementario de DOCVIS-JANO-01). Los tokens de paleta/tipografía
  de Fase 2 (`theme.css`, arriba) se aplican acá solo vía `className`/
  `data-crypto-active` -- ningún flujo cambió de comportamiento.
  Dos flujos reales contra un
  `EngineClient` real (`src/worker/`): crear una bóveda nueva (después
  mostrar la clave de recuperación exactamente una vez, sección 3)
  cuando `VaultAccountStore.load()` no encuentra nada local, o pedir la
  master password cuando sí encuentra algo. La retroalimentación
  mientras el worker está ocupado es UN solo mensaje estable
  ("Unlocking vault...") en ambos flujos — no aparece ningún detalle
  granular de fase acá, según el no-negociable de DOCVIS-JANO-01 sobre
  ese punto.
- `bytes-to-base64.ts` — helper chiquito basado en `btoa` para mostrar
  la clave de recuperación como texto. Duplicado (no importado) del
  `toBase64` de `engine/rotation-http-client.ts` a propósito — ese
  archivo es un cliente de red; traerlo a la capa de UI por tres líneas
  agregaría una dependencia que esta capa no tiene otro motivo para
  tener.
- `CredentialRevealView.tsx` — ítem 3 del checklist de Fase 1. Los
  tokens de Fase 2 se aplican igual que en `UnlockScreen.tsx` — solo
  `className`/`data-crypto-active`/`data-copy-confirmed`, sin cambio
  de comportamiento. Enmascarada por defecto; `revealPassword()` es
  el paso de descifrado del caller (compuesto en `App.tsx` desde
  `EngineClient.decryptItem` + `deserializeVaultItem` — este
  componente solo maneja un `string` plano que le entregaron
  explícitamente, siguiendo la regla de types.ts de que convertir
  `Bytes` del motor a `string` es trabajo declarado de la capa de UI,
  no del motor). El nodo revelado se elimina del DOM (no solo se
  oculta) al perder foco, o después de `UI_AUTO_MASK_TIMEOUT_MS`
  (`../config.ts`) si sigue con foco. Copiar activa
  `scheduleClipboardAutoClear` (`../clipboard/`) y muestra una
  confirmación que nunca es solo color (requisito de accesibilidad de
  DOCVIS-JANO-01): un texto "Copied to clipboard.", un glyph
  `[COPIED]`, y un atributo `data-copy-confirmed` en el `<p>` que
  envuelve todo — ese atributo es el hook funcional real que el
  checklist de Fase 2 (sección 4) asumía que ya existía como un cambio
  de borde 1px→2px; el borde en sí es un token visual de Fase 2 que se
  aplica sobre este atributo más adelante, no está construido acá.
- `VaultStatusIndicator.tsx` — la pieza funcional que el checklist de
  Fase 2 (sección 3) asumía que ya existía; no era así. Sin estilo a
  propósito, misma regla que el resto de este directorio. Calcula
  exactamente uno de los tres estados de texto de DOCVIS-JANO-01 a
  partir de señales reales: un resultado de `PendingRotationStore.load()`
  (solo presencia — ese registro está sellado bajo una KEK que este
  componente no tiene por qué tener, ver
  `engine/rotation-state-machine.ts`) y `navigator.onLine` (inyectable
  vía `isOnline`), re-evaluado en vivo ante eventos `online`/`offline`
  de la ventana. La `N` en `PENDING SYNC: N ATOMIC ROTATION` siempre es
  `1` cuando hay una rotación pendiente — no es arbitrario, es
  consecuencia directa de que `IndexedDbPendingRotationStore` es un
  diseño de un solo slot a propósito (una rotación pendiente por
  dispositivo, por construcción).
- `App.tsx` — componente raíz. Renderiza `UnlockScreen` hasta que un
  `EngineClient` vuelve desbloqueado. Todavía no hay storage real de
  ítems de bóveda (WatermelonDB no está construido — ver abajo), así
  que una vez desbloqueado cifra UN ítem de demo con la DEK residente
  real y renderiza `CredentialRevealView` contra ese ciphertext real —
  nada acá persiste entre un ciclo de lock/unlock, que es exactamente
  lo correcto para un placeholder que representa una capa de storage
  que todavía no existe. También tiene el botón `Lock` (`client.lock()`
  + `client.terminate()`) para probar a mano el ciclo completo de
  crear/desbloquear/revelar/lock de punta a punta.
- `__tests__/UnlockScreen.test.tsx` — test de componente contra un
  `EngineClient`/Worker REAL (solo el store local es un fake en memoria
  simple, inyectado vía `UnlockScreenProps.store`): el camino completo
  crear-bóveda -> clave-de-recuperación -> cliente-funcional-entregado,
  la validación de passwords-no-coinciden que nunca toca el motor, y
  unlock con password incorrecta seguido de la correcta.
- `__tests__/CredentialRevealView.test.tsx` — test de componente
  contra un `EngineClient`/Worker REAL (solo el `ClipboardAdapter` es
  un fake simple): descifrado real al revelar, destrucción del DOM al
  perder foco, auto-enmascarado después de `UI_AUTO_MASK_TIMEOUT_MS`, y
  copiar escribiendo la password real al portapapeles (fake) con
  confirmación de texto que lleva tanto el glyph `[COPIED]` como el
  atributo `data-copy-confirmed`.
- `__tests__/VaultStatusIndicator.test.tsx` — cubre cada uno de los
  tres estados por separado contra fakes inyectables de
  `PendingRotationStore` y `navigator.onLine`, la reacción en vivo a
  eventos `online`/`offline` de la ventana, y que una rotación
  pendiente nunca se pisa por un evento de conectividad.

## `src/clipboard/`

Distinción Web vs. Tauri de portapapeles, sección 10 de
ARCHITECTURE-01.md — respalda el botón de copiar de
`CredentialRevealView.tsx`.

- `clipboard-adapter.ts` — la interfaz compartida `ClipboardAdapter`
  (`writeText`/`readText`/`clear`) que ambas implementaciones cumplen,
  más `getClipboardAdapter()`: elige la real en tiempo de ejecución vía
  `isTauri()` de `@tauri-apps/api/core`, usando un `import()` dinámico
  por rama para que el bundle Web nunca cargue el JS de
  `@tauri-apps/plugin-clipboard-manager` (y viceversa).
- `web-clipboard-adapter.ts` — `navigator.clipboard`. `readText()`
  devuelve `null` en vez de lanzar cuando el navegador se niega (lo más
  común: sin foco del documento, la propia limitación que declara la
  sección 10); `clear()` sobreescribe con un string vacío — no hay un
  primitivo real de "limpiar el portapapeles" en la plataforma Web.
- `tauri-clipboard-adapter.ts` — `@tauri-apps/plugin-clipboard-manager`
  (agregado en este pase: `src-tauri/Cargo.toml`, registrado en el
  builder de `src-tauri/src/lib.rs`, permisos otorgados en
  `src-tauri/capabilities/default.json`). Un comando real del
  portapapeles del sistema operativo, incluyendo un `clear()` real —
  no una sobreescritura con string vacío. **No verificado en este
  sandbox** (misma disciplina que `engine/opaque-client.ts`):
  confirmado contra las firmas reales de función del propio
  `dist-js/index.d.ts` del paquete de npm, pero necesita una build real
  de Tauri para invocar algo de verdad.
- `schedule-clipboard-auto-clear.ts` — activa una limpieza demorada
  (`CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS`, `../config.ts`) que solo limpia
  de verdad si el portapapeles todavía tiene exactamente lo que se
  copió — "copiar-y-verificar-antes-de-limpiar" según el checklist de
  Fase 1. Nunca limpia contenido que no verificó haber puesto ahí él
  mismo.
- `__tests__/` — `web-clipboard-adapter.test.ts` y
  `tauri-clipboard-adapter.test.ts` (este último necesariamente mockea
  el plugin — no hay IPC real de Tauri en Vitest, igual que otros tests
  de este código que fakean un sistema externo al que no pueden llegar
  directamente) cubren cada uno su propia lógica de
  pass-through/null-en-falla; `schedule-clipboard-auto-clear.test.ts`
  cubre la decisión de verificar-antes-de-limpiar en sí (limpia si
  coincide, nunca limpia si no coincide o si no se pudo verificar) con
  timers falsos.

No implementado todavía en este folder: la integración con
WatermelonDB, el algoritmo de conflict-fork (§14) del lado cliente, y
la actualización a firma asimétrica (Ed25519/P-256) para el Factor 2 de
rotación — esta última también está pendiente del lado del servidor,
hoy con un secreto HMAC compartido documentado explícitamente como
provisional, pospuesto a propósito para la fase final de hardening.
