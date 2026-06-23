# effects-vocabulary (AI)

Flat table of every effect `kind` that `Loader` (and via `Action.fromLoader`,
`Action`) emits, and which adapter handles it. Default for unknown kinds is
`{ ok: false, error: "Effect ... has no configured backend" }`.

| Elm function | `kind` | Handled by | Payload | Returns |
|---|---|---|---|---|
| `Loader.fetchJson { url, decoder }` | `fetchJson` | `defaultEffectRunner`, `cloudflareEffects`, `inMemoryEffects` | `{ url }` | decoded JSON or 502 |
| `Loader.cacheGet { key, decoder }` | `cacheGet` | `inMemoryEffects(Map)`, `withCache(backend)`, `cloudflareEffects(KV)` | `{ key }` | `Maybe a` (null on miss) |
| `Loader.cachePut { key, value, ttlSeconds }` | `cachePut` | same as cacheGet | `{ key, value, ttlSeconds? }` | `()` |
| `Loader.query { sql, params, decoder }` | `query` | `inMemoryEffects({ sql })`, `postgresSql(client)`, `cloudflareEffects(D1)` | `{ sql, params }` | `List a` |
| `Loader.queryOne { sql, params, decoder }` | `queryOne` | same as query | `{ sql, params }` | `Maybe a` |
| `Loader.execute { sql, params }` | `execute` | same as query | `{ sql, params }` | `{ rowsAffected }` |
| `Loader.env name` | `env` | `inMemoryEffects({ env })`, `cloudflareEffects(env)`, custom provider runner | `{ name }` | `Maybe String` |
| `Loader.getCookie name` | `cookie` | `defaultEffectRunner`, `cloudflareEffects`, `inMemoryEffects` (reads `context.request.headers.cookie`) | `{ name }` | `Maybe String` |
| `Loader.enqueue { task, payload }` | `enqueue` | `withTasks(handlers)` → `ctx.waitUntil` when available/detached otherwise; `withQueueProducer({ queueBinding })` → Cloudflare Queue; custom provider queue runner | `{ task, payload }` | `()` |
| `Loader.session decoder` | `session` | `sessionEffects(runner)` (requires `sessionMiddleware`) | `{}` | `Maybe a` |
| `Loader.csrfToken` | `csrfToken` | `sessionEffects` | `{}` | `Maybe String` |
| `Loader.setSession value` | `setSession` | `sessionEffects` (marks session dirty) | `{ value }` | `()` |
| `Loader.clearSession` | `clearSession` | `sessionEffects` (marks session destroyed) | `{}` | `()` |
| `Loader.startJob { kind, payload }` | `startJob` | `withJobs({ store, handlers })` | `{ kind, payload }` | `JobId : String` |
| `Loader.jobStatus { jobId, decoder }` | `jobStatus` | `withJobs` (reads from store) | `{ jobId }` | `JobStatus a` |
| `Loader.custom { kind, payload, decoder }` | `<your kind>` | YOUR adapter wrapping `baseRunner` | whatever | whatever |

## Composing adapters

```ts
// Wrappers chain: outermost intercepts first; falls through to inner.
const effects =
  withJobs(
    withTasks(
      sessionEffects(
        withCache(
          inMemoryEffects({ env, sql: postgresSql(pg) }),
          redisCache(redis)
        )
      ),
      { sendEmail }
    ),
    { store: cacheJobStore(redisCache(redis)), handlers: { reportGen } }
  );
```

Order matters only when **two adapters claim the same kind** (none do
today). Anything not matched falls through to the next wrapper.

## What needs middleware vs what doesn't

| Effects | Needs middleware? |
|---|---|
| fetchJson, cacheGet/Put, query/queryOne/execute, env, cookie, enqueue, custom | No |
| session, csrfToken, setSession, clearSession | **Yes** — `sessionMiddleware` on the request, then `sessionEffects` wrapping the runner |
| startJob, jobStatus | No middleware — `withJobs` wraps the runner, that's it |

## Failure shape

Every effect handler returns `{ ok: true, value }` or `{ ok: false, error }`.

- Loader-side: `ok: false` → loader fails with status 502 + the error
  message (via `resumeFetchJson` in `Loader.elm`).
- Decode error: also 502, with `Loader response did not match decoder: ...`.
- Missing adapter: `defaultEffectRunner` returns `Effect "<kind>" has no
  configured backend. Pass an adapter ... as effects.` — surfaces as 502.
