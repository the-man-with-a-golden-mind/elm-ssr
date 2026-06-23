# Deployment

elm-ssr apps are Fetch-compatible. The generated runtime exports a `worker`
object with:

```ts
worker.fetch(request: Request, env?: unknown, executionCtx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>
```

That shape maps directly to worker/edge platforms and is easy to adapt to
long-lived server processes. Cloudflare Workers is a first-class target because
the package includes KV/D1/Queue adapters, but the core runtime does not require
Cloudflare.

## What Is Portable

These pieces are provider-neutral:

- Elm route modules under `src/<App>/Routes/`.
- Elm islands under `src/<App>/Islands/`.
- The generated page and island bundles.
- The `Loader` / `Action` effect vocabulary.
- `createWorkerApp`, `renderApp`, middleware, sessions, SSE, migrations, and
  the serializer.

These pieces are provider-specific:

- The effect runner: cache, SQL, env, fetch, tasks.
- Session and job stores.
- Queue adapters.
- The deployment entrypoint.
- Static asset serving and platform configuration.

Keep provider-specific choices in `runtime.ts` or the host entrypoint. Do not
put them in Elm route modules.

## Plain Bun Server

After `bunx elm-ssr build`, import the generated worker and call `fetch`:

```ts
import { worker } from "./my-app/runtime";

Bun.serve({
  port: 3000,
  fetch: (request) => worker.fetch(request, process.env)
});
```

For local SQL/cache parity, compose adapters around `inMemoryEffects`:

```ts
import { inMemoryEffects } from "elm-ssr/effects";
import { postgresSql, redisCache, withCache } from "elm-ssr/backends";
import { withTasks } from "elm-ssr/tasks";

export const effects = withTasks(
  withCache(
    inMemoryEffects({
      env: process.env,
      sql: postgresSql({ run: pgRun })
    }),
    redisCache(redis)
  ),
  {
    sendEmail: async (payload) => { /* ... */ }
  }
);
```

## Edge / Worker-Style Hosts

Most edge hosts want a default export with a `fetch` method. Forward the
platform values to `worker.fetch`:

```ts
import { worker } from "./my-app/runtime";

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  }
};
```

If the host does not provide `ctx.waitUntil`, inline tasks still run, but they
are detached work in the current process/request lifetime. Use a durable queue
or your own task adapter for work that must not be lost.

## Cloudflare Workers

Cloudflare needs almost no adapter because its module-worker shape matches
`worker.fetch`:

```ts
import { worker } from "./my-app/runtime";

export default worker;
```

Use `cloudflareEffects` when you want the built-in KV/D1 mapping:

```ts
import { cloudflareEffects } from "elm-ssr/effects";

const effects = cloudflareEffects({
  cacheBinding: "CACHE",
  dbBinding: "DB"
});
```

Use `withQueueProducer` / `createQueueConsumer` only when you specifically want
Cloudflare Queues. Otherwise `withTasks` is the portable post-response adapter.

## Other Providers

For another provider, write the smallest adapter at the TypeScript boundary:

1. Expose the app as `Request -> Promise<Response>`.
2. Map provider environment values into `env`.
3. Implement cache and SQL through `withCache` / `inMemoryEffects({ sql })`, or
   handle custom effect kinds yourself.
4. Use `waitUntil` if the provider has it; otherwise choose durable storage or a
   provider queue for important background work.

The test for portability is simple: routes should still render if you call
`worker.fetch(new Request("https://example.com/"))` directly in a test.

## See Also

- [Backends](backends.md) — effect runner adapters.
- [Tasks and queues](tasks.md) — post-response work and durable queues.
- [Middleware](middleware.md) — customizing the request pipeline.
- [Testing](testing.md) — calling `worker.fetch` directly.
