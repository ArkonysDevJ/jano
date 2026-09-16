import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Owns the single `pg` connection pool shared by all five Postgres
 * repositories (docs/schema.sql). A plain factory provider returning
 * `new Pool(...)` would work too, but wrapping it in an injectable
 * class gives Nest's lifecycle hooks a place to call `pool.end()` on
 * shutdown (`onModuleDestroy`) -- otherwise the process can hang on
 * exit holding open TCP connections to Postgres, or leak them across
 * hot-reloads under `--watch`.
 *
 * Fails fast and explicitly if `DATABASE_URL` is missing, same pattern
 * as CloudflareOpaqueServerProvider's own explicit checks for the
 * OPAQUE_* secrets -- a clear message at boot beats `pg`'s own cryptic
 * connection-refused error a request or two later.
 */
@Injectable()
export class PgPoolManager implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not configured. Copy apps/api/.env.example to ' +
          'apps/api/.env and start the local database with ' +
          '`docker compose up -d` (repo root) before running the API.',
      );
    }
    this.pool = new Pool({ connectionString });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
