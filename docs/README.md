# elm-ssr docs

Topic-by-topic documentation for [elm-ssr](../README.md). The top-level
[README](../README.md) is the quickstart and end-to-end overview; these pages
go deeper, one concern at a time.

## Getting started

- [Getting started](getting-started.md) — install, scaffold an app, build it,
  run it locally.

## Authoring

- [Routing](routing.md) — file-based routes, dynamic segments, NotFound.
- [Loaders and Actions](loaders-and-actions.md) — describe data fetching for
  pages and handle non-GET requests (forms).
- [Effects](effects.md) — the backend-neutral effect vocabulary
  (`fetchJson`, `cacheGet/Put`, `query/queryOne/execute`, `env`, `getCookie`,
  `enqueue`).
- [Islands](islands.md) — interactive `Browser.element` islands, embedding,
  cross-island bus, persistence across SPA navigation.

## Runtime

- [Backends](backends.md) — composing effect adapters (`inMemoryEffects`,
  `cloudflareEffects`, `withCache`, `redisCache`, `postgresSql`).
- [Tasks and queues](tasks.md) — background work with `withTasks`
  (`waitUntil`) or Cloudflare Queues (`withQueueProducer` /
  `createQueueConsumer`).
- [Migrations](migrations.md) — SQL-file migrations (`runMigrations`,
  `revertMigrations`, `listMigrations`); transactional per-migration.
- [Middleware](middleware.md) — the standard middleware stack and
  `composeMiddleware`.

## Tooling

- [CLI](cli.md) — `elm-ssr build|new|migrate|dev|compress|routes|info`.
- [Testing](testing.md) — unit/integration test loops, Docker-managed PG+Redis.

## See also

- [AGENTS.md](../AGENTS.md) — hard rules + orientation for AI agents working on
  this repo.
- [examples/basic/](../examples/basic/) — reference app (pages, islands, forms,
  cache, sql, tasks).
- [examples/crypto-dashboard/](../examples/crypto-dashboard/) — Tailwind +
  `elm/svg` + `elm/http` islands with 15s refresh and cross-island bus.
