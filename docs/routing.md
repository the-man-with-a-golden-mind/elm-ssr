# Routing

Routing is file-based, Next/Remix-style. The CLI scans
`src/<Namespace>/Routes/` and generates a router that dispatches by URL path
and HTTP method.

## File layout → URL

| File | URL |
| ---- | --- |
| `Routes/Index.elm` | `/` |
| `Routes/About.elm` | `/about` |
| `Routes/Posts/Index.elm` | `/posts` |
| `Routes/Posts/Slug_.elm` | `/posts/:slug` (dynamic) |
| `Routes/Greet/Name_.elm` | `/greet/:name` |
| `Routes/NotFound.elm` | fallback for everything else |

Trailing-underscore names are **dynamic segments**, captured into
`Request.params` and read with `Route.param "slug"`.

## Every route exposes `page` and `action`

```elm
module Demo.Routes.About exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (p, text)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "About"
        , head = []
        , body = [ p [] [ text "About this app" ] ]
        }
```

- `page` handles `GET` and `HEAD`. Returns a `Loader (Document Never)`.
- `action` handles `POST` (and other non-GET). Returns an
  `Action (Document Never)`. Most pages reject non-GET with `Action.fail 405`.

See [Loaders and Actions](loaders-and-actions.md) for the data-fetching side.

## Reading the request

```elm
import ElmSsr.Route as Route exposing (Request)


page : Request -> Loader (Document Never)
page request =
    case Route.param "slug" request of
        Just slug ->
            -- dynamic segment captured from the filename
            loadPost slug

        Nothing ->
            Loader.fail 400 "Missing slug"
```

`ElmSsr.Route` exports:
- `method : Request -> String` — uppercased HTTP method.
- `segments : Request -> List String` — path split into non-empty parts.
- `query : String -> Request -> Maybe String` — query-string parameter.
- `param : String -> Request -> Maybe String` — dynamic route segment.
- `params : Request -> List ( String, String )` — all dynamic segments.
- `formValue : String -> Request -> Maybe String` — form field, for actions.
- `env : String -> Request -> Maybe String` — environment variable / binding, synchronous (see below).

## Reading environment variables

`Route.env` reads a variable from the runtime environment **synchronously** —
no effect round-trip, no `Cmd`. Use it for configuration constants (feature
flags, dialect strings, API base URLs) that are fixed for the lifetime of the
process.

```elm
import ElmSsr.Route as Route exposing (Request)


type Dialect = PostgreSQL | SQLite


page : Request -> Loader (Document Never)
page request =
    let
        dialect =
            case Route.env "DB_DIALECT" request of
                Just "postgres" -> PostgreSQL
                _               -> SQLite
    in
    Loader.map (view dialect) (Repo.all dialect userQuery)
```

For **per-request** secrets or values that may change between requests (e.g. a
KV-stored flag), use `Loader.env` instead, which emits an effect and costs one
runtime round-trip.

## Reading form and JSON body data

`Route.formValue` reads fields from:
- `application/x-www-form-urlencoded` form submissions.
- `multipart/form-data` form submissions.
- The **top-level keys of a flat JSON body** — the runtime pre-parses the JSON
  and exposes each string-valued field the same way as a form field.

The "flat JSON as form fields" behaviour means islands can post JSON and API
actions can use `Route.formValue` without any special handling:

```elm
-- Island (sends JSON with string-encoded integers):
Http.post
    { url = "/api/trello/move"
    , body =
        Http.jsonBody <|
            Encode.object
                [ ( "cardId", Encode.string (String.fromInt cardId) )
                , ( "columnId", Encode.string (String.fromInt newColId) )
                ]
    , expect = Http.expectWhatever MoveCardResponse
    }

-- Action (reads them with Route.formValue):
action request =
    case ( Route.formValue "cardId" request, Route.formValue "columnId" request ) of
        ( Just cardIdStr, Just colIdStr ) ->
            case ( String.toInt cardIdStr, String.toInt colIdStr ) of
                ( Just cardId, Just colId ) ->
                    -- proceed
                _ ->
                    Action.fail 400 "ids must be integers"
        _ ->
            Action.fail 400 "Missing cardId or columnId"
```

> **Integer and boolean values** in the JSON body must be encoded as strings
> before posting. The runtime decodes JSON values as strings; non-string JSON
> values (numbers, booleans) are silently dropped. This is a deliberate
> simplification that keeps the Elm request model uniform across content types.
> Use form-urlencoded for richer type handling, or use `Loader.custom` with a
> TS adapter that parses the raw body itself.

## NotFound

`Routes/NotFound.elm` is the fallback. Use `Page.notFound` (which sets the
right status) instead of `Page.page`:

```elm
view : Document Never
view =
    Page.notFound
        { title = "Not found"
        , head = []
        , body = [ p [] [ text "This route does not exist." ] ]
        }
```

If you don't ship a `NotFound.elm`, unknown routes get a plain text 404 from
the runtime.

## Tips

- Keep route modules small. Move shared markup into `View/Shared.elm`.
- For a static (no-data) page, `Loader.succeed view` is enough — no effects
  are pumped.
- For interactive bits inside a page, embed an island. The page itself stays
  SSR-only; only the island ships JS. See [Islands](islands.md).
- For JSON API endpoints called by islands, put routes under `Routes/Api/` and
  return `Action.json`. See [API Routes](api-routes.md).
- For custom TypeScript endpoints (WebSockets, streaming), scaffold with
  `elm-ssr route name --ws` or `--sse` — the CLI generates a handler under
  `src/Endpoints/`. Wire it in `runtime.ts` before the main `worker.fetch`.
- The client runtime intercepts same-origin link clicks and form submissions
  on pages that have islands — no full reload. See [SPA Navigation](spa-navigation.md).
