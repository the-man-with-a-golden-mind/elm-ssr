import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
// @ts-expect-error JS sibling — Bun resolves the .mjs CLI at runtime; tsc doesn't include test/.
import { migrate } from "../packages/cli/lib/migrate.mjs";

// End-to-end smoke for the `elm-ssr migrate` CLI: applies the example app's
// migrations against a fresh SQLite file, then reverts, exercising the full
// path (subcommand parsing → adapter construction → runMigrations/revertMigrations).

const exampleMigrations = resolve(import.meta.dir, "..", "examples/basic/migrations");

let tmp: string;
let dbPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(resolve(tmpdir(), "elm-ssr-cli-"));
  dbPath = resolve(tmp, "app.db");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const silenceLog = () => {
  const log = mock(() => {});
  const original = console.log;
  (console as { log: typeof console.log }).log = log as unknown as typeof console.log;
  return () => {
    (console as { log: typeof console.log }).log = original;
  };
};

describe("elm-ssr migrate (CLI)", () => {
  it("applies the example migrations against SQLite (up → status → down)", async () => {
    const restore = silenceLog();

    try {
      await migrate(["up", "--dir", exampleMigrations, "--db", dbPath]);

      let db = new Database(dbPath);
      expect(db.query("SELECT name FROM sqlite_master WHERE name='entries'").all())
        .toEqual([{ name: "entries" }]);
      expect(db.query("SELECT name FROM __elm_ssr_migrations").all())
        .toEqual([{ name: "0001_guestbook.sql" }]);
      db.close();

      // Re-running up is a no-op.
      await migrate(["up", "--dir", exampleMigrations, "--db", dbPath]);
      db = new Database(dbPath);
      expect(db.query("SELECT name FROM __elm_ssr_migrations").all())
        .toEqual([{ name: "0001_guestbook.sql" }]);
      db.close();

      // status doesn't throw.
      await migrate(["status", "--dir", exampleMigrations, "--db", dbPath]);

      // down rolls back.
      await migrate(["down", "--dir", exampleMigrations, "--db", dbPath]);
      db = new Database(dbPath);
      expect(db.query("SELECT name FROM sqlite_master WHERE name='entries'").all()).toEqual([]);
      expect(db.query("SELECT name FROM __elm_ssr_migrations").all()).toEqual([]);
      db.close();
    } finally {
      restore();
    }
  });

  it("accepts a sqlite:// URL for --db", async () => {
    const restore = silenceLog();
    try {
      await migrate(["up", "--dir", exampleMigrations, "--db", `sqlite://${dbPath}`]);
      const db = new Database(dbPath);
      expect(db.query("SELECT name FROM sqlite_master WHERE name='entries'").all())
        .toEqual([{ name: "entries" }]);
      db.close();
    } finally {
      restore();
    }
  });

  it("errors when neither --db nor DATABASE_URL is set", async () => {
    const restore = silenceLog();
    const savedDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(migrate(["up", "--dir", exampleMigrations])).rejects.toThrow(/Missing --db/);
    } finally {
      if (savedDb !== undefined) {
        process.env.DATABASE_URL = savedDb;
      }
      restore();
    }
  });
});
