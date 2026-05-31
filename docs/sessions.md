# Sessions and CSRF

Signed-cookie sessions backed by a pluggable store, plus CSRF protection for
form submissions. The whole stack is opt-in via two flags on
`createWorkerApp`. The Elm side picks the session up via four new effects:
`Loader.session`, `Loader.csrfToken`, `Loader.setSession`, and
`Loader.clearSession`.

## Quickstart

```ts
import { createWorkerApp } from "elm-ssr";
import { memorySessionStore, cacheStore } from "elm-ssr/sessions";
import { redisCache } from "elm-ssr/backends";

const worker = createWorkerApp({
  // ... your usual options (elmModule, routes, createFlags, effects, ...)

  // Enable signed-cookie sessions + auto-wrap your effect runner with
  // sessionEffects so Loader.session / setSession work.
  sessions: {
    secret: env.SESSION_SECRET, // 32+ random bytes; do not leak
    store: cacheStore(redisCache(myRedisClient)),
    // Defaults: cookieName "session", maxAgeSeconds 7 days,
    //           cookiePath "/", secure true, sameSite "lax", HttpOnly.
  },

  // Enable CSRF (requires sessions). `true` uses defaults; pass an object to customize.
  csrf: true
});
```

In dev / tests, swap in `memorySessionStore()` and `secure: false` so the
cookie works over plain HTTP.

## The flow

1. **Request arrives.** `sessionMiddleware` reads the configured cookie, HMAC-verifies it, looks up the record in the store. If anything's missing/tampered, it **mints a fresh session** (with a new CSRF token) so downstream code never has to nil-check.
2. **Effects run.** `sessionEffects` (auto-wired when `sessions:` is set) intercepts four Elm-facing effect kinds and reads/writes `context.session`:
   - `session` → returns `session.data` or `null`.
   - `csrfToken` → returns `session.csrf`.
   - `setSession` → mutates `session.data`, marks `dirty`.
   - `clearSession` → marks `destroyed`.
3. **Response comes back.** `sessionMiddleware`:
   - If `destroyed`: deletes the record and emits a `Max-Age=0` Set-Cookie.
   - If `dirty` or new: persists to the store and emits a fresh signed Set-Cookie.
   - Else: leaves the response alone.
4. **`csrfMiddleware` runs in between.** For POST/PUT/PATCH/DELETE it requires a token matching `context.session.csrf`. Token comes from the `X-CSRF-Token` header or a `_csrf` form field. Mismatch → 403 (JSON for `/api/*`, plain text otherwise). Safe verbs pass through untouched.

## Stores

```ts
interface SessionStore {
  get(id: string): Promise<SessionRecord | null>;
  set(id: string, record: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

interface SessionRecord {
  data: unknown;          // your app's payload (JSON-serialisable)
  csrf: string;
  expiresAt?: number;     // epoch ms
}
```

Two built-ins:

- **`memorySessionStore()`** — a `Map`-backed store. Useful for tests and dev; sessions vanish when the process restarts.
- **`cacheStore(backend, options?)`** — wraps any [`CacheBackend`](backends.md) (so `redisCache(...)`, a KV-backed wrapper, etc.). Sessions are prefixed (default `"elm-ssr:session:"`) to avoid colliding with your other cache uses, and TTLs come from each record's `expiresAt`.

For SQL-backed sessions, implement `SessionStore` against your driver — that's three async functions.

## Authoring in Elm

### Read the session

```elm
import Json.Decode as Decode
import ElmSsr.Loader as Loader exposing (Loader)


type alias User =
    { id : String, email : String }


userDecoder : Decode.Decoder User
userDecoder =
    Decode.map2 User
        (Decode.field "id" Decode.string)
        (Decode.field "email" Decode.string)


currentUser : Loader (Maybe User)
currentUser =
    Loader.session userDecoder
```

`Loader.session` returns `Nothing` when no session payload has been set yet
(fresh anonymous visitor).

