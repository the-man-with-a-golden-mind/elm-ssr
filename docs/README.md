# elm-ssr docs

Topic-by-topic documentation for [elm-ssr](../README.md). The top-level
[README](../README.md) is the quickstart and end-to-end overview; these pages
go deeper, one concern at a time.

## Getting started

- [Getting started](getting-started.md) — install, scaffold an app, build it,
  run it locally.
- [Configuration & Environment Variables](configuration.md) — config secrets, local `.env` and Wrangler `.dev.vars` alignment, Elm flag validation.

## Authoring

- [Routing](routing.md) — file-based routes, dynamic segments, NotFound, request reading, JSON body parsing.
- [Loaders and Actions](loaders-and-actions.md) — describe data fetching for
  pages and handle non-GET requests (forms).
- [Effects](effects.md) — the backend-neutral effect vocabulary
  (`fetchJson`, `cacheGet/Put`, `query/queryOne/execute/softExecute/transaction`, `env`, `getCookie`,
  `enqueue`, `startJob/jobStatus`).
- [Islands](islands.md) — interactive `Browser.element` islands, embedding,
  cross-island bus, persistence across SPA navigation.
- [SPA Navigation](spa-navigation.md) — how the client runtime intercepts links, swaps pages, syncs `<head>`, and persists islands across navigations.
- [API Routes](api-routes.md) — returning JSON from actions, calling API routes from islands, CSRF on API endpoints.
- [Request Decode](request-decode.md) — type-safe, accumulating decoder for form fields, query strings, and route params with built-in validators.
- [Error Handling](error-handling.md) — loader failures, action failures, custom error pages, constraint violations, route guards.
- **[Elmto](elmto.md)** — **the** type-safe, Ecto-like database layer (schemas, changesets, Repo, joins, aggregates). The generator now emits Elmto by default. This is the primary DB story.
- [Legacy Query DSL](query-dsl.md) — old `Db.Dsl` surface (migration reference only).
- [Error Handling](error-handling.md) — comprehensive coverage of Form errors, DB constraints, effect failures, and non-optimistic paths.
- [Elmto](elmto.md) — Ecto-like schemas, changesets, joins, group-by,
  aggregate projections, and Repo execution.

## Runtime

- [Deployment](deployment.md) — run the same Fetch-compatible app on Bun,
  worker/edge hosts, Cloudflare Workers, or another provider with a small
  entrypoint adapter.
- [Backends](backends.md) — composing effect adapters (`inMemoryEffects`,
  `cloudflareEffects`, `withCache`, `redisCache`, `postgresSql`).
- [Tasks and queues](tasks.md) — background work with `withTasks`
  (`waitUntil` when available, detached locally) or Cloudflare Queues
  (`withQueueProducer` / `createQueueConsumer`).
- [Migrations](migrations.md) — SQL-file migrations (`runMigrations`,
  `revertMigrations`, `listMigrations`); transactional per-migration.
- [Middleware](middleware.md) — the standard middleware stack and
  `composeMiddleware`.
- [Sessions and CSRF](sessions.md) — signed-cookie sessions (memory + cache
  stores), CSRF protection, `Loader.session`/`csrfToken`/`setSession`/
  `clearSession`.
- [Server-Sent Events (SSE)](sse.md) — `createSseStream` on the server +
  `ElmSsr.Island.Sse` on islands. Per-connection live updates.
- [Background jobs](jobs.md) — `withJobs` adapter + `Loader.startJob` /
  `Loader.jobStatus` for long-running work that exceeds a single request
  budget (heavy compute, report generation, big aggregations).

## Recipes

- [Parallel SQL queries](recipes/parallel-queries.md) — `Loader.custom` +
  `Promise.all` in the adapter for fan-out workloads (3 queries in one
  effect call).

## Tutorials

- **[Building a Real App](tutorials/building-a-real-app.md)** — complete end-to-end guide. Scaffold with auth + db + tailwind, Docker Postgres, Elmto, Form + changesets, resource routes, build + test. **Recommended starting point.**
- [Authentication Flow](tutorials/auth-flow.md) — sessions, CSRF, login form, protected pages.
- [Building a Trello Board](tutorials/trello-board.md) — Kanban with islands + actions.

## Examples gallery

- [Examples](examples.md) — every demo route and island in
  `examples/basic` and `examples/crypto-dashboard`, mapped to the feature
  it shows. Start here when you want to find runnable code for X.

## Tooling

- [CLI](cli.md) — `elm-ssr build|new|migrate|dev|compress|routes|route|query|info`.
- [Testing](testing.md) — unit/integration test loops, writing tests for routes, effects, sessions, and islands.
- [Development Debugger Panel (DevTools)](debugger.md) — built-in DevTools for profiling renders, inspecting islands, logging SQL queries, and tracking cross-island broadcasts.

## See also

- [CHANGELOG](../CHANGELOG.md) — release notes.
- [AGENTS.md](../AGENTS.md) — hard rules + orientation for AI agents working on
  this repo.
- [examples/basic/](../examples/basic/) — reference app (pages, islands, forms,
  cache, sql, tasks).
- [examples/crypto-dashboard/](../examples/crypto-dashboard/) — Tailwind +
  `elm/svg` + `elm/http` islands with 15s refresh and cross-island bus.
