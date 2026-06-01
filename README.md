# elm-ssr

Elm-first SSR library and framework for Cloudflare Workers (and Bun locally).

Two execution worlds, glued by a marker element:

- **Pages** are SSR-only Elm. They use a custom serialisable AST (`ElmSsr.Html`,
  `ElmSsr.Svg`) because Cloudflare Workers has no DOM — `elm/html`'s virtual-dom
  kernel can't run server-side.
- **Islands** are *standard* `Browser.element` programs using stock `elm/html`,
  `elm/svg`, `elm/http`, `Html.Keyed`, `elm/time`, … They mount client-side into
  `<elm-ssr-island>` markers the page emits.

The Worker exposes a **backend-neutral** effect surface (cache, sql, env,
cookie, fetchJson, enqueue) that Elm `Loader`/`Action` describe; pluggable TS
adapters execute them — KV/D1 on Cloudflare, Redis/Postgres/SQLite locally —
without any change to the Elm code. Background jobs run after the response via
`ctx.waitUntil` or Cloudflare Queues. A built-in SQL migration runner brings the
schema with it.

## Why it exists

Stock Elm SSR is awkward because `elm/html` is opaque and DOM-bound. Other
frameworks fake hydration by replaying the whole tree. This project takes the
other fork:

- **Real SSR for pages** via a serialisable, library-owned AST → works on
  Cloudflare Workers with no DOM, real HTML per request.
- **No fake hydration** — islands are mounted with normal Elm browser runtime,
  so you get unmodified `elm/html`/`Html.Keyed`/`elm/http`/`elm/svg` inside them.
- **Backend-neutral effects** so the same Elm runs against Cloudflare KV/D1 or
  local Redis/Postgres/SQLite by swapping the runner adapter — useful for
  parity between local dev and production.

## Quickstart

```bash
bun install
bun run build         # CLI scans Routes/ + Islands/, generates Main.elm + islands bundle
bun run test          # 100+ tests, including end-to-end worker.fetch coverage
bun run dev           # wrangler dev
```

Scaffold a new app:

```bash
bun run ssr:new my-app
```

Optional — run integration tests against real Postgres + Redis:

```bash
docker compose up -d --wait
bun run test:integration
docker compose down
```

The default `bun test` skips the integration suites when `DATABASE_URL` /
`REDIS_URL` aren't set, so machines without Docker stay clean.

## Repository layout

```
packages/
  elm-ssr/                       # The single published package: CLI (`elm-ssr` build/new/migrate/dev),
                                 # TS runtime + effect adapters + tasks/queues + migrations, and the
                                 # Elm authoring modules under elm-src/ (synced into each app on build)
examples/
  basic/                         # The reference app (pages, islands, forms, cache, sql, tasks)
  crypto-dashboard/              # Tailwind + elm/svg + elm/http islands with 15s refresh + cross-island bus
docker-compose.yml               # postgres + redis for integration tests
AGENTS.md                        # Orientation for AI agents working on this repo
```

## Authoring

### Routes (file-based)

Drop a module under `src/<App>/Routes/`:
- `Index.elm` → `/`
- `Counter.elm` → `/counter`
- `Greet/Name_.elm` → `/greet/:name` (names ending in `_` are dynamic segments)
- `NotFound.elm` → fallback

Every route exposes `page` (GET/HEAD) and `action` (POST):

```elm
module Demo.Routes.Status exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view

action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"
```

### Loaders + effects

Loaders are pure descriptions; the Worker pumps their effects:

```elm
cachedStatus : Loader Status
cachedStatus =
    Loader.cacheGet { key = "status", decoder = decoder }
        |> Loader.andThen
            (\cached ->
                case cached of
                    Just status -> Loader.succeed status
                    Nothing ->
                        Loader.fetchJson { url = "https://…", decoder = decoder }
                            |> Loader.andThen
                                (\status ->
                                    Loader.cachePut { key = "status", value = encode status, ttlSeconds = Just 60 }
                                        |> Loader.map (\_ -> status)
                                )
            )
```

