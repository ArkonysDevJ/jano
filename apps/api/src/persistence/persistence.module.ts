import { Module } from '@nestjs/common';
import { PgPoolManager } from './postgres/pg-pool-manager.js';
import { PostgresUsersRepository } from './postgres/postgres-users.repository.js';
import { PostgresDevicesRepository } from './postgres/postgres-devices.repository.js';
import { PostgresVaultKeysRepository } from './postgres/postgres-vault-keys.repository.js';
import { PostgresVaultItemsRepository } from './postgres/postgres-vault-items.repository.js';
import { PostgresSyncEventsRepository } from './postgres/postgres-sync-events.repository.js';
import {
  DEVICES_REPOSITORY,
  SYNC_EVENTS_REPOSITORY,
  USERS_REPOSITORY,
  VAULT_ITEMS_REPOSITORY,
  VAULT_KEYS_REPOSITORY,
} from './tokens.js';

/**
 * STATUS: all five providers now run against real PostgreSQL
 * (docs/schema.sql) via a single shared `pg` Pool (PgPoolManager) --
 * data survives a process restart as of 2026-09-12. The in-memory
 * implementations (in-memory/) are NOT deleted: every *.spec.ts in
 * this codebase constructs its service under test directly with a
 * `new InMemory*Repository()` (never through this module), so they
 * remain the fast, no-database test double they always were. This
 * module is the only thing that changed -- AuthModule, VaultModule,
 * SyncModule, VaultKeysModule, and RotationModule all depend solely on
 * the tokens/interfaces in repositories.ts, never on these concrete
 * classes, exactly as the previous handoff's note here intended.
 *
 * Requires `DATABASE_URL` (apps/api/.env, see .env.example) pointing at
 * a running Postgres -- `docker compose up -d` from the repo root
 * starts one with docs/schema.sql already applied. PgPoolManager
 * throws a clear error at boot if it's missing, rather than failing
 * later on the first query.
 */
@Module({
  providers: [
    PgPoolManager,
    {
      provide: USERS_REPOSITORY,
      useFactory: (manager: PgPoolManager) => new PostgresUsersRepository(manager.pool),
      inject: [PgPoolManager],
    },
    {
      provide: DEVICES_REPOSITORY,
      useFactory: (manager: PgPoolManager) => new PostgresDevicesRepository(manager.pool),
      inject: [PgPoolManager],
    },
    {
      provide: VAULT_KEYS_REPOSITORY,
      useFactory: (manager: PgPoolManager) => new PostgresVaultKeysRepository(manager.pool),
      inject: [PgPoolManager],
    },
    {
      provide: VAULT_ITEMS_REPOSITORY,
      useFactory: (manager: PgPoolManager) => new PostgresVaultItemsRepository(manager.pool),
      inject: [PgPoolManager],
    },
    {
      provide: SYNC_EVENTS_REPOSITORY,
      useFactory: (manager: PgPoolManager) => new PostgresSyncEventsRepository(manager.pool),
      inject: [PgPoolManager],
    },
  ],
  exports: [
    USERS_REPOSITORY,
    DEVICES_REPOSITORY,
    VAULT_KEYS_REPOSITORY,
    VAULT_ITEMS_REPOSITORY,
    SYNC_EVENTS_REPOSITORY,
  ],
})
export class PersistenceModule {}
