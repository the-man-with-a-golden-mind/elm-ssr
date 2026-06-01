# migrations (AI)

**Subpath:** `elm-ssr/migrations`. **CLI:** `elm-ssr migrate <up|down|status>`.

SQL-file migrations. Files in a directory, alphabetical order, tracked in
`__elm_ssr_migrations(name PRIMARY KEY, applied_at)`. Each migration runs
in its own `BEGIN..COMMIT` together with its tracking insert.

## File layout

```
migrations/
  0001_init.sql
  0001_init.down.sql       # optional; required for `migrate down`
  0002_add_users.sql
  0002_add_users.down.sql
```

- Numeric prefix → alphabetical sort = creation order.
- `.down.sql` is paired. Missing one → `migrate down` errors.
- Non-`.sql` files ignored. `.down.sql` ignored on `up`.

## Adapter interface

```ts
interface MigrationsAdapter {
  exec(sql: string): Promise<void>;                                  // multi-statement, no params
  list(sql: string): Promise<Array<Record<string, unknown>>>;        // SELECT
  runInTransaction?(fn: () => Promise<void>): Promise<void>;          // optional native txn
}
```

If `runInTransaction` is absent, the runner uses raw `BEGIN`/`COMMIT`/`ROLLBACK`.

## Exports

```ts
interface RunMigrationsOptions { dir: string; tableName?: string; now?: () => string; }
interface MigrationResult { applied: string[]; skipped: string[]; }

interface RevertMigrationsOptions { dir: string; tableName?: string; count?: number; }
interface RevertResult { reverted: string[]; }

interface ListMigrationsOptions { dir: string; tableName?: string; }
interface MigrationsStatus { applied: Array<{ name: string; appliedAt: string }>; pending: string[]; }

runMigrations(adapter: MigrationsAdapter, options: RunMigrationsOptions): Promise<MigrationResult>;
revertMigrations(adapter: MigrationsAdapter, options: RevertMigrationsOptions): Promise<RevertResult>;
listMigrations(adapter: MigrationsAdapter, options: ListMigrationsOptions): Promise<MigrationsStatus>;
```

## CLI

```sh
elm-ssr migrate up                                  # apply pending
elm-ssr migrate down                                # revert most recent
elm-ssr migrate down --count 3
elm-ssr migrate status                              # applied (with timestamps) + pending

elm-ssr migrate up --db postgres://user:pass@host:5432/db
elm-ssr migrate up --db sqlite://./app.db
elm-ssr migrate up --db ./app.db                    # bare path = SQLite
elm-ssr migrate up --dir ./db/migrations            # default ./migrations
elm-ssr migrate up --table schema_history           # default __elm_ssr_migrations

# Reads DATABASE_URL when --db is omitted.
```

## Minimal example: bun:sqlite

```ts
import { Database } from "bun:sqlite";
import { runMigrations, type MigrationsAdapter } from "elm-ssr/migrations";

const db = new Database("./app.db");
const adapter: MigrationsAdapter = {
  exec: async (sql) => { db.exec(sql); },
  list: async (sql) => db.query(sql).all() as Array<Record<string, unknown>>,
};

const result = await runMigrations(adapter, { dir: "./migrations" });
// → { applied: ["0001_init.sql"], skipped: [] }
```

## Minimal example: Postgres (Bun.sql)

```ts
import { SQL } from "bun";

const sql = new SQL(process.env.DATABASE_URL!);
const adapter: MigrationsAdapter = {
  exec: async (text) => { await sql.unsafe(text); },
  list: async (text) => {
    const rows = await sql.unsafe(text);
    return Array.isArray(rows) ? rows : [...(rows ?? [])];
  },
  runInTransaction: async (fn) => { await sql.begin(fn); },
};
```

## Patterns

- Run on every cold start: call `runMigrations` from your worker's setup (NOT per-request; cache the promise).
- Multi-environment: same migration files, different `--db` per environment.
- Custom table name: `tableName: "schema_history"` to avoid colliding with another tool.
- Down migration safety: revert keeps tracking row if the revert fails — re-run after fix.

## Footguns

- D1 doesn't expose multi-statement `exec` with a single transaction. Use ONE statement per migration file on D1, or run from a scheduled Worker.
- `tableName` is validated against `^[A-Za-z_][A-Za-z0-9_]*$`; anything else throws `Invalid migrations table name`.
- A throwing migration rolls back (transactional backend) — tracking row never written. Next run resumes from there.
- `.down.sql` missing → `revertMigrations` throws `No down migration for "<name>"`. Migrations are forward-only unless you opt in.
- `migrate down` reverts in REVERSE order (most recent first).
- CLI uses `bun:sqlite` for SQLite paths and `Bun.sql` for `postgres://` URLs — those must be installed (they're built into Bun).
