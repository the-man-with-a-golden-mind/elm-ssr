# debugger (AI)

**Subpath:** `elm-ssr/src/debugger.ts`. **Option:** `debug?: boolean` on `WorkerAppOptions`.

Built-in development DevTools console. Injected in dev/test mode at the bottom of rendered HTML documents, providing request profiling, active island inspection with page highlights, session viewing, and real-time cross-island event bus loggers.

## File layout

The debugger feature is implemented in:
- `packages/elm-ssr/src/debugger.ts`: Contains the instrumentation and injection wrappers.
- `packages/elm-ssr/src/request-handler.ts`: Orchestrates context mapping and injects assets.
- `packages/elm-ssr/src/client-runtime/islands.ts`: Dispatches events on navigation for real-time debugger updates.

## Exports (`elm-ssr/src/debugger.ts`)

```ts
import type { EffectRunner } from "./effects";

/**
 * Wraps an EffectRunner to intercept all side effects, measuring duration
 * and pushing log records into context.debugLogs.
 */
export const instrumentEffects = (baseRunner: EffectRunner): EffectRunner;

/**
 * Appends CSS styles, HTML nodes, and a script tag for the debugger panel
 * right before the closing </body> tag of the document.
 */
export const injectDebugger = (html: string, data: unknown): string;
```

## Instrumentation Log Record Shape

If `debug` is enabled, `EffectContext.debugLogs` is populated with records matching:

```ts
interface DebugLogRecord {
  kind: string;
  payload: Record<string, unknown>;
  ok: boolean;
  value?: unknown;
  error?: string;
  durationMs: number;
}
```

## Client Custom Events

The debugger listens to the following window CustomEvents to synchronize client state:

| Event Name | Dispatched By | Detail Payload | Purpose |
|---|---|---|---|
| `elm-ssr-broadcast` | Island broadcast out port | `{ tag: string, payload: unknown }` | Log cross-island events in the console |
| `elm-ssr-debug-update` | Islands client router | `{ url: string, method: string, status: number, effects: DebugLogRecord[], session: unknown }` | Update panel data on SPA navigation |

## Pitfalls & Footguns

1. **Production Safety**: Ensure `debug` is never forced to `true` in production configurations, as it leaks SQL queries, parameters, session structures, and execution timing.
2. **SPA Navigation Scripts**: HTML fragments returned from `/api/render` do not execute script tags when injected via `innerHTML`. To ensure updates during SPA transitions, the islands runtime dispatches `"elm-ssr-debug-update"`, which the pre-mounted debugger listens for.
3. **Cache Hits vs. Fetches**: In E2E tests, repeated renders may show zero `fetchJson` calls and only `cacheGet` hits because the local cache is persistent across requests.
