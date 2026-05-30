# SQL migrations

A small, backend-neutral, transactional SQL-file migration runner. Files live
in a directory (e.g. `migrations/0001_init.sql`), get applied in alphabetical
order, and are tracked in `__elm_ssr_migrations(name PRIMARY KEY, applied_at)`.

The runner is also wired into the CLI as
[`elm-ssr migrate up|down|status`](cli.md).

## Files

```
migrations/
  0001_init.sql
  0001_init.down.sql      # optional, paired for `migrate down`
  0002_add_users.sql
  0002_add_users.down.sql
```

- Numeric prefix → alphabetical sort matches creation order.
- `.down.sql` is optional but required if you want to revert that migration.
- The runner ignores any non-`.sql` files and ignores `.down.sql` on the up
  pass.

## Safety

Each migration runs inside a single `BEGIN…COMMIT` transaction **together
with** its tracking insert. If the SQL fails, the transaction rolls back and
the tracking row is never written, so the next run picks up exactly where
this one stopped.

Backends with native transaction support can override this by providing
`runInTransaction(fn)` on the adapter. The Postgres adapter the CLI ships
uses `sql.begin(fn)` for proper transactional safety; SQLite uses raw
`BEGIN`/`COMMIT`.

## CLI

```sh
elm-ssr migrate up                         # Apply all pending
elm-ssr migrate down                       # Revert the most recent
elm-ssr migrate down --count 3             # Revert the last 3
elm-ssr migrate status                     # Show applied (with timestamps) + pending

# Connection string options:
elm-ssr migrate up --db postgres://user:pass@localhost:5432/db
elm-ssr migrate up --db sqlite://./app.db
elm-ssr migrate up --db ./app.db           # bare path = SQLite

# Reads DATABASE_URL if --db is omitted.
DATABASE_URL=postgres://... elm-ssr migrate up

# Other flags:
elm-ssr migrate up --dir ./db/migrations   # default: ./migrations
elm-ssr migrate up --table schema_history  # default: __elm_ssr_migrations
```

## Programmatic API

```ts
import {
  runMigrations,
  revertMigrations,
  listMigrations,
  type MigrationsAdapter
} from "elm-ssr/migrations";

// Adapter shape — wire any backend:
interface MigrationsAdapter {
  exec(sql: string): Promise<void>;                              // multi-statement, no params
  list(sql: string): Promise<Array<Record<string, unknown>>>;    // query
  runInTransaction?(fn: () => Promise<void>): Promise<void>;     // optional native txn
}
```

### bun:sqlite

```ts
import { Database } from "bun:sqlite";

const db = new Database("./app.db");
const adapter: MigrationsAdapter = {
  exec: async (sql) => { db.exec(sql); },
  list: async (sql) => db.query(sql).all() as Array<Record<string, unknown>>
};

await runMigrations(adapter, { dir: "./migrations" });
```

### Postgres (Bun.sql)

```ts
import { SQL } from "bun";

const sql = new SQL(process.env.DATABASE_URL!);
const adapter: MigrationsAdapter = {
  exec: async (text) => { await sql.unsafe(text); },
  list: async (text) => {
    const rows = await sql.unsafe(text);
    return Array.isArray(rows) ? rows : [...(rows ?? [])];
  },
  runInTransaction: async (fn) => { await sql.begin(fn); }
};

await runMigrations(adapter, { dir: "./migrations" });
```

### D1 (Cloudflare)

D1 doesn't expose multi-statement `exec` with `runInTransaction`, so use one
statement per migration file and run from a scheduled Worker or a build step.

## Return values

```ts
type MigrationResult = { applied: string[]; skipped: string[] };
type RevertResult    = { reverted: string[] };
type MigrationsStatus = {
  applied: Array<{ name: string; appliedAt: string }>;
  pending: string[];
};
```

## What you can rely on

- **Idempotent.** Re-running `up` skips anything already in
  `__elm_ssr_migrations`.
- **Forward-only by default.** `down` errors loudly if the paired
  `.down.sql` is missing.
- **Safe failure.** A throwing migration rolls back (assuming a transactional
  backend); the tracking row is never written.
- **Custom table name.** Pass `tableName` if `__elm_ssr_migrations` clashes
  with anything. The name is validated against
  `^[A-Za-z_][A-Za-z0-9_]*$` to prevent SQL injection via the option.

## Source

- [packages/elm-ssr/src/migrations.ts](../packages/elm-ssr/src/migrations.ts)
- [packages/elm-ssr/lib/migrate.mjs](../packages/elm-ssr/lib/migrate.mjs)
- Tests:
  [test/migrations.test.ts](../test/migrations.test.ts),
  [test/cli-migrate.test.ts](../test/cli-migrate.test.ts),
  [test/integration/redis-postgres.test.ts](../test/integration/redis-postgres.test.ts)
