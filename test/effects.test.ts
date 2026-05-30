import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createExampleWorker, worker } from "../examples/basic/runtime";
import { inMemoryEffects, type SqlQuery } from "elm-ssr/effects";
import { withTasks } from "elm-ssr/tasks";

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

describe("server effects: env", () => {
  it("reads an env value inside a loader", async () => {
    const html = await (await worker.fetch(new Request("https://example.com/status"))).text();
    expect(html).toContain("Env GREETING: hello from the server env");
  });
});

describe("server effects: sql + background tasks (Phase 3 + 4)", () => {
  const sqlBackend = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)");

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
