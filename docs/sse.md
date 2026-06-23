# Server-Sent Events (SSE)

The third server→client path, after **props at render** and **client-initiated
effects**. An island opens an `EventSource` against a server endpoint; the
server streams `text/event-stream`; the island re-renders in place as events
arrive.

Two pieces, both in this release:

- **`createSseStream(request, handler, options?)`** — TS-side primitive that
  turns a handler into a streaming `Response` with proper framing and
  client-disconnect signal.
- **`ElmSsr.Island.Sse`** — Elm port module for the island side. Subscribe
  to a URL, decode events, route them.

This is a **per-connection** model — every `EventSource` is its own stream
from the handler. For fan-out (one event, many subscribers), wire your
provider's broadcast primitive, durable object, pub/sub service, or message bus
inside the handler.

## Server side (`elm-ssr/sse`)

```ts
import { createSseStream } from "elm-ssr/sse";

const liveStream = (request: Request): Response =>
  createSseStream(request, async (send, signal) => {
    let n = 0;
    while (!signal.aborted) {
      n += 1;
      send(JSON.stringify({ time: new Date().toISOString(), n }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
```

The handler receives:

- **`send(event)`** — enqueue an event. Either a string (shorthand for
  `{ data: <string> }`) or a full `{ data, event?, id?, retry? }` for custom
  event names, ids, or reconnect hints.
- **`signal: AbortSignal`** — fires when the client disconnects. Loop on
  `!signal.aborted` so your generator stops promptly.

Returning from the handler closes the stream. Throwing closes it with the
error logged (`elm-ssr: SSE handler threw`).

### Wiring it into your runtime

SSE endpoints live outside the Elm router. Dispatch yourself and fall
through to `worker.fetch` for everything else:

```ts
const base = createWorkerApp({ /* ... */ });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/__elm-ssr/live") {
      return liveStream(request);
    }
    return base.fetch(request, env, ctx);
  }
};
```

The reference app does exactly this in
[examples/basic/runtime.ts](../examples/basic/runtime.ts) (see
`withLiveStream`).

### Response headers

`createSseStream` sets:

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (tells nginx-style proxies not to buffer)

Pass `options.headers` to add your own; the SSE-critical ones above
overwrite any conflicting entries.

### Convenience helper

```ts
import { createNamedSseStream } from "elm-ssr/sse";

return createNamedSseStream(request, "tick", async (publish, signal) => {
  while (!signal.aborted) {
    publish(JSON.stringify({ n: Date.now() }));
    await new Promise((r) => setTimeout(r, 1000));
  }
});
```

Same as `createSseStream`, but each event auto-gets `event: "tick"` and an
incrementing `id:`. Useful when the channel has a single semantic event
shape.

## Island side (`ElmSsr.Island.Sse`)

```elm
port module ElmSsr.Island.Sse
    exposing
        ( Event, Error(..)
        , open, close
        , events, errors, match
        )
```

### Opening + closing

```elm
init flags =
    ( { latest = Nothing }, Sse.open "/__elm-ssr/live" )


update msg model =
    case msg of
        Disconnect ->
            ( model, Sse.close "/__elm-ssr/live" )
```

Open is idempotent — opening the same URL twice does not open a second
EventSource. Close is also idempotent.

### Receiving + decoding

```elm
type Msg
    = GotEvent Sse.Event
    | GotError { url : String, message : String }


subscriptions _ =
    Sub.batch
        [ Sse.events GotEvent
        , Sse.errors GotError
        ]


update msg model =
    case msg of
        GotEvent event ->
            case Sse.match "/__elm-ssr/live" tickDecoder event of
                Just (Ok tick) ->
                    ( { model | latest = Just tick }, Cmd.none )

                Just (Err (Sse.DecodeError err)) ->
                    ( { model | error = Just err }, Cmd.none )

                Just (Err (Sse.NetworkError err)) ->
                    ( { model | error = Just err }, Cmd.none )

                Nothing ->
                    -- event was for a different URL
                    ( model, Cmd.none )

        GotError { message } ->
            ( { model | error = Just message }, Cmd.none )
```

`Sse.events` fires for every stream this island has open. Filter by URL with
`Sse.match` — it returns `Nothing` for unrelated URLs so you can short-circuit
without nested `case`s.

### Auto-reconnect

The browser's `EventSource` auto-reconnects on transient network loss; the
client honours the server's `retry:` hint (default 3000 ms — override via
`createSseStream(..., { retryHintMs })`). `Sse.errors` fires once per error
so you can show a "reconnecting…" indicator if you want.

### Lifecycle

- **Page navigation (SPA):** non-persistent islands are torn down on
  navigation, including their EventSources (closed automatically by the
  client runtime). Persistent islands (with an `id`) keep their connections
  alive across navigations.
- **Hard reload / tab close:** the browser closes all EventSources;
  `request.signal` fires on the server, your handler's loop exits.

## End-to-end example

[examples/basic/src/Example/Basic/Routes/Live.elm](../examples/basic/src/Example/Basic/Routes/Live.elm)
+ [examples/basic/src/Example/Basic/Islands/Live.elm](../examples/basic/src/Example/Basic/Islands/Live.elm)
+ the `/__elm-ssr/live` endpoint in
[examples/basic/runtime.ts](../examples/basic/runtime.ts) form the full
demo. The page is static (no client JS); only the embedded `Live` island
hydrates and subscribes.

## Caveats

- **Runtime support:** your host must support streaming `Response` bodies.
  For very long-lived streams with quiet periods, consider sending a keepalive
  comment `: ping\n\n` every few seconds (no Elm-visible side effect).
- **Behind a load balancer / CDN:** some proxies buffer responses by
  default. `X-Accel-Buffering: no` covers nginx; Cloudflare honours
  `Cache-Control: no-cache` plus `Content-Type: text/event-stream`. If you
  see batched delivery, check the intermediaries.
- **Browser limit:** browsers cap the number of concurrent EventSource
  connections per origin (commonly 6 over HTTP/1.1; effectively unlimited
  over HTTP/2). Don't fan out one stream per island instance; share a
  channel when you can.

## Source

- [packages/elm-ssr/src/sse.ts](../packages/elm-ssr/src/sse.ts) — `createSseStream`, `encodeSseEvent`, `createNamedSseStream`.
- [packages/elm-ssr/elm-src/ElmSsr/Island/Sse.elm](../packages/elm-ssr/elm-src/ElmSsr/Island/Sse.elm) — Elm port module.
- [packages/elm-ssr/src/client-runtime/islands.ts](../packages/elm-ssr/src/client-runtime/islands.ts) — `wireBus` wires the SSE ports + per-island cleanup.
- Tests: [test/sse.test.ts](../test/sse.test.ts).
