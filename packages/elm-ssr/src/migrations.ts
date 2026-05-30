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

const isUpMigration = (name: string): boolean =>
  name.endsWith(".sql") && !name.endsWith(".down.sql");

const ensureTable = async (adapter: MigrationsAdapter, table: string): Promise<void> => {
  await adapter.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
};

const runTransaction = async (adapter: MigrationsAdapter, work: () => Promise<void>): Promise<void> => {
  if (adapter.runInTransaction) {
    await adapter.runInTransaction(work);
    return;
  }

  await adapter.exec("BEGIN");
  try {
    await work();
    await adapter.exec("COMMIT");
  } catch (error) {
    try {
      await adapter.exec("ROLLBACK");
    } catch {
      // ignore — backend may have already rolled back
    }
    throw error;
  }
};

export const runMigrations = async (
  adapter: MigrationsAdapter,
  options: RunMigrationsOptions
): Promise<MigrationResult> => {
  const table = options.tableName ?? "__elm_ssr_migrations";
  validateTableName(table);

  const now = options.now ?? (() => new Date().toISOString());

  await ensureTable(adapter, table);

  const rows = await adapter.list(`SELECT name FROM ${table}`);
  const alreadyApplied = new Set(rows.map((row) => String(row.name)));

  const allFiles = (await readdir(options.dir)).filter(isUpMigration).sort();

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

    try {
      await runTransaction(adapter, async () => {
        if (trimmed.length > 0) {
          await adapter.exec(trimmed);
        }
        await adapter.exec(insertSql);
      });
      applied.push(file);
    } catch (error) {
      throw new Error(`Migration "${file}" failed: ${String(error)}`);
    }
  }

  return { applied, skipped };
};

// === Down migrations ===

export interface RevertMigrationsOptions {
  /** Directory containing the matching `<name>.down.sql` files. */
  dir: string;
  /** Override the tracking table name (default `"__elm_ssr_migrations"`). */
  tableName?: string;
  /** How many of the most-recently-applied migrations to revert. Default `1`. */
  count?: number;
}

export interface RevertResult {
  /** Migration filenames reverted in this run, most-recent-first. */
  reverted: string[];
}

/**
 * Revert the most-recently-applied migrations. For each one, runs the paired
 * `<name>.down.sql` from `dir` and removes the tracking row, transactionally.
 * Errors if a paired down file is missing — migrations are forward-only by
 * default; opt in to reverts by shipping `*.down.sql` alongside `*.sql`.
 */
export const revertMigrations = async (
  adapter: MigrationsAdapter,
  options: RevertMigrationsOptions
): Promise<RevertResult> => {
  const table = options.tableName ?? "__elm_ssr_migrations";
  validateTableName(table);

  await ensureTable(adapter, table);

  const rows = await adapter.list(`SELECT name FROM ${table} ORDER BY name DESC`);
  const applied = rows.map((row) => String(row.name));
  const count = Math.max(0, options.count ?? 1);
  const toRevert = applied.slice(0, count);
  const reverted: string[] = [];

  for (const file of toRevert) {
    const downName = file.replace(/\.sql$/, ".down.sql");
    let downSql: string;
    try {
      downSql = await readFile(resolve(options.dir, downName), "utf8");
    } catch {
      throw new Error(`No down migration for "${file}" (expected ${downName})`);
    }

    const trimmed = downSql.replace(/[\s;]+$/, "");
    const deleteSql = `DELETE FROM ${table} WHERE name = ${escapeLiteral(file)}`;

    try {
      await runTransaction(adapter, async () => {
        if (trimmed.length > 0) {
          await adapter.exec(trimmed);
        }
        await adapter.exec(deleteSql);
      });
      reverted.push(file);
    } catch (error) {
      throw new Error(`Reverting "${file}" failed: ${String(error)}`);
    }
  }

  return { reverted };
};

// === Status ===

export interface ListMigrationsOptions {
  /** Directory containing `*.sql` migration files. */
  dir: string;
  /** Override the tracking table name (default `"__elm_ssr_migrations"`). */
  tableName?: string;
}

export interface MigrationsStatus {
  /** Already-applied migrations, oldest first. */
  applied: Array<{ name: string; appliedAt: string }>;
  /** On-disk migrations that haven't been applied yet. */
  pending: string[];
}

/**
 * Inspect the migration state: what's applied (with timestamps) and what
 * remains. Creates the tracking table on first use.
 */
export const listMigrations = async (
  adapter: MigrationsAdapter,
  options: ListMigrationsOptions
): Promise<MigrationsStatus> => {
  const table = options.tableName ?? "__elm_ssr_migrations";
  validateTableName(table);

  await ensureTable(adapter, table);

  const rows = await adapter.list(`SELECT name, applied_at FROM ${table} ORDER BY name`);
  const applied = rows.map((row) => ({ name: String(row.name), appliedAt: String(row.applied_at) }));
  const appliedSet = new Set(applied.map((entry) => entry.name));

  const allFiles = (await readdir(options.dir)).filter(isUpMigration).sort();
  const pending = allFiles.filter((file) => !appliedSet.has(file));

  return { applied, pending };
};
