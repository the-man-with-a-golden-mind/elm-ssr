# Examples

Catalog of every demo route and island in the two reference apps. Use this
as the entry point when you want to find working code for a specific
feature. Each row links the Elm source plus any TS wiring that makes the
demo run.

## examples/basic

A single multi-route app that touches every feature surface — pages,
loaders, actions, islands, cookies, sessions, SSE, custom effects, SQL,
background tasks.

### Pages and routes

| Path | Feature | Source |
| ---- | ------- | ------ |
| `/` | Hero + feature cards. Stateless page, no client JS. | [Routes/Index.elm](../examples/basic/src/Example/Basic/Routes/Index.elm) |
| `/counter` | Static page that embeds three `Browser.element` islands. | [Routes/Counter.elm](../examples/basic/src/Example/Basic/Routes/Counter.elm) |
| `/status` | `Loader.cacheGet` (fills on miss) + `Loader.env`. No client runtime. | [Routes/Status.elm](../examples/basic/src/Example/Basic/Routes/Status.elm) |
| `/chart` | Server-rendered inline SVG via `ElmSsr.Svg`. Ships zero JS. | [Routes/Chart.elm](../examples/basic/src/Example/Basic/Routes/Chart.elm) |
| `/greet/:name` | Dynamic route segment captured from the filename (`Greet/Name_.elm`). | [Routes/Greet/Name_.elm](../examples/basic/src/Example/Basic/Routes/Greet/Name_.elm) |
| `/echo` | Form action (PRG): validate → server effect → redirect. Works without JS. | [Routes/Echo.elm](../examples/basic/src/Example/Basic/Routes/Echo.elm) |
| `/guestbook` | SQL via `Loader.query` (list) + `Loader.execute` (insert) inside an Action. | [Routes/Guestbook.elm](../examples/basic/src/Example/Basic/Routes/Guestbook.elm) |
| `/session` | Raw cookie demo — `Action.setCookie` / `Action.clearCookie` + `Loader.getCookie`. No middleware. | [Routes/Session.elm](../examples/basic/src/Example/Basic/Routes/Session.elm) |
| `/profile` | High-level sessions + CSRF — `Loader.session`/`csrfToken`/`setSession`/`clearSession` via the session middleware. | [Routes/Profile.elm](../examples/basic/src/Example/Basic/Routes/Profile.elm) |
| `/live` | Server push via SSE. Page embeds the `Live` island; the island subscribes to `/__elm-ssr/live`. | [Routes/Live.elm](../examples/basic/src/Example/Basic/Routes/Live.elm) |
| `/parallel` | `Loader.custom` + `Promise.all` fan-out — three "queries" in one effect call. | [Routes/Parallel.elm](../examples/basic/src/Example/Basic/Routes/Parallel.elm) |
| `/reports` | Background jobs — `Loader.startJob` (POST form), `Loader.jobStatus` (poll on GET with `?id=`). | [Routes/Reports.elm](../examples/basic/src/Example/Basic/Routes/Reports.elm) |
| `*` (fallback) | NotFound page using `Page.notFound` for the correct status. | [Routes/NotFound.elm](../examples/basic/src/Example/Basic/Routes/NotFound.elm) |

### Islands

| Name | Feature | Source |
| ---- | ------- | ------ |
| `Counter` | Plain `Browser.element` with stock `elm/html`. Persistent (`id = Just "..."`) so SPA-nav transfers state. | [Islands/Counter.elm](../examples/basic/src/Example/Basic/Islands/Counter.elm) |
| `Observer` | Cross-island bus — listens for `coin-selected` broadcasts via `ElmSsr.Island.Shared.listen`. | [Islands/Observer.elm](../examples/basic/src/Example/Basic/Islands/Observer.elm) |
| `Tasks` | `Html.Keyed` list with drag-reorder; preserves child input state on reorder. | [Islands/Tasks.elm](../examples/basic/src/Example/Basic/Islands/Tasks.elm) |
| `Live` | SSE subscription via `ElmSsr.Island.Sse.open` + `events`. Renders server-pushed ticks. | [Islands/Live.elm](../examples/basic/src/Example/Basic/Islands/Live.elm) |

### TS wiring (`runtime.ts`)

