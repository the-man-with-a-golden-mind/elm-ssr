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
