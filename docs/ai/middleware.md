# middleware (AI)

**Subpath:** `elm-ssr/middleware` (+ types in `elm-ssr/http`).

`createWorkerApp` installs a fixed default stack. To customize, build your
own with `composeMiddleware`.

## Types

```ts
interface AppContext {
  request: Request;
  url: URL;
  requestId: string;            // set by requestIdMiddleware
  startedAt: number;            // performance.now() at request start
  executionCtx?: { waitUntil(p: Promise<unknown>): void };
  env?: Record<string, unknown>;
  session?: RequestSession;     // populated by sessionMiddleware
}

type AppHandler = (ctx: AppContext) => Promise<Response>;
type Middleware = (ctx: AppContext, next: AppHandler) => Promise<Response>;
```

## Exports

```ts
composeMiddleware(handler: AppHandler, middlewares: Middleware[]): AppHandler;
// Outermost first: composeMiddleware(h, [a, b, c]) → a wraps b wraps c wraps h.

// Default stack pieces (export individually):
errorMiddleware: Middleware;       // try/catch; JSON 500 for /api/*, plain 500 elsewhere
requestIdMiddleware: Middleware;   // uses x-request-id or generates UUID, echoes header
timingMiddleware: Middleware;      // adds server-timing + x-response-time
loggingMiddleware(logger?): Middleware;  // JSON log line per request via waitUntil
headMiddleware: Middleware;        // strips body on HEAD requests

// http.ts helpers:
json(body: unknown, init?: ResponseInit): Response;
text(body: string, init?: ResponseInit): Response;
withHeaders(response: Response, headers: HeadersInit): Response;
```

## Default stack order (in `createWorkerApp`)

```
errorMiddleware
  → requestIdMiddleware
    → timingMiddleware
      → loggingMiddleware(log)
        → [if sessions:] sessionMiddleware
          → [if csrf:] csrfMiddleware
            → headMiddleware
              → routeHandler
```

## Minimal example: add a middleware

```ts
import { composeMiddleware, errorMiddleware, requestIdMiddleware, timingMiddleware, loggingMiddleware, headMiddleware, type Middleware } from "elm-ssr/middleware";

const authMiddleware: Middleware = async (ctx, next) => {
  if (ctx.url.pathname.startsWith("/admin/")) {
    const cookie = ctx.request.headers.get("cookie") ?? "";
    if (!cookie.includes("admin=1")) return new Response("Forbidden", { status: 403 });
  }
  return next(ctx);
};

const handler = composeMiddleware(routeHandler, [
  errorMiddleware,
  requestIdMiddleware,
  timingMiddleware,
  loggingMiddleware(),
  authMiddleware,
  headMiddleware,
]);
```

## Patterns

- Custom logger: `createWorkerApp({ log: (line) => console.log(line) })` overrides only the logger; the rest of the stack stays default.
- Per-route logic via middleware: branch on `ctx.url.pathname`, fall through to `next(ctx)` for the rest.
- Sessions/CSRF: prefer `createWorkerApp({ sessions: {...}, csrf: true })` — wires the right order automatically.
- Reading the body in middleware: clone via `ctx.request.clone()` so the route handler can read it again.

## Footguns

- Outermost middleware runs FIRST going in, LAST going out. `errorMiddleware` is outermost so it catches everything downstream.
- `headMiddleware` strips the body — must be innermost (last in array, closest to handler) so other middlewares still see status/headers.
- `ctx.requestId` is empty BEFORE `requestIdMiddleware`. Don't read it in middlewares above it.
- `executionCtx?.waitUntil` is host-provided and optional; check `if (ctx.executionCtx) ...`. In Bun/tests it is usually `undefined`.
- `withHeaders` creates a new Response; the original is consumed.
- The default stack is opinionated — you can't remove middlewares from it via `createWorkerApp` opts. To customize, build your own with `composeMiddleware`.
