# deployment (AI)

**Core rule:** elm-ssr is Fetch-compatible, not Cloudflare-only.

`createWorkerApp(...)` returns:

```ts
interface WorkerHandler {
  fetch(request: Request, env?: unknown, executionCtx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>;
}
```

## Portable pieces

- Elm route modules.
- Elm island modules.
- Generated `app.mjs` / `islands.mjs`.
- `Loader` / `Action` effect vocabulary.
- `createWorkerApp`, `renderApp`, middleware, sessions, SSE, jobs, migrations.

## Provider-specific pieces

- Effect runner (`inMemoryEffects`, `cloudflareEffects`, `withCache`, custom).
- SQL/cache clients.
- Session/job stores.
- Queue implementation.
- Deployment entrypoint.

## Bun / long-lived server

```ts
import { worker } from "./my-app/runtime";

Bun.serve({
  fetch: (request) => worker.fetch(request, process.env)
});
```

## Edge / worker-style host

```ts
import { worker } from "./my-app/runtime";

export default {
  fetch: (request, env, ctx) => worker.fetch(request, env, ctx)
};
```

## Cloudflare Workers

```ts
import { worker } from "./my-app/runtime";

export default worker;
```

Use `cloudflareEffects({ cacheBinding, dbBinding })` only when mapping cache/SQL
effects to KV/D1. Use `withQueueProducer` / `createQueueConsumer` only for
Cloudflare Queues.

## Patterns

- Prefer `inMemoryEffects({ sql: postgresSql(...) })` + `withCache(..., redisCache(...))` for portable server deployments.
- Write a custom runner for provider-specific services. Intercept `effect.kind`; fall through to the base runner.
- Use `ctx.waitUntil` when the provider has it. Otherwise assume post-response work can be lost unless it goes through a durable queue/store.
- Keep provider-specific code in `runtime.ts` or the deployment entrypoint, not in Elm route modules.

## Footguns

- `elm-ssr dev` runs `wrangler dev`; it is Cloudflare-oriented convenience, not the only local run path.
- `cloudflareEffects` requires Cloudflare-style `env` bindings named `CACHE`/`DB` by default.
- `withQueueProducer` is not a generic queue abstraction; it targets Cloudflare Queues.
