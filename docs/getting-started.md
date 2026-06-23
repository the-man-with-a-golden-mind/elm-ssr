# Getting started

elm-ssr is one package: `elm-ssr`. It ships the CLI, a Fetch-compatible SSR
runtime, the Elm authoring modules, and the SQL migration runner. Use it in any
runtime that can call a standard `Request -> Response` handler; Cloudflare
Workers is one supported target, not a requirement.

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
bunx elm-ssr new my-app
```

This creates `my-app/` under the current workspace. To put it under a subdir,
use `bunx elm-ssr new my-app --in apps`.

The scaffold contains:
- `elm.json` — Elm package manifest
- `runtime.ts` — wires the Fetch handler (`createWorkerApp`)
- `worker.ts` — entry point (`export default worker`)
- `styles.ts` — inlined stylesheet
- `src/<Namespace>/Routes/Index.elm`, `Counter.elm`, `NotFound.elm`
- `src/<Namespace>/Islands/Counter.elm`
- `src/<Namespace>/View/Shared.elm`

It also adds the app to `elm-ssr.config.json`.

## Build

```sh
bunx elm-ssr build
```

For each configured app the CLI:
1. Scans `src/<Namespace>/Routes/` and `src/<Namespace>/Islands/`.
2. Generates `<app-root>/.elm-ssr/Main.elm` (the router, with file-based
   routes + dynamic segments).
3. Syncs the Elm authoring modules (`ElmSsr/*.elm`) into
   `<app-root>/.elm-ssr/src/ElmSsr/`.
4. Runs `elm make` to compile the page program and one combined island bundle
   (`Elm.<App>.Islands.<Name>` per island).

Outputs land in `generated/<app-root>/` (gitignored), matching the `root` value
from `elm-ssr.config.json`.

## Run locally

The generated `runtime.ts` exports a `worker` object with a
`fetch(request, env?, executionCtx?)` method. For a plain Bun local server:

```ts
import { worker } from "./my-app/runtime";

Bun.serve({
  port: 3000,
  fetch: (request) => worker.fetch(request, process.env)
});
```

If you specifically want a Cloudflare-like local environment, use:

```sh
bunx elm-ssr dev
```

That runs `build` then `wrangler dev`. Wrangler is only for this development
path; the package runtime itself is provider-neutral.

## Deploy

Deploy by adapting the same `worker.fetch` method to your host:

```ts
import { worker } from "./my-app/runtime";

export default {
  fetch: (request, env, ctx) => worker.fetch(request, env, ctx)
};
```

Provider-specific code should stay in `runtime.ts` or the deployment entrypoint:
choose an effect runner (`inMemoryEffects`, `cloudflareEffects`, `withCache`,
`postgresSql`, custom adapters), a session store, and an optional task/queue
adapter. The Elm routes and islands stay unchanged.

## Project layout

```
elm-ssr.config.json              # Lists your apps
package.json                     # Workspaces, scripts
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
apps/
  another-app/                  # If created with --in apps
    elm.json
    migrations/                  # Optional: SQL files for `elm-ssr migrate`
generated/                       # Build output (gitignored)
```

## What next

- [Routing](routing.md) — adding pages with file-based routes.
- [Loaders and Actions](loaders-and-actions.md) — fetching data and handling
  form submissions.
- [Islands](islands.md) — adding interactive bits to otherwise-static pages.
