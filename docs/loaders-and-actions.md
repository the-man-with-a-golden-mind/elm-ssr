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
