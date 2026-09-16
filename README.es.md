# Jano

Gestor de contraseñas local-first, zero-knowledge real — Producto 2 de
Arkonys. El backend nunca tiene capacidad de descifrar el vault, ni
comprometido por completo. Copia en la nube con el mismo nivel de
protección que la copia local, no un backup que reduce seguridad.

Repositorio público bajo la marca `ArkonysDevJ` — el criterio de diseño
de seguridad es visible y auditable en el propio código, no un documento
aparte del sistema.

## Estado

Arquitectura técnica **sellada** (V1.3, CIERRE de André, 10/09/2026) —
ver [`docs/ARCHITECTURE-01.md`](docs/ARCHITECTURE-01.md) para la
arquitectura completa: modelo de amenaza, autenticación (OPAQUE +
Argon2id), cifrado (AES-256-GCM), motor de sync (WatermelonDB), rotación
de clave, y el punto abierto de exposición de credenciales en UI (§10).
Ver [`docs/TESTING-01.md`](docs/TESTING-01.md) para cómo correr y
verificar todo esto — comandos de prueba, setup del servidor en vivo, y
la colección de Bruno.

Los módulos de dominio de `apps/api` están implementados y probados
contra un servidor real en ejecución:

- **Auth** — registro/login OPAQUE (aPAKE) vía `@cloudflare/opaque-ts`,
  JWTs de sesión/refresh.
- **Vault** — CRUD ciego sobre blobs de ciphertext opaco; el servidor
  nunca ve texto plano.
- **VaultKeys** — registro de envolturas del DEK master/recovery,
  versionadas de forma independiente (§3).
- **Sync** — gate de reconciliación por versión de clave y
  conflict-fork (§14), reemplazando last-write-wins.
- **Rotation** — re-registro offline `pending_opaque_rotation` (§13),
  con rate limiting en `/auth/rotate/*`.

El motor de cifrado de `apps/desktop` (`src/engine/`) cubre derivación
Argon2id (KEK), envoltura/desenvoltura AES-256-GCM, ciclo de vida
KEK/DEK (§9), creación de vault (envolturas duales master/recovery), la
máquina de estados de rotación offline, y el orquestador de reconexión
que conecta esa máquina de estados con un servidor OPAQUE real por
HTTP (con un almacén de rotaciones pendientes respaldado por
IndexedDB, agnóstico de storage y de red por diseño) — ver
[`apps/desktop/README.es.md`](apps/desktop/README.es.md).

Suite de pruebas: 102/102 pasando (38 en `apps/api`, 64 en `apps/desktop`,
incluyendo un round-trip criptográfico OPAQUE real, Argon2id/WebCrypto
reales, un test de integración con un Web Worker real del límite de
RPC motor↔UI (sección 9), y tests de componente con motor real de la
pantalla de unlock y de la vista de revelación/copia de credencial
(Fase 1) — ver la sección 3 de `docs/TESTING-01.md` para el desglose
por archivo).

Todavía no construido: la actualización a firma asimétrica
(Ed25519/P-256) para el Factor 2 de rotación, que hoy usa un secreto
HMAC compartido, documentado explícitamente como provisional
(pospuesto a propósito para la fase final de hardening); la
integración de WatermelonDB y el storage real de ítems de bóveda; y la
Fase 2 (identidad visual, DOCVIS-JANO-01) de la UI de escritorio. La
Fase 1 (funcional, sin estilo, pantalla de unlock y vista de
revelación/copia de una sola credencial) y el empaquetado con Tauri ya
están cerrados — ver la sección 3.4 de `docs/TESTING-01.md`.

## Estructura

```
jano/
├── apps/
│   ├── api/       NestJS — servidor ciego (OPAQUE, Vault, Sync, VaultKeys, Rotation)
│   └── desktop/   Tauri (pendiente de init) + motor de cifrado
├── docs/
│   ├── ARCHITECTURE-01.md
│   ├── TESTING-01.md
│   └── schema.sql
```

## Stack

- Backend: NestJS + Fastify + PostgreSQL (persistencia real, ver
  `docs/TESTING-01.md`)
- Cliente: Tauri + WatermelonDB
- Auth: OPAQUE (aPAKE) para sync online, Argon2id para desbloqueo local
  offline — dos planos físicamente distintos, no intercambiables (§4)
- Cifrado: AES-256-GCM, nonce de 96 bits, CSPRNG, por operación (§5)

## Desarrollo

```
npm install
npm run dev:api               # apps/api — servidor de desarrollo, watch mode
npm run test --workspace=apps/api
npm run test:desktop          # apps/desktop — tests del motor de cifrado
```

Requiere Node 22 (ver `.node-version`). `apps/api` es un paquete ESM
nativo (lo exige la versión instalada de NestJS, que ya solo distribuye
ESM). `apps/desktop` todavía no tiene una app ejecutable — necesita el
toolchain de Tauri primero, ver su README.

Ver [`docs/TESTING-01.md`](docs/TESTING-01.md) para el procedimiento
completo de verificación: setup de entorno (`.env`, secretos del
servidor OPAQUE), cómo ejercitar la API en vivo con criptografía OPAQUE
real, y la colección numerada de Bruno (`apps/api/bruno/`).

## Licencia

MIT — ver [`LICENSE`](LICENSE).
