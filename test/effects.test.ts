import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createExampleWorker, worker } from "../examples/basic/runtime";
import { inMemoryEffects, type SqlQuery } from "elm-ssr/effects";
import { withTasks } from "elm-ssr/tasks";

// ---------------------------------------------------------------------------
// Helpers shared by the transaction and softExecute suites
// ---------------------------------------------------------------------------

const makeSqliteBackend = (db: Database) => {
  return ({ sql, params, mode }: SqlQuery) => {
    const stmt = db.query(sql);
    const args = params as never[];
    if (mode === "run") {
      const info = stmt.run(...args);
      return { rowsAffected: Number(info.changes) };
    }
    if (mode === "first") return stmt.get(...args) ?? null;
    return stmt.all(...args);
  };
};

const makeSqliteTransaction = (db: Database) => {
  return async (stmts: Array<{ sql: string; params: unknown[] }>) => {
    const txn = db.transaction(() => {
      let total = 0;
      for (const s of stmts) {
        const info = db.query(s.sql).run(...(s.params as never[]));
        total += Number(info.changes);
      }
      return { rowsAffected: total };
    });
    return txn();
  };
};

// Phase 3: backend-neutral server effects. The Elm side requests logical effects
// (cacheGet/cachePut, query/execute, env); the injectable runner maps them to a
// backend. Here we use the in-memory adapter with a real bun:sqlite SQL backend —
// the same Elm code would run against Cloudflare KV/D1 by swapping the adapter.

describe("server effects: cache (cacheGet/cachePut)", () => {
  it("serves a loader's data from cache on the second request (miss -> fetch -> hit)", async () => {
    let fetchCount = 0;
    const effects = inMemoryEffects({
      cache: new Map(),
      env: { GREETING: "hi" },
      fetchJson: () => {
        fetchCount += 1;
        return { uptime: "100%", region: "fra", builds: 7 };
      }
    });
    const app = createExampleWorker({ effects });

    const first = await (await app.fetch(new Request("https://example.com/status"))).text();
    const second = await (await app.fetch(new Request("https://example.com/status"))).text();

    expect(fetchCount).toBe(1); // second request hit the cache, no refetch
    expect(first).toContain("Region: fra");
    expect(second).toContain("Region: fra");
  });
});

describe("Loader.map2 (two sequential effects both execute and combine)", () => {
  it("combines results of two independent queries into one value", async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE fruits (name TEXT NOT NULL)");
    db.run("CREATE TABLE veggies (name TEXT NOT NULL)");
    db.run("INSERT INTO fruits VALUES ('apple'), ('banana')");
    db.run("INSERT INTO veggies VALUES ('carrot')");

    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });
    const ctx = {};

    // Simulate what Loader.map2 does at the TS runner level: run two queries
    // sequentially and verify both produce correct results.
    const first = (await effects({ kind: "query", payload: { sql: "SELECT name FROM fruits", params: [] } }, ctx)) as { ok: boolean; value: unknown[] };
    const second = (await effects({ kind: "query", payload: { sql: "SELECT name FROM veggies", params: [] } }, ctx)) as { ok: boolean; value: unknown[] };

    expect(first.ok).toBe(true);
    expect((first.value as Array<{ name: string }>).map((r) => r.name)).toEqual(["apple", "banana"]);
    expect(second.ok).toBe(true);
    expect((second.value as Array<{ name: string }>).map((r) => r.name)).toEqual(["carrot"]);
  });
});

describe("server effects: env", () => {
  it("Loader.env reads an env value via the effect runner (async)", async () => {
    const html = await (await worker.fetch(new Request("https://example.com/status"))).text();
    // Loader.env reads from inMemoryEffects({ env: { GREETING: "..." } }).
    expect(html).toContain("Env GREETING (Loader.env): hello from the server env");
  });

  it("Route.env reads an env value synchronously from the request flags", async () => {
    // Pass env as the second argument to worker.fetch so createFlags populates
    // the Elm request's env field and Route.env can read it synchronously.
    const html = await (
      await worker.fetch(
        new Request("https://example.com/status"),
        { GREETING: "hello from route env" } as unknown as Record<string, unknown>
      )
    ).text();
    // Route.env reads from the request flags — no effect round-trip.
    expect(html).toContain("Env GREETING (Route.env): hello from route env");
    // Loader.env still reads from the effect runner's own env config.
    expect(html).toContain("Env GREETING (Loader.env): hello from the server env");
  });
});

