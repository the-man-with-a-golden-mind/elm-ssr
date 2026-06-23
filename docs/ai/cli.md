# cli (AI)

**Binary:** `elm-ssr` (after `bun add elm-ssr`). Entry:
[`packages/elm-ssr/bin/elm-ssr.mjs`](../../packages/elm-ssr/bin/elm-ssr.mjs).

## Commands

```sh
bunx elm-ssr build                              # scan Routes/+Islands/, generate Main.elm + manifest, run elm make
bunx elm-ssr compress                           # same as build + gzip generated bundles
bunx elm-ssr init <name> [--db] [--auth betterAuth|auth0] # scaffold single-app project in cwd
bunx elm-ssr new <name> [--in <subdir>] [--db] [--auth betterAuth|auth0] # scaffold app under workspace
bunx elm-ssr route <path> [opts]                # scaffold Elm page/API route, or TS WS/SSE endpoint
bunx elm-ssr query [opts]                       # generate type-safe Elm Db modules from SQL migrations
bunx elm-ssr routes                             # list configured apps + their public modules
bunx elm-ssr info                               # workspace package name + configured app names
bunx elm-ssr migrate <up|down|status> [opts]    # see migrations.md
bunx elm-ssr help                               # default
```

## Global flag

`--root <path>` — workspace root (default cwd). Used for testing/CI: `elm-ssr new x --root /tmp/scratch`.

## Configuration: `elm-ssr.config.json` at workspace root

```jsonc
{
  "apps": [
    { "name": "basic", "root": "examples/basic", "module": "Example.Basic" },
    { "name": "my-app", "root": "apps/my-app", "module": "MyApp" }
  ]
}
```

- `name` → short id used in `generated/<name>/`.
- `root` → app directory (relative to workspace root).
- `module` → root Elm namespace. `My.App` expects `src/My/App/Routes/`, `src/My/App/Islands/`, etc.

## `elm-ssr init` and `elm-ssr new`

```sh
bunx elm-ssr init my-app [--db] [--auth betterAuth|auth0]
bunx elm-ssr new my-app [--in <subdir>] [--db] [--auth betterAuth|auth0]
```

Scaffolds a new project (`init` in current working directory with `root: "."`) or app (`new` under `<workspace>/<name>/` or with subdirectory via `--in`).

Generates standard structure:
- `<root>/elm.json`
- `<root>/runtime.ts` (createWorkerApp wiring; import paths computed relative to depth)
- `<root>/worker.ts` (re-exports `worker`)
- `<root>/styles.ts`
- `<root>/src/<Namespace>/Routes/{Index,Counter,NotFound}.elm`
- `<root>/src/<Namespace>/Islands/Counter.elm`
- `<root>/src/<Namespace>/View/Shared.elm`

If `--db` is specified (or enabled automatically via `--auth`):
- `<root>/migrations/0001_init.sql` (initial users schema)
- SQLite support via `bun:sqlite` and `inMemoryEffects` registered in `runtime.ts`

If `--auth <betterAuth|auth0>` is specified:
- `<root>/src/<Namespace>/Routes/{Login,Profile}.elm` (authenticated views)
- `<root>/src/Endpoints/Auth.ts` (mock auth callback endpoint interceptor)
- Session / CSRF middleware configured in `runtime.ts`

Appends entry to `elm-ssr.config.json`.
Name validation: `^[a-z0-9-]+$` (lowercase letters, digits, dashes). PascalCase'd for the Elm namespace.

## `elm-ssr build`

For each configured app:
1. Scans `<root>/src/<Module>/Routes/` and `Islands/`.
2. Generates `<root>/.elm-ssr/Main.elm` (the router) + `<root>/.elm-ssr/islands.manifest.json`.
3. Syncs `packages/elm-ssr/elm-src/ElmSsr/*.elm` → `<root>/.elm-ssr/src/ElmSsr/`.
4. Runs `elm make` → `generated/<root>/app.mjs` + `generated/<root>/islands.mjs`.

## `elm-ssr route`

```sh
bunx elm-ssr route blog/post                  # standard Elm page route
bunx elm-ssr route api/users --api            # Elm JSON API route
bunx elm-ssr route chat --ws                  # TS WebSocket endpoint
bunx elm-ssr route feed --sse                 # TS Server-Sent Events stream
```

- **Arguments**:
  - `path`: Relative route path (e.g. `blog/post_` for dynamic segments).
- **Flags**:
  - `--app <app-name>`: Scaffolds in a specific app (required if multiple configured apps exist).
  - `--api`: Generates an Elm route module returning a JSON payload from the action.
  - `--ws` / `--websocket`: Generates a TypeScript WebSocket handler in `src/Endpoints/<path>.ts`.
  - `--sse`: Generates a TypeScript Server-Sent Events stream handler in `src/Endpoints/<path>.ts`.

## `elm-ssr query`

```sh
bunx elm-ssr query                            # run in default app
bunx elm-ssr query --app my-app               # run in specific app
bunx elm-ssr query --dir ./custom-migrations  # override migrations dir
bunx elm-ssr query --output ./src/Db          # override generated modules output path
```

- **Behavior**: Scans the migrations folder (defaults to `<app_root>/migrations`) for `.sql` files (excluding `.down.sql`). Parses `CREATE TABLE` structures to automatically generate matching type-safe Elm Db modules exposing Elm records, decoders, and CRUD helper loaders/actions (e.g., `byId`, `insert`, `update`, `delete`, `all`).

## Patterns

- **Watch + rebuild during dev**: use `bunx elm-ssr dev` for Cloudflare-like local dev. For other hosts, re-run `bunx elm-ssr build` in a watcher and start your own server/entrypoint.
- **Multi-app workspace**: each `apps[]` entry builds independently; manifest paths are namespaced.
- **CI**: `bunx elm-ssr build` + `bun test`. `--root` for scratch dirs.

## Footguns

- **Command must come BEFORE flags**: `elm-ssr new my-app --root /tmp` works; `elm-ssr --root /tmp new my-app` prints help (`--root` taken as the command).
- New routes/islands require a fresh build — they're not hot-detected without `elm-ssr dev`.
- The build SYNCS the `ElmSsr.*` modules from the installed package into `.elm-ssr/src/`. Don't edit `.elm-ssr/src/ElmSsr/*` — changes lost next build.
- Scaffold writes the workspace config — multiple parallel `new` calls would race. Run sequentially.
- The CLI uses `process.cwd()` unless `--root` is passed. Run from the workspace root.
