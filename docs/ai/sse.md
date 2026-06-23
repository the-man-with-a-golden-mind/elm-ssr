# sse (AI)

**Subpath:** `elm-ssr/sse`. **Elm:** `ElmSsr.Island.Sse` (see `islands.md`).

Per-connection Server-Sent Events. Server emits `text/event-stream`;
island consumes via `EventSource`. **One stream per client connection** —
for fan-out (one event → many subscribers), wire your provider's broadcast,
durable object, pub/sub, or message-bus primitive yourself.

## Exports

```ts
interface SseEvent { data: string; event?: string; id?: string; retry?: number; }

type SseSend = (event: SseEvent | string) => void;     // string = { data: string }
type SseStreamHandler = (send: SseSend, signal: AbortSignal) => Promise<void> | void;

interface SseStreamOptions { headers?: HeadersInit; retryHintMs?: number; }

createSseStream(request: Request, handler: SseStreamHandler, options?: SseStreamOptions): Response;
createNamedSseStream(request: Request, channel: string, handler: (publish: (data: string) => void, signal: AbortSignal) => Promise<void> | void, options?: SseStreamOptions): Response;
encodeSseEvent(event: SseEvent | string): string;       // exposed for ad-hoc framing
```

## Server response defaults

`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, plus the configured `retry:` line up-front.

## Minimal example: server

```ts
import { createSseStream } from "elm-ssr/sse";

const liveStream = (request: Request): Response =>
  createSseStream(request, async (send, signal) => {
    let n = 0;
    while (!signal.aborted && n < 600) {
      n += 1;
      send(JSON.stringify({ time: new Date().toISOString(), n }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

// Dispatch yourself; fall through to worker.fetch:
const base = createWorkerApp({ /* ... */ });
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/__elm-ssr/live") return liveStream(request);
    return base.fetch(request, env, ctx);
  },
};
```

## Minimal example: island

```elm
import ElmSsr.Island.Sse as Sse

init _ = ( { tick = "" }, Sse.open "/__elm-ssr/live" )

subscriptions _ = Sub.batch [ Sse.events GotEvent, Sse.errors GotError ]

update msg model =
    case msg of
        GotEvent event ->
            case Sse.match "/__elm-ssr/live" tickDecoder event of
                Just (Ok tick) -> ( { model | tick = tick.time }, Cmd.none )
                _ -> ( model, Cmd.none )

        GotError _ -> ( model, Cmd.none )
```

## Patterns

- Time-based feed (server tick) → `createSseStream` + `while (!signal.aborted) { send(...); await sleep(...) }`.
- Named events (per-channel) → `createNamedSseStream` auto-emits `event: <channel>` + incrementing `id:`.
- Multiple streams per island → call `Sse.open` for each URL; filter in `update` via `Sse.match`.
- Persistent island for SSE → `id = Just "..."` keeps the EventSource open across SPA nav.

## Footguns

- SSE endpoint lives OUTSIDE the Elm router. Dispatch yourself in your fetch handler; fall through to `base.fetch` for everything else.
- `createSseStream(request, ...)` — first arg is the `Request`, not options. `request.signal` is the disconnect source.
- Host must support streaming `Response` bodies. Long-running streams can hit provider limits; consider keepalive `: ping\n\n` comments + bounded duration.
- The client EventSource auto-reconnects on transient drop. `Sse.errors` is informational; don't tear down state on error.
- Browser per-origin EventSource limit on HTTP/1.1 is ~6. Share channels when you can.
- `Sse.events` fires for ALL open streams in the island — filter by `event.url` (use `Sse.match`).
