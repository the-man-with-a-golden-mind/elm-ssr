# Loaders and Actions

`Loader` and `Action` are **descriptions of work**, not side effects. The
author composes them; the runtime pumps the actual IO through the Worker's
effect adapter and feeds the results back until each one terminates.

This keeps Elm pure end-to-end — no manual ports, no flag-shaped JSON
threading, no `Cmd` for server work.

## Loader (data fetching, for `page`)

A `Loader a` resolves to a value of type `a` after the runtime has executed
any effects it requested. The page can then render based on that value.

### Constructors

```elm
-- pure success
Loader.succeed : a -> Loader a

-- abort with an HTTP status and message
Loader.fail : Int -> String -> Loader a
```

### Composition

```elm
Loader.map     : (a -> b) -> Loader a -> Loader b
Loader.map2    : (a -> b -> c) -> Loader a -> Loader b -> Loader c
Loader.andThen : (a -> Loader b) -> Loader a -> Loader b
```

Loaders are sequential. `andThen` runs the next effect only after the prior
one resolves.

### Effects

See [Effects](effects.md) for the full vocabulary. Quick reference:

```elm
Loader.fetchJson : { url : String, decoder : Decoder a } -> Loader a
Loader.cacheGet  : { key : String, decoder : Decoder a } -> Loader (Maybe a)
Loader.cachePut  : { key : String, value : Value, ttlSeconds : Maybe Int } -> Loader ()
Loader.query     : { sql : String, params : List Value, decoder : Decoder a } -> Loader (List a)
Loader.queryOne  : { sql : String, params : List Value, decoder : Decoder a } -> Loader (Maybe a)
Loader.execute   : { sql : String, params : List Value } -> Loader { rowsAffected : Int }
Loader.env       : String -> Loader (Maybe String)
Loader.enqueue   : { task : String, payload : Value } -> Loader ()
```

`getCookie` is also available via `Loader` — see [Effects](effects.md).

### Example: cache → fetch → cache

```elm
cachedStatus : Loader Status
cachedStatus =
    Loader.cacheGet { key = "status", decoder = statusDecoder }
        |> Loader.andThen
            (\cached ->
                case cached of
                    Just status ->
                        Loader.succeed status

                    Nothing ->
                        Loader.fetchJson
                            { url = "https://api.example.com/status"
                            , decoder = statusDecoder
                            }
                            |> Loader.andThen
                                (\status ->
                                    Loader.cachePut
                                        { key = "status"
                                        , value = encodeStatus status
                                        , ttlSeconds = Just 60
                                        }
                                        |> Loader.map (\_ -> status)
                                )
            )
```

## Action (form handling, for `action`)

`Action a` is the non-GET equivalent. It can resolve to a value, fail, redirect
(303-style Post/Redirect/Get), or respond with JSON.

### Constructors

```elm
Action.succeed  : a -> Action a
Action.fail     : Int -> String -> Action a
Action.redirect : String -> Action a
Action.json     : Value -> Action a
```

### Cookies

Any `Action` can attach `Set-Cookie` headers to its response — including
redirects, JSON responses, and even failures. Cookies travel through
`map`/`andThen`/`fromLoader` so you can compose freely.

```elm
Action.Cookie : { name : String, value : String, maxAge : Maybe Int, expires : Maybe String, domain : Maybe String, path : Maybe String, secure : Bool, httpOnly : Bool, sameSite : Maybe SameSite }

Action.SameSite = Lax | Strict | None

-- Build a cookie:
Action.defaultCookie : String -> String -> Cookie    -- permissive (Path=/), fill in what you need
Action.sessionCookie : String -> String -> Cookie    -- HARDENED: Secure, HttpOnly, SameSite=Lax, Max-Age=7d

-- Attach to an action:
Action.setCookie   : Cookie -> Action a -> Action a
Action.clearCookie : { name : String, path : Maybe String, domain : Maybe String } -> Action a -> Action a
```

