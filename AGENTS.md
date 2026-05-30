# AGENTS.md — orientation for AI assistants working on elm-ssr

If you are an AI agent (Claude Code, Cursor, …) opening this repo, read this
file first. It encodes the project's architecture, conventions, and the small
set of footguns that tend to bite agents specifically.

## TL;DR

`elm-ssr` is a small Elm-first SSR library + framework for Cloudflare Workers
(and Bun locally). Two execution worlds, glued by a marker element:

- **Pages** are SSR-only Elm. They use a custom serializable AST
  (`ElmSsr.Html`) because Cloudflare Workers has no DOM, so `elm/html`'s
  `virtual-dom` kernel can't run server-side.
- **Islands** are *standard* `Browser.element` programs using stock `elm/html`,
  `elm/svg`, `elm/http`, `Html.Keyed`, etc. They mount client-side into
  `<elm-ssr-island>` markers the page emits.

The Worker exposes a *backend-neutral* effect surface (cache/sql/env/cookie/
fetchJson/enqueue) that the Elm side describes; pluggable TS adapters execute
them against KV/D1 on Cloudflare or Redis/Postgres/SQLite locally.

## Hard rules (read before editing)

These match real bugs I've shipped or nearly shipped. Don't repeat them.

1. **Islands MUST use `elm/html`, not `ElmSsr.Html`.** Every island's
   `view : Model -> Html Msg` imports `Html exposing (...)`. `ElmSsr.Html` is
   only used inside the island module for the SSR `fallback` markup (which is
   part of the page tree). If you find yourself rewriting an island's view to
   `ElmSsr.Html` you are wrong — that's the pre-pivot architecture we deleted.
2. **Pages use `ElmSsr.Html`.** Pages return `Document Never`, serialized on the
   server to HTML. They cannot use `elm/html` because Workers has no DOM.
3. **Verify against code, not memory or this file.** Memory files in
   `~/.claude/projects/.../memory/` carry useful context but can also be stale.
   Run `grep`/`ls`/`Read` before asserting how something currently works.
4. **No `Generated.*` modules in author-facing API.** The author imports the
   island module directly (`import App.Islands.Counter as Counter`) and calls
   `Counter.embed {...}`. There is *no* `Generated.Islands` re-export. Codegen
   is reserved for things the author never touches (`Main.elm`, the islands
   client program, the manifest).
5. **Workspace subpath imports.** TS imports `elm-ssr/effects`,
   `/tasks`, `/backends`, `/migrations`, `/middleware`, `/http`, etc. — never
   relative paths like `../../packages/elm-ssr/src/effects`.
6. **Small modules.** Split by responsibility (the client runtime is split into
   `islands.ts` + the inline core; the effect adapters are composable
   `withCache`/`withTasks`/`withQueueProducer`). Don't grow one file.
7. **Don't add comments that narrate the change.** No "added for issue #X",
   "now we also …", "refactored from …". Either explain a non-obvious *why* in
   one short line, or stay silent.
