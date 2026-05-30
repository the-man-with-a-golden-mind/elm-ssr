# @elm-ssr/runtime-worker

The Cloudflare Workers / Bun runtime for [elm-ssr](https://github.com/) apps.

It owns the request lifecycle (middleware, render, response), the backend-neutral
effect adapters that the Elm side describes via `Loader`/`Action`, the background
task scheduler, and the client island bootstrap that mounts standard
`Browser.element` islands.

## Install

```sh
bun add @elm-ssr/runtime-worker
```

## Highlights

- **`createWorkerApp({ elmModule, islands, islandsBundle, stylesheet, routes, createFlags, effects })`** — the worker handler. Compose your own `effects` from the adapters below.
- **`inMemoryEffects` / `cloudflareEffects`** — local-dev and Cloudflare adapters for the neutral effect vocabulary (`cacheGet`/`cachePut`, `query`/`queryOne`/`execute`, `env`, `cookie`, `fetchJson`).
- **`backends.ts`** — driver-agnostic glue over minimal client interfaces: `redisCache(client)` + `withCache(runner, backend)` for any Redis-shaped KV; `postgresSql(client)` for any SQL client (Bun.sql, node-postgres, SQLite, …).
- **`tasks.ts`** — `withTasks(runner, handlers)` runs fire-and-forget background work after the response via `ctx.waitUntil`; `withQueueProducer(runner, {queueBinding})` + `createQueueConsumer(handlers)` use Cloudflare Queues for durable jobs.
- **`islands-runtime`** — the small client script that boots each `Browser.element` island into its `<elm-ssr-island>` marker (child-mount keeps the marker as the persistent unit), wires the cross-island event bus, intercepts links for SPA navigation, and syncs `<head>` across navigations.

See the [main README](../../README.md) and the example apps in `examples/` for end-to-end usage.

## License

MIT
