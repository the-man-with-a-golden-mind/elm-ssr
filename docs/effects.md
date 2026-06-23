# Effects

Effects are the **single, backend-neutral vocabulary** that loaders and
actions speak. Elm describes what it needs (`{ kind, payload }`); the
configured TypeScript adapter executes it against a real backend (in-memory
map, Redis/Postgres/SQLite, Cloudflare KV/D1, or your own provider adapter).
This is what lets the same Elm code run on different hosts without change.

## The vocabulary

All effects are available on `Loader`. Actions reuse them via
`Action.fromLoader`.

| Elm function | `kind` string | What it does |
| ------------ | ------------- | ------------ |
| `Loader.fetchJson { url, decoder }` | `fetchJson` | HTTP GET, JSON-decoded. |
| `Loader.cacheGet { key, decoder }` | `cacheGet` | Cache read; returns `Maybe a`. |
| `Loader.cachePut { key, value, ttlSeconds }` | `cachePut` | Cache write with optional TTL. |
| `Loader.query { sql, params, decoder }` | `query` | SQL select, decode rows. |
| `Loader.queryOne { sql, params, decoder }` | `queryOne` | First row only (`Maybe a`). |
| `Loader.execute { sql, params }` | `execute` | INSERT/UPDATE/DELETE; returns `{ rowsAffected }`. |
| `Loader.env name` | `env` | Read an env var / binding name. |
| `Loader.getCookie name` | `cookie` | Read a request cookie (parsed from the `Cookie` header). Returns `Maybe String`. |
| `Loader.session decoder` | `session` | Read the current session payload (requires `sessionMiddleware`). See [sessions](sessions.md). |
| `Loader.csrfToken` | `csrfToken` | Read the current CSRF token (requires `sessionMiddleware`). See [sessions](sessions.md). |
| `Loader.setSession value` | `setSession` | Replace the session payload. Mark dirty for middleware to persist. See [sessions](sessions.md). |
| `Loader.clearSession` | `clearSession` | Destroy the session. Mark for middleware to delete + clear cookie. See [sessions](sessions.md). |
| `Loader.enqueue { task, payload }` | `enqueue` | Fire-and-forget background work. See [tasks](tasks.md). |
| `Loader.custom { kind, payload, decoder }` | `<your kind>` | Escape hatch — emit any effect kind your adapter handles. See [recipe: parallel queries](recipes/parallel-queries.md) for the most common use (Promise.all fan-out). |
| `Loader.startJob { kind, payload }` / `Loader.jobStatus { jobId, decoder }` | `startJob` / `jobStatus` | Submit and poll a long-running background job. Requires `withJobs(runner, { store, handlers })`. See [jobs](jobs.md). |

To **write** a cookie on the response, use `Action.setCookie` /
`Action.clearCookie` / `Action.sessionCookie` from inside an `Action` — see
[Loaders and Actions](loaders-and-actions.md#cookies).

## Failure modes

- `fetchJson` non-2xx → `502 fetchJson received <status> from <url>`.
- `fetchJson` decode failure → `502 Loader response did not match decoder: …`.
- `cacheGet` / `query…` decode failure → `502` with the decode error.
- Missing backend (e.g. no SQL adapter wired in `inMemoryEffects`) →
  `502 The "sql" handler is not configured…`.

Failures are turned into HTTP responses (5xx page or JSON for `/api/`).

## How a `kind` resolves to a backend

The runtime uses an `EffectRunner` you supply (or the default if you supply
none). Adapters are composable functions of type
`EffectRunner -> EffectRunner` that intercept the kinds they care about and
forward everything else.

```ts
import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";
import { withCache, redisCache, postgresSql } from "elm-ssr/backends";
import { withTasks } from "elm-ssr/tasks";

// Bun/Node/other server runtimes: Redis cache + Postgres SQL.
const effects = withTasks(
  withCache(
    inMemoryEffects({ sql: postgresSql(pg), env: { /* … */ } }),
    redisCache(redis)
  ),
  { sendEmail, warmCache }
);

// Cloudflare: KV (cacheGet/Put), D1 (query/queryOne/execute), env, cookie, fetchJson.
const cloudflare = withTasks(
  cloudflareEffects({ cacheBinding: "CACHE", dbBinding: "DB" }),
  { sendEmail, warmCache }
);
```

See [Backends](backends.md) for the adapter catalogue and [Tasks and
queues](tasks.md) for `enqueue`.

## Defaults if you skip `effects`

The runtime falls back to `defaultEffectRunner`. It handles only:
- `fetchJson` — real `fetch`.
- `cookie` — parsed from `request.headers["cookie"]`.

Everything else returns `{ ok: false, error: "Effect \"<kind>\" has no
configured backend…" }`, which surfaces as a 502 to the caller. So a Loader
that just calls `fetchJson` works with zero config; one that touches the cache
or DB needs an adapter.

## What next

- [Backends](backends.md) — assemble an adapter that runs these effects.
- [Tasks and queues](tasks.md) — what `enqueue` actually does.
- Source: [packages/elm-ssr/src/effects.ts](../packages/elm-ssr/src/effects.ts),
  [packages/elm-ssr/elm-src/ElmSsr/Loader.elm](../packages/elm-ssr/elm-src/ElmSsr/Loader.elm).