| Concern | Where |
| ------- | ----- |
| Default `inMemoryEffects` + custom `parallelMarkets` branch with `Promise.all` | [runtime.ts](../examples/basic/runtime.ts) (`exampleEffects`) |
| SSE endpoint `/__elm-ssr/live` + worker wrapper | [runtime.ts](../examples/basic/runtime.ts) (`liveStreamHandler`, `withLiveStream`) |
| Session + CSRF worker variant (`createSessionExampleWorker`) | [runtime.ts](../examples/basic/runtime.ts) |

## examples/crypto-dashboard

Tailwind-based dashboard. Demonstrates real-time updates via SSE, an SVG
chart, cross-island communication, and a CDN-loaded utility stylesheet.

### Pages

| Path | Feature | Source |
| ---- | ------- | ------ |
| `/` | Landing page that embeds `MarketOverview` + `PriceChart` islands. | [Routes/Index.elm](../examples/crypto-dashboard/src/CryptoDashboard/Routes/Index.elm) |
| `*` | NotFound. | [Routes/NotFound.elm](../examples/crypto-dashboard/src/CryptoDashboard/Routes/NotFound.elm) |

### Islands

| Name | Feature | Source |
| ---- | ------- | ------ |
| `MarketOverview` | **Live SSE subscription** — receives a nudged price snapshot every 2s, broadcasts `coin-selected` on click. | [Islands/MarketOverview.elm](../examples/crypto-dashboard/src/CryptoDashboard/Islands/MarketOverview.elm) |
| `PriceChart` | `elm/http` for 7-day history + `Html.Keyed` SVG chart; **listens** to `coin-selected` broadcasts and re-fetches. | [Islands/PriceChart.elm](../examples/crypto-dashboard/src/CryptoDashboard/Islands/PriceChart.elm) |

### TS wiring

| Concern | Where |
| ------- | ----- |
| Custom `cryptoEffects` runner (CoinGecko mock) | [runtime.ts](../examples/crypto-dashboard/runtime.ts) |
| `/__elm-ssr/markets/stream` SSE endpoint (2s nudged ticker) | [runtime.ts](../examples/crypto-dashboard/runtime.ts) (`marketTicker`, `withMarketStream`) |

## Feature → example crosswalk

If you came here to find "how do I do X", start here:

| Want to learn | Read | Look at |
| ------------- | ---- | ------- |
| File-based routing + dynamic segments | [routing](routing.md) | `/`, `/greet/:name`, `/counter` |
| Loaders + Actions (forms, redirects) | [loaders-and-actions](loaders-and-actions.md) | `/echo`, `/guestbook` |
| Backend-neutral effects (cache/sql/env) | [effects](effects.md) + [backends](backends.md) | `/status`, `/guestbook` |
| Background tasks (`waitUntil` / queues) | [tasks](tasks.md) | `/guestbook` (enqueue branch) |
| Islands (interactive bits) | [islands](islands.md) | `/counter`, `Islands/*` |
| Cross-island bus | [islands](islands.md#cross-island-state) | `Islands/Observer`, MarketOverview + PriceChart |
| Cookies (low-level) | [loaders-and-actions#cookies](loaders-and-actions.md#cookies) | `/session` |
| Sessions + CSRF (high-level) | [sessions](sessions.md) | `/profile` |
| Server-Sent Events | [sse](sse.md) | `/live`, crypto-dashboard MarketOverview |
| Parallel SQL fan-out | [recipes/parallel-queries](recipes/parallel-queries.md) | `/parallel` |
| Background jobs (heavy compute) | [jobs](jobs.md) | `/reports` |
| SQL migrations | [migrations](migrations.md) | `examples/basic/migrations/` |
| Middleware stack | [middleware](middleware.md) | every route (default stack applies) |

## Running them

```sh
# both apps build into generated/<name>/
bun run build

# Cloudflare-like local dev for this repo:
bun run dev

# For other hosts, build and run an entrypoint that calls worker.fetch.

# tests cover every route end-to-end through worker.fetch:
bun run test:unit          # fast, no docker
bun run test               # full, brings PG+Redis up
```

See [getting-started.md](getting-started.md) for first-app scaffolding.