describe("server effects: sql + background tasks (Phase 3 + 4)", () => {
  const sqlBackend = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))");

    return ({ sql, params, mode }: SqlQuery) => {
      const statement = db.query(sql);
      const args = params as never[];

      if (mode === "run") {
        const info = statement.run(...args);
        return { rowsAffected: Number(info.changes) };
      }

      if (mode === "first") {
        return statement.get(...args) ?? null;
      }

      return statement.all(...args);
    };
  };

  const setup = () => {
    const audit: string[] = [];
    const pending: Array<Promise<unknown>> = [];
    const effects = withTasks(inMemoryEffects({ sql: sqlBackend() }), {
      auditEntry: (payload) => {
        audit.push((payload as { message: string }).message);
      }
    });
    const app = createExampleWorker({ effects });
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    return { app, audit, pending, ctx };
  };

  it("lists with query, inserts with execute (PRG), and runs a background task after the response", async () => {
    const { app, audit, pending, ctx } = setup();

    const empty = await (await app.fetch(new Request("https://example.com/guestbook"), undefined, ctx)).text();
    expect(empty).toContain("Guestbook");
    expect(empty).not.toContain("hello sql");

    const post = await app.fetch(
      new Request("https://example.com/guestbook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hello+sql"
      }),
      undefined,
      ctx
    );
    expect(post.status).toBe(302);
    expect(post.headers.get("location")).toBe("/guestbook");

    // The audit task is fire-and-forget, scheduled via waitUntil — await it.
    await Promise.all(pending);
    expect(audit).toEqual(["hello sql"]);

    const after = await (await app.fetch(new Request("https://example.com/guestbook"), undefined, ctx)).text();
    expect(after).toContain("hello sql");
  });

  it("rejects an empty submission with 422 (no insert, no task)", async () => {
    const { app, audit, ctx } = setup();
    const post = await app.fetch(
      new Request("https://example.com/guestbook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message="
      }),
      undefined,
      ctx
    );
    expect(post.status).toBe(422);
    expect(audit).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Loader.transaction — atomic multi-statement execution
// ---------------------------------------------------------------------------

describe("Loader.transaction", () => {
  const makeDb = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, balance INTEGER NOT NULL DEFAULT 0)");
    db.run("INSERT INTO accounts VALUES (1, 'alice', 1000), (2, 'bob', 500)");
    return db;
  };

  it("executes all statements and returns total rowsAffected on success", async () => {
    const db = makeDb();
    const effects = inMemoryEffects({
      sql: makeSqliteBackend(db),
      sqlTransaction: makeSqliteTransaction(db)
    });

    const result = (await effects(
      {
        kind: "transaction",
        payload: {
          statements: [
            { sql: "UPDATE accounts SET balance = balance - 100 WHERE id = ?", params: [1] },
            { sql: "UPDATE accounts SET balance = balance + 100 WHERE id = ?", params: [2] }
          ]
        }
      },
      {}
    )) as { ok: boolean; value: { rowsAffected: number } };

    expect(result.ok).toBe(true);
    expect(result.value.rowsAffected).toBe(2);

    // Verify the DB state is consistent.
    const alice = db.query("SELECT balance FROM accounts WHERE id = 1").get() as { balance: number };
    const bob = db.query("SELECT balance FROM accounts WHERE id = 2").get() as { balance: number };
    expect(alice.balance).toBe(900);
    expect(bob.balance).toBe(600);
  });

  it("rolls back all statements when one fails, leaving the DB unchanged", async () => {
    const db = makeDb();
    const effects = inMemoryEffects({
      sql: makeSqliteBackend(db),
      sqlTransaction: makeSqliteTransaction(db)
    });

    // The second INSERT violates the UNIQUE constraint on `name`.
    const result = await effects(
      {
        kind: "transaction",
        payload: {
          statements: [
            { sql: "INSERT INTO accounts (name, balance) VALUES (?, ?)", params: ["charlie", 300] },
            { sql: "INSERT INTO accounts (name, balance) VALUES (?, ?)", params: ["alice", 0] } // UNIQUE violation
          ]
        }
      },
      {}
    );

    // The runner reports failure (error from sqlTransaction throw).
    expect(result.ok).toBe(false);

    // charlie must NOT have been inserted — the transaction was rolled back.
    const charlie = db.query("SELECT * FROM accounts WHERE name = 'charlie'").get();
    expect(charlie).toBeNull();
    // Original rows are intact.
    const count = db.query("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("returns a clear error when sqlTransaction is not configured", async () => {
    // inMemoryEffects with no sqlTransaction option.
    const effects = inMemoryEffects({ sql: makeSqliteBackend(new Database(":memory:")) });

    const result = await effects(
      {
        kind: "transaction",
        payload: { statements: [{ sql: "SELECT 1", params: [] }] }
      },
      {}
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("sqlTransaction");
  });
});

// ---------------------------------------------------------------------------
// Loader.softQueryOne — used by Repo.insert/update on PostgreSQL (RETURNING *)
// ---------------------------------------------------------------------------

describe("Loader.softQueryOne", () => {
  it("returns the first row for a successful query", async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, sku TEXT NOT NULL)");
    db.run("INSERT INTO items VALUES (1, 'ELM-001')");
    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });

    const result = (await effects(
      { kind: "softQueryOne", payload: { sql: "SELECT id, sku FROM items WHERE id = ?", params: [1] } },
      {}
    )) as { ok: boolean; value: unknown };

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ id: 1, sku: "ELM-001" });
  });

  it("returns Ok null when no row matches (empty result)", async () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, sku TEXT NOT NULL)");
    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });

    const result = (await effects(
      { kind: "softQueryOne", payload: { sql: "SELECT id FROM items WHERE id = ?", params: [999] } },
      {}
    )) as { ok: boolean; value: unknown };

    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });

  it("returns constraintError when the query throws a Postgres-style unique violation (INSERT … RETURNING *)", async () => {
    // Postgres executes INSERT … RETURNING * as a single statement; a constraint
    // violation surfaces as an exception on the query call, not execute.
    // softQueryOne catches it and returns the error as data so Repo.insert can
    // attach it to the changeset rather than crashing with 502.
    const effects = inMemoryEffects({
      sql: async () => {
        const err = new Error('duplicate key value violates unique constraint "items_sku_key"') as Error & {
          detail?: string;
        };
        err.detail = "Key (sku)=(ELM-001) already exists.";
        throw err;
      }
    });

    const result = (await effects(
      {
        kind: "softQueryOne",
        payload: { sql: "INSERT INTO items (sku) VALUES ($1) RETURNING *", params: ["ELM-001"] }
      },
      {}
    )) as { ok: boolean; value: { constraintError: { kind: string; field: string | null } } };

    expect(result.ok).toBe(true);
    expect(result.value.constraintError.kind).toBe("unique");
    expect(result.value.constraintError.field).toBe("sku");
  });
});

