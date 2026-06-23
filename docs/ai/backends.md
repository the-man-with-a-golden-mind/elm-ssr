# backends (AI)

**Subpath:** `elm-ssr/effects`, `elm-ssr/backends`.

## EffectRunner

```ts
type EffectRunner = (effect: LoaderEffect, context: EffectContext) => Promise<LoaderEffectResult>;

interface LoaderEffect { kind: string; payload: Record<string, unknown>; }
interface LoaderEffectResult { ok: boolean; value?: unknown; error?: string; }
interface EffectContext {
  env?: Record<string, unknown>;
  request?: Request;
  waitUntil?: (p: Promise<unknown>) => void;
  session?: RequestSession;  // populated by sessionMiddleware
}
```

## Two starting runners

```ts
// elm-ssr/effects

// Returns 502 for any non-default kind (fetchJson + cookie handled here).
const defaultEffectRunner: EffectRunner;

// Portable / tests: Map cache + env map + pluggable sql.
interface InMemoryEffectsOptions {
  env?: Record<string, string>;
  cache?: Map<string, { value: unknown; expiresAt?: number }>;
  sql?: (q: { sql: string; params: unknown[]; mode: "all" | "first" | "run" }) => unknown | Promise<unknown>;
  fetchJson?: (url: string) => unknown | Promise<unknown>;  // override real fetch
  now?: () => number;
}
inMemoryEffects(options?: InMemoryEffectsOptions): EffectRunner;

// Cloudflare-specific: KV (cacheGet/Put), D1 (query/queryOne/execute), env, cookie, fetchJson.
cloudflareEffects(config?: { cacheBinding?: string; dbBinding?: string }): EffectRunner;
```

## Composable adapters (`elm-ssr/backends`)

```ts
// Cache layer (intercepts cacheGet/cachePut).
interface CacheBackend { get(key: string): Promise<unknown>; put(key: string, value: unknown, ttlSeconds?: number): Promise<void>; }
withCache(runner: EffectRunner, backend: CacheBackend): EffectRunner;

// Redis-like client → CacheBackend.
interface CacheClient { get(key: string): Promise<string | null>; set(key: string, value: string, ttlSeconds?: number): Promise<unknown>; }
redisCache(client: CacheClient): CacheBackend;

// SQL client → SqlQuery handler (use as inMemoryEffects({ sql: postgresSql(...) })).
interface SqlClient { run(sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>; }
postgresSql(client: SqlClient): (q: SqlQuery) => Promise<unknown>;
```

## Minimal example: portable server stack

```ts
import { inMemoryEffects } from "elm-ssr/effects";
import { postgresSql, redisCache, withCache } from "elm-ssr/backends";

const effects = withCache(
  inMemoryEffects({ sql: postgresSql(pg), env: process.env }),
  redisCache({
    get: (k) => myRedis.get(k),
    set: (k, v, ttl) => ttl ? myRedis.set(k, v, "EX", ttl) : myRedis.set(k, v),
  })
);
```

## Minimal example: Cloudflare bindings

```ts
import { cloudflareEffects } from "elm-ssr/effects";

const effects = cloudflareEffects({
  cacheBinding: "CACHE", // KV
  dbBinding: "DB"        // D1
});
```

## Minimal example: dev stack with Postgres

```ts
import { inMemoryEffects } from "elm-ssr/effects";
import { postgresSql } from "elm-ssr/backends";
import { SQL } from "bun";

const pg = new SQL(process.env.DATABASE_URL!);

const effects = inMemoryEffects({
  env: { /* ... */ },
  sql: postgresSql({
    run: async (sql, params) => {
      const rows = await pg.unsafe(sql, params);
      return { rows: [...rows], rowCount: (rows as { count?: number }).count ?? rows.length };
    },
  }),
});
```

## Patterns

- **Compose left-to-right outermost-first**: `withJobs(withTasks(sessionEffects(withCache(base, redisCache(...)))))`.
- **Custom kind**: write your own runner that intercepts the kind, falls through to base. See `effects-vocabulary.md`.
- **Per-route effects**: not directly supported; route handlers all share one runner. Branch inside the runner if you need it.
- **Testing**: use `inMemoryEffects` everywhere; override `fetchJson` with a fixture map; reuse the cache `Map` across requests to assert state.

## Footguns

- `withCache` only intercepts cache effects — sql/env/fetchJson still go through the wrapped runner. Don't double-wrap.
- `inMemoryEffects` without `sql` → query effects fail with `"sql" handler is not configured`.
- `cloudflareEffects` is Cloudflare-specific. Defaults: `cacheBinding="CACHE"`, `dbBinding="DB"`. If your bindings differ, set them or every cache/sql effect fails with `Missing KV/D1 binding`.
- `inMemoryEffects`'s in-memory `Map` is **per process / per isolate** — not shared across requests on different isolates. Use `withCache(... , redisCache(...))` for cross-isolate state.
- The `SqlClient` interface uses `?` placeholders (Bun.sql / SQLite style). For node-pg you may need to translate to `$1, $2`.
