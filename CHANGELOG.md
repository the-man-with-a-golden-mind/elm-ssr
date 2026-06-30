# Changelog

All notable changes to the `elm-ssr` package. Dates are ISO; "Unreleased" lives
at the top until a version is cut.

## Unreleased / 1.0.8

### Fixed

- **`BETTER_AUTH_API_KEY` (and `secret`/`baseURL`) could go stale forever on a warm Cloudflare Workers isolate.** The internal BetterAuth instance was cached keyed only by the resolved DB binding — but `env.DB` is the *same object reference* on every request to a warm isolate, so once constructed, whatever `apiKey`/`secret`/`baseURL` happened to resolve on the very first request (e.g. `apiKey` undefined before a dashboard key was configured) stayed cached for the isolate's entire lifetime, even after the env var was correctly set. The cache key now covers all resolved config, not just the DB reference. Caught by directly observing real production logs (`apiKey: 'missing'` persisting despite the var being set) — added a regression test (`test/auth-better-auth.test.ts`) that spies on the option resolvers and asserts they're re-evaluated, and a stale config actually invalidates the cache, on every request; verified the test fails against the original code and passes with the fix.

## 1.0.7 — 2026-06-30

### Fixed

- **Home page and navbar never reflected signed-in state.** Only `Profile.elm` read the session; `Index`/`Counter`/`NotFound` never did, and `Shared.layout`'s nav hardcoded a static "Sign in" link regardless of auth state. Fixed: `Shared.User` / `Shared.sessionDecoder` / `Shared.layoutFor` make the nav session-aware (shows the signed-in user + a `/profile` link, or "Sign in"). `elm-ssr auth add` on an existing app adds these *additively* — the original `layout` function and any hand-edited pages keep compiling unchanged; a warning names which pages to migrate to `layoutFor` if you want them session-aware too.
- **Login form had no real validation errors.** It discarded `Form.decode`'s per-field errors and showed one generic string. Now `Form.errorFor "email"` / `Form.errorFor "password"` render inline under each field, cleared as you type; server errors (wrong password, duplicate email) still show as a banner.
- **BetterAuth dashboard never actually showed sign-ups — the 1.0.6 fix was wrong.** The `/api/auth/dash/validate` handler shipped in 1.0.6 was a hand-rolled stand-in that always returned `{ok: true}` with no verification. Checked against the real `@better-auth/infra` package: the dashboard requires the `dash()` plugin (JWT-gated, reports real user data to Better Auth's own infra API), not a bare reachability ping. The fake handler also unconditionally short-circuited the route, so even a correctly-configured `dash()` plugin would never have been reached. Now wires in the real plugin via `createBetterAuthProvider`'s `apiKey` option — set `BETTER_AUTH_API_KEY` (get one by connecting your app at dash.better-auth.com) and sign-ups show up there.
- **Auth0 token exchange used the wrong content type.** `/oauth/token` was called with `Content-Type: application/json`; Auth0's documented format is `application/x-www-form-urlencoded`. Fixed.

### Internal

- **Auth provider implementations moved out of generated code and into the library.** Previously the full BetterAuth/Auth0 provider logic (route handling, session bridging, OAuth2 exchange) was a JS string template copy-pasted into every scaffolded app's `Auth.ts` — never imported, never type-checked, never unit-tested directly. That's how the dash() plugin gap and the content-type bug went unnoticed despite an E2E test suite: nothing exercised the real upstream protocol. Now `createBetterAuthProvider`/`createAuth0Provider` live in `packages/elm-ssr/src/auth/{better-auth,auth0,contract}.ts`, exported as `elm-ssr/auth`, `elm-ssr/auth/better-auth`, `elm-ssr/auth/auth0`, with direct unit tests (`test/auth-better-auth.test.ts`, `test/auth-auth0.test.ts`) that exercise them against a real BetterAuth/sqlite instance and a mocked Auth0 endpoint. Generated `Auth.ts` is now ~10-20 lines of env-resolver glue instead of ~150 lines of duplicated implementation.
- `better-auth` / `@better-auth/infra` are now `peerDependencies` of `elm-ssr` itself (optional) — the scaffold reads required versions from there instead of keeping its own separate hardcoded version strings.

## 1.0.6 — 2026-06-30

### Added / Improved

- **Elmto is now the canonical DB layer.** `elm-ssr query` generator emits `ElmSsr.Db.Elmto` schemas (`xxxSchema`, `*Col`) + compat CRUD helpers. Old `ElmSsr.Db.Dsl` is deprecated (kept for ports only). Examples (Guestbook) and docs updated. `Repo` + `Changeset` + soft* constraint paths are the recommended story.
- **Scaffold codegen is more debuggable and automatic.** `ensureScaffoldCodegen` now does mtime-based rebuild when `Scaffold.elm` changes (not just when output missing). Wired non-fatally into `build` and CLI paths. Hybrid Elm/JS remains (JS for FS/CLI, pure Elm for content gen).
- **SPA navigation now surfaces lifecycle events.** `elm-ssr-navigation-start` / `elm-ssr-navigation-end` (with `ok`) for pending spinners, revalidation UI, or island coordination during client nav. Falls back to full reload on error.
- **Error handling solidified with more adversarial tests.** Expanded coverage for hard effect failures (→ 502), Form decode errors (→ 422), DB constraints (via `softExecute`/`softQueryOne` + changeset attachment), unknown effects, txn rollbacks, Loader/Action fail statuses, etc. Non-optimistic paths (constraint, bad input) are now explicitly tested in addition to happy paths. See `docs/error-handling.md`.

### Fixed / Polished

- Fixed escaping in auth login island Form decoder (lambda) during scaffold E2E runs.
- Marked vestigial modules (`ElmSsr.Html.Events`, `ElmSsr.Document.Events`) with LEGACY notes. No new surface should be added here.
- Docs refreshed for canonical paths (query-dsl marked legacy, elmto promoted, SPA nav section updated).
- Full verification: builds, `bun test` (targeted + key suites including cli scaffold critical paths, elmto, effects, actions), island runtime.

### Breaking / Migration

- Generated `Db/*.elm` modules from `elm-ssr query` now use Elmto (schema/cols) instead of Dsl. Update call sites to `Query.from MyDb.xxxSchema` + `Repo.all` (or keep using the compat `all`/`insert` helpers).
- Old Dsl imports will eventually be removed from the public story.

### Auth: provider-neutral contract

- **`AuthUser` / `AuthSessionData` is now the stable session shape across providers.** elm-ssr sessions own app auth state; `session.user` is what Elm decodes. Providers normalise into `AuthUser { id?, email, name?, picture?, provider? }` and never invent their own session shape. Pending OAuth state lives under `session.auth.pendingOAuth`, never the top-level payload, so it can't break `Loader.requireUser`.
- **`composeAuthProviders([...])` replaces ad-hoc middleware wiring.** Both BetterAuth and Auth0 scaffolds now generate the identical runtime shape: `sessions: {...}`, `csrf: { skipPaths: ["/api/auth/"] }`, `middlewares: [authMiddleware]`. Adding a second provider later merges cleanly into the same `composeAuthProviders([...])` call and import line.
- **BetterAuth provider (`betterAuthProvider`)**: sign-in/sign-up call BetterAuth for credential validation only — elm-ssr sessions are the system of record, not BetterAuth's own session table. An explicit callback bridge (`bridgeBetterAuthSession`) normalises BetterAuth's session into `AuthUser` after any request that falls through to BetterAuth's own handler (e.g. social providers). `/api/auth/dash/*` is handled directly — these are BetterAuth's *online dashboard* callbacks (reachability check, config load before saving a new secret), not part of the npm package, and previously 404'd.
- **Auth0 provider (`auth0Provider`)**: proper OAuth2 — `state` generated and verified (CSRF protection), user fetched via `/userinfo` (server-to-server) instead of decoding an unverified ID token client-side.
- **`elm-ssr auth add <betterAuth|auth0> [--app <name>]` / `auth list`**: add an auth provider to an existing app without regenerating it. Idempotent (safe to run twice), non-destructive (never overwrites an existing `Login.elm`/`Profile.elm`), supports adding a second provider on top of the first via `// elm-ssr-auth:start`/`:end` markers in `runtime.ts`.
- **Login as a real Elm island** (`Islands/Login.elm`, BetterAuth only): sign-in/sign-up form using `ElmSsr.Form` for client-side validation and a `navigateTo` port (now a first-class island primitive in `client-runtime/islands.ts`, alongside `broadcastOut`/`stateOut`/SSE ports) for post-auth navigation. Replaces an earlier hardcoded HTML string.

### Fixed (this round)

- Restored a BetterAuth E2E test that had been disabled with an early `return` after a missing migration-application step caused it to fail — it was reporting green while skipping ~30 lines of real assertions (sign-up/in, wrong-password, duplicate-signup, route isolation, dashboard endpoints, logout). Root-caused and fixed properly instead of leaving it skipped.
- `ensureScaffoldCodegen` no longer attempts (and warns about) a rebuild when `codegen/Scaffold.elm` is absent — which is the normal case for installed/published packages, since only the precompiled `lib/scaffold-codegen.mjs` ships. Previously this printed a non-fatal but noisy stderr warning on every `new`/`init`/`route`/`build` invocation for any user without `elm` on `PATH`.

### Internal

- `lib/scaffold.mjs` split from a single 2685-line file into 8 focused modules under `lib/scaffold/` (codegen bridge, string utils, app templates, auth templates, runtime/worker templates, styles template, `auth add` logic, route scaffolding). Public API unchanged — `bin/elm-ssr.mjs` and `lib/build.mjs` needed no changes. Dropped two dead exports (`generateApiRoute`, `generatePageRoute`) left over from the Elm-codegen migration.

## 1.0.5 — 2026-06-29

### Added

- **CLI now shows its version.** `elm-ssr version`, `elm-ssr --version`, and
  `elm-ssr -v` all print the installed version number. The help header also
  includes the version so it's always visible at a glance.

### Fixed

- **BetterAuth dashboard validation endpoint was missing.** The BetterAuth online
  dashboard calls `GET /api/auth/dash/validate` before saving configuration
  changes (e.g. a new secret). This route is not in BetterAuth's npm package —
  it is an external callback from their cloud dashboard. The generated auth
  intercept now handles it directly:
  - `GET /api/auth/dash/validate` → `200 { "ok": true }`
  - `GET /api/auth/dash/validate?challenge=<token>` → `200 <token>` (echo)

- **BetterAuth instance was re-created on every request.** `createAuth(env)` was
  called in both `betterAuthBridge` (per page load) and the auth intercept (per
  auth call), re-initializing Kysely and all plugins each time. Now a lazy
  singleton `_auth ??= createAuth(getAuthEnv(env))` is shared across all
  requests within a worker isolate.

### Improved

- **BetterAuth route isolation is now explicitly tested.** Assertions verify that
  `/api/auth/*` routes reach BetterAuth (empty 404 body, not elm-ssr HTML),
  `GET /api/auth/get-session` returns 200+null unauthenticated, POST to an
  auth route is not blocked by elm-ssr's CSRF middleware, and
  `GET /api/auth/dash/validate` returns 200.

## 1.0.4 — 2026-06-28

### Fixed

- **Scaffold `--auth better-auth` broke Cloudflare Workers builds.**
  The generated `src/Endpoints/Auth.ts` contained `require("bun:sqlite")` which
  Wrangler's esbuild bundler cannot resolve. The generated database config also
  used `{ type: "sqlite", db: env.DB }` which made BetterAuth's adapter skip
  auto-detection and treat `env.DB` as an already-initialized Kysely instance —
  causing `db.selectFrom is not a function` at runtime.

  Fix:
  - `Auth.ts` no longer references `bun:sqlite` at all. `env.DB` is passed
    directly to `betterAuth({ database: env.DB })` so BetterAuth's adapter
    auto-detects the dialect: D1 on Cloudflare (via `"batch"/"exec"/"prepare"`),
    bun:sqlite locally (via `"fileControl"`).
  - The local bun:sqlite `Database` is now opened inside `runtime.ts` (not
    `Auth.ts`) inside a `typeof Bun !== "undefined"` guard — a block that
    esbuild statically eliminates when targeting Cloudflare Workers. The db is
    injected into `env` as `DB` via `getAuthEnv()` before every BetterAuth call
    so `Auth.ts` stays platform-agnostic.
  - `app.db` is opened relative to `import.meta.dir` so it always lives next to
    `runtime.ts` regardless of the process working directory.
  - Tests are rewritten to use BetterAuth's real email+password API
    (`/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`)
    and apply the generated migration before first use. `sessionStore` is no
    longer exported from `runtime.ts` for BetterAuth apps.
  - `better-auth` is added to the monorepo dev dependencies so the test suite
    can import it via the symlinked `node_modules`.

## 1.0.3 — 2026-06-28

### Fixed

- **Scaffold `--auth better-auth` generated a mock stub instead of a real integration.**
  The migration had only a single `users` table with an `INTEGER AUTOINCREMENT` id.
  `src/Endpoints/Auth.ts` hardcoded `user@example.com` and never imported `better-auth`.
  `runtime.ts` used elm-ssr's own session cookie alongside the mock.

  Fix:
  - Migration now emits all 4 tables BetterAuth requires (`user`, `session`, `account`,
    `verification`) with correct column types (`TEXT` primary keys, camelCase names,
    `ON DELETE CASCADE` foreign keys).
  - `Auth.ts` imports `betterAuth` from `better-auth`, initialises it per-request
    (D1 on Cloudflare, `bun:sqlite` locally), and exports `handleAuth` (delegates to
    `auth.handler(request)`) and `betterAuthMiddleware` (reads BetterAuth's session and
    injects the user into `context.session` so `Loader.requireUser` works).
  - `runtime.ts` wraps the effect runner with `sessionEffects` directly instead of
    configuring elm-ssr's session middleware; `betterAuthMiddleware` is wired via the
    `middlewares` option; `/api/auth/*` is forwarded to `handleAuth(request, env)` with
    no extra arguments (BetterAuth owns session state).
  - `.dev.vars` / `.env` now contain `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` instead
    of `SESSION_SECRET`. Social-provider vars are included as commented examples.
  - `package.json` gains `"better-auth": "latest"` in `devDependencies`.

- **Scaffold `--auth auth0` generated a mock stub instead of a real OAuth2 flow.**
  The migration was a generic `users` table with an integer id. `Auth.ts` hardcoded the
  user and never redirected to Auth0.

  Fix:
  - Migration creates a `users` table with `id TEXT` (Auth0 subject), `picture`, and
    camelCase `createdAt`/`updatedAt` columns.
  - `Auth.ts` implements the real Authorization Code flow: `/api/auth/login` redirects
    to `https://{AUTH0_DOMAIN}/authorize`; `/api/auth/callback` exchanges the code at
    `/oauth/token`, decodes the ID token JWT payload, and writes the user into elm-ssr's
    session store; `/api/auth/logout` clears the session and redirects to Auth0's OIDC
    logout endpoint. No extra npm package required.
  - `.dev.vars` / `.env` now contain `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`,
    `AUTH0_CLIENT_SECRET`, and `AUTH0_CALLBACK_URL` alongside `SESSION_SECRET`.

## 1.0.2 — 2026-06-26

### Fixed

- **Debugger Islands tab did not update live.** Island state and DOM text
  were only visible after switching away and back to the Islands tab.

  Root cause: the `MutationObserver` callback called `scanIslands()`
  synchronously. For islands that emit model state via the `stateOut` port,
  the `elm-ssr-state-update` event fires asynchronously — *after* the
  synchronous `scanIslands()` call — so the panel re-rendered with the
  previous model state.

  Fix:
  - `scheduleScan()` — a debounced, `requestAnimationFrame`-deferred
    wrapper that replaces every direct `scanIslands()` call triggered by
    DOM mutations or state-update events. The rAF boundary gives the
    browser one full frame to flush all port messages and dispatch pending
    events before the panel re-renders, guaranteeing the freshest model
    state and DOM text are always displayed.
  - `scanPending` guard prevents duplicate rAF callbacks when multiple
    mutations arrive in the same frame (e.g. Elm removes old nodes and
    inserts new ones in one reconcile pass).
  - Live DOM text is now **always** shown alongside model state (previously
    it was hidden when `islandActiveStates` had any entry). This means
    the panel reflects live DOM immediately on every render, even if the
    model-state port fires slightly later.

## 1.0.1 — 2026-06-26

### Fixed

- **Generated app had no layout, header, or navigation.** `Shared.elm` emitted
  a bare `div + h1`. All pages looked like unstyled text. Replaced with a full
  design system:
  - Sticky header with brand (`◆ elm-ssr`) and nav links. Auth-aware: includes
    a **Sign in** link when `--auth` is set.
  - **Index** — hero section with `Ship fast.` heading, CTA buttons, three
    feature cards (Edge-first / Fully typed / Islands).
  - **Counter** — page header + white card wrapping the island.
  - **Login** — centred auth card: logo, `Welcome back`, `Continue with BetterAuth/Auth0`.
  - **Profile** — avatar circle with name initial, name + email, sign-out button.
  - **NotFound** — large `404` in muted grey, `Go home` button.
  - **CSS** — complete design system (`--bg`, `--surface`, `--border`, `--text`
    custom properties; `.header`, `.nav`, `.hero`, `.features`, `.card`,
    `.btn`/`.btn-primary`/`.btn-secondary`, `.auth-card`, `.counter`,
    `.error-page`, form components). Font via Google Fonts (Inter) with
    system-font fallback.
  - **Tailwind** `@layer components` updated to match all new class names so
    `elm-ssr init … --tailwind` compiles real CSS immediately after
    `bun run build`.
- **`authDisplayName` helper** — the sign-in button showed `"Continue with
  better-auth"` (internal normalised id) instead of `"Continue with
  BetterAuth"`. Fixed: `better-auth` → `BetterAuth`, `auth0` → `Auth0`.

## 1.0.0 — 2026-06-26

### Fixed

- **`elm-ssr init <name>` now creates a directory.** Previously `init t`
  dumped all files directly into the current working directory. It now
  creates `./t/` and scaffolds the self-contained project inside it
  (`elm-ssr.config.json` at `./t/` with `root: "."`). Prints next-steps
  guidance (`cd t && bun install && bun run build && bun run dev`).

- **Scaffold stylesheet was missing essential CSS.** The generated
  `styles.ts` had no font loading, no `h1`/`h2`/`p`/`a` base styles, no
  `.link`, no `.button.primary`, no `.login-container`. Login and profile
  pages were completely unstyled. Fixed: adds Google Fonts (Inter), base
  typography, and all class names referenced by the Elm templates.

- **Tailwind scaffold generated no CSS.** `src/app.css` was three
  bare directives. Tailwind scanned Elm templates for utility classes,
  found none (templates use custom class names like `.shell`, `.button`),
  and emitted nothing. Fixed: `@layer base` (h1/h2/p/a) and `@layer
  components` (`@apply`-based definitions for every class name the
  templates use) are now emitted so a freshly scaffolded Tailwind app
  looks correct immediately.

- **`stat` not imported in `scaffold.mjs`.** Was used inside
  `createAppScaffold` but missing from the `node:fs/promises` import,
  causing the `.env` existence check to silently fail (caught by the
  surrounding try/catch). Fixed.

## 0.99.0 — 2026-06-26

Documentation overhaul, test suite expansion to 263 tests, and example
improvements. No breaking changes; all exports from 0.98.0 are unchanged.

### Documentation — new files

- **[`docs/request-decode.md`](docs/request-decode.md)** — First documentation
  for `ElmSsr.Request.Decode`. Covers all runners (`decodeForm`, `decodeQuery`,
  `decodeParams`, `decodeRaw`), the applicative pipeline (`required`, `optional`,
  `optionalWithDefault`), every built-in validator (`email`, `nonEmpty`,
  `minInt`/`maxInt`, `minFloat`/`maxFloat`, `minLength`/`maxLength`), `validate`,
  `custom`, `andThen`, and the PRG error-display pattern. Previously this module
  was only discoverable from reading `examples/basic/Routes/Validate.elm`.
- **[`docs/api-routes.md`](docs/api-routes.md)** — Explains the JSON API route
  pattern: `Action.json`, calling API routes from islands with `elm/http`, sending
  string-encoded ints in JSON bodies (because `Route.formValue` decodes as strings),
  CSRF on API endpoints via `X-CSRF-Token` header, and the `/api/` vs page error
  format difference.
- **[`docs/error-handling.md`](docs/error-handling.md)** — Unified error guide
  consolidating failure modes previously scattered across four docs: `Loader.fail` /
  `Action.fail` status codes, effect decode failures → 502, `Page.notFound` /
  `Page.document` / `Page.error` for custom error pages, the `Loader.requireUser`
  decode-failure footgun (malformed session → 502, not redirect), `softExecute`
  for constraint-safe writes, and uncaught exception format.
- **[`docs/spa-navigation.md`](docs/spa-navigation.md)** — Documents the
  client-side navigation layer: link interception, the `/api/render?path=` endpoint
  contract, progressive form submissions, island `id` persistence (when to use and
  when not to), head sync algorithm, SSE connections across navigations, hash and
  external link handling, `data-no-spa` opt-out.
- **[`docs/tutorials/auth-flow.md`](docs/tutorials/auth-flow.md)** — Step-by-step
  login/logout/protected-page tutorial. Covers wiring `sessions:` + `csrf:` in
  `runtime.ts`, a login page using `Loader.map2` to read session + CSRF token
  simultaneously, `Loader.setSession`, `Loader.requireUser` and `Action.requireUser`
  on protected pages, `Loader.clearSession`, and a production checklist.

### Documentation — updated files

- **`docs/query-dsl.md`** — Added a "DSL vs Elmto — which to use" decision table
  at the top so developers know immediately which layer to reach for. Added a
  concrete generated module example showing exactly what `elm-ssr query` produces
  for a `trello_cards` table (phantom type, column descriptors, record alias, decoder,
  CRUD signatures, camelCase convention, nullable → `Maybe` mapping).
- **`docs/testing.md`** — Replaced the thin "Writing tests" stub with a
  comprehensive guide: testing page routes with `renderPath`, form actions (PRG
  pattern) with a SQLite-backed `inMemoryEffects`, effect runners in isolation,
  session flows with `createSessionExampleWorker`, and islands with `happy-dom`.
  Updated test count from "~108 tests" to 260+.
- **`docs/routing.md`** — Added tips linking to `api-routes.md` and
  `spa-navigation.md`, and documenting the `--ws`/`--sse` CLI scaffold pattern
  for custom TypeScript endpoints. Added documentation of `Route.formValue` reading
  flat JSON bodies (values must be strings) and `Route.env` synchronous access
  with a concrete dialect-detection example.
- **`docs/loaders-and-actions.md`** — Added `Loader.redirect` constructor with
  auth-guard example; `Loader.requireUser` with signature and usage; `Action.requireUser`
  with signature and usage.
- **`docs/effects.md`** — Added `Loader.softExecute`, `Loader.softQueryOne`, and
  `Loader.transaction` to the vocabulary table; added dedicated sections explaining
  the `ConstraintError` type and transaction rollback semantics.
- **`docs/README.md`**, **`llms.txt`**, **`docs/ai/README.md`** — Updated to
  reference all five new files and the auth-flow tutorial.
- **`docs/tutorials/trello-board.md`** — Fixed five bugs in the tutorial code:
  invalid Elm import syntax (`import Html.Events import …`), non-existent
  `Route.bodyJson` replaced with `Route.formValue` pattern, island sending integer
  JSON values that wouldn't decode (must be string-valued), missing `Action.json`
  at the end of the card creation API, and `TrelloCards.update` with placeholder
  zeros overwriting all fields replaced with a targeted `Loader.execute` UPDATE.

### Tests — 21 new test cases across 7 files + 1 new file (263 total)

- **`test/effects.test.ts`** — Added `Loader.map2` (sequential execution),
  `Loader.softQueryOne` (success, empty result, Postgres UNIQUE violation on
  `INSERT … RETURNING *`), `Loader.transaction` (success with summed
  `rowsAffected`, rollback on failure, clear error when `sqlTransaction` not
  configured), `Loader.softExecute` (success, UNIQUE, NOT NULL), `Route.env`
  (dedicated test passing env via second argument to `worker.fetch`).
- **`test/app.test.ts`** — Added `Page.metaCharset`, `Page.metaViewport`,
  `Page.metaName`, `Page.stylesheet`, `Page.page` (lang + 200 status),
  `Page.notFound` (404, head helpers still present), `Page.document` (custom 502
  status propagates).
- **`test/browser-island.test.ts`** — Added cross-island Shared bus test (Counter
  broadcasts, Observer receives and updates its view); added `ElmSsr.Island.Sse`
  port tests (Live island decodes incoming event via `sseEventIn` port; ignores
  events for a different URL via `Sse.match` filter).
- **`test/route-guards.test.ts`** — Added `Loader.requireUser` key-rotation test
  (old-secret cookie rejected by new-secret worker → redirect); `Loader.map2`
  integration test via `/profile` (session + CSRF token combined); `Action.requireUser`
  unauthenticated POST → redirect; `Action.requireUser` authenticated POST → action
  body runs (405); `Loader.requireUser` malformed session → 502 (not redirect) via
  pre-seeded store.
- **`test/sse.test.ts`** — Added five `createNamedSseStream` tests: `event:` stamp,
  auto-incrementing `id:`, SSE headers, data payload delivery, per-stream id reset.
- **`test/cookies.test.ts`** — Added `Action.defaultCookie` tests: permissive
  attributes (path=/ only, no HttpOnly/Secure/SameSite/Max-Age), GET renders theme.
- **`test/elmto-associations.test.ts`** (new file) — End-to-end test for
  `Repo.loadHasMany` and `Repo.loadBelongsTo` with real SQLite rows. Verifies the
  in-Elm grouping logic: Alice gets 2 posts, Bob 1, Carol 0 (empty list, not
  missing); each post matched to its author; orphan (userId=99) → `null`.

### Examples — new and updated files

- **`examples/basic/src/Example/Basic/Routes/Preferences.elm`** (new) —
  `Action.defaultCookie` reference implementation. POST sets a permissive theme
  preference cookie (no HttpOnly, no Secure, no SameSite, no Max-Age) to contrast
  with the hardened `Action.sessionCookie` used in `Session.elm`.
- **`examples/basic/src/Example/Basic/Routes/Dashboard.elm`** — `action` now uses
  `Action.requireUser profileDecoder "/profile"` so unauthenticated POSTs redirect
  to `/profile` rather than returning 405, fully demonstrating `Action.requireUser`.
- **`examples/basic/src/Example/Basic/Routes/Status.elm`** — Now renders both
  `Route.env "GREETING"` (synchronous, from request flags) and `Loader.env "GREETING"`
  (async, from effect runner) side by side, proving both agree and demonstrating
  the sync/async distinction in a live route.
- **`examples/basic/runtime.ts`** — `createFlags` now passes string-typed env
  bindings to Elm flags so `Route.env` works at runtime. `createSessionExampleWorker`
  accepts an optional `store?` parameter for test injection (pre-seeding sessions
  with specific payloads without going through the login flow).

## 0.98.0 — 2026-06-25

### Added

- **Elmto `updateAll` / `deleteAll`**: Bulk update and delete operations that apply a WHERE expression to a whole table. `updateAll` returns `Result (Changeset record) Int` (rows affected) and propagates constraint errors; `deleteAll` returns `Int` (rows affected).
- **Elmto `preloadHasMany` / `preloadBelongsTo`**: Convenience wrappers over `loadHasMany` / `loadBelongsTo` that accept a result-builder function and return the merged `List result` directly, removing the extra `Loader.map` at the call site.
- **Elmto `compileUpdateAll` / `compileDeleteAll`**: Compiler support for bulk operations with dialect-aware SQL generation (SQLite `?` / PostgreSQL `$n` positionals).
- **Constraint error `detail` field**: `parseConstraintError` now inspects the Bun.sql-style `.detail` metadata property on error objects (PostgreSQL `Key (col)=(val) already exists` detail), so field names are extracted reliably even when the main message omits them. Tests added to `test/adapters.test.ts`.
- **PostgreSQL `COUNT` cast**: `Repo.count` and `Repo.countWhere` now emit `COUNT(*)::int` on PostgreSQL to ensure the Elm `Decode.int` decoder receives an integer rather than a string.
- **`D1DatabaseLike.batch` type**: Added missing `batch` method to the internal D1 interface so TypeScript accepts `cloudflareEffects` transaction batching without a cast.

### Performance

- **`Route.env` sync shortcut**: Config constants passed via `createFlags` `env` are now resolved synchronously from the flags record rather than going through an async `effectRequest`/`effectResult` port round-trip, eliminating one event-loop tick per request for every `Route.env` call.

### Fixed

- **Constraint error parsing**: `parseConstraintError` now receives the raw error object instead of `String(error)`, so quoted field names (`Key ("email")=…`) are extracted correctly via the combined message + detail approach.

## 0.92.0 — 2026-06-24

### Added

- **Release Merge**: Merged the remote `origin/master` branch containing `v0.91.3` (commit `585b705`) into local master branch cleanly with conflict resolution.
- **Elmto (Ecto in ElmSSR)**: Implemented a type-safe, composable, Ecto-like SQL DSL under `ElmSsr.Db.Elmto` containing:
  - **Schema mapping** (`ElmSsr.Db.Elmto`): Maps tables to Elm records with explicit encoders, decoders, and primitive fields (`string`, `int`, `float`, `bool`).
  - **Changeset pipeline** (`ElmSsr.Db.Elmto.Changeset`): Supports casting inputs and checking validations (`validateRequired`, `validateLength`, `validateFormat`, `validateNumber`).
  - **Composable Query builder** (`ElmSsr.Db.Elmto.Query`): Supports composable pipelines (`from`, `select`, `where_`, `limit`, `offset`, `orderBy`) and comparison operators (`eq`, `gt`, `like`, `isNull`, `inList`).
  - **Dialect Compilers** (`ElmSsr.Db.Elmto.Compiler`): Compiles queries and changesets to PostgreSQL (`$1` positional, `RETURNING *`) and SQLite (`?` positional) SQL statements.
  - **Repository execution bridge** (`ElmSsr.Db.Elmto.Repo`): Maps operations to standard `Loader` and `Action` monad commands.
- **Elmto Test Suite**: Added a comprehensive unit test suite (`test/elmto.test.ts`) and database-backed E2E integration test suite (`test/integration/elmto-integration.test.ts`) verifying all DSL compilation and Repo writes against real SQLite and PostgreSQL databases.

## 0.91.6 — 2026-06-24

### Added

- **Cloudflare Effects Adapter Unit Tests**: Added detailed unit tests for the KV/D1/env adapters in `cloudflareEffects`.
- **Soft Routing Redirect Unit Tests**: Added unit tests validating redirects in the client-side render API.

### Fixed

- **Tailwind CSS Compilation**: Made Tailwind CSS compilation in the build command more robust by executing the package binary directly using the workspace-local `tailwindcss` installation, and added `tailwindcss: 3.4.17` dependency to `packages/elm-ssr`.

## 0.91.5 — 2026-06-24

### Fixed

- **Public sessions exports**: Exported `readSignedCookie` from `packages/elm-ssr/src/sessions/middleware.ts` and publicly re-exported it in `packages/elm-ssr/src/sessions/index.ts` so that scaffolded auth handlers/endpoints can successfully import it from `elm-ssr/sessions`.
- **Memory session store inspectability**: Exposed the internal `store` Map on `memorySessionStore()` so test suites can inspect and modify session entries.
- **E2E CLI Scaffolding Tests**: Fixed session identification in test cases to filter store entries by non-null `data` presence instead of assuming insertion order.

## 0.91.4 — 2026-06-24

### Fixed

- **Mock Authentication Flow**: Fixed a redirection loop in the scaffolded auth example where clicking the login button resulted in the user being redirected to `/profile` but instantly sent back to `/login` due to unsigned cookie mismatches. Added full E2E testing of the login request and session validation.

### Added

- **Tailwind CLI Scaffolding Flag**: Added support for the `--tailwind` option to the `init` and `new` commands. This configures `"tailwind": true` in the application config and scaffolds a starter `src/app.css` containing Tailwind CSS directives.

## 0.91.3 — 2026-06-24

### Fixed

- **CLI Scaffolding Session Store Configuration**: Added missing session store configuration (`store: memorySessionStore()`) to the scaffolded `runtime.ts` options template, preventing runtime crashes under Wrangler dev when utilizing authenticated route guards.
- **Scaffolding Index Page Effect Handling**: Configured the effects runner unconditionally in the scaffolded worker template to support standard baseline effects (like `env` and `cookie`) by default, resolving the `502 Bad Gateway` error on the index route of newly generated projects.
- **E2E Scaffolding Test Resolution**: Configured dynamic workspace `node_modules` symlinking and Elm namespace cleanup inside unit and integration tests to resolve compilation imports and avoid dynamic namespace collisions (`hints/6.md`) during E2E requests fetches.

### Added

- **PostgreSQL E2E Integration Test**: Added a complete E2E integration test runner (`test/integration/cli-scaffold.test.ts`) that scaffolds a database app, executes its migrations against a real PostgreSQL Docker database using the CLI `migrate` tool, compiles it, and performs E2E HTTP requests using a real `postgresSql` adapter.

## 0.91.2 — 2026-06-24

### Fixed

- **Wrangler / Cloudflare SQLite Bundling**: Resolved esbuild compilation failure (`Could not resolve "bun:sqlite"`) in Wrangler by dynamically requiring `bun:sqlite` using runtime reflection (to hide it from static analysis). Added D1 database check routing dynamically to `cloudflareEffects` when running under Wrangler/D1, and falling back to `bun:sqlite` locally under Bun.

## 0.91.1 — 2026-06-24

### Fixed

- **Authentication Scaffolding**: Resolved an Elm type mismatch error and a syntax error in the scaffolded `Profile.elm` route template. It now correctly uses `Loader.requireUser` with an Elm lambda callback instead of passing the `request` variable directly, and escapes backslashes to prevent JavaScript Unicode escape errors.

### Added

- **Scaffolding E2E Compilation Tests**: Added automated compilation checks inside `test/cli.test.ts` to verify that all scaffolded output configurations (including DB setup, Auth handlers, HTML pages, JSON APIs, WebSockets, and Server-Sent Events) compile successfully under the Elm compiler.
- **CLI Reference**: Updated the root and package READMEs to document all CLI commands and options in detail.

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
