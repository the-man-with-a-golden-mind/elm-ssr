# Middleware

`createWorkerApp` wraps the request handler in a fixed stack of middlewares.
You usually don't need to touch this — the defaults give you request IDs,
timing headers, structured request logging, error normalization, and HEAD
support out of the box.

## Default stack

In order (outermost first):

1. **`errorMiddleware`** — catches anything thrown downstream, logs
   `elm_ssr_request_failed { requestId, path, error }`, and returns
   `{ "error": "internal_error", "requestId": ... }` (JSON, status 500) for
   `/api/*` or plain `Internal Server Error` (status 500) for everything
   else.
2. **`requestIdMiddleware`** — uses the incoming `x-request-id` header if
   non-empty; otherwise generates a fresh UUID. Echoes the value back in the
   response header.
3. **`timingMiddleware`** — adds `server-timing: app;dur=…` and
   `x-response-time: …ms` based on `performance.now() - context.startedAt`.
4. **`loggingMiddleware`** — after the response is built, logs a JSON line
   `{ event: "request_completed", requestId, method, path, status, durationMs }`.
   On Cloudflare the logging is scheduled via `ctx.waitUntil` so it doesn't
   block the response.
5. **`headMiddleware`** — for `HEAD` requests, strips the response body while
   preserving status + headers.

## Composing your own

```ts
import {
  composeMiddleware,
  errorMiddleware,
  requestIdMiddleware,
  timingMiddleware,
  loggingMiddleware,
  headMiddleware,
  type Middleware
} from "elm-ssr/middleware";

const authMiddleware: Middleware = async (context, next) => {
  if (context.url.pathname.startsWith("/admin/")) {
    const session = context.request.headers.get("cookie") ?? "";
    if (!session.includes("admin=1")) {
      return new Response("Forbidden", { status: 403 });
    }
  }
  return next(context);
};

const handler = composeMiddleware(myRouteHandler, [
  errorMiddleware,
  requestIdMiddleware,
  timingMiddleware,
  loggingMiddleware(),
  authMiddleware,
  headMiddleware
]);
```

`composeMiddleware(handler, [a, b, c])` runs `a` outermost: `a → b → c →
handler → c → b → a`.

If you want to customize the **default** stack used by `createWorkerApp`,
you can't drop middlewares from it directly — pass your own `log` to override
the logger, or build your own `WorkerHandler` from scratch with
`composeMiddleware` if you need different ordering.

## `AppContext`

Every middleware and handler receives an `AppContext`:

```ts
interface AppContext {
  request: Request;
  url: URL;
  requestId: string;        // set by requestIdMiddleware (empty before)
  startedAt: number;        // performance.now() at request start
  executionCtx?: WorkerExecutionContext;  // present on Cloudflare; has waitUntil
  env?: Record<string, unknown>;          // Cloudflare bindings
}
```

`executionCtx?.waitUntil(promise)` is how the logging and task adapters
schedule work after the response. If absent (Bun, tests), middlewares fall
back to fire-and-forget.

## Source

- [packages/elm-ssr/src/middleware.ts](../packages/elm-ssr/src/middleware.ts)
- [packages/elm-ssr/src/http.ts](../packages/elm-ssr/src/http.ts) — types
- [packages/elm-ssr/src/app.ts](../packages/elm-ssr/src/app.ts) — default stack
