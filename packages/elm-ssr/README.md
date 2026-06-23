# elm-ssr

Elm-first SSR library and framework for Fetch-compatible runtimes.
One package, three pieces:

- A **CLI** (`elm-ssr build|new|migrate|dev`) that scans your routes/islands,
  generates the router + manifest, and runs `elm make`.
- A **Fetch-compatible runtime** (`createWorkerApp`, `renderApp`, effect adapters,
  background tasks, SQL migrations, middleware) exported via subpaths.
- A set of **Elm authoring modules** under `elm-src/ElmSsr/` (Route, Loader,
  Action, Html, Svg, Island, Page, Document, Runtime) which the build syncs
  into each app's `.elm-ssr/src/ElmSsr/`.

## Install

```sh
bun add elm-ssr
```

Then import the runtime via subpaths and run the CLI with `bunx`:

```sh
bunx elm-ssr new my-app
bunx elm-ssr build
```

## CLI commands

- **`elm-ssr build`** — scans each configured app's `src/<Namespace>/Routes/`
  and `Islands/`, generates `.elm-ssr/Main.elm` (the router with file-based
  routes + dynamic segments) and the islands manifest, syncs the Elm authoring
  modules into the app's `.elm-ssr/src/ElmSsr/`, and compiles via `elm make`
  (one combined island bundle exposing `Elm.<App>.Islands.<Name>`).
- **`elm-ssr new <name>`** — scaffold a new app and register it in
  `elm-ssr.config.json`.
- **`elm-ssr dev`** — `build` then `wrangler dev` for Cloudflare-like local
  development. For other hosts, build with `elm-ssr build` and adapt
  `worker.fetch` in your own server/entrypoint.
- **`elm-ssr compress`** — pre-compress generated bundles with gzip.
- **`elm-ssr migrate <up|down|status>`** — apply / revert / inspect SQL-file
  migrations. `--db postgres://…`, `sqlite://path`, or a plain SQLite file path;
  `--dir <path>` (default `./migrations`); `--count N` (for `down`, default 1).
  Reads `DATABASE_URL` if `--db` is omitted.

Configuration lives in `elm-ssr.config.json` at the repo root:

```jsonc
{
  "apps": [
    { "name": "basic", "root": "examples/basic", "module": "Example.Basic" }
  ]
}
```

## Runtime exports

```ts
import { createWorkerApp } from "elm-ssr";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import type { RouteCatalog } from "elm-ssr/http";
import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";
import { withCache, redisCache, postgresSql } from "elm-ssr/backends";
import { withTasks, withQueueProducer, createQueueConsumer } from "elm-ssr/tasks";
import { runMigrations, revertMigrations, listMigrations } from "elm-ssr/migrations";
import { composeMiddleware } from "elm-ssr/middleware";
```

See the [top-level README](../../README.md) for end-to-end usage and the
authoring guide.

## License

MIT.
