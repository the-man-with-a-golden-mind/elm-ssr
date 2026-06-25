import { describe, expect, it } from "bun:test";
import { cloudflareEffects, defaultEffectRunner, inMemoryEffects } from "elm-ssr/effects";
import { postgresSql, redisCache, withCache, type CacheClient, type SqlClient } from "elm-ssr/backends";
import { createQueueConsumer, withQueueProducer, type QueueBatch } from "elm-ssr/tasks";

// Unit-level coverage for the adapter glue: cookie reading, redisCache over a
// fake Redis-shaped client, postgresSql over a fake SQL client, and the CF
// Queue producer + consumer. No external servers needed.

describe("cookie effect (getCookie)", () => {
  const runEffect = (header: string | null, name: string) =>
    inMemoryEffects()(
      { kind: "cookie", payload: { name } },
      { request: new Request("https://example.com/", { headers: header ? { cookie: header } : {} }) }
    );

  it("returns the requested cookie value when present", async () => {
    const result = await runEffect("session=abc; theme=dark", "theme");
    expect(result).toEqual({ ok: true, value: "dark" });
  });

  it("returns null when the cookie is absent", async () => {
    const result = await runEffect("session=abc", "theme");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("returns null when no Cookie header is sent", async () => {
    const result = await runEffect(null, "anything");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("URL-decodes the value (default behavior of the cookie parser)", async () => {
    const result = await runEffect("user=John%20Doe", "user");
    expect(result).toEqual({ ok: true, value: "John Doe" });
  });
});

describe("constraint error parsing", () => {
  it("extracts quoted PostgreSQL unique fields via inMemoryEffects softExecute", async () => {
    const runner = inMemoryEffects({
      sql: async () => {
        throw new Error('duplicate key value violates unique constraint "users_email_key" Key ("email")=(x@example.com) already exists');
      }
    });

    const result = await runner(
      { kind: "softExecute", payload: { sql: "INSERT INTO users(email) VALUES (?)", params: ["x@example.com"] } },
      {}
    );

    expect(result).toEqual({
      ok: true,
      value: { constraintError: { kind: "unique", field: "email" } }
    });
  });

  it("extracts PostgreSQL unique fields from Bun.sql-style detail metadata", async () => {
    const runner = inMemoryEffects({
      sql: async () => {
        const error = new Error('duplicate key value violates unique constraint "users_email_key"') as Error & {
          detail?: string;
        };
        error.detail = "Key (email)=(x@example.com) already exists.";
        throw error;
      }
    });

    const result = await runner(
      { kind: "softExecute", payload: { sql: "INSERT INTO users(email) VALUES (?)", params: ["x@example.com"] } },
      {}
    );

    expect(result).toEqual({
      ok: true,
      value: { constraintError: { kind: "unique", field: "email" } }
    });
  });
});

describe("redisCache + withCache (Redis adapter)", () => {
  const fakeRedis = (): CacheClient & { store: Map<string, string> } => {
    const store = new Map<string, string>();
    return {
      store,
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      }
    };
  };

  it("round-trips cachePut → cacheGet via the client", async () => {
    const client = fakeRedis();
    const runner = withCache(defaultEffectRunner, redisCache(client));

    const put = await runner(
      { kind: "cachePut", payload: { key: "k", value: { hello: "world" } } },
      {}
    );
    expect(put).toEqual({ ok: true, value: null });

    const get = await runner({ kind: "cacheGet", payload: { key: "k" } }, {});
    expect(get).toEqual({ ok: true, value: { hello: "world" } });
    // The underlying client received a JSON-encoded string.
    expect(client.store.get("k")).toBe('{"hello":"world"}');
  });

  it("returns null on a miss", async () => {
    const runner = withCache(defaultEffectRunner, redisCache(fakeRedis()));
    const get = await runner({ kind: "cacheGet", payload: { key: "absent" } }, {});
    expect(get).toEqual({ ok: true, value: null });
  });

  it("forwards non-cache effects to the inner runner", async () => {
    const runner = withCache(defaultEffectRunner, redisCache(fakeRedis()));
    const result = await runner({ kind: "cookie", payload: { name: "x" } }, { request: new Request("https://example.com/") });
    expect(result.ok).toBe(true); // cookie handled by defaultEffectRunner
  });
});

describe("postgresSql (SQL adapter)", () => {
  const fakeSql = (rows: unknown[], rowCount: number): SqlClient & { calls: Array<{ sql: string; params: unknown[] }> } => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    return {
      calls,
      run: async (sql, params) => {
        calls.push({ sql, params });
        return { rows, rowCount };
      }
    };
  };

  it("maps mode 'all' to the full row list", async () => {
    const client = fakeSql([{ id: 1 }, { id: 2 }], 2);
    const handler = postgresSql(client);
    const value = await handler({ sql: "SELECT * FROM t WHERE x = ?", params: [42], mode: "all" });
    expect(value).toEqual([{ id: 1 }, { id: 2 }]);
    expect(client.calls).toEqual([{ sql: "SELECT * FROM t WHERE x = ?", params: [42] }]);
  });

  it("maps mode 'first' to the first row (or null)", async () => {
    expect(await postgresSql(fakeSql([{ id: 1 }], 1))({ sql: "x", params: [], mode: "first" })).toEqual({ id: 1 });
    expect(await postgresSql(fakeSql([], 0))({ sql: "x", params: [], mode: "first" })).toBeNull();
  });

  it("maps mode 'run' to { rowsAffected }", async () => {
    const handler = postgresSql(fakeSql([], 3));
    const value = await handler({ sql: "DELETE FROM t", params: [], mode: "run" });
    expect(value).toEqual({ rowsAffected: 3 });
  });
});

describe("cloudflareEffects (KV/D1/env adapter)", () => {
  const fakeKv = () => {
    const store = new Map<string, unknown>();
    const ttls = new Map<string, number | undefined>();
    return {
      store,
      ttls,
      binding: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
          store.set(key, JSON.parse(value));
          ttls.set(key, options?.expirationTtl);
        },
        delete: async (key: string) => {
          store.delete(key);
        }
      }
    };
  };

  const fakeD1 = () => {
    const calls: Array<{ sql: string; params: unknown[]; mode: "all" | "first" | "run" }> = [];
    return {
      calls,
      binding: {
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            all: async () => {
              calls.push({ sql, params, mode: "all" });
              return { results: [{ id: 1 }, { id: 2 }] };
            },
            first: async () => {
              calls.push({ sql, params, mode: "first" });
              return { id: 1 };
            },
            run: async () => {
              calls.push({ sql, params, mode: "run" });
              return { meta: { changes: 3 } };
            }
          })
        })
      }
    };
  };

  it("round-trips cache effects through a KV-like binding", async () => {
    const kv = fakeKv();
    const runner = cloudflareEffects();

    const put = await runner(
      { kind: "cachePut", payload: { key: "settings", value: { theme: "dark" }, ttlSeconds: 30 } },
      { env: { CACHE: kv.binding } }
    );
    const get = await runner({ kind: "cacheGet", payload: { key: "settings" } }, { env: { CACHE: kv.binding } });

    expect(put).toEqual({ ok: true, value: null });
    expect(get).toEqual({ ok: true, value: { theme: "dark" } });
    expect(kv.ttls.get("settings")).toBe(30);
  });

  it("maps query, queryOne, and execute to a D1-like binding", async () => {
    const d1 = fakeD1();
    const runner = cloudflareEffects();
    const context = { env: { DB: d1.binding } };

    await expect(runner({ kind: "query", payload: { sql: "SELECT * FROM t WHERE x = ?", params: [42] } }, context))
      .resolves.toEqual({ ok: true, value: [{ id: 1 }, { id: 2 }] });
    await expect(runner({ kind: "queryOne", payload: { sql: "SELECT * FROM t LIMIT 1", params: [] } }, context))
      .resolves.toEqual({ ok: true, value: { id: 1 } });
    await expect(runner({ kind: "execute", payload: { sql: "DELETE FROM t", params: ["old"] } }, context))
      .resolves.toEqual({ ok: true, value: { rowsAffected: 3 } });

    expect(d1.calls).toEqual([
      { sql: "SELECT * FROM t WHERE x = ?", params: [42], mode: "all" },
      { sql: "SELECT * FROM t LIMIT 1", params: [], mode: "first" },
      { sql: "DELETE FROM t", params: ["old"], mode: "run" }
    ]);
  });

  it("reads string env values and treats non-strings as absent", async () => {
    const runner = cloudflareEffects();

    expect(await runner({ kind: "env", payload: { name: "GREETING" } }, { env: { GREETING: "hello" } }))
      .toEqual({ ok: true, value: "hello" });
    expect(await runner({ kind: "env", payload: { name: "COUNT" } }, { env: { COUNT: 3 } }))
      .toEqual({ ok: true, value: null });
  });

  it("fails clearly when required Cloudflare bindings are missing", async () => {
    const runner = cloudflareEffects({ cacheBinding: "APP_CACHE", dbBinding: "APP_DB" });

    const cache = await runner({ kind: "cacheGet", payload: { key: "x" } }, { env: {} });
    const sql = await runner({ kind: "query", payload: { sql: "SELECT 1", params: [] } }, { env: {} });

    expect(cache).toEqual({ ok: false, error: 'Missing KV binding "APP_CACHE"' });
    expect(sql).toEqual({ ok: false, error: 'Missing D1 binding "APP_DB"' });
  });
});

