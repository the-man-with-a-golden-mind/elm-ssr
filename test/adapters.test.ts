import { describe, expect, it } from "bun:test";
import { defaultEffectRunner, inMemoryEffects } from "@elm-ssr/runtime-worker/effects";
import { postgresSql, redisCache, withCache, type CacheClient, type SqlClient } from "@elm-ssr/runtime-worker/backends";
import { createQueueConsumer, withQueueProducer, type QueueBatch } from "@elm-ssr/runtime-worker/tasks";

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
