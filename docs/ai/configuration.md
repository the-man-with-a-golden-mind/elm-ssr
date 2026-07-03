# configuration (AI)

**Feature:** Configuration files, environment variables context resolution, and Elm flag mappings.

## Environment Files

| File | Location | Loaded By | Purpose |
|---|---|---|---|
| `.env` | Workspace Root | Bun / Node | Read by test runner, custom local servers |
| `.dev.vars` | App Root | `elm-ssr dev` (Bun) AND Cloudflare Wrangler | Secret bindings; `elm-ssr dev` parses+loads this itself now (values already in the shell env win), same as `wrangler dev` always did |

*Scaffold presets: `GREETING`, `SESSION_SECRET`.*

---

## `DATABASE_URL` (local SQLite target for `--db`/`--auth` apps)

`runtime.ts`'s `sqlHandler` and `Auth.ts`'s BetterAuth `bunAuthDb` resolve it
identically — one env var, one file, both connections opened with
`PRAGMA journal_mode = WAL` so they can coexist:

```ts
const rawDbUrl = process.env.DATABASE_URL || "";
if (rawDbUrl && !rawDbUrl.startsWith("sqlite://") && /^[a-z][a-z0-9+.-]*:\/\//i.test(rawDbUrl)) {
  throw new Error(/* not a local sqlite target */);
}
const dbPath = rawDbUrl.startsWith("sqlite://") ? rawDbUrl.slice(9) : rawDbUrl || (import.meta.dir + "/app.db");
```

Local Bun dev only ever opens sqlite directly — a `postgres://`/`mysql://`/etc
value throws immediately at startup (module load, uncaught — crashes `elm-ssr
dev` on purpose) instead of being handed to `bun:sqlite` as a bogus filename.
Postgres is real for `elm-ssr migrate --db postgres://...` / `elm-ssr query`
and for hand-written production effects wiring — not for this local handler.

---

## TS Context Resolution

### app.ts
Maps request context `env` argument to `AppContext.env`:
```ts
env: (env ?? (typeof process !== "undefined" ? process.env : undefined))
```

### request-handler.ts / http.ts
Passes `env` to the flags factory context (`RenderFlagsContext`):
```ts
export interface RenderFlagsContext {
  request: Request;
  url: URL;
  path: string;
  formData?: Record<string, string>;
  env?: Record<string, unknown>;
}
```

### runtime.ts (scaffolded)
Filters `env` properties to string/number/boolean (excludes KV/D1 database bindings) and forwards to Elm flags:
```ts
export const createFlags = ({ env, ... }) => {
  const envVars = {};
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        envVars[k] = v;
      }
    }
  }
  return { env: envVars, ... };
};
```

---

## Dynamic Session Secrets

`secret` in `sessionMiddleware` supports type `string | ((env: any) => string)` to resolve secret dynamically at request time:
```ts
sessions: {
  secret: (env) => env?.SESSION_SECRET || "default-secret",
  secure: false
}
```

---

## Elm Vocabulary

### Loader / Action effect
```elm
Loader.env : String -> Loader (Maybe String)
```
- Resolved via `inMemoryEffects` (`process.env` fallback) or `cloudflareEffects` (`context.env`).

---

## Footguns

- Cloudflare KV/D1 binding objects cannot be JSON-serialized into flags. Filters must exclude non-primitive bindings in `createFlags`.
- `process.env` is not available at Cloudflare Workers edge; must resolve dynamically from `env` argument via request context.
- Escape backslash `\` when writing Elm code inside JS template literals (e.g. use `\\maybeGreeting ->`).
