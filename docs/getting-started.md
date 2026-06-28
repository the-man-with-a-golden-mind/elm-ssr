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

## Scaffold a new project

The quickest way to start a new project is `init` — it creates the directory for you:

```sh
bunx elm-ssr init my-app
cd my-app
bun install
bun run build
bun run dev
```

`init` creates `./my-app/`, writes `elm-ssr.config.json` (with `root: "."`), and generates the package, TypeScript entrypoints, and initial Elm routes inside it. No need to `mkdir` first.

If you are building a multi-app workspace, you can scaffold new apps using the `new` command:

```sh
bunx elm-ssr new my-app
```

Use `--in apps` to group under a subdirectory: `bunx elm-ssr new my-app --in apps`.

### Options (On-Demand DB and Auth)
For both `init` and `new`, you can specify:
- `--db` to configure local SQLite database support and a `migrations/` folder.
- `--auth betterAuth|auth0` to configure session and CSRF middleware, authed routes (`Login.elm`, `Profile.elm`), and handler callbacks (automatically enables `--db` too).

The scaffold contains:
- `elm.json` — Elm package manifest
- `runtime.ts` — wires the Fetch handler (`createWorkerApp`)
- `worker.ts` — entry point (`export default worker`)
- `styles.ts` — inlined stylesheet
- `src/<Namespace>/Routes/Index.elm`, `Counter.elm`, `NotFound.elm`
- `src/<Namespace>/Islands/Counter.elm`
- `src/<Namespace>/View/Shared.elm`

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
