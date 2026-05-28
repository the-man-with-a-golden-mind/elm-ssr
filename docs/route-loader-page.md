# File-based routes, loaders, and pages

This is the current route authoring model.

## Mental model

A route is always a server-rendered page:

```elm
page : Request -> Loader (Document Never)
```

That means:
- the route runs on the server
- it loads data through `Loader`
- it returns static HTML for that request
- it cannot attach live event handlers directly because the result is `Document Never`

If a page needs interactivity, it embeds an island. The island is not another
SSR route mode. It is a separate Elm `Browser.element` mounted inside the page.

## File-based routing

Modules under `src/<App>/Routes/` become URLs:

- `Index.elm` -> `/`
- `Status.elm` -> `/status`
- `Counter.elm` -> `/counter`
- `Posts/Index.elm` -> `/posts`
- `Greet/Name_.elm` -> `/greet/:name`
- `NotFound.elm` -> fallback

Rules:
- `Index.elm` maps to its parent path
- folders nest
- a trailing `_` marks a dynamic segment
- literal segments win over dynamic segments at the same position

The build scans routes at build time and generates `.elm-ssr/Main.elm`. Nothing
is scanned at request time inside the Worker.

## Writing a page

Minimal page:

```elm
module Demo.Routes.Index exposing (page)

import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed
        (Page.page
            { title = "Home"
            , head = []
            , body = []
            }
        )
```

## Loading data

Use `Loader` to describe server-side data requirements:

```elm
module Demo.Routes.Status exposing (page)

import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import Json.Decode as Decode

type alias Status =
    { uptime : String }

page : Request -> Loader (Document Never)
page _ =
    Loader.fetchJson
        { url = "https://api.example.com/status"
        , decoder = Decode.map Status (Decode.field "uptime" Decode.string)
        }
        |> Loader.map view

view : Status -> Document Never
view status =
    Page.page
        { title = "Status"
        , head = []
        , body = [ ElmSsr.Html.text status.uptime ]
        }
```

Useful primitives:
- `Loader.succeed`
- `Loader.map`
- `Loader.map2`
- `Loader.andThen`
- `Loader.fail`
- `Loader.fetchJson`

The Worker executes the effects. Elm only describes them.

## Dynamic segments

Read dynamic segments from the request:

```elm
module Demo.Routes.Greet.Name_ exposing (page)

import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)

page : Request -> Loader (Document Never)
page request =
    Loader.succeed
        (Page.page
            { title = "Hello"
            , head = []
            , body =
                [ ElmSsr.Html.text
                    (Route.param "name" request |> Maybe.withDefault "stranger")
                ]
            }
        )
```

## Interactivity through islands

A page stays static and embeds an island marker:

```elm
module Demo.Routes.Counter exposing (page)

import Demo.Islands.Counter as Counter
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed
        (Page.page
            { title = "Counter"
            , head = []
            , body = [ Counter.embed { start = 0 } ]
            }
        )
```

The island itself is a normal Elm browser program:

```elm
module Demo.Islands.Counter exposing (embed, main)

import Browser
import ElmSsr.Island as Island
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)
import Json.Encode as Encode

type alias Flags =
    { start : Int }

type alias Model =
    { count : Int }

type Msg
    = Increment

embed =
    Island.embed "Counter"
        { encodeFlags = \flags -> Encode.object [ ( "start", Encode.int flags.start ) ]
        , fallback = \flags -> []
        }

main : Program Flags Model Msg
main =
    Browser.element
        { init = \flags -> ( { count = flags.start }, Cmd.none )
        , update = \msg model -> ( { model | count = model.count + 1 }, Cmd.none )
        , subscriptions = \_ -> Sub.none
        , view = \model -> div [] [ button [ onClick Increment ] [ text "+" ], text (String.fromInt model.count) ]
        }
```

The build compiles islands separately and writes a manifest the browser loader
uses to mount them.

## Runtime boundaries

- A page render is request-scoped.
- A mounted island is browser-scoped.
- A page without island markers ships no browser runtime.
- Backend state should flow through loaders, APIs, actions, or realtime push.
- Island local state should not be treated as shared backend state.

## Example app

The working example is in:
- [Routes](/Users/michalmajchrzak/Projects/elmssr/examples/basic/src/Example/Basic/Routes)
- [Islands](/Users/michalmajchrzak/Projects/elmssr/examples/basic/src/Example/Basic/Islands)
- [runtime.ts](/Users/michalmajchrzak/Projects/elmssr/examples/basic/runtime.ts)

## Next steps

The current foundation is:
- file-based SSR routes
- server loaders
- Browser.element islands
- Worker middleware and REST endpoints

The next layer is server actions and richer backend bindings.
