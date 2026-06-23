# cli (AI)

**Binary:** `elm-ssr` (after `bun add elm-ssr`). Entry:
[`packages/elm-ssr/bin/elm-ssr.mjs`](../../packages/elm-ssr/bin/elm-ssr.mjs).

## Commands

```sh
bunx elm-ssr build                              # scan Routes/+Islands/, generate Main.elm + manifest, run elm make
bunx elm-ssr compress                           # same as build + gzip generated bundles
bunx elm-ssr dev                                # build + wrangler dev (Cloudflare-oriented convenience)
bunx elm-ssr new <name> [--in <subdir>]         # scaffold app at <workspace>/<name>/ (or <workspace>/<subdir>/<name>/)
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

## `elm-ssr new`

```sh
bunx elm-ssr new my-app                # → <workspace>/my-app/, namespace MyApp
bunx elm-ssr new billing --in apps     # → <workspace>/apps/billing/, namespace Billing
```

Generates:
- `<root>/elm.json`
- `<root>/runtime.ts` (createWorkerApp wiring; `../generated/<root>/...` import paths computed by directory depth)
- `<root>/worker.ts` (re-exports `worker`)
- `<root>/styles.ts`
- `<root>/src/<Namespace>/Routes/{Index,Counter,NotFound}.elm`
- `<root>/src/<Namespace>/Islands/Counter.elm`
- `<root>/src/<Namespace>/View/Shared.elm`

And appends a `{ name, root, module }` entry to `elm-ssr.config.json`.

Name validation: `^[a-z0-9-]+$` (lowercase letters, digits, dashes). PascalCase'd for the Elm namespace.

## `elm-ssr build`

For each configured app:
1. Scans `<root>/src/<Module>/Routes/` and `Islands/`.
2. Generates `<root>/.elm-ssr/Main.elm` (the router) + `<root>/.elm-ssr/islands.manifest.json`.
3. Syncs `packages/elm-ssr/elm-src/ElmSsr/*.elm` → `<root>/.elm-ssr/src/ElmSsr/`.
4. Runs `elm make` → `generated/<root>/app.mjs` + `generated/<root>/islands.mjs`.

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