8. **Elm sources live in `packages/elm-ssr/elm-src/`** (the package is the
   canonical home; the build syncs them into each app's `.elm-ssr/src/ElmSsr/`).
   There is **one** published package — `elm-ssr` — covering CLI, TS runtime,
   effect adapters, tasks/queues, migrations, and the Elm authoring modules.
   The earlier split into `@elm-ssr/cli` + `@elm-ssr/runtime-worker` was
   collapsed pre-release; don't look for those.

## File layout

```
packages/
  elm-ssr/                       # The single published package
    bin/elm-ssr.mjs              # `elm-ssr` CLI entry
    elm-src/ElmSsr/              # Route, Loader, Action, Html(+.Attributes/.Events),
                                 # Svg(+.Attributes), Island(+.Shared), Document(+.Encode/.Events),
                                 # Page, Runtime — synced into each app's .elm-ssr/src/ on build
    lib/
      build.mjs                  # Scans Routes/ + Islands/, generates Main.elm, runs `elm make`
      migrate.mjs                # `elm-ssr migrate up|down|status` with Postgres + SQLite adapters
      scaffold.mjs               # `elm-ssr new <name>`
      workspace.mjs              # reads elm-ssr.config.json
    src/
      app.ts                     # createWorkerApp({elmModule, islands, ..., effects})
      request-handler.ts         # Routes + dispatch; threads effectContext into render
      render.ts                  # Drives the Elm runtime's effect loop; returns RenderedDocument
      effects.ts                 # EffectRunner, defaultEffectRunner, inMemoryEffects, cloudflareEffects
      tasks.ts                   # withTasks, withQueueProducer, createQueueConsumer
      backends.ts                # CacheBackend, withCache, redisCache, SqlClient, postgresSql
      middleware.ts              # composeMiddleware + the standard middlewares
      http.ts                    # AppContext type, json/text/withHeaders
      response-headers.ts        # htmlHeaders, jsonHeaders, cssHeaders, assetHeaders
      serialize.ts               # SsrDocument → HTML string
      protocol.ts                # SsrNode/Attribute/Document types + isNode validation
      migrations.ts              # runMigrations, revertMigrations, listMigrations
      client-runtime/islands.ts  # The client island runtime (source string)
examples/
  basic/                         # The reference app
  crypto-dashboard/              # Tailwind + elm/svg + elm/http islands + cross-island bus
generated/                       # Build output (gitignored)
test/                            # bun test, happy-dom for the client runtime
```

## Architecture cheat sheet

- **Routing is file-based** (Next/Remix-style). `src/<App>/Routes/Index.elm` → `/`,
  `Foo/Bar.elm` → `/foo/bar`, names ending in `_` are dynamic segments
  (`Greet/Name_.elm` → `/greet/:name`, captured via `Route.param "name"`),
  `NotFound.elm` is the fallback. Each route module exposes
  `page : Request -> Loader (Document Never)` and `action : Request -> Action (Document Never)`.
- **Loaders/Actions are descriptions.** They produce `Pending Effect (Value -> …)`.
  The Worker (`render.ts`) pumps the effect loop via ports until terminal.
- **`Action.fromLoader` lifts a `Loader` into an `Action`** — that's how actions
  reuse every Loader effect (cacheGet, query, execute, env, fetchJson, getCookie, enqueue).
- **Islands** live in `src/<App>/Islands/`. The codegen scans the directory,
  emits `Generated.Islands` only for the *client registry/manifest* (never
  re-exported to authors), and one combined `islands.mjs` is shipped per app.
- **Cross-island state** uses `ElmSsr.Island.Shared.broadcast`/`listen`, a
  `window` CustomEvent bus. A broadcaster also hears its own broadcast — filter
  by `tag` in `update`.
- **Client SPA navigation** is in `client-runtime/islands.ts`: intercepts
  same-origin link clicks (skips hash-only/same-path), fetches `/api/render`,
  swaps `#elm-ssr-root` innerHTML, re-boots islands, syncs `<head>`. Persistent
  islands (with `id`) transfer across navigation; non-persistent ones leak the
  Elm runtime (Elm has no program teardown — only the bus listener is reclaimable).

## Effect vocabulary

In Elm (`ElmSsr.Loader`, reusable from `Action` via `fromLoader`):

| Effect | Kind string | Maps to (cloudflareEffects) | Local default |
|---|---|---|---|
| `fetchJson { url, decoder }` | `fetchJson` | real `fetch` | real `fetch` (override via inMemoryEffects.fetchJson) |
| `cacheGet { key, decoder }` / `cachePut { key, value, ttlSeconds }` | `cacheGet`/`cachePut` | `env.CACHE` (KV) | in-memory `Map` (or `withCache(redisCache(client))`) |
| `query` / `queryOne` / `execute` | `query`/`queryOne`/`execute` | `env.DB` (D1) | `inMemoryEffects({ sql })` hook (plug bun:sqlite / Postgres / SQLite) |
| `env name` | `env` | `context.env[name]` | the `env` option object |
| `getCookie name` | `cookie` | parsed from `context.request` cookie header | same |
| `enqueue { task, payload }` | `enqueue` | `withTasks(...)` → `ctx.waitUntil`, OR `withQueueProducer({queueBinding})` → CF Queue | `withTasks` fire-and-forget |

The adapters are *composable*. A realistic stack:

```ts
const effects = withTasks(
  withCache(
    inMemoryEffects({ sql: postgresSql(pgClient), env }),
    redisCache(redisClient)
  ),
  { sendEmail, warmCache }
);
```

## How to add things

### A new route

Drop `src/<App>/Routes/<Name>.elm` exposing `page` and `action`. The CLI build
regenerates `Main.elm` automatically. Dynamic segments via trailing `_`.

### A new island

Drop `src/<App>/Islands/<Name>.elm`. It MUST:
- be a `Browser.element` (`main : Program Flags Model Msg`) using stock `elm/html`.
- expose `embed = Island.embed "<Name>" { encodeFlags, fallback, id }` — the
  build validates the name string matches the module path.

The page imports the island and calls `<Name>.embed {...}`.

### A new server effect

Decide if it's logical (deserves its own kind) or just a fetchJson variant.
For a new kind:
1. Add a constructor to `ElmSsr.Loader` emitting `Pending { kind = "myKind", payload = ... } continue`.
2. Handle the kind in the relevant adapter(s) — `defaultEffectRunner`,
   `inMemoryEffects`, `cloudflareEffects`. Use `EffectContext.env`/`request`.
3. Test by calling the runner directly with the effect (see `test/adapters.test.ts`).

### A new background task handler

Pure TS: register it in the `withTasks` handlers object (or in the
`createQueueConsumer` map). Elm side calls `Loader.enqueue { task = "name", payload }`.

### A new backend adapter

Match a minimal client interface (see `CacheClient` / `SqlClient` in
`backends.ts`) and write a small mapping function. Test with a fake client; the
user wires the real driver in their entrypoint.

## Build pipeline

`bun run build` → `bun run packages/elm-ssr/bin/elm-ssr.mjs build`:
1. Reads `elm-ssr.config.json` (workspace root) listing apps.
2. For each app, scans `src/<Namespace>/Routes/` and `Islands/`, generates
   `.elm-ssr/Main.elm` (router) + the islands manifest, and syncs
   `packages/elm-ssr/elm-src/ElmSsr/*` into `<app>/.elm-ssr/src/ElmSsr/*` so the
   example's `elm.json` `source-directories` can list `".elm-ssr/src"`.
3. Runs `elm make` to produce `generated/<app>/app.mjs` and a combined
   `islands.mjs` (one bundle exposing every island as `Elm.<Module>`).

`bun run check` = `build` + `tsc --noEmit`. `bun test` = `build` + `bun test`.

The test runner uses `happy-dom` for the client island runtime (`bun:sqlite` is
plugged into `inMemoryEffects({ sql })` for the SQL adapter test).

## Migrations

`elm-ssr/migrations` exports three operations:

- `runMigrations(adapter, { dir, tableName?, now? })` — apply pending `*.sql`, alphabetical, transactional per-migration, idempotent. Files named `*.down.sql` are ignored on the up pass.
- `revertMigrations(adapter, { dir, tableName?, count? })` — revert the most-recently-applied N (default 1) by running each `<name>.down.sql`; errors clearly if a paired down file is missing.
- `listMigrations(adapter, { dir, tableName? })` — `{ applied: [{name, appliedAt}], pending: [name] }`.

The adapter is two callbacks plus an optional transaction hook:

```ts
interface MigrationsAdapter {
  exec(sql: string): Promise<void>;                          // multi-statement
  list(sql: string): Promise<Array<Record<string, unknown>>>; // SELECT
  runInTransaction?(fn: () => Promise<void>): Promise<void>;  // use the driver's native txn scope
}
```

Wire it to bun:sqlite (`{ exec: s => { db.exec(s); }, list: s => db.query(s).all() }`), `Bun.sql` (`runInTransaction: fn => sql.begin(fn)`), `node-postgres`, or D1. Real-world wiring lives in `test/migrations.test.ts` (SQLite, 16 tests), `test/integration/redis-postgres.test.ts` (Postgres, incl. revert + status), and `test/cli-migrate.test.ts` (the CLI driving SQLite end-to-end on the example's migrations dir).

### CLI

`elm-ssr migrate <up|down|status> [--dir <path>] [--db <conn>] [--count N] [--table <name>]`:

- `--db postgres://…` → builds a `Bun.sql` adapter with `runInTransaction = sql.begin`.
- `--db sqlite://path` or a bare file path → bun:sqlite adapter.
- Reads `DATABASE_URL` if `--db` is omitted; errors clearly if neither is set.

CLI lives in `packages/elm-ssr/lib/migrate.mjs`, dispatched from `packages/elm-ssr/bin/elm-ssr.mjs`.

## Integration tests (Docker)

`docker-compose.yml` brings up Postgres 16 + Redis 7. `test/integration/redis-postgres.test.ts` uses `describe.skip` when `DATABASE_URL` / `REDIS_URL` aren't set, so the default `bun test` stays clean on machines without Docker.

```
docker compose up -d
bun run test:integration
docker compose down
```

The integration test wires `Bun.redis` to `redisCache` and `Bun.sql` to `postgresSql`, runs a real migration against Postgres, and verifies the round-trip of every effect against the real backend.

## Testing strategy

Each TS module has unit tests where it has logic worth isolating
(`middleware.test.ts`, `http.test.ts`, `adapters.test.ts`, `effects.test.ts`,
`serialize.test.ts`, `svg.test.ts`). Routes/actions/effects are tested
end-to-end through `worker.fetch` (`app.test.ts`, `action.test.ts`,
`crypto-dashboard.test.ts`). Islands are tested via:
- `browser-island.test.ts` — mount a per-island bundle in happy-dom, click,
  assert (uses a fresh div as the mount point, NOT the marker, so it dodges
  Browser.element's node-replacement).
- `island-runtime.test.ts` — drives the *real* client runtime source
  (`createIslandsRuntime`) under happy-dom, with the real generated bundle,
  to cover the marker child-mount + persistence transfer + head sync.

Cookie/redis/postgres/queues are unit-tested with fakes — no real servers.

## Common pitfalls

- **`Browser.element` replaces the mount node.** If you find yourself storing
  `marker` after `Elm.<Module>.init({ node: marker })`, you stored a detached
  node. The client runtime mounts into a child `<div>` for exactly this reason
  (see `client-runtime/islands.ts` — `bootMarker`). Persistence references the
  marker, not the inner Elm-managed view.
- **happy-dom `querySelector` is broken** in some selector cases — the existing
  tests use `getElementsByTagName` + a manual class walker. Don't reach for
  `querySelector` in new tests.
- **Don't add elm/html things to `ElmSsr.Html.Events`.** Only `click`/`input`/
  `change`/`submit` are wired through `Document.Events.findMessage`. Pages are
  static — they don't need handlers. (The Events module is more of a vestige
  from the pre-pivot architecture; new event vocabulary belongs in islands via
  `Html.Events`.)
- **`tsc` does not include `test/`.** Only `packages/**` and `examples/**` are
  type-checked. A test file can `import { Database } from "bun:sqlite"` even
  though tsc wouldn't accept that import elsewhere.
- **`bun run check` exits with `tail`'s status if you pipe it.** Capture
  `bun run check > /tmp/log 2>&1; echo "exit: $?"` to read the real exit code.