### Read the CSRF token (to embed in a form)

```elm
form
    [ Attr.method "post", Attr.action "/profile" ]
    (csrfHidden token ++ [ {- inputs, button -} ])


csrfHidden : Maybe String -> List (Node msg)
csrfHidden token =
    case token of
        Just value ->
            [ input [ Attr.type_ "hidden", Attr.name "_csrf", Attr.value value ] ]

        Nothing ->
            []
```

A page that needs both the session AND the token at once:

```elm
page _ =
    Loader.map2 view
        (Loader.session userDecoder)
        Loader.csrfToken
```

### Write the session (login)

```elm
import Json.Encode as Encode
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Loader as Loader


action : Request -> Action (Document Never)
action request =
    case Route.formValue "username" request of
        Just username ->
            Action.fromLoader
                (Loader.setSession
                    (Encode.object [ ( "username", Encode.string username ) ]))
                |> Action.andThen (\_ -> Action.redirect "/dashboard")

        Nothing ->
            Action.fail 422 "Username is required"
```

`Loader.setSession` takes a `Json.Encode.Value` — that's the only constraint
on payload shape. The middleware persists and rolls the signed cookie when
the response is built.

### Destroy the session (logout)

```elm
action _ =
    Action.fromLoader Loader.clearSession
        |> Action.andThen (\_ -> Action.redirect "/")
```

The middleware deletes the record and clears the cookie.

## CSRF in detail

`csrfMiddleware` enforces CSRF tokens for unsafe HTTP methods:

| Method | Token required? |
| ------ | --------------- |
| GET, HEAD, OPTIONS | No |
| POST, PUT, PATCH, DELETE, anything else | Yes |

The token is looked up in this order:

1. The `X-CSRF-Token` request header (configurable via `headerName`).
2. The `_csrf` field of a URL-encoded or multipart form body (configurable via `fieldName`).

Either matches the current request's `context.session.csrf`. Mismatch ⇒ 403.

```ts
csrf: {
  headerName: "x-csrf-token",  // default
  fieldName: "_csrf",          // default
  skipPaths: ["/webhooks/"]    // prefixes to bypass — useful for inbound webhooks
}
```

`csrfMiddleware` reads the form body via `request.clone().formData()` so the
downstream route handler can still read it.

## Security notes

- **Secret rotation.** The HMAC secret signs every cookie. Rotating it
  invalidates all existing sessions (next request mints a new one). Treat as
  a Cloudflare secret binding, never commit.
- **Cookie attributes.** Defaults are `HttpOnly` + `Secure` + `SameSite=Lax`
  + 7-day Max-Age + `Path=/`. Override `secure: false` only when developing
  on plain HTTP (`http://localhost`).
- **CSRF tokens.** 32 bytes from `crypto.getRandomValues`, URL-safe Base64.
  Rotated on session destroy (the new session minted afterward gets a fresh
  token).
- **Constant-time signature check.** `verifyValue` uses constant-time byte
  comparison.
- **Cookie size.** The signed cookie value is just the session id + signature
  (~120 bytes). Payload lives in the store, never in the cookie — that
  avoids the 4 KB cookie limit + lets you change session data without
  re-signing on every response.

## End-to-end example

[examples/basic/src/Example/Basic/Routes/Profile.elm](../examples/basic/src/Example/Basic/Routes/Profile.elm)
is the full login/logout flow over the API above. The session-enabled worker
that runs it is exported as `createSessionExampleWorker` in
[examples/basic/runtime.ts](../examples/basic/runtime.ts).

## Source

- [packages/elm-ssr/src/sessions/](../packages/elm-ssr/src/sessions/) — `crypto.ts`, `types.ts`, `store.ts`, `middleware.ts`, `effects.ts`, `index.ts`.
- Tests: [test/sessions.test.ts](../test/sessions.test.ts), [test/profile.test.ts](../test/profile.test.ts).