Available effects (all backend-neutral): `fetchJson`, `cacheGet`/`cachePut`,
`query`/`queryOne`/`execute`, `env`, `getCookie`, `enqueue`. To write
cookies, use `Action.setCookie` / `Action.sessionCookie` / `Action.clearCookie`
from inside an `Action` — see
[docs/loaders-and-actions.md](docs/loaders-and-actions.md#cookies).

For higher-level **sessions + CSRF** (signed-cookie sessions, pluggable
stores, CSRF protection, the `Loader.session`/`csrfToken`/`setSession`/
`clearSession` effects), see [docs/sessions.md](docs/sessions.md). Opt in
with `sessions:` + `csrf:` on `createWorkerApp`.

For **server push** (live-updating islands via Server-Sent Events) see
[docs/sse.md](docs/sse.md). TS side: `createSseStream(request, handler)`
from `elm-ssr/sse`; Elm side: `ElmSsr.Island.Sse.open` / `events` / `match`.

### Actions (forms without JS)

Actions are the POST equivalent of loaders — describe validation, run a server
effect, then redirect (Post/Redirect/Get). Reuse any Loader effect via
`Action.fromLoader`:

```elm
action : Request -> Action (Document Never)
action request =
    case Route.formValue "message" request of
        Just msg when not (String.isEmpty msg) ->
            Action.fromLoader
                (Loader.execute { sql = "INSERT INTO entries (message) VALUES (?)"
                                , params = [ Encode.string msg ] })
                |> Action.andThen (\_ -> Action.redirect "/guestbook")

        _ ->
            Action.fail 422 "Message is required."
```

### Islands

Drop a `Browser.element` under `src/<App>/Islands/`. The module also exposes a
one-line `embed` that pages call directly — no generated indirection:

```elm
module Demo.Islands.Counter exposing (embed, main)

import Browser
import ElmSsr.Island as Island
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)
import Json.Encode as Encode

type alias Flags = { start : Int }
type alias Model = { count : Int }
type Msg = Increment

embed : Flags -> Island.Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = \f -> Encode.object [ ( "start", Encode.int f.start ) ]
        , fallback = \_ -> []
        , id = Nothing
        }

main : Program Flags Model Msg
main =
    Browser.element
        { init = \flags -> ( { count = flags.start }, Cmd.none )
        , update = \_ m -> ( { m | count = m.count + 1 }, Cmd.none )
        , subscriptions = \_ -> Sub.none
        , view = \m -> div [] [ button [ onClick Increment ] [ text "+" ], text (String.fromInt m.count) ]
        }
```

The page imports the island and calls `Counter.embed { start = 0 }`. Cross-island
state goes through `ElmSsr.Island.Shared.broadcast`/`listen` (a `window`
CustomEvent bus).

## Effect adapters

Compose the worker's `effects` from small adapters:

```ts
import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";
import { withCache, redisCache, postgresSql } from "elm-ssr/backends";
import { withTasks, withQueueProducer } from "elm-ssr/tasks";

// Cloudflare deploy:
const effects = withTasks(cloudflareEffects({ cacheBinding: "CACHE", dbBinding: "DB" }), {
  sendEmail,
  warmCache
});

// Local dev / tests:
const effects = withTasks(
  withCache(
    inMemoryEffects({ sql: postgresSql(myPgClient), env: { /* … */ } }),
    redisCache(myRedisClient)
  ),
  { sendEmail, warmCache }
);
```

The Elm code is identical on both. `redisCache(client)` and `postgresSql(client)`
take minimal client interfaces (see `packages/elm-ssr/src/backends.ts`) so
they work with `Bun.redis`/`Bun.sql`, `ioredis`, `node-postgres`, SQLite, etc.

For durable background jobs (instead of `waitUntil`), swap `withTasks` for
`withQueueProducer({ queueBinding })` and wire `createQueueConsumer(handlers)`
in the consumer worker's `queue` handler.

## Database migrations

SQL-file migrations live in a directory (e.g. `migrations/0001_init.sql`,
`0002_add_users.sql`). The runner creates a tracking table
(`__elm_ssr_migrations`) and applies each pending file in alphabetical order,
**transactionally** (each migration + its tracking insert are one `BEGIN…COMMIT`,
so a failure rolls back without leaving a partial schema). Re-runs are
idempotent. Optional down migrations live alongside as `<name>.down.sql`.

The example app ships migrations in [`examples/basic/migrations/`](./examples/basic/migrations/) — the `0001_guestbook.sql` schema used by `/guestbook`, plus a paired `0001_guestbook.down.sql`.

### From the CLI

```bash
elm-ssr migrate up     --dir ./migrations --db ./app.db
elm-ssr migrate status --dir ./migrations --db ./app.db
elm-ssr migrate down   --dir ./migrations --db ./app.db   # revert the last applied
elm-ssr migrate down --count 3 --dir ./migrations --db postgres://user:pass@localhost:5432/db
```

`--db` accepts a Postgres URL (`postgres://…` / `postgresql://…`), a `sqlite://` URL, or a plain SQLite file path. If omitted it reads `DATABASE_URL` from the environment.

### Programmatic API

```ts
import { Database } from "bun:sqlite";
import {
  runMigrations,
  revertMigrations,
  listMigrations
} from "elm-ssr/migrations";

const db = new Database("app.db");
const adapter = {
  exec: async (sql) => { db.exec(sql); },
  list: async (sql) => db.query(sql).all()
};

const { applied, skipped } = await runMigrations(adapter, { dir: "./migrations" });
const status                = await listMigrations(adapter, { dir: "./migrations" });
const { reverted }          = await revertMigrations(adapter, { dir: "./migrations", count: 1 });
```

The same `MigrationsAdapter` shape wires to Postgres (`Bun.sql`/`node-postgres`)
— optionally with `runInTransaction(fn)` if the driver exposes native
transaction scopes (`sql.begin` / `pool.connect`) — or Cloudflare D1.

## Commands

```bash
bun install
bun run build              # generate Main.elm, compile app + islands bundle, write generated/
bun run check              # build + tsc --noEmit
bun run test               # build + bun test (skips integration when env unset)
bun run test:integration   # bun test test/integration/ (needs DATABASE_URL + REDIS_URL)
bun run test:docker        # docker compose up --wait; bun run test; docker compose down
bun run dev                # build + wrangler dev
bun run deploy             # build + wrangler deploy
bun run ssr:new <name>     # scaffold a new example app
bun run ssr:routes         # print configured app modules

# Migration CLI (any directory + any backend)
elm-ssr migrate up     --dir ./migrations --db ./app.db
elm-ssr migrate status --dir ./migrations --db ./app.db
elm-ssr migrate down   --dir ./migrations --db ./app.db [--count N]
```

## Example routes (`examples/basic`)

- `GET /` — pure SSR page, no client JS.
- `GET /status` — loader page with **server-side caching** (`cacheGet` → miss →
  `fetchJson` → `cachePut`) and an `env` read.
- `GET /counter` — SSR page that embeds two `Browser.element` islands.
- `GET /greet/:name` — SSR page with a dynamic segment.
- `GET /chart` — pure-SSR inline SVG via `ElmSsr.Svg`.
- `GET /echo`, `POST /echo` — form action: validate → effect → PRG redirect, no JS.
- `GET /guestbook`, `POST /guestbook` — list via `query`, insert via `execute`,
  enqueue a background `auditEntry` task after the redirect.

## Phases shipped

- **Phase 1** — File-based routes, Loaders, server effect loop. (`docs/`)
- **Phase 1.5** — Dynamic segments, small-modules split.
- **Islands pivot** — Islands are `Browser.element` (full `elm/html` ecosystem).
- **Phase 2** — Effectful `Action` (free monad like Loader), `fromLoader`, form
  actions, PRG redirects.
- **Phase 3** — Backend-neutral effects (`cacheGet`/`cachePut`, `query`/`queryOne`/
  `execute`, `env`), Cloudflare + in-memory adapters, composable
  `withCache`/`postgresSql`/`redisCache` over driver-agnostic client interfaces.
- **Phase 4** — Background tasks (`enqueue`) via `withTasks` (`waitUntil`) or
  `withQueueProducer` + `createQueueConsumer` (CF Queues).
- **Migrations** — file-based SQL with transactional per-migration safety.

## Tradeoffs

- Pages use a library-specific SSR HTML tree, not stock `elm/html`. (Workers has
  no DOM.) Islands use stock Elm.
- No "fake full hydration" for arbitrary `elm/html` apps.
- Islands ship one combined bundle per app (no per-route code splitting — Elm
  has no lazy loading).
- The default `withTasks` keeps the isolate alive via `waitUntil`; durable jobs
  need Queues (an adapter swap, no Elm change).

## Guarantees

- SSR render is request-scoped, with per-request `env`/bindings on the effect
  runner.
- Island state is client-scoped and isolated per mounted root.
- Pages without island markers ship no browser runtime.
- `Html.Keyed` works through Elm's own runtime inside islands.
- Each SQL migration runs inside a transaction; tracking is updated only on
  successful commit.
- Worker concerns (middleware, REST, asset serving) stay outside the
  author-facing Elm modules.

## More

- [`docs/`](./docs/) — topic-by-topic documentation (routing, effects,
  backends, tasks, islands, migrations, sessions, SSE, CLI, middleware,
  testing).
- [`docs/examples.md`](./docs/examples.md) — **catalog of every demo route
  and island** in `examples/basic` and `examples/crypto-dashboard`, mapped
  to the feature it shows. Start here when looking for runnable code.
- [`docs/recipes/`](./docs/recipes/) — composition patterns. Currently:
  [parallel-queries.md](./docs/recipes/parallel-queries.md) (`Loader.custom`
  + `Promise.all` for fan-out workloads).
- [`CHANGELOG.md`](./CHANGELOG.md) — release notes.
- [`llms.txt`](./llms.txt) — entry point for LLMs/AI agents reading this repo
  ([llmstxt.org](https://llmstxt.org/) format).
- [`AGENTS.md`](./AGENTS.md) — orientation for AI agents working on this
  repo (hard rules + footguns).
- [`packages/elm-ssr/README.md`](./packages/elm-ssr/README.md) — the package
  readme (CLI commands, runtime exports, Elm authoring modules).

The package also ships the Elm authoring modules (under `packages/elm-ssr/elm-src/`) which the build syncs into each app's `.elm-ssr/src/ElmSsr/` at compile time.

## License

MIT. See [LICENSE](./LICENSE).
