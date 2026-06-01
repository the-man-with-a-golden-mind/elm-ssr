# sessions (AI)

**Subpath:** `elm-ssr/sessions`. **Middleware** + **effect adapter**.
**Elm effects:** `session`, `csrfToken`, `setSession`, `clearSession`.

## Exports

```ts
// Stores
interface SessionRecord { data: unknown; csrf: string; expiresAt?: number; }
interface SessionStore { get(id): Promise<SessionRecord | null>; set(id, r): Promise<void>; delete(id): Promise<void>; }

memorySessionStore(initial?: Map<string, SessionRecord>): SessionStore;
cacheStore(backend: CacheBackend, options?: { keyPrefix?: string; defaultTtlSeconds?: number }): SessionStore;

// Middleware
interface SessionMiddlewareOptions {
  secret: string;                                 // HMAC-SHA256; do not leak
  store: SessionStore;
  cookieName?: string;                            // default "session"
  maxAgeSeconds?: number;                         // default 7 days
  cookiePath?: string;                            // default "/"
  cookieDomain?: string;
  secure?: boolean;                               // default true; flip false for plain-HTTP dev
  sameSite?: "lax" | "strict" | "none";           // default "lax"
}
sessionMiddleware(options: SessionMiddlewareOptions): Middleware;

interface CsrfMiddlewareOptions { headerName?: string; fieldName?: string; skipPaths?: string[]; }
csrfMiddleware(options?: CsrfMiddlewareOptions): Middleware;

// Effect adapter — REQUIRED for the Elm session/csrf/setSession/clearSession effects to work.
sessionEffects(runner: EffectRunner): EffectRunner;

// Crypto helpers (used internally; exposed for ad-hoc sign/verify)
signValue(secret, value): Promise<string>;
verifyValue(secret, signed): Promise<string | null>;
generateSessionId(): string;       // crypto.randomUUID()
generateCsrfToken(): string;       // 32 random bytes, base64url
```

## RequestSession (lives on AppContext + EffectContext as `session?`)

```ts
interface RequestSession {
  id: string;
  data: unknown;
  csrf: string;
  dirty: boolean;        // set by sessionEffects on setSession
  destroyed: boolean;    // set by sessionEffects on clearSession
  isNew: boolean;        // true when freshly minted
}
```

## Easiest wiring — `createWorkerApp` opts

```ts
const worker = createWorkerApp({
  // ... usual options
  sessions: { secret: env.SESSION_SECRET, store: cacheStore(redisCache(redis)) },
  csrf: true,  // or CsrfMiddlewareOptions
});
// This installs sessionMiddleware + csrfMiddleware in the right order
// AND auto-wraps your effect runner with sessionEffects(...).
```

## Manual wiring (if you compose your own stack)

```ts
const handler = composeMiddleware(routeHandler, [
  errorMiddleware,
  requestIdMiddleware,
  sessionMiddleware({ secret, store }),
  csrfMiddleware(),
  loggingMiddleware(),
  headMiddleware,
]);
// ...and wrap the effect runner with sessionEffects(runner).
```

## Minimal Elm example: login → setSession → redirect

```elm
import Json.Encode as Encode
import ElmSsr.Action as Action
import ElmSsr.Loader as Loader


action request =
    case Route.formValue "username" request of
        Just username ->
            Action.fromLoader (Loader.setSession (Encode.object [ ( "username", Encode.string username ) ]))
                |> Action.andThen (\_ -> Action.redirect "/dashboard")

        Nothing ->
            Action.fail 422 "Username required"


-- Read the session on the next page:
page _ =
    Loader.map2 view
        (Loader.session userDecoder)
        Loader.csrfToken
```

## CSRF check

`csrfMiddleware` enforces token match on unsafe verbs (POST/PUT/PATCH/DELETE):

1. Reads `X-CSRF-Token` header (configurable via `headerName`), OR
2. Reads `_csrf` form field (configurable via `fieldName`).

Compares to `context.session.csrf`. 403 on mismatch (JSON shape for `/api/*` paths, plain text otherwise).

`skipPaths` prefixes bypass (use for webhook receivers).

## Patterns

- Embed CSRF in every form: `input [ Attr.type_ "hidden", Attr.name "_csrf", Attr.value token ]` where `token` comes from `Loader.csrfToken`.
- For JSON `fetch` from islands: `headers: { "x-csrf-token": csrf }` — pass the token down as island flags.
- Session destroy on logout: `Action.fromLoader Loader.clearSession |> Action.andThen (\_ -> Action.redirect "/")`.
- Sliding session: just `Loader.setSession` on every page write — middleware rolls the cookie + extends TTL.

## Footguns

- `cacheStore` uses `backend.put(..., null, 1)` for `delete()` (tombstone with 1s TTL) — fine for short-lived sessions, but a `CacheBackend` with a real `delete()` would be better. Custom store recommended for stricter semantics.
- `secure: true` (default) → cookie REJECTED by browsers on `http://localhost`. Set `secure: false` in dev or test the example workers with `secure: false`.
- `csrf: true` requires `sessions:` to also be set; otherwise CSRF middleware fails closed with 500 ("requires sessionMiddleware to be installed first").
- The session effects (`session`/`csrfToken`/`setSession`/`clearSession`) require `sessionEffects(runner)` — `createWorkerApp` does this for you when `sessions:` is set, but if you build a custom worker, wrap manually.
- `Loader.session` returns `Maybe a` — `Nothing` means no data set yet (fresh session), NOT an error.
- `setSession`/`clearSession` are Loaders; lift with `Action.fromLoader` inside an Action.
