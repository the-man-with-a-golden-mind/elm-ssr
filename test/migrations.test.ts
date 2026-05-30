import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  listMigrations,
  revertMigrations,
  runMigrations,
  type MigrationsAdapter
} from "elm-ssr/migrations";

// The migration runner is backend-neutral; here we drive it against an
// in-memory SQLite database via bun:sqlite. The same `MigrationsAdapter`
// shape works for Postgres (Bun.sql / node-postgres) and D1 — the integration
// test in test/integration/ covers Postgres against a real server.

const sqliteAdapter = (db: Database): MigrationsAdapter => ({
  exec: async (sql) => {
    db.exec(sql);
  },
  list: async (sql) => db.query(sql).all() as Array<Record<string, unknown>>
});

let dir: string;
let db: Database;
let adapter: MigrationsAdapter;

const seed = async (files: Record<string, string>): Promise<void> => {
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(resolve(dir, name), sql)));
};

beforeEach(async () => {
  dir = await mkdtemp(resolve(tmpdir(), "elm-ssr-mig-"));
  db = new Database(":memory:");
  adapter = sqliteAdapter(db);
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("applies all pending migrations in alphabetical order and tracks them", async () => {
    await seed({
      "0001_users.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
      "0002_posts.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);"
    });

    const result = await runMigrations(adapter, { dir, now: () => "2026-01-01T00:00:00Z" });

    expect(result.applied).toEqual(["0001_users.sql", "0002_posts.sql"]);
    expect(result.skipped).toEqual([]);

    const tracked = db.query("SELECT name, applied_at FROM __elm_ssr_migrations ORDER BY name").all();
    expect(tracked).toEqual([
      { name: "0001_users.sql", applied_at: "2026-01-01T00:00:00Z" },
      { name: "0002_posts.sql", applied_at: "2026-01-01T00:00:00Z" }
    ]);
    // The migrations actually ran.
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','posts') ORDER BY name").all())
      .toEqual([{ name: "posts" }, { name: "users" }]);
  });

  it("is idempotent: re-running skips already-applied migrations", async () => {
    await seed({
      "0001_init.sql": "CREATE TABLE t (id INTEGER);"
    });

    await runMigrations(adapter, { dir });
    const second = await runMigrations(adapter, { dir });

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["0001_init.sql"]);
  });

  it("only applies pending migrations on subsequent runs", async () => {
    await seed({ "0001_init.sql": "CREATE TABLE t1 (id INTEGER);" });
    await runMigrations(adapter, { dir });

    await seed({ "0002_more.sql": "CREATE TABLE t2 (id INTEGER);" });
    const result = await runMigrations(adapter, { dir });

    expect(result.applied).toEqual(["0002_more.sql"]);
    expect(result.skipped).toEqual(["0001_init.sql"]);
  });

  it("rolls back a failing migration without leaving partial schema or tracking", async () => {
    await seed({
      "0001_good.sql": "CREATE TABLE good (id INTEGER);",
      "0002_broken.sql": "CREATE TABLE broken (id INTEGER); INSERT INTO broken (no_such_column) VALUES (1);"
    });

    await expect(runMigrations(adapter, { dir })).rejects.toThrow(/0002_broken\.sql/);

    // First migration was applied (it's in its own transaction).
    expect(db.query("SELECT name FROM __elm_ssr_migrations").all()).toEqual([
      { name: "0001_good.sql" }
    ]);
    // The broken migration's CREATE TABLE was rolled back.
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='broken'").all()).toEqual([]);
    // The good one stuck.
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='good'").all())
      .toEqual([{ name: "good" }]);

    // After fixing the broken file, re-running applies only what's missing.
    await writeFile(resolve(dir, "0002_broken.sql"), "CREATE TABLE broken (id INTEGER);");
    const retry = await runMigrations(adapter, { dir });
    expect(retry.applied).toEqual(["0002_broken.sql"]);
  });

  it("ignores non-.sql files in the directory", async () => {
    await seed({
      "0001_real.sql": "CREATE TABLE r (id INTEGER);",
      "README.md": "# Migrations",
      "draft.txt": "not yet"
    });

    const result = await runMigrations(adapter, { dir });
    expect(result.applied).toEqual(["0001_real.sql"]);
  });

  it("supports a custom tracking table name", async () => {
    await seed({ "0001_init.sql": "CREATE TABLE t (id INTEGER);" });
    await runMigrations(adapter, { dir, tableName: "schema_history" });

    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_history'").all())
      .toEqual([{ name: "schema_history" }]);
  });

  it("rejects unsafe tracking table names", async () => {
    await seed({ "0001_init.sql": "CREATE TABLE t (id INTEGER);" });
    await expect(runMigrations(adapter, { dir, tableName: "bad name; DROP TABLE x" })).rejects.toThrow(/Invalid/);
  });

  it("escapes single quotes in filenames safely", async () => {
    await seed({ "0001_o'clock.sql": "CREATE TABLE clk (id INTEGER);" });
    const result = await runMigrations(adapter, { dir });
    expect(result.applied).toEqual(["0001_o'clock.sql"]);
    expect(db.query("SELECT name FROM __elm_ssr_migrations").all())
      .toEqual([{ name: "0001_o'clock.sql" }]);
  });

  it("ignores `.down.sql` files on the up pass", async () => {
    await seed({
      "0001_init.sql": "CREATE TABLE t (id INTEGER);",
      "0001_init.down.sql": "DROP TABLE t;"
    });
    const result = await runMigrations(adapter, { dir });
    expect(result.applied).toEqual(["0001_init.sql"]);
  });
});

