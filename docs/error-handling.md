# Error Handling

How elm-ssr surfaces, formats, and recovers from errors at each layer.

## Loader failures

`Loader.fail status message` aborts a load before the page renders. The
runtime turns it into an HTTP response with the given status and an
error document body.

```elm
page : Request -> Loader (Document Never)
page request =
    case Route.param "id" request |> Maybe.andThen String.toInt of
        Nothing ->
            Loader.fail 400 "id must be an integer"

        Just id ->
            Loader.map (view id) (loadById id)
```

Common status codes:

| Status | When to use |
|---|---|
| `400` | Malformed request (bad params, missing fields) |
| `401` | Authentication required (prefer `Loader.redirect "/login"`) |
| `403` | Authenticated but not authorised |
| `404` | Resource not found (or use `Page.notFound` in a loader result) |
| `405` | Method not allowed (in the `action` of a page-only route) |
| `422` | Validation failed |
| `502` | Upstream dependency failed (set automatically on decode errors) |

### Effect failures

When an effect runner returns `{ ok: false, error: "…" }`, the loader
automatically fails with **502** and the error message. You don't catch this
explicitly — it surfaces as a 502 response to the browser.

```elm
-- This always fails if the backend is down:
Loader.fetchJson { url = "https://api.slow.com/data", decoder = dec }
-- → 502 "fetchJson received 503 from …" if the API returns non-2xx
```

To catch effect errors and fall back gracefully, use `Loader.custom` with a
TS adapter that returns `{ ok: true, value: null }` on failure.

### Decode errors

A decoder mismatch inside `Loader.queryOne`, `Loader.cacheGet`, or
`Loader.fetchJson` also produces a **502**:

```
502 Loader response did not match decoder: …
```

Fix by correcting the decoder or the data shape.

## Action failures

`Action.fail status message` works the same way: the runtime responds with
that status. For page routes the body is plain text; for `/api/` routes it is
JSON `{ "error": "message" }`.

```elm
action request =
    case Route.formValue "email" request of
        Nothing ->
            Action.fail 422 "Email is required"

        Just email ->
            Action.fromLoader (save email)
                |> Action.andThen (\_ -> Action.redirect "/thanks")
```

## Custom error pages with `Page.notFound` and `Page.document`

For user-facing 404s, return a `Page.notFound` document from the loader:

```elm
page request =
    Loader.queryOne { sql = "SELECT …", params = […], decoder = postDecoder }
        |> Loader.andThen
            (\maybePost ->
                case maybePost of
                    Just post ->
                        Loader.succeed (Page.page { title = post.title, … })

                    Nothing ->
                        Loader.succeed
                            (Page.notFound
                                { title = "Post not found"
                                , head = Shared.head
                                , body = [ p [] [ text "That post does not exist." ] ]
                                }
                            )
            )
```

`Page.notFound` sets status 404. For other statuses use `Page.document`:

```elm
Page.document
    { status = 503
    , lang   = "en"
    , head   = Shared.head
    , body   = [ p [] [ text "Back in a moment." ] ]
    }
```

`Page.error` is a runtime utility that builds a minimal error document:

```elm
Page.error 503 "Service temporarily unavailable"
-- → { status = 503, head = [title "Error 503"], body = [h1 "503", p "…"] }
```

## Route guard failures

`Loader.requireUser` and `Action.requireUser` redirect to the login path when
the session is absent:

```elm
page _ =
    Loader.requireUser profileDecoder "/login" <| \user ->
        Loader.map (view user) loadDashboard
```

**Important:** if the session *exists* but its data does not match the decoder,
`Loader.session` returns `Failed 502` — not `Nothing`. Protect against stale
session shapes by using a decoder that is tolerant of missing fields
(`Decode.maybe` for optional fields, or store a version key and clear the
session on mismatch):

```elm
-- Robust: wrap optional fields so a stale session doesn't 502
sessionDecoder =
    Decode.map2 User
        (Decode.field "username" Decode.string)
        (Decode.maybe (Decode.field "role" Decode.string)
            |> Decode.map (Maybe.withDefault "user"))
```

## Constraint violations (`softExecute`, `softQueryOne`)

`Loader.execute` crashes the request with 502 on a database constraint
violation. `Loader.softExecute` catches the violation and returns it as data
so you can attach it to a form error:

```elm
Action.fromLoader
    (Loader.softExecute
        { sql = "INSERT INTO users (email) VALUES (?)"
        , params = [ Encode.string email ]
        }
    )
    |> Action.andThen
        (\result ->
            case result of
                Ok _ ->
                    Action.redirect "/dashboard"

                Err { kind, field } ->
                    case kind of
                        "unique" ->
                            Action.redirect "/signup?err_email=already+taken"
                        _ ->
                            Action.fail 422 "Database constraint violation"
        )
```

`Repo.insert` / `Repo.update` use `softExecute` internally and return
`Err changeset` with the error already attached. See [Elmto](elmto.md).

## Uncaught exceptions

If an effect runner throws (TypeScript exception), the `errorMiddleware`
catches it and responds with:

- **Page routes:** `500 Internal Server Error` (plain text)
- **`/api/` routes:** `{ "error": "internal_error", "requestId": "…" }` (JSON)

The exception is logged with `elm_ssr_request_failed { requestId, path, error }`.

## The `NotFound` route

`Routes/NotFound.elm` is the fallback for any URL the router doesn't match.
Use `Page.notFound` to get the correct 404 status:

```elm
module Example.Routes.NotFound exposing (action, page)

page _ =
    Loader.succeed
        (Page.notFound
            { title = "404 Not Found"
            , head  = Shared.head
            , body  = [ h1 [] [ text "This page doesn't exist." ] ]
            }
        )

action _ =
    Action.fail 405 "Method not allowed"
```

Without a `NotFound.elm`, the runtime returns a plain text 404.

## Error format by route prefix

| Route prefix | 4xx/5xx body | Content-Type |
|---|---|---|
| `/api/…` | `{ "error": "…", "requestId": "…" }` | `application/json` |
| Everything else | Plain text or error HTML | `text/html` |

## See also

- [Loaders and Actions](loaders-and-actions.md) — `Loader.fail`, `Action.fail`, redirect
- [Effects](effects.md) — 502 on decode/effect failure
- [Elmto](elmto.md) — `Repo.insert` constraint handling via changesets
- [Middleware](middleware.md) — `errorMiddleware`
