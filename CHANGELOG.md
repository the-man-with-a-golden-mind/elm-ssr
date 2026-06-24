# Changelog

All notable changes to the `elm-ssr` package. Dates are ISO; "Unreleased" lives
at the top until a version is cut.

## 0.91.0 — 2026-06-24

### Added

- **On-Demand DB & Auth Scaffolding (`elm-ssr init` / `new`)**:
  - Adds `--db` option to scaffold SQLite support (via `bun:sqlite`), generating an initial database schema migration and registering `inMemoryEffects` in the TS runtime.
  - Adds `--auth <betterAuth|auth0>` option to scaffold session cookies and CSRF middleware, route modules (`Login.elm`, `Profile.elm`), and callback intercepts. Automatically enables database/migrations support.
- **Environment Variables Support & Validation**:
  - Automatically generates `.env` at the workspace root and `.dev.vars` inside the app directory with mock environment variables (`GREETING`, `SESSION_SECRET`).
  - Request context falls back to `process.env` when undefined (e.g. locally or in unit tests) to align with Wrangler's `env` object.
  - Runtime filters request environment context to serializable primitives (strings/numbers/booleans) to prevent Cloudflare bindings (like D1/KV) from failing JSON serialization when passed to Elm flags.
  - Dynamic session secrets (`secret` functions) resolving at request time.
  - Loader environment variables validation (`Loader.env` / `Action.env`).

## 0.90.1 — 2026-06-24

### Added

- **Interactive DevTools Debugger Panel**:
  - Injected request stats overlay showing path, method, and overall server-side render time.
  - Interactive islands inspector highlighting element instances, flags, and DOM mutations count/timestamps via `MutationObserver`.
  - Event Bus Monitor logging cross-island events.
  - TIMINGS and effects logger panel split: dedicated "Database" tab for SQL query executions, timings, and variables.
  - Zero-config DOM text preview fallback for active island state visualization.
- **Trello Board E2E Tutorial**:
  - Full narrative tutorial under `docs/tutorials/trello-board.md` detailing how to build a database-backed Kanban board with drag-and-drop islands and persistence.

## 0.11.0 — 2026-06-23

### Added

- **Type-Safe SQL Query DSL & Schema Generation (`elm-ssr query`)**:
  - Implemented `ElmSsr.Db.Dsl` providing type-safe query construction, operators (`eq`, `gt`, `like`, `isNull`, `inList`, etc.), logical operators (`and`, `or`), and edge loader executions.
  - Updates `elm-ssr query` CLI generator to parse schemas and generate table and column descriptors alongside types, record decoders, and parameter encoders.
  - Unit and integration tests for query DSL generation.

## 0.10.0 — 2026-06-23

### Added

- **Zero-Config Tailwind & CSS Styling Pipeline**:
  - Automatically compiles and minifies `src/app.css` if it exists in the application root.
  - Supports full Tailwind CSS compilation by scanning Elm views (`src/**/*.elm`) and TS/JS files for utility classes when `"tailwind": true` is specified in `elm-ssr.config.json`.
  - Output CSS is bundled as a TypeScript module (`styles.ts`), preserving 100% backward compatibility for routes importing `./styles`.
  - Watcher in `dev` mode recursively tracks `.css` files to trigger automatic rebuilds and browser reloads.
  - Unit tests validating plain CSS minification and Tailwind utility class compilation.

## 0.9.0 — 2026-06-23

### Added

- **Declarative GET Redirects & Auth Guards (`Loader.redirect` / `requireUser`)**:
  - Implemented `Loader.redirect` allowing GET loaders to trigger progressive browser redirection on the server.
  - Implemented `Loader.requireUser` and `Action.requireUser` route guard helpers, simplifying authorization checks for authenticated sessions.
  - Handled `Loader.Moved` routing step in the edge runtime and updated the compiler.
  - Added new integration demo route (`/dashboard`) and end-to-end integration tests.
- **Client-Side Progressive Form Enhancement**:
  - Automatically intercepts standard same-origin form submissions (`GET`/`POST`) and performs progressive submissions, updating page content dynamically while preserving active client-side islands.

## 0.8.0 — 2026-06-23

### Added

- **Type-safe Request & Form Validation Library (`ElmSsr.Request.Decode`)**:
  - Implemented `Decoder a` and `FieldDecoder a` types supporting type-safe request query/form parameter parsing.
  - Implemented pipeline decoding support (`required`, `optional`, `optionalWithDefault`) with full applicative validation error accumulation.
  - Added built-in validations (like `email`, `nonEmpty`, `minLength`, `maxLength`, and numeric boundaries).
  - Handles checkbox state normalization (normalization of checkbox presence or omission to Boolean values).
  - Added new integration demo route (`/validate`) and end-to-end integration tests.

## 0.7.0 — 2026-06-23

### Added

- **`elm-ssr route <path>` Command**: A new generator CLI command to scaffold routes. Supports:
  - Standard HTML page routes (`page` and `action` in Elm).
  - JSON API routes (`--api` yielding `Action.json` in Elm).
  - WebSocket routes (`--ws` yielding a TypeScript handler in `src/Endpoints/`).
  - Server-Sent Events routes (`--sse` yielding a TypeScript handler with `createSseStream` in `src/Endpoints/`).
- **Flexible Route Scaffolding**: Support for dynamic segments (preserving underscores like `slug_`) and segment casing. Automatically supports targeting specific apps in multi-app configurations via the `--app <name>` flag.

## 0.6.2 — 2026-06-23

### Fixed

