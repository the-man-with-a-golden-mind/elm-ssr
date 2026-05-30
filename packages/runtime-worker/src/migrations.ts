import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * SQL-file migration runner. Backend-neutral over a minimal `MigrationsAdapter`:
 * wire it to bun:sqlite, Postgres (Bun.sql / node-postgres), Cloudflare D1, etc.
 *
 * Migrations live in `<dir>/*.sql`, ordered alphabetically (use a numeric
 * prefix: `0001_init.sql`, `0002_add_users.sql`). Applied migrations are tracked
 * in `__elm_ssr_migrations(name PRIMARY KEY, applied_at)`; re-runs are
 * idempotent. Each migration runs inside a single `BEGIN…COMMIT` transaction
 * together with its tracking insert, so a failing migration rolls back without
 * leaving the schema partially applied (assuming a transactional backend).
 */
export interface MigrationsAdapter {
  /** Execute possibly-multi-statement SQL (no params). */
  exec(sql: string): Promise<void>;
  /** Run a query and return the result rows as plain objects. */
  list(sql: string): Promise<Array<Record<string, unknown>>>;
  /** Optional: Run a set of operations in a transaction. */
  runInTransaction?(fn: () => Promise<void>): Promise<void>;
}

export interface RunMigrationsOptions {
  /** Directory containing `*.sql` migration files. */
  dir: string;
  /** Override the tracking table name (default `"__elm_ssr_migrations"`). */
  tableName?: string;
  /** Override the timestamp generator (useful for deterministic tests). */
  now?: () => string;
}

export interface MigrationResult {
  /** Migration filenames applied during this run, in order. */
  applied: string[];
  /** Migration filenames that were already applied. */
  skipped: string[];
}

const escapeLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const validateTableName = (name: string): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid migrations table name: ${name}`);
  }
};

export const runMigrations = async (
  adapter: MigrationsAdapter,
  options: RunMigrationsOptions
): Promise<MigrationResult> => {
  const table = options.tableName ?? "__elm_ssr_migrations";
  validateTableName(table);

  const now = options.now ?? (() => new Date().toISOString());

  await adapter.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );

  const rows = await adapter.list(`SELECT name FROM ${table}`);
  const alreadyApplied = new Set(rows.map((row) => String(row.name)));

  const allFiles = (await readdir(options.dir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of allFiles) {
    if (alreadyApplied.has(file)) {
      skipped.push(file);
      continue;
    }

    const raw = await readFile(resolve(options.dir, file), "utf8");
    // Strip trailing whitespace + trailing semicolons so we can compose without `;;`.
    const trimmed = raw.replace(/[\s;]+$/, "");
    const insertSql = `INSERT INTO ${table} (name, applied_at) VALUES (${escapeLiteral(file)}, ${escapeLiteral(now())})`;

    const run = async () => {
      await adapter.exec(trimmed);
      await adapter.exec(insertSql);
    };

    try {
      if (adapter.runInTransaction) {
        await adapter.runInTransaction(run);
      } else {
        await adapter.exec("BEGIN");
        try {
          await run();
          await adapter.exec("COMMIT");
        } catch (error) {
          try {
            await adapter.exec("ROLLBACK");
          } catch {
            // ignore
          }
          throw error;
        }
      }
      applied.push(file);
    } catch (error) {
      throw new Error(`Migration "${file}" failed: ${String(error)}`);
    }
  }

  return { applied, skipped };
};
