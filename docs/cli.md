# CLI

The `elm-ssr` command. Install it with `bun add elm-ssr`, then run it with
`bunx elm-ssr <command>` from the workspace root.

## Commands

### `elm-ssr build`

Reads `elm-ssr.config.json`, then for each configured app:

1. Scans `src/<Namespace>/Routes/` and `Islands/`.
2. Generates `<root>/.elm-ssr/Main.elm` (the router; file-based routes +
   dynamic segments) and the islands manifest.
3. Syncs the Elm authoring modules from
   `packages/elm-ssr/elm-src/ElmSsr/*.elm` into
   `<root>/.elm-ssr/src/ElmSsr/`.
4. Runs `elm make` to compile the page program + one combined island bundle
   (`Elm.<App>.Islands.<Name>` per island).

Outputs land in `generated/<app-root>/` (gitignored), matching the configured
`root` value. For example, `root: "apps/admin"` writes under
`generated/apps/admin/`.

### `elm-ssr compress`

Same pipeline as `build`, but additionally gzips the generated bundles so the
edge can serve `Content-Encoding: gzip` directly.

### `elm-ssr dev`

```sh
elm-ssr dev
```

Runs `build` then `wrangler dev`. Use this for local Cloudflare-flavoured
development. For other providers or a plain Bun server, run `elm-ssr build`
and start your own entrypoint that calls `worker.fetch`.

### `elm-ssr init <name>`

```sh
elm-ssr init my-app [--db] [--auth betterAuth|auth0]
```

Creates a `./<name>/` directory and scaffolds a self-contained, single-app project inside it. The `elm-ssr.config.json` is written inside `<name>/` with `root: "."`, so the project is fully self-contained. Also scaffolds basic routes, a styles helper, and configurations.

Options:
- `--db`: Starts the app with SQLite configured (via `bun:sqlite`), generating an initial database schema migration `migrations/0001_init.sql` and registering `inMemoryEffects` in the TS runtime.
- `--auth <betterAuth|auth0>`: Generates authentication structures (on demand). This scaffolds signed session cookies/CSRF middleware, the route modules `Login.elm` and `Profile.elm`, and an Auth callback TS interceptor/mock under `src/Endpoints/Auth.ts`. Specifying `--auth` automatically activates the `--db` setup since query persistence is required.

### `elm-ssr new <name>`

```sh
elm-ssr new my-app [--in <subdir>] [--db] [--auth betterAuth|auth0]
```

Scaffolds a new app under `<workspace>/<name>/` (or `<workspace>/<subdir>/<name>/` if `--in <subdir>` is provided) and registers it in `elm-ssr.config.json`.

Options:
- `--in <subdir>`: Nested subdirectory (e.g. `--in apps` places the app under `<workspace>/apps/<name>/`).
- `--db`: Configures local SQLite database support and an initial migration schema `migrations/0001_init.sql`.
- `--auth <betterAuth|auth0>`: Scaffolds on-demand authentication middleware, pages (`Login.elm`, `Profile.elm`), and handler intercepts. Automatically enables database/migrations.

Name must match `^[a-z0-9-]+$` (lowercase letters, digits, dashes).

### `elm-ssr migrate <up|down|status>`

SQL-file migration runner. See [docs/migrations.md](migrations.md) for
behaviour. Quick reference:

```sh
elm-ssr migrate up                                # apply pending
elm-ssr migrate down                              # revert most recent
elm-ssr migrate down --count 3
elm-ssr migrate status                            # applied + pending

elm-ssr migrate up --db postgres://user:pass@host:5432/db
elm-ssr migrate up --db sqlite://./app.db
elm-ssr migrate up --db ./app.db                  # bare path = SQLite

elm-ssr migrate up --dir ./db/migrations          # default ./migrations
elm-ssr migrate up --table schema_history         # default __elm_ssr_migrations
```

Reads `DATABASE_URL` from the environment if `--db` is omitted.

### `elm-ssr routes`

Prints each configured app with its module + routes directory.

```sh
$ elm-ssr routes
basic: root=examples/basic module=Example.Basic routes=src/Example/Basic/Routes
```

### `elm-ssr route <path>`

Scaffolds a new route or endpoint in the selected app. Supports standard Elm page routes, Elm JSON API routes, WebSockets, or Server-Sent Events (SSE).

```sh
elm-ssr route blog/post                  # scaffolds standard Elm Page route
elm-ssr route api/users --api            # scaffolds Elm JSON API route
elm-ssr route chat --ws                  # scaffolds WebSocket TS endpoint under src/Endpoints/
elm-ssr route feed --sse                 # scaffolds Server-Sent Events TS endpoint under src/Endpoints/

elm-ssr route contact --app my-app       # specifies app in a multi-app workspace
```

- `--app <app-name>`: Specify which app to add the route to (required if there are multiple apps in the workspace).
- `--api`: Scaffolds a JSON API route with an action returning a JSON structure.
- `--ws` or `--websocket`: Scaffolds a TypeScript WebSocket handler in `src/Endpoints/<route>.ts`.
- `--sse`: Scaffolds a TypeScript Server-Sent Events (SSE) stream handler in `src/Endpoints/<route>.ts`.

### `elm-ssr query`

Generates type-safe Elm Db modules and schemas from raw SQL table definitions in your migrations directory.

```sh
elm-ssr query                            # generates Db modules from migrations
elm-ssr query --app my-app               # specifies app in a multi-app workspace
elm-ssr query --dir ./db/migrations      # overrides migrations path (default: <app_root>/migrations)
elm-ssr query --output ./src/Database    # overrides Elm output folder (default: <app_root>/src/<Module>/Db)
```

- `--app <app-name>`: Specify which app to run the query generator on (required if there are multiple apps).
- `--dir <migrations-dir>`: Overrides the directory scanned for SQL migration files.
- `--output <output-dir>`: Overrides the directory where generated Elm modules are written.

### `elm-ssr info`

Prints the workspace package name + the list of configured app names.

### `elm-ssr help`

Default when no command is given. Lists everything.

## Global flag

`--root <path>` overrides where the CLI looks for `elm-ssr.config.json` and
treats as the workspace root. Default: current working directory.

## Configuration

`elm-ssr.config.json` at the workspace root lists your apps:

```jsonc
{
  "apps": [
    { "name": "basic",           "root": "examples/basic",           "module": "Example.Basic" },
    { "name": "crypto-dashboard","root": "examples/crypto-dashboard","module": "CryptoDashboard" }
  ]
}
```

- `name` — short identifier; used in `generated/<name>/` paths.
- `root` — the app's directory (relative to the workspace root).
- `module` — the root Elm namespace (period-separated). `Example.Basic`
  expects `src/Example/Basic/Routes/`, `src/Example/Basic/Islands/`, etc.

## Source

- Entry point: [packages/elm-ssr/bin/elm-ssr.mjs](../packages/elm-ssr/bin/elm-ssr.mjs)
- Build: [packages/elm-ssr/lib/build.mjs](../packages/elm-ssr/lib/build.mjs)
- Scaffold: [packages/elm-ssr/lib/scaffold.mjs](../packages/elm-ssr/lib/scaffold.mjs)
- Migrate: [packages/elm-ssr/lib/migrate.mjs](../packages/elm-ssr/lib/migrate.mjs)
- Workspace config: [packages/elm-ssr/lib/workspace.mjs](../packages/elm-ssr/lib/workspace.mjs)
