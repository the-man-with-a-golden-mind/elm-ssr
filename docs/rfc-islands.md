# Islands: current decision

This document describes the architecture that is implemented in this repo now.

## Decision

An island is a standard Elm `Browser.element`.

That is the whole point of the pivot. We explicitly do not keep a custom island
virtual DOM, custom keyed reconciliation, or a custom event bridge for island
updates.

## Why this direction

The previous island runtime gave tighter control over DOM patching, but it came
with the wrong product tradeoff for a library:
- island authors had to target a custom API
- compatibility with the Elm package ecosystem was limited
- `Html.Keyed` needed our own implementation
- every new event or DOM feature had to be reimplemented by us

Using `Browser.element` flips the tradeoff:
- authors write normal Elm
- islands work with `elm/html`, `Html.Keyed`, `elm/http`, `elm/time`, `elm/svg`
- Elm's own runtime owns DOM updates
- our runtime only needs to find markers, decode flags, and call `init`

## What remains custom

Routes are still SSR pages built on the library's own document tree:
- page modules return `Loader (Document Never)`
- page HTML is serialized by the Worker runtime
- island markers are emitted by `ElmSsr.Island.embed`

So this is not transparent SSR for arbitrary `elm/html` pages.

The split is intentional:
- SSR page shell: custom library layer
- client island runtime: stock Elm browser runtime

## What was removed

This pivot makes several earlier pieces obsolete:
- custom island patcher
- custom island event bridge
- generated union-program for island `Model`/`Msg`
- `ElmSsr.Effect`
- `ElmSsr.Html.Keyed`
- browser-side island message codec plumbing

The tests now target real mounted `Browser.element` islands instead of a fake
DOM patch runtime.

## Rendering model

### Server

1. A route loader resolves on the server.
2. The page renders `Document Never`.
3. A page may embed one or more islands with `ElmSsr.Island.embed`.
4. `embed` outputs an `elm-ssr-island` element with:
   - `data-elmssr-island`
   - `data-elmssr-props`
   - optional inert fallback HTML
5. If at least one marker is present, the serializer includes
   `/__elm-ssr/islands.js`.

### Browser

1. The loader script scans for `[data-elmssr-island]`.
2. It resolves the island entry from the generated manifest.
3. It dynamically imports that island bundle.
4. It resolves `Elm.<Module>.init`.
5. It mounts the island with `init({ node, flags })`.

Each island root gets its own Elm instance.

## State and isolation

There are two separate state domains:

- SSR state is request-scoped.
  Every request boots a fresh Elm route runtime on the server.
- Island state is browser-scoped.
  Every mounted island has its own Elm model in that page instance.

This avoids cross-user leakage by construction. One user typing into an island
does not mutate anyone else's island state because there is no shared global
client model on the server.

If you want shared backend state, the island should talk to an API or reload
through the server. The backend remains the source of truth.

## Authoring shape

### Page

```elm
module App.Routes.Counter exposing (page)

import App.Islands.Counter as Counter
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed
        (Page.page
            { title = "Counter"
            , head = []
            , body = [ Counter.embed { start = 3 } ]
            }
        )
```

### Island

```elm
module App.Islands.Counter exposing (embed, main)

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

## Consequences

### Gains

- Normal Elm inside islands.
- Native `Html.Keyed`.
- Far better package compatibility.
- Much smaller browser runtime surface owned by this library.

### Costs

- No fake claim of transparent SSR hydration for arbitrary `elm/html`.
- The page shell and island tree are not one shared Elm program.
- Island fallback HTML is just server-rendered preview content; the browser mount
  owns the real live subtree afterwards.

## Test implications

The important tests for this model are:
- SSR pages render without JS when they have no islands
- pages with island markers load the island bootstrap
- Browser.element islands mount correctly
- per-root island state stays isolated
- `Html.Keyed` behavior works through Elm's runtime

That is exactly what the current suite covers.