describe("revertMigrations", () => {
  it("reverts the most-recently-applied migration via its paired down file", async () => {
    await seed({
      "0001_users.sql": "CREATE TABLE users (id INTEGER);",
      "0001_users.down.sql": "DROP TABLE users;",
      "0002_posts.sql": "CREATE TABLE posts (id INTEGER);",
      "0002_posts.down.sql": "DROP TABLE posts;"
    });
    await runMigrations(adapter, { dir });

    const result = await revertMigrations(adapter, { dir });

    expect(result.reverted).toEqual(["0002_posts.sql"]);
    expect(db.query("SELECT name FROM __elm_ssr_migrations").all()).toEqual([{ name: "0001_users.sql" }]);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','posts')").all())
      .toEqual([{ name: "users" }]);
  });

  it("reverts multiple migrations when count > 1, most-recent first", async () => {
    await seed({
      "0001_users.sql": "CREATE TABLE users (id INTEGER);",
      "0001_users.down.sql": "DROP TABLE users;",
      "0002_posts.sql": "CREATE TABLE posts (id INTEGER);",
      "0002_posts.down.sql": "DROP TABLE posts;"
    });
    await runMigrations(adapter, { dir });

    const result = await revertMigrations(adapter, { dir, count: 2 });

    expect(result.reverted).toEqual(["0002_posts.sql", "0001_users.sql"]);
    expect(db.query("SELECT name FROM __elm_ssr_migrations").all()).toEqual([]);
  });

  it("errors clearly when a down migration is missing", async () => {
    await seed({ "0001_init.sql": "CREATE TABLE t (id INTEGER);" });
    await runMigrations(adapter, { dir });

    await expect(revertMigrations(adapter, { dir })).rejects.toThrow(/No down migration/);
  });

  it("rolls back a failing revert without removing the tracking row", async () => {
    await seed({
      "0001_init.sql": "CREATE TABLE t (id INTEGER);",
      "0001_init.down.sql": "DROP TABLE no_such_table;"
    });
    await runMigrations(adapter, { dir });

    await expect(revertMigrations(adapter, { dir })).rejects.toThrow(/0001_init\.sql/);

    // Tracking row is still there; original table still there.
    expect(db.query("SELECT name FROM __elm_ssr_migrations").all()).toEqual([{ name: "0001_init.sql" }]);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").all())
      .toEqual([{ name: "t" }]);
  });

  it("is a no-op when there's nothing applied", async () => {
    const result = await revertMigrations(adapter, { dir });
    expect(result.reverted).toEqual([]);
  });
});

describe("listMigrations", () => {
  it("reports applied entries (with timestamps) and pending filenames", async () => {
    await seed({
      "0001_users.sql": "CREATE TABLE users (id INTEGER);",
      "0002_posts.sql": "CREATE TABLE posts (id INTEGER);",
      "0003_comments.sql": "CREATE TABLE comments (id INTEGER);"
    });
    await runMigrations(adapter, { dir, now: () => "2026-05-30T00:00:00Z" });

    // Now add a pending one without applying.
    await seed({ "0004_likes.sql": "CREATE TABLE likes (id INTEGER);" });

    const status = await listMigrations(adapter, { dir });

    expect(status.applied).toEqual([
      { name: "0001_users.sql", appliedAt: "2026-05-30T00:00:00Z" },
      { name: "0002_posts.sql", appliedAt: "2026-05-30T00:00:00Z" },
      { name: "0003_comments.sql", appliedAt: "2026-05-30T00:00:00Z" }
    ]);
    expect(status.pending).toEqual(["0004_likes.sql"]);
  });

  it("creates the tracking table on first call (returns empty applied + all pending)", async () => {
    await seed({ "0001_init.sql": "CREATE TABLE t (id INTEGER);" });
    const status = await listMigrations(adapter, { dir });
    expect(status.applied).toEqual([]);
    expect(status.pending).toEqual(["0001_init.sql"]);
  });
});
