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

### `elm-ssr new <name>`

```sh
elm-ssr new my-app
```

Scaffolds a new app under `<workspace>/<name>/` and registers it in
`elm-ssr.config.json`. Use `--in apps` to create
`<workspace>/apps/<name>/`. Generates `Routes/Index.elm`,
`Routes/Counter.elm`, `Routes/NotFound.elm`, `Islands/Counter.elm`,
`View/Shared.elm`, plus the TypeScript `runtime.ts`, `worker.ts`,
`styles.ts`, and `elm.json`.

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