describe("withQueueProducer + createQueueConsumer (CF Queues)", () => {
  it("sends an enqueue effect to the configured queue binding", async () => {
    const sent: unknown[] = [];
    const runner = withQueueProducer(defaultEffectRunner, { queueBinding: "JOBS" });

    const result = await runner(
      { kind: "enqueue", payload: { task: "ship", payload: { id: 1 } } },
      { env: { JOBS: { send: async (m: unknown) => { sent.push(m); } } } }
    );

    expect(result).toEqual({ ok: true, value: null });
    expect(sent).toEqual([{ task: "ship", payload: { id: 1 } }]);
  });

  it("fails clearly when the queue binding is missing", async () => {
    const runner = withQueueProducer(defaultEffectRunner, { queueBinding: "JOBS" });
    const result = await runner({ kind: "enqueue", payload: { task: "ship", payload: null } }, { env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("JOBS");
  });

  it("forwards non-enqueue effects to the inner runner", async () => {
    const runner = withQueueProducer(defaultEffectRunner);
    const result = await runner({ kind: "cookie", payload: { name: "x" } }, { request: new Request("https://example.com/", { headers: { cookie: "x=1" } }) });
    expect(result).toEqual({ ok: true, value: "1" });
  });

  it("consumer dispatches messages to handlers and acks; retries on missing handler or error", async () => {
    const calls: Array<{ name: string; payload: unknown }> = [];
    const acked: string[] = [];
    const retried: string[] = [];

    const make = (name: string, body: unknown) => ({
      body,
      ack: () => acked.push(name),
      retry: () => retried.push(name)
    });

    const batch: QueueBatch = {
      queue: "JOBS",
      messages: [
        make("ok", { task: "doThing", payload: { id: 1 } }),
        make("missing", { task: "noSuchTask", payload: null }),
        make("boom", { task: "explode", payload: null })
      ]
    };

    const consumer = createQueueConsumer({
      doThing: (payload) => {
        calls.push({ name: "doThing", payload });
      },
      explode: () => {
        throw new Error("kaboom");
      }
    });

    await consumer(batch);

    expect(calls).toEqual([{ name: "doThing", payload: { id: 1 } }]);
    expect(acked).toEqual(["ok"]);
    expect(retried.sort()).toEqual(["boom", "missing"]);
  });
});
