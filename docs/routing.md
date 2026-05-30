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
