# AI reference

Operational reference for AI coding agents. Dense, machine-friendly,
deduplicated. One file per feature; each file is structured the same way:

1. **Subpath / module / effect kinds** — what to import.
2. **Exports** — function signatures (Elm) and types (TS).
3. **Minimal example** — copy-pasteable, both sides.
4. **Patterns** — one-liners of common compositions.
5. **Footguns** — known wrong moves.

Human-oriented tutorials with explanations and trade-offs live in
[`../`](../) (one level up). AI agents should usually prefer this folder
for code generation, then cross-link to the human docs when the user asks
"why" or "when".

## Files

- [routing.md](routing.md) — file-based routes + dynamic segments.
- [loaders-actions.md](loaders-actions.md) — `Loader` + `Action`,
  all built-in effect kinds, cookies, `Loader.custom`.
- [effects-vocabulary.md](effects-vocabulary.md) — flat table of every
  effect kind + its required adapter.
- [backends.md](backends.md) — `inMemoryEffects`, `cloudflareEffects`,
  `withCache`, `redisCache`, `postgresSql`.
- [tasks.md](tasks.md) — `withTasks`, `withQueueProducer`,
  `createQueueConsumer`.
- [islands.md](islands.md) — `Browser.element` islands, `Island.embed`,
  cross-island bus, SSE subscription.
- [deployment.md](deployment.md) — Fetch-compatible runtime shape, Bun,
  worker/edge, Cloudflare, and provider-specific adapter boundaries.
- [sessions.md](sessions.md) — `sessionMiddleware` + `csrfMiddleware`,
  stores, `sessionEffects`.
- [sse.md](sse.md) — `createSseStream`, `ElmSsr.Island.Sse`.
- [jobs.md](jobs.md) — `withJobs`, stores, `Loader.startJob`/`jobStatus`,
  `JobStatus` ADT.
- [middleware.md](middleware.md) — `composeMiddleware`, default stack,
  `AppContext`.
- [migrations.md](migrations.md) — `runMigrations`,
  `revertMigrations`, `listMigrations`, `MigrationsAdapter`.
- [cli.md](cli.md) — `elm-ssr build|new|migrate|dev`.
- [configuration.md](configuration.md) — environment files, context mapping, dynamic secrets, Elm flags/loaders.
- **[elmto.md](elmto.md)** — Canonical DB layer (schemas + changesets + Repo). Generator output, joins, error paths.
- [query-dsl.md](query-dsl.md) — Legacy only.
- [elmto.md](elmto.md) — Ecto-like schemas, changesets, joins, group-by,
  aggregate projections, and Repo execution.
- [debugger.md](debugger.md) — visual debugger panel instrumentation, events, SPA update.
- [testing.md](testing.md) — `bun run test:unit|test|test:integration`,
  patterns.

## See also

- [../examples.md](../examples.md) — every demo route in
  `examples/basic` + `examples/crypto-dashboard` mapped to the feature it
  shows. Use this when the user asks "where's the example for X".
- [../recipes/](../recipes/) — composition patterns. Currently
  parallel-queries.
- [../../AGENTS.md](../../AGENTS.md) — hard rules + footguns specific to
  this repo (NOT a feature reference — orientation only).

## Human docs covering features without an AI reference yet

These topics are documented in the human-oriented `../` folder only.
Use them directly for code generation — they contain exact signatures and examples.

- [../request-decode.md](../request-decode.md) — `ElmSsr.Form` (recommended) + `ElmSsr.Request.Decode` (compat): shared server/client validation, pure `decode`, error helpers.
- [../api-routes.md](../api-routes.md) — JSON API routes, `Action.json`, island HTTP calls, CSRF on `/api/` endpoints.
- [../error-handling.md](../error-handling.md) — `Loader.fail`/`Action.fail` semantics, custom error pages (`Page.notFound`, `Page.document`, `Page.error`), `softExecute` constraint handling, route guard 502 footgun.
- [../spa-navigation.md](../spa-navigation.md) — `/api/render`, island `id` persistence, head sync, form progressive enhancement, `data-no-spa`.
