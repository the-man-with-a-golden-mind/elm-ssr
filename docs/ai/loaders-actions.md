# loaders-actions (AI)

**Modules:** `ElmSsr.Loader`, `ElmSsr.Action`.

## Loader

```elm
type Loader a  -- opaque free monad

-- Constructors
succeed : a -> Loader a
fail : Int -> String -> Loader a    -- HTTP status + message

-- Composition (SEQUENTIAL — no built-in parallel; see Loader.custom)
map : (a -> b) -> Loader a -> Loader b
map2 : (a -> b -> c) -> Loader a -> Loader b -> Loader c
andThen : (a -> Loader b) -> Loader a -> Loader b

-- Effects: see effects-vocabulary.md for the full table
fetchJson : { url : String, decoder : Decoder a } -> Loader a
cacheGet  : { key : String, decoder : Decoder a } -> Loader (Maybe a)
cachePut  : { key : String, value : Value, ttlSeconds : Maybe Int } -> Loader ()
query     : { sql : String, params : List Value, decoder : Decoder a } -> Loader (List a)
queryOne  : { sql : String, params : List Value, decoder : Decoder a } -> Loader (Maybe a)
execute   : { sql : String, params : List Value } -> Loader { rowsAffected : Int }
env       : String -> Loader (Maybe String)
getCookie : String -> Loader (Maybe String)
enqueue   : { task : String, payload : Value } -> Loader ()

-- Sessions (require sessionMiddleware + sessionEffects)
session     : Decoder a -> Loader (Maybe a)
csrfToken   : Loader (Maybe String)
setSession  : Value -> Loader ()
clearSession : Loader ()

-- Background jobs (require withJobs)
type alias JobId = String
type JobStatus a = JobQueued | JobRunning { progress : Maybe Value } | JobDone a | JobFailed { reason : String } | JobMissing
startJob  : { kind : String, payload : Value } -> Loader JobId
jobStatus : { jobId : JobId, decoder : Decoder a } -> Loader (JobStatus a)

-- Escape hatch — emit any kind your TS adapter handles
custom : { kind : String, payload : Value, decoder : Decoder a } -> Loader a
```

## Action

```elm
type Action a

succeed  : a -> Action a
fail     : Int -> String -> Action a
redirect : String -> Action a           -- 303 PRG
json     : Value -> Action a            -- JSON response

map    : (a -> b) -> Action a -> Action b
andThen : (a -> Action b) -> Action a -> Action b

-- Lift any Loader into an Action — reuses every effect from above
fromLoader : Loader a -> Action a

-- Cookies (attach Set-Cookie to the response)
type alias Cookie = { name : String, value : String, maxAge : Maybe Int, expires : Maybe String, domain : Maybe String, path : Maybe String, secure : Bool, httpOnly : Bool, sameSite : Maybe SameSite }
type SameSite = Lax | Strict | None

defaultCookie : String -> String -> Cookie                     -- permissive: path=/, nothing else
sessionCookie : String -> String -> Cookie                     -- HARDENED: Secure, HttpOnly, SameSite=Lax, Max-Age=7d

setCookie : Cookie -> Action a -> Action a                     -- composable; call multiple times
clearCookie : { name, path : Maybe String, domain : Maybe String } -> Action a -> Action a
```

## Minimal example: form (PRG with effect)

```elm
action : Request -> Action (Document Never)
action request =
    case Route.formValue "email" request of
        Nothing ->
            Action.fail 422 "Email required"

        Just email ->
            Action.fromLoader
                (Loader.execute
                    { sql = "INSERT INTO subs (email) VALUES (?)"
                    , params = [ Encode.string email ]
                    })
                |> Action.andThen (\_ -> Action.redirect "/thanks")
```

## Patterns

- Pure description, no IO: `Loader.succeed`, `Action.succeed`.
- Sequential dependent fetches: chain with `andThen`.
- Concurrent independent SQL: `Loader.custom` + Promise.all in adapter (see `parallel-queries` recipe).
- PRG form: `Action.fromLoader (...) |> Action.andThen (\_ -> Action.redirect "/...")`.
- Set cookie on response: `Action.redirect "/x" |> Action.setCookie (sessionCookie "session" sid)`.
- Login then setSession: `Action.fromLoader (Loader.setSession (encodeUser u)) |> Action.andThen (\_ -> Action.redirect "/dashboard")`.

## Failure semantics

- `Loader.fail status msg` / `Action.fail status msg` → response with that status, message in body.
- Effect handler returns `{ ok: false, error }` → 502 with the error message.
- Decode error on `fetchJson`/`cacheGet`/`query` → 502 with decode trace.
- Cookie attach: even on `Action.fail`, the cookies still go out (propagated through `map`/`andThen`/`fromLoader`).

## Footguns

- `Loader.map2 a b` is SEQUENTIAL — `a` awaits before `b`. For parallel use `Loader.custom` + Promise.all on TS side.
- `setSession` is a Loader, not an Action — lift with `Action.fromLoader`.
- `Action.fail` still attaches cookies set via `Action.setCookie` (semantically right: failure response is still a response).
- Without `sessionMiddleware` + `sessionEffects`, the session/csrfToken/setSession/clearSession effects return `requires sessionMiddleware to be installed`.
- Loaders for pages with `Document Never` cannot be reused as Action because Action operates over its own type; use `Action.fromLoader` to lift.