- Scaffolding commands (`new`, `init`) and `migrate` now execute relative to the current working directory (`process.cwd()`) rather than climbing directories to locate a parent workspace. Auto-discovery climbing is reserved only for execution commands (`dev`, `build`, `routes`, `info`), preventing subfolder commands from hijacking new project creations.

## 0.6.1 — 2026-06-23

### Fixed

- Improve error messaging when trying to scaffold an app name that already exists in `elm-ssr.config.json`. Correct terminology to refer to "App" instead of "Example".

## 0.6.0 — 2026-06-23

### Added

- **Workspace Root Auto-discovery**: The CLI will now walk up the directory tree to find `elm-ssr.config.json`, allowing you to run `dev`, `build`, and other commands from inside app subdirectories (like `my-app`).
- **Elm File Watcher in `dev` Mode**: Rebuilds the Elm project automatically when source files change. Changes trigger browser reload seamlessly.
- **Single-App Scaffolding (`elm-ssr init`)**: Adds an `init` command to scaffold a single-app project directly in the current directory (`root: "."`).
- **Automatic `package.json` Setup**: Automatically generates or updates `package.json` with scripts (`dev`, `build`, etc.) and dependencies (`elm-ssr`, `wrangler`) during project scaffolding.

## 0.5.2 — 2026-06-23

### Fixed

- Improve robustness of the `dev` CLI command. It now runs the build directly and automatically falls back to utilizing `bunx wrangler` with a CLI entrypoint flag pointing to the first configured app (and required node compatibility settings) when no `package.json` build scripts or populated wrangler configuration files exist.

## 0.5.1 — 2026-06-23

### Fixed

- Gracefully handle missing `elm-ssr.config.json` configuration file in CLI commands. Running `new` now automatically initializes a workspace configuration, and other workspace-dependent commands print a friendly error message instead of an unhandled `ENOENT` exception.

## 0.5.0 — 2026-05-31

First piece of the "heavy compute" stack: a first-class background-job
model. Submit work that exceeds a single request budget, get an id back
immediately, poll progress or final result from a follow-up page (or
build SSE streaming on top with `createSseStream`).

### Added

- **`elm-ssr/jobs` subpath** ([docs/jobs.md](docs/jobs.md))
  - `withJobs(runner, { store, handlers, defaultTtlSeconds? })` adapter
    intercepts `startJob` and `jobStatus` effects. Handlers run via
    `ctx.waitUntil` on Cloudflare, fire-and-forget on Bun.
  - `memoryJobStore()` (dev/tests) + `cacheJobStore(backend, options?)`
    over any `CacheBackend` (Redis / KV). The `JobStore` interface for
    SQL-backed storage.
  - `JobHandler = (payload, { jobId, reportProgress, signal }) => Promise<unknown>`.
    Return value lands in `record.result`; throwing marks the job failed.
    `signal` aborts on isolate teardown.
- **Elm-side jobs API** ([packages/elm-ssr/elm-src/ElmSsr/Loader.elm](packages/elm-ssr/elm-src/ElmSsr/Loader.elm))
  - `Loader.startJob : { kind, payload } -> Loader JobId` — returns the id
    immediately; the handler runs in the background.
  - `Loader.jobStatus : { jobId, decoder } -> Loader (JobStatus a)` — poll
    the current state.
  - `type JobStatus a = JobQueued | JobRunning { progress } | JobDone a |
    JobFailed { reason } | JobMissing`. Result decoder runs against the
    handler's return value when `JobDone`.
- **Reference demo at `/reports`** in `examples/basic`. Submits a
  `generateReport` job (sleeps 3 × 400ms with progress between phases),
  page polls status, renders Queued / Running / Done / Failed / Missing.
- **Tests** — [test/jobs.test.ts](test/jobs.test.ts) (12 unit: stores,
  start/run/done/failed, progress, missing handler, waitUntil wiring) +
  [test/reports.test.ts](test/reports.test.ts) (5 e2e: form, redirect,
  poll progress, done view, unknown id).

### Notes

- For real durability across isolate restarts, use a durable store
  (`cacheJobStore` over Redis / KV). The in-flight execution itself can
  still be lost on CF isolate rotation — that needs queue-backed
  handlers, planned as a follow-up adapter.
- Cancellation by id, retry policies, SSE-driven streaming results are
  deliberately out of scope for this release. The current store +
  `createSseStream` already let you build streaming with a small handler
  if you need it now.

## 0.4.0 — 2026-05-31

Adds `Loader.custom` — an escape hatch for emitting your own effect kinds,
so you can drop in domain-specific server work (most commonly: `Promise.all`
fan-out over independent SQL queries) without forking the framework.

### Added

- **`Loader.custom : { kind : String, payload : Value, decoder : Decoder a } -> Loader a`**
  ([packages/elm-ssr/elm-src/ElmSsr/Loader.elm](packages/elm-ssr/elm-src/ElmSsr/Loader.elm)).
  Emits an arbitrary effect kind; a user-supplied `EffectRunner` adapter
  intercepts and returns `{ ok, value }`. Decoder runs against `value`.
- **Recipe: [Parallel SQL queries](docs/recipes/parallel-queries.md)** —
  full worked pattern for fan-out via `Promise.all` in the adapter. New
  `docs/recipes/` folder, ready for more.
- **Reference demo at `/parallel`** in `examples/basic` — three fake
  queries (60/80/70 ms) run inside one `parallelMarkets` custom effect,
  the page reports the wall-clock so you can see parallel ≈ slowest, not
  the sum.
- **Test [`test/parallel.test.ts`](test/parallel.test.ts)** — e2e
  correctness + a wall-clock assertion that proves the queries didn't
  serialize.

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
