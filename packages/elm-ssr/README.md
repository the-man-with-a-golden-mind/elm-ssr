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

Run the CLI using `bunx elm-ssr <command>`.

### `build`
Generates `.elm-ssr/Main.elm` (router) and the islands manifest for all configured apps, syncs the Elm authoring modules into `.elm-ssr/src/ElmSsr/`, and compiles pages and island bundles.

### `compress`
Runs the `build` pipeline and additionally pre-compresses generated JS/CSS assets with Gzip for faster delivery on edge networks.

### `dev`
Starts the local development loop. Compiles the Elm code and runs `wrangler dev` (monitoring `.elm` and `.css` files for hot-reloads).

### `init <name> [--db] [--auth betterAuth|auth0]`
Initialises a self-contained, single-app project in the current directory.
- `--db`: Configures local SQLite database support (generates initial migration and configures `inMemoryEffects`).
- `--auth <betterAuth|auth0>`: Scaffolds basic route modules (`Login.elm`, `Profile.elm`), signed cookie/CSRF middleware, and callback intercepts. (Automatically implies `--db`).

### `new <name> [--in <subdir>] [--db] [--auth betterAuth|auth0]`
Creates a new app under `<workspace>/<name>/` (or `<workspace>/<subdir>/<name>/` if `--in <subdir>` is provided) and registers it in `elm-ssr.config.json`.
- `--in <subdir>`: Target subdirectory group (e.g. `--in apps` places it under `apps/<name>/`).
- `--db`: Configures SQLite database support and an initial migration.
- `--auth <betterAuth|auth0>`: Scaffolds authentication views, cookies, and callback handlers.

### `route <path> [--app <name>] [--api] [--ws] [--sse] [--resource]`
Scaffolds a new route or endpoint (uses `ElmSsr.Form` for modern full-stack examples):
- `--app <app-name>`: Required if multiple apps are configured in the workspace.
- `--api`: Scaffolds a JSON API page/action route instead of an HTML page.
- `--ws` or `--websocket`: Scaffolds a TypeScript WebSocket handler in `src/Endpoints/<route>.ts`.
- `--sse`: Scaffolds a TypeScript Server-Sent Events (SSE) stream handler in `src/Endpoints/<route>.ts`.
- `--resource`: Generates a richer CRUD-style example with `Form` validation + Elmto hints.

### `query [--app <name>] [--dir <path>] [--output <path>]`
Generates type-safe Elm database schema and query helpers directly from raw SQL files in the migrations directory.
- `--app <app-name>`: Required if multiple apps exist.
- `--dir <path>`: Directory containing migrations (default: `<app_root>/migrations`).
- `--output <path>`: Directory where Elm Db modules will be generated (default: `<app_root>/src/<Module>/Db`).

### `migrate <up|down|status> [--db <conn>] [--dir <path>] [--count <n>] [--table <name>]`
SQL migration runner.
- `up`: Applies all pending migrations.
- `down`: Reverts the last migration (or `n` migrations via `--count`).
- `status`: Lists all applied and pending migrations.
- `--db <conn>`: Database connection string (Postgres URL, SQLite URL, or plain file path). Reads `DATABASE_URL` if omitted.
- `--dir <path>`: Path to the SQL migrations directory (default: `./migrations`).
- `--count <n>`: The number of migrations to revert when running `down` (default: 1).
- `--table <name>`: Tracking database table name (default: `__elm_ssr_migrations`).

### `routes`
Prints a list of all configured apps, their root directories, and their route source directories.

### `info`
Prints the workspace name and registered app names.

## Global options
- `--root <path>`: Overrides where the CLI looks for `elm-ssr.config.json` (defaults to current directory).

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
