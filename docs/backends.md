# Backends

A backend is what actually runs an effect. The runtime takes a single
`EffectRunner` (`(effect, context) => Promise<{ ok, value? | error? }>`); the
adapters in `elm-ssr/effects`, `elm-ssr/backends`, and `elm-ssr/tasks` are
composable functions of type `EffectRunner -> EffectRunner` that intercept
specific kinds and forward the rest.

## Two starting runners

### `inMemoryEffects(options?)`

Portable local/test runner. Cache is an in-memory `Map` with TTL; `env` comes
from the options; `fetchJson` is real `fetch` unless you pass a fake. SQL is
pluggable — pass a handler (or wrap `postgresSql(client)`).

```ts
import { inMemoryEffects } from "elm-ssr/effects";

const effects = inMemoryEffects({
  env: { ANALYTICS_KEY: "abc" },
  sql: postgresSql(myPgClient),         // see below
  fetchJson: async (url) => fixtures[url], // optional, defaults to real fetch
  cache: new Map(),                     // optional — pass one to share/inspect
  now: () => Date.now()                 // optional — useful in tests
});
```

Unknown kinds fall through to `defaultEffectRunner` (which still handles
`fetchJson` and `cookie`).

### `cloudflareEffects(config?)`

Cloudflare-specific runner. Maps the effect vocabulary onto KV and D1 bindings:

```ts
import { cloudflareEffects } from "elm-ssr/effects";

const effects = cloudflareEffects({
  cacheBinding: "CACHE", // KV — default "CACHE"
  dbBinding: "DB"        // D1 — default "DB"
});
```

| Effect | Backend |
| ------ | ------- |
| `fetchJson` | `fetch` |
| `cacheGet`/`cachePut` | `env[cacheBinding]` (KV, JSON-encoded values, TTL) |
| `query`/`queryOne`/`execute` | `env[dbBinding]` (D1) |
| `env name` | `env[name]` |
| `cookie` | parsed from `request.headers["cookie"]` |

Missing bindings fail clearly with `Missing KV binding "CACHE"` /
`Missing D1 binding "DB"`.

## Cache adapters (`withCache`, `redisCache`)

`withCache` wraps any runner so that `cacheGet`/`cachePut` are served by a
`CacheBackend` instead of the runner's own cache logic. Use it to plug in Redis,
Memcached, a provider KV store, or any cache client without writing your own
full runner.

```ts
import { withCache, redisCache } from "elm-ssr/backends";

const effects = withCache(
  inMemoryEffects({ sql: postgresSql(pg) }),
  redisCache({
    // Bun.redis:
    get: (k) => Bun.redis.get(k),
    set: (k, v, ttl) => ttl !== undefined ? Bun.redis.set(k, v, "EX", ttl) : Bun.redis.set(k, v)
  })
);
```

The `CacheClient` interface is minimal so it fits `Bun.redis`, `ioredis`,
`node-redis`, anything with a get/set:

```ts
interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
}
```

Values are JSON-encoded going in and decoded coming out.

## SQL adapter (`postgresSql`)

`postgresSql(client)` adapts a minimal client to the `SqlQuery` handler shape
used by `inMemoryEffects({ sql })`. It maps the three SQL modes (`query`,
`queryOne`, `execute`) onto a single `run(sql, params)` call.

```ts
import { postgresSql } from "elm-ssr/backends";
import { SQL } from "bun";

const pg = new SQL(process.env.DATABASE_URL!);

const effects = inMemoryEffects({
  sql: postgresSql({
    run: async (sql, params) => {
      const rows = await pg.unsafe(sql, params);
      return { rows: [...rows], rowCount: (rows as { count?: number }).count ?? rows.length };
    }
  })
});
```

For SQLite via `bun:sqlite`, write a `run` that calls `db.query(sql).all(params)`
(or `.run(...)` for execute) and report `rowCount` from `changes`.

## Background tasks

`enqueue` is handled by `withTasks` (inline via `waitUntil`) or
`withQueueProducer` (Cloudflare Queues). Other queue providers can be wired by
handling the `enqueue` kind in a custom runner. See [Tasks and queues](tasks.md).

## A complete recipe

```ts
import { inMemoryEffects } from "elm-ssr/effects";
import { withCache, redisCache, postgresSql } from "elm-ssr/backends";
import { withTasks } from "elm-ssr/tasks";

const effects = withTasks(
  withCache(
    inMemoryEffects({
      env: { GIT_SHA: process.env.GIT_SHA ?? "dev" },
      sql: postgresSql({ run: pgRun })
    }),
    redisCache({ get: Bun.redis.get, set: Bun.redis.set })
  ),
  {
    sendEmail: async (payload) => { /* … */ },
    warmCache: async () => { /* … */ }
  }
);
```

The same Elm can run against this, `cloudflareEffects()`, or a provider-specific
custom adapter — only the TypeScript adapter changes.

## Source

- [packages/elm-ssr/src/effects.ts](../packages/elm-ssr/src/effects.ts)
- [packages/elm-ssr/src/backends.ts](../packages/elm-ssr/src/backends.ts)
