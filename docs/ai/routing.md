# routing (AI)

**Module:** `ElmSsr.Route`. **Build step:** CLI scans `src/<Namespace>/Routes/`
and generates `Main.elm` with the router.

## File → URL mapping

| File | URL |
|---|---|
| `Routes/Index.elm` | `/` |
| `Routes/Foo.elm` | `/foo` |
| `Routes/Foo/Bar.elm` | `/foo/bar` |
| `Routes/Foo/Slug_.elm` | `/foo/:slug` (trailing `_` = dynamic) |
| `Routes/NotFound.elm` | fallback |

## Every route module exposes

```elm
page : Request -> Loader (Document Never)
action : Request -> Action (Document Never)
```

- `page` handles GET/HEAD. Most return `Loader.succeed view` (static) or chain effects.
- `action` handles POST (and other non-GET). Routes that don't accept POST return `Action.fail 405 "Method not allowed"`.

## `ElmSsr.Route` exports

```elm
type alias Request =
    { method : String
    , path : String
    , query : List ( String, String )
    , params : List ( String, String )       -- dynamic segments
    , formData : List ( String, String )     -- only set on POST
    }

segments : Request -> List String           -- path split, non-empty
method : Request -> String                  -- uppercased
query : String -> Request -> Maybe String   -- ?name=value
param : String -> Request -> Maybe String   -- dynamic segment
params : Request -> List ( String, String ) -- all dynamic segments
formValue : String -> Request -> Maybe String
decoder : Decoder Request                   -- usually not called by authors
```

## Minimal example

```elm
module Demo.Routes.Posts.Slug_ exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)


page : Request -> Loader (Document Never)
page request =
    case Route.param "slug" request of
        Just slug -> Loader.map view (loadPost slug)
        Nothing -> Loader.fail 400 "Missing slug"


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"
```

## Patterns

- Static page → `Loader.succeed view`. Ships no client JS.
- NotFound → use `Page.notFound` (sets 404 status), not `Page.page`.
- Multiple URL segments via dynamic: `Routes/Org/OrgSlug_/Repo/RepoSlug_.elm` → `/org/:orgSlug/repo/:repoSlug`.
- `Route.formValue` returns the field as-is. For typed validation, decode + `Maybe.andThen`.

## Footguns

- Dynamic segment is a **trailing** underscore on the module file: `Slug_.elm`, NOT `_Slug.elm`.
- `action` must exist even if route is GET-only — return `Action.fail 405`. Build fails if missing.
- `params` is empty for static routes; `Route.param` returns `Nothing` then.
- Adding a new route requires re-running `bun elm-ssr build` (or `bun run dev` which builds).
