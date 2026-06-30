import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { redis, SQL } from "bun";
import { defaultEffectRunner } from "elm-ssr/effects";
import {
  postgresSql,
  redisCache,
  withCache,
  type CacheClient,
  type SqlClient
} from "elm-ssr/backends";
import {
  listMigrations,
  revertMigrations,
  runMigrations,
  type MigrationsAdapter
} from "elm-ssr/migrations";

// Gated on DATABASE_URL + REDIS_URL — the docker-compose.yml at the repo root
// brings up matching services. Skips on machines without them, so the default
// `bun test` stays clean. Run with: `docker compose up -d && bun run test:integration`.

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const shouldSkip = !DATABASE_URL || !REDIS_URL;
const integration = shouldSkip ? describe.skip : describe;

if (shouldSkip) {
  console.warn("Skipping redis-postgres integration tests (no DATABASE_URL/REDIS_URL).");
}

const tablePrefix = `elm_ssr_it_${Math.floor(Date.now() / 1000)}_`;

integration("integration: Redis (real server)", () => {
  const cacheClient: CacheClient = {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      if (ttlSeconds !== undefined) {
        await redis.set(key, value, "EX", ttlSeconds);
      } else {
        await redis.set(key, value);
      }
    }
  };

  it("round-trips cachePut → cacheGet via the real Redis", async () => {
    const runner = withCache(defaultEffectRunner, redisCache(cacheClient));
    const key = `${tablePrefix}cache`;

    await runner({ kind: "cachePut", payload: { key, value: { hello: "world" } } }, {});
    const result = await runner({ kind: "cacheGet", payload: { key } }, {});

    expect(result).toEqual({ ok: true, value: { hello: "world" } });
    await redis.del(key);
  });

  it("honours TTL (a 1-second key expires)", async () => {
    const runner = withCache(defaultEffectRunner, redisCache(cacheClient));
    const key = `${tablePrefix}ttl`;
    await runner({ kind: "cachePut", payload: { key, value: "soon-gone", ttlSeconds: 1 } }, {});
    await new Promise((r) => setTimeout(r, 1200));
    const result = await runner({ kind: "cacheGet", payload: { key } }, {});
    expect(result).toEqual({ ok: true, value: null });
  });
});

integration("integration: Postgres (real server, via Bun.sql)", () => {
  let sql: SQL;
  let migDir: string;

  const sqlClient: SqlClient = {
    run: async (query, params) => {
      const rows = await sql.unsafe(query, params as unknown[]);
      const rowsArray = Array.isArray(rows) ? rows : [...(rows as Iterable<unknown>)];
      const count = (rows as { count?: number }).count;
      return { rows: rowsArray, rowCount: typeof count === "number" ? count : rowsArray.length };
    }
  };

  const migrationsAdapter: MigrationsAdapter = {
    exec: async (s) => {
      await sql.unsafe(s);
    },
    list: async (s) => {
      const rows = await sql.unsafe(s);
      return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [...(rows as Iterable<Record<string, unknown>>)];
    },
    runInTransaction: async (fn) => {
      await sql.begin(fn);
    }
  };

  const tableName = `${tablePrefix}entries`;
  const trackingTable = `${tablePrefix}migrations`;

  beforeAll(async () => {
    sql = new SQL(DATABASE_URL!);
    migDir = await mkdtemp(resolve(tmpdir(), "elm-ssr-it-mig-"));
    await writeFile(
      resolve(migDir, "0001_entries.sql"),
      `CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, message TEXT NOT NULL);`
    );
    await writeFile(
      resolve(migDir, "0001_entries.down.sql"),
      `DROP TABLE ${tableName};`
    );
  });

  afterAll(async () => {
    try {
      await sql.unsafe(`DROP TABLE IF EXISTS ${tableName}`);
      await sql.unsafe(`DROP TABLE IF EXISTS ${trackingTable}`);
    } finally {
      await rm(migDir, { recursive: true, force: true });
      await sql.close();
    }
  });

  it("runs SQL migrations against real Postgres (creates tracking table + the user table)", async () => {
    const result = await runMigrations(migrationsAdapter, { dir: migDir, tableName: trackingTable });
    expect(result.applied).toEqual(["0001_entries.sql"]);

    // Re-run is idempotent.
    const second = await runMigrations(migrationsAdapter, { dir: migDir, tableName: trackingTable });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["0001_entries.sql"]);
  });

  it("listMigrations reports applied + pending on real Postgres", async () => {
    const status = await listMigrations(migrationsAdapter, { dir: migDir, tableName: trackingTable });
    expect(status.applied.map((a) => a.name)).toEqual(["0001_entries.sql"]);
    expect(status.pending).toEqual([]);
  });

  it("revertMigrations rolls back the schema and the tracking row, then re-up restores it", async () => {
    const reverted = await revertMigrations(migrationsAdapter, { dir: migDir, tableName: trackingTable });
    expect(reverted.reverted).toEqual(["0001_entries.sql"]);

    // The table is gone.
    const stillThere = await sql.unsafe(
      `SELECT to_regclass(${`'${tableName}'`}) AS reg`
    );
    const stillThereArray = Array.isArray(stillThere) ? stillThere : [...(stillThere as Iterable<unknown>)];
    expect((stillThereArray[0] as { reg: string | null }).reg).toBeNull();

    // Tracking row is gone.
    const tracking = await sql.unsafe(`SELECT name FROM ${trackingTable}`);
    expect(Array.isArray(tracking) ? tracking : [...tracking]).toEqual([]);

    // Re-running up restores it cleanly.
    const replay = await runMigrations(migrationsAdapter, { dir: migDir, tableName: trackingTable });
    expect(replay.applied).toEqual(["0001_entries.sql"]);
  });

  it("postgresSql maps query/queryOne/execute to real Postgres", async () => {
    const handler = postgresSql(sqlClient);

    const insert = await handler({
      sql: `INSERT INTO ${tableName} (message) VALUES ($1)`,
      params: ["hello postgres"],
      mode: "run"
    });
    expect(insert).toEqual({ rowsAffected: 1 });

    const all = await handler({ sql: `SELECT message FROM ${tableName} ORDER BY id DESC`, params: [], mode: "all" });
    expect(all).toEqual([{ message: "hello postgres" }]);

    const first = await handler({ sql: `SELECT message FROM ${tableName} ORDER BY id DESC LIMIT 1`, params: [], mode: "first" });
    expect(first).toEqual({ message: "hello postgres" });
  });
});

