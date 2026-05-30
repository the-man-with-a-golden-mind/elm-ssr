# Getting started

elm-ssr is one package: `elm-ssr`. It ships the CLI, the Worker runtime, the
Elm authoring modules, and the SQL migration runner. Use it on Cloudflare
Workers in production or on Bun locally for dev.

## Install

```sh
bun add elm-ssr
```

Make sure Bun ≥ 1.3 (`engines.bun` in the package).

## Scaffold a new app

In a fresh workspace, create `elm-ssr.config.json`:

```jsonc
{
  "apps": []
}
```

Then:

```sh
bun elm-ssr new my-app
```

This creates `examples/my-app/` (or whatever you name it) with:
- `elm.json` — Elm package manifest
- `runtime.ts` — wires the Worker (`createWorkerApp`)
- `worker.ts` — entry point (`export default worker`)
- `styles.ts` — inlined stylesheet
- `src/<Namespace>/Routes/Index.elm`, `Counter.elm`, `NotFound.elm`
- `src/<Namespace>/Islands/Counter.elm`
- `src/<Namespace>/View/Shared.elm`

It also adds the app to `elm-ssr.config.json`.

## Build

```sh
bun elm-ssr build
```

For each configured app the CLI:
1. Scans `src/<Namespace>/Routes/` and `src/<Namespace>/Islands/`.
2. Generates `<app-root>/.elm-ssr/Main.elm` (the router, with file-based
   routes + dynamic segments).
3. Syncs the Elm authoring modules (`ElmSsr/*.elm`) into
   `<app-root>/.elm-ssr/src/ElmSsr/`.
4. Runs `elm make` to compile the page program and one combined island bundle
   (`Elm.<App>.Islands.<Name>` per island).

Outputs land in `generated/<app-name>/` (gitignored).

## Run locally

```sh
bun elm-ssr dev
```

That runs `build` then `wrangler dev`. The same Worker handler is used both on
Bun (via wrangler) and on Cloudflare in production.

## Project layout

```
elm-ssr.config.json              # Lists your apps
package.json                     # Workspaces, scripts
examples/
  my-app/
    elm.json
    runtime.ts                   # createWorkerApp(...)
    worker.ts                    # export default worker
    src/MyApp/
      Routes/
        Index.elm
      Islands/
        Counter.elm
      View/
        Shared.elm
    migrations/                  # Optional: SQL files for `elm-ssr migrate`
generated/                       # Build output (gitignored)
```

## What next

- [Routing](routing.md) — adding pages with file-based routes.
- [Loaders and Actions](loaders-and-actions.md) — fetching data and handling
  form submissions.
- [Islands](islands.md) — adding interactive bits to otherwise-static pages.
