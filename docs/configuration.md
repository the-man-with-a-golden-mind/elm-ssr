# Configuration & Environment Variables

This document details how environment variables, configuration secrets, and local/production environments are structured and validated in `elm-ssr`.

---

## Local Development Files

When scaffolding a new project or app with `elm-ssr init` or `elm-ssr new`, two environment files are created automatically to align local runtime environments:

1. **`.env` (Workspace Root)**:
   - Used by local Bun or Node.js processes (e.g., local test runners, custom Bun server scripts).
   - Bun automatically loads `.env` variables into `process.env` at startup.
2. **`.dev.vars` (App Root)**:
   - Used specifically by Cloudflare Wrangler (`wrangler dev`).
   - Wrangler loads variables inside `.dev.vars` and exposes them as local worker environment bindings.

By default, the scaffold populates these files with mock values:
```env
GREETING="Hello from your local environment!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
```

`elm-ssr dev` (see [CLI](cli.md)) runs the app directly under Bun and loads
`.dev.vars` itself (values already set in the shell win), so both files are
available locally regardless of which one you edit.

---

## `DATABASE_URL` (local SQLite target)

For `--db`/`--auth` apps, `runtime.ts`'s `sqlHandler` and `Auth.ts`'s BetterAuth
database both resolve the same way, so there is exactly one local DB file per
app — never an accidental split between "what migrations ran against" and
"what the server actually opened":

```env
# Optional — default is <app-root>/app.db
DATABASE_URL=sqlite://./app.db
```

This is a **local Bun dev only** setting, and it only accepts a sqlite target
(`sqlite://<path>` or a bare path). `bun:sqlite` cannot open a `postgres://` or
other connection string, so setting `DATABASE_URL` to one is rejected
immediately at startup with an explanation, rather than being silently handed
to `bun:sqlite` as a garbage filename. Postgres (or any other backend) is real
for `elm-ssr migrate` / `elm-ssr query` and for your own production effects
wiring (see [Backends](backends.md)) — it is just not what the scaffolded
local dev DB handler speaks. `elm-ssr dev` logs the resolved DB path and
migration status on every start, and auto-applies any pending
`migrations/*.sql` against it before serving.

---

## Reading Environment Variables in Elm

There are two primary ways to access and validate environment variables on the Elm side: on-demand (via loaders/actions) or globally (via application flags).

### 1. On-Demand Validation in Loaders / Actions

Use `Loader.env : String -> Loader (Maybe String)` to retrieve environment variables during route loading. This allows you to write type-safe validation guards in Elm:

```elm
module MyNamespace.Routes.Index exposing (page)

import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Document exposing (Document)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.env "GREETING"
        |> Loader.andThen validateGreeting
        |> Loader.map view

validateGreeting : Maybe String -> Loader String
validateGreeting maybeGreeting =
    case maybeGreeting of
        Just greeting ->
            Loader.succeed greeting
            
        Nothing ->
            Loader.fail 500 "Missing required GREETING environment variable!"

view : String -> Document Never
view greeting =
    -- Render your page using the validated greeting
```

### 2. Startup Flags Validation

The TypeScript runtime automatically forwards the request's environment context to your Elm program's flags.

In the scaffolded `runtime.ts` file, the `createFlags` helper extracts environment variables (filtering out non-serializable Cloudflare KV/D1 binding objects) and passes them to Elm flags:

```typescript
export const createFlags = ({ request, path, formData, env }: { 
  request?: Request; 
  url?: URL; 
  path: string; 
  formData?: Record<string, string>;
  env?: Record<string, unknown>;
}) => {
  const [pathname, search = ""] = path.split("?");

  const envVars: Record<string, string | number | boolean> = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        envVars[key] = value;
      }
    }
  }

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: formData ?? {},
    env: envVars // Forwarded directly to Elm flags
  };
};
```

---

## Dynamic Session Secrets

For session and authorization middleware, you should avoid hardcoding secrets. The `sessionMiddleware` supports dynamic session secret resolution at request time. 

In your `runtime.ts`, define the secret as a function that resolves from the environment:

```typescript
export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags,
  sessions: {
    // Resolves secret dynamically from environment context
    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    secure: false
  },
  csrf: true
});
```

When running locally under Wrangler, Wrangler injects the `SESSION_SECRET` from `.dev.vars` into the worker's request context `env`. In production, Cloudflare injects secrets defined in the Cloudflare dashboard or via `wrangler secret put SESSION_SECRET`.