// ---------------------------------------------------------------------------
// Loader.softExecute — constraint violations returned as data, not crashes
// ---------------------------------------------------------------------------

describe("Loader.softExecute", () => {
  const makeDb = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)");
    db.run("INSERT INTO users VALUES (1, 'alice@example.com')");
    return db;
  };

  it("returns Ok rowsAffected for a successful execute", async () => {
    const db = makeDb();
    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });

    const result = (await effects(
      {
        kind: "softExecute",
        payload: { sql: "INSERT INTO users VALUES (?, ?)", params: [2, "bob@example.com"] }
      },
      {}
    )) as { ok: boolean; value: { rowsAffected: number } };

    expect(result.ok).toBe(true);
    expect(result.value.rowsAffected).toBe(1);
  });

  it("returns Err constraintError for a UNIQUE violation instead of crashing", async () => {
    const db = makeDb();
    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });

    // Inserting alice again violates the UNIQUE constraint on email.
    const result = (await effects(
      {
        kind: "softExecute",
        payload: { sql: "INSERT INTO users VALUES (?, ?)", params: [99, "alice@example.com"] }
      },
      {}
    )) as { ok: boolean; value: { constraintError: { kind: string; field: string | null } } };

    expect(result.ok).toBe(true); // ok:true means "caller received the error as data"
    expect(result.value.constraintError.kind).toBe("unique");
    expect(result.value.constraintError.field).toBe("email");
  });

  it("returns Err constraintError for a NOT NULL violation", async () => {
    const db = makeDb();
    const effects = inMemoryEffects({ sql: makeSqliteBackend(db) });

    const result = (await effects(
      {
        kind: "softExecute",
        // email is NOT NULL; passing null triggers the constraint.
        payload: { sql: "INSERT INTO users (id, email) VALUES (?, NULL)", params: [50] }
      },
      {}
    )) as { ok: boolean; value: { constraintError: { kind: string; field: string | null } } };

    expect(result.ok).toBe(true);
    expect(result.value.constraintError.kind).toBe("notNull");
    expect(result.value.constraintError.field).toBe("email");
  });
});