**Security defaults matter.** `Action.sessionCookie` is what you should reach
for any time a cookie grants authority (session IDs, auth tokens). It sets:

- `HttpOnly` — JavaScript cannot read it (XSS-resistant).
- `Secure` — only sent over HTTPS.
- `SameSite=Lax` — sent on top-level navigations, blocked on cross-site
  sub-requests (CSRF-resistant for unsafe verbs).
- `Path=/`, `Max-Age=7 days`.

`Action.defaultCookie` is the unopinionated escape hatch for non-sensitive
cookies (preferences, analytics consent, etc).

### Example: login (PRG + hardened session cookie)

```elm
action : Request -> Action (Document Never)
action request =
    case Route.formValue "username" request of
        Just username ->
            Action.fromLoader (mintSessionToken username)
                |> Action.andThen
                    (\token ->
                        Action.redirect "/dashboard"
                            |> Action.setCookie (Action.sessionCookie "session" token)
                    )

        Nothing ->
            Action.fail 422 "Username is required"
```

### Example: logout

```elm
action _ =
    Action.redirect "/login"
        |> Action.clearCookie { name = "session", path = Just "/", domain = Nothing }
```

### Reading cookies back

From the matching `page` (or any `Loader`), use `Loader.getCookie`:

```elm
page _ =
    Loader.getCookie "session"
        |> Loader.andThen
            (\session ->
                case session of
                    Just token ->
                        Loader.map renderDashboard (lookupUser token)

                    Nothing ->
                        Loader.succeed renderLoginPrompt
            )
```

### Stacking multiple cookies

`setCookie` is composable — call it more than once to attach multiple
cookies to the same response:

```elm
Action.redirect "/onboarding/step-2"
    |> Action.setCookie (Action.sessionCookie "session" token)
    |> Action.setCookie ({ defaultCookie "onboarding" "step-2" | sameSite = Just Lax })
```

### Local dev gotcha

`Secure` cookies are rejected by modern browsers on plain `http://`. If
you're hitting your app on `http://localhost`, either run it over HTTPS
(wrangler dev does, by default) or override `secure = False` on the cookie.
See [examples/basic/src/Example/Basic/Routes/Session.elm](../examples/basic/src/Example/Basic/Routes/Session.elm)
for the pattern.

### Composition

```elm
Action.map     : (a -> b) -> Action a -> Action b
Action.andThen : (a -> Action b) -> Action a -> Action b

-- Lift any Loader (and all its effects: cacheGet, query, execute, env, ...)
-- into an Action so it runs as part of the action's effect chain.
Action.fromLoader : Loader a -> Action a
```

`fromLoader` is how actions do server work — there's no separate "action
effect" type; the entire `Loader` effect vocabulary is reusable.

### Example: a guestbook POST (PRG pattern)

```elm
action : Request -> Action (Document Never)
action request =
    case Route.formValue "message" request of
        Nothing ->
            Action.fail 422 "Message is required."

        Just message ->
            if String.isEmpty (String.trim message) then
                Action.fail 422 "Message is required."

            else
                Action.fromLoader
                    (Loader.execute
                        { sql = "INSERT INTO entries (message) VALUES (?)"
                        , params = [ Encode.string message ]
                        }
                    )
                    |> Action.andThen (\_ -> Action.redirect "/guestbook")
```

The client `POST /guestbook`s with the form, the row is inserted, the action
redirects with `303 See Other` to `/guestbook`, the browser issues a `GET`, the
page re-renders with the new entry. No JS required.

## Failures

Both `Loader.fail` and `Action.fail` take an HTTP status. The runtime turns
them into the matching response (with the message). Decode failures during
`fetchJson`/`cacheGet`/`query` map to `502` automatically.

## What next

- [Effects](effects.md) — the full effect surface and what each kind does.
- [Backends](backends.md) — choosing/composing the adapter that runs effects.
