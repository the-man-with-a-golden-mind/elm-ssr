# Changelog

All notable changes to the `elm-ssr` package. Dates are ISO; "Unreleased" lives
at the top until a version is cut.

## 0.3.0 — 2026-05-31

Style + DX refresh for the reference app. **No changes to the published
package surface** — every export, type, and effect from 0.2.0 still works
identically. Bumped because the in-repo `examples/basic` (which the docs link
to as docs-as-code) was inconsistent and lacked interactive affordances.

### Changed

- **Unified button/link styling in `examples/basic`.** Five overlapping class
  names (`.button-link`, `.counter-button`, `.button`, `.task-up`,
  `.task-remove`) collapsed into one `.btn` family with explicit emphasis
  modifiers (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`,
  `.btn-square`). All clickable elements now have real `:hover`, `:focus-visible`,
  and `:active` states; inline links use `.text-link` (underlined). The
  navigation pills (`.nav-link`) were made visually distinct from CTAs so
  visitors can tell links apart from buttons. Inputs gained focus rings.
- **Stylesheet token system** in [examples/basic/styles.ts](examples/basic/styles.ts) —
  `--accent-strong`, `--line-strong`, `--focus-ring` added for hover/focus.

## 0.2.0 — 2026-05-30

Sessions + CSRF land as a first-class, opt-in layer; **server push via
Server-Sent Events** for islands; cookie primitives gain hardened defaults;
the CLI's `new` command stops scaffolding under `examples/`.

### Added

- **Server-Sent Events** ([docs/sse.md](docs/sse.md))
  - New subpath `elm-ssr/sse` exports `createSseStream(request, handler, options?)` and `createNamedSseStream` for streaming responses with proper SSE framing. Handler receives `(send, signal)` — `signal` aborts on client disconnect.
  - `encodeSseEvent` exposed for ad-hoc framing.
  - New Elm port module `ElmSsr.Island.Sse` with `open`/`close` (Cmd), `events`/`errors` (Sub), and a `match url decoder` helper for routing typed events out of `update`.
  - Client runtime wires SSE ports automatically and closes EventSources when non-persistent islands are torn down on SPA navigation.
  - **examples/basic**: `/live` page + `Live` island + `/__elm-ssr/live` endpoint pushing a tick every second. Demonstrates the `withLiveStream(base)` pattern for dispatching custom SSE routes alongside the Elm router.
  - **examples/crypto-dashboard**: `MarketOverview` island migrated from 15s `Time.every` polling to a live SSE subscription. New `/__elm-ssr/markets/stream` endpoint pushes the four-coin snapshot every 2s with small randomised price nudges so the cards visibly move.
- **Sessions and CSRF** ([docs/sessions.md](docs/sessions.md))
  - New subpath `elm-ssr/sessions` exports `sessionMiddleware`,
    `csrfMiddleware`, `sessionEffects`, `memorySessionStore`,
    `cacheStore`, `signValue`, `verifyValue`, `generateSessionId`,
    `generateCsrfToken`, plus the `SessionStore` / `SessionRecord` /
    `RequestSession` types.
  - `createWorkerApp` gains two opt-in options:
    - `sessions: { secret, store, cookieName?, maxAgeSeconds?, cookiePath?, cookieDomain?, secure?, sameSite? }` — installs the signed-cookie session middleware and auto-wraps your effect runner with `sessionEffects`.
    - `csrf: true | CsrfMiddlewareOptions` — installs the CSRF middleware (requires `sessions`). Header (`X-CSRF-Token`) or form field (`_csrf`); `skipPaths` for webhook receivers.
  - HMAC-SHA256 cookie signing via WebCrypto (constant-time verify).
  - `memorySessionStore()` for dev/tests; `cacheStore(backend, options?)` reuses any `CacheBackend` (works over `redisCache(...)`, KV-backed wrappers, …).
- **Elm-side session API** ([packages/elm-ssr/elm-src/ElmSsr/Loader.elm](packages/elm-ssr/elm-src/ElmSsr/Loader.elm))
  - `Loader.session : Decoder a -> Loader (Maybe a)` — read the current session payload.
  - `Loader.csrfToken : Loader (Maybe String)` — embed in forms (hidden `_csrf` input) or `X-CSRF-Token` on `fetch`.
  - `Loader.setSession : Value -> Loader ()` — replace session data; middleware persists + rolls the cookie.
  - `Loader.clearSession : Loader ()` — destroy the session.
- **Cookies as a first-class `Action` primitive** ([docs/loaders-and-actions.md#cookies](docs/loaders-and-actions.md#cookies))
  - `Action.setCookie : Cookie -> Action a -> Action a`, `Action.clearCookie`, propagated through `map`/`andThen`/`fromLoader`.
  - `Action.defaultCookie` (permissive base) and `Action.sessionCookie` (hardened: `Secure`, `HttpOnly`, `SameSite=Lax`, 7-day `Max-Age`, `Path=/`).
  - `Action.Cookie`, `Action.SameSite = Lax | Strict | None`.
  - `Loader.getCookie : String -> Loader (Maybe String)` for the matching read side.
  - `Set-Cookie` headers attach to **every** response path: HTML page, redirect, JSON, and `/api/render`'s SPA-nav preview.
- **CLI**
  - `elm-ssr new <name>` scaffolds at `<workspace>/<name>/` (previously hardcoded `examples/<name>/`).
  - New `--in <subdir>` flag: `elm-ssr new my-app --in apps` → `<workspace>/apps/my-app/`.
- **Test loops**
  - `bun run test:unit` — fast loop, no Docker.
  - `bun run test:integration` — only the integration suite, self-manages Docker.
  - `bun run test` — full suite, self-manages Docker. (Replaces the old `test:docker`, which is now redundant.)
- **Docs**
  - New [docs/sessions.md](docs/sessions.md).
  - Doc tree: [docs/README.md](docs/README.md) + 11 topic pages
    (getting-started, routing, loaders-and-actions, effects, backends,
    tasks, islands, migrations, cli, middleware, sessions, testing).
  - [llms.txt](llms.txt) at the repo root for AI agents (llmstxt.org format).
- **Example app**
  - `examples/basic/src/Example/Basic/Routes/Profile.elm` — end-to-end session + CSRF demo with `Loader.session` / `csrfToken` / `setSession` / `clearSession`. Exposed via `createSessionExampleWorker` in [runtime.ts](examples/basic/runtime.ts).
  - `examples/basic/src/Example/Basic/Routes/Session.elm` — raw cookie demo (login/logout via `Action.setCookie` + `Action.clearCookie`).

### Changed

- `Action.encodeStep` now takes a `List Cookie` parameter for the cookies to
  attach. Used internally by the runtime; no impact unless you build your
  own encoded steps by hand.
- `Action.step` skips top-level `WithCookies` wrappers; use the new
  `Action.collectCookies : Action a -> ( List Cookie, Action a )` first if
  you need the cookies separately.
- `AppContext` and `EffectContext` gained an optional `session?` field
  populated by `sessionMiddleware`. Existing code is source-compatible.
- Default `bun run test` now brings Postgres + Redis up via Docker
  automatically and tears them down on exit. Use `bun run test:unit` for the
  fast no-Docker loop.

### Fixed

- `elm-ssr new <name>` no longer hardcodes `examples/<name>/`.
- **Flash of unstyled content on SPA navigation.** `syncHead` used to remove
  every managed `<link rel="stylesheet">` and re-add the new ones, even when
  the href was identical across pages — for one paint cycle the page had no
  stylesheet. The diff-based sync now keeps stylesheets in place when their
  `href`/`media` is unchanged, removes only orphans, and adds only what's new.
  Same diff applied to `<meta>` tags (less DOM churn, no visual impact).
  `document.title` is also only reassigned when it actually changes.

### Removed

- `bun run test:docker` (redundant — `bun run test` now self-manages Docker).
- The `@elm-ssr/cli` + `@elm-ssr/runtime-worker` scoped packages were
  collapsed into the single unscoped `elm-ssr` package back in 0.1.0; this
  release does not republish them. Deprecate them in your registry to point
  users at `elm-ssr`:
  ```
  npm deprecate @elm-ssr/cli@0.1.0           "Replaced by the unscoped 'elm-ssr' package."
  npm deprecate @elm-ssr/runtime-worker@0.1.0 "Replaced by the unscoped 'elm-ssr' package."
  ```

## 0.1.0 — 2026-05-30

First public release. Single package `elm-ssr` covering CLI, TS runtime,
effect adapters, tasks/queues, SQL migrations, and the Elm authoring
modules (`ElmSsr.*`).
