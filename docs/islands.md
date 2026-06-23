# Islands

An island is a normal `Browser.element` Elm program that mounts client-side
into an SSR-rendered page. It uses **stock** `elm/html`, `elm/svg`, `elm/http`,
`Html.Keyed`, etc. — there is no custom virtual-DOM patcher, no fake
hydration. The server emits a marker element with encoded flags + optional
fallback markup; the browser runtime finds the marker and runs the island's
`main`.

This keeps islands fully compatible with the broader Elm package ecosystem.

## Authoring an island

Islands live under `src/<App>/Islands/`. The build picks them up
automatically. Each module should expose `embed` (called from pages) plus
`main` (mounted client-side):

```elm
module Demo.Islands.Counter exposing (embed, main)

import Browser
import ElmSsr.Island as Island
import ElmSsr.Html as SsrHtml
import ElmSsr.Html.Attributes as SsrAttributes
import Html exposing (Html, button, div, span, text)
import Html.Attributes exposing (class)
import Html.Events exposing (onClick)
import Json.Encode as Encode


-- SSR-side: page calls `Counter.embed { start = 0 }`.
embed : Flags -> Island.Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = \f -> Encode.object [ ( "start", Encode.int f.start ) ]
        , fallback = \f -> [ SsrHtml.text (String.fromInt f.start) ]
        , id = Nothing
        }


-- Client-side: stock Browser.element with stock elm/html.
type alias Flags =
    { start : Int }


type alias Model =
    { count : Int }


type Msg
    = Increment
    | Decrement


main : Program Flags Model Msg
main =
    Browser.element
        { init = \flags -> ( { count = flags.start }, Cmd.none )
        , update = update
        , view = view
        , subscriptions = \_ -> Sub.none
        }


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment -> ( { model | count = model.count + 1 }, Cmd.none )
        Decrement -> ( { model | count = model.count - 1 }, Cmd.none )


view : Model -> Html Msg
view model =
    div [ class "counter" ]
        [ button [ onClick Decrement ] [ text "-" ]
        , span [] [ text (String.fromInt model.count) ]
        , button [ onClick Increment ] [ text "+" ]
        ]
```

A page embeds the island the same way it would render anything else:

```elm
import Demo.Islands.Counter as Counter

view : Document Never
view =
    Page.page
        { title = "Counter"
        , head = []
        , body = [ Counter.embed { start = 0 } ]
        }
```

There is **no `Generated.Islands` re-export.** Authors import island modules
directly. Codegen is reserved for things the author never touches
(`Main.elm`, the islands client program, the manifest).

## `Island.embed` and `Config`

```elm
type alias Config flags pageMsg =
    { encodeFlags : flags -> Encode.Value
    , fallback : flags -> List (Node pageMsg)
    , id : Maybe String
    }

embed : String -> Config flags pageMsg -> flags -> Node pageMsg
```

- `name` must match the generated bundle key (the module's basename, e.g.
  `"Counter"` for `Islands/Counter.elm`).
- `encodeFlags` serializes the island's flags into the SSR markup; the client
  runtime decodes them and feeds them to `init`.
- `fallback` is SSR-only markup shown before the client bundle mounts — show
  initial server-rendered state, a spinner, or nothing.
- `id` lets the island **persist across SPA navigation** (see below).

## Pages use `ElmSsr.Html`, islands use `elm/html`

This is the load-bearing convention in this repo:

- A **page** returns `Document Never` and is serialised on the server to
  HTML. It uses `ElmSsr.Html` because server and edge runtimes normally have no
  DOM, and `elm/html`'s virtual-DOM kernel can't run server-side.
- An **island** is a normal browser Elm program. Its `view : Model -> Html Msg`
  uses `Html exposing (...)` from `elm/html`. `ElmSsr.Html` only shows up
  inside the island module for the `fallback` markup (which is part of the
  page tree, not the island's runtime).

Don't "fix" an island view to use `ElmSsr.Html` — that's the pre-pivot
architecture that was deleted.

## Cross-island state

Islands are isolated from each other. To communicate, use
`ElmSsr.Island.Shared`, which provides a `window` CustomEvent bus.

```elm
import ElmSsr.Island.Shared as Shared


-- Send to all other islands:
update msg model =
    ( newModel, Shared.broadcast "cart:add" (encodeItem item) )


-- Listen for broadcasts. A broadcaster also hears its own broadcast —
-- filter by tag in update:
subscriptions _ =
    Shared.listen GotGlobalEvent


update msg model =
    case msg of
        GotGlobalEvent { tag, payload } ->
            if tag == "cart:add" then ... else (model, Cmd.none)
```

`GlobalEvent` is `{ tag : String, payload : Value }`.

## Persistence across SPA navigation

When a user clicks an in-app link, the client runtime fetches the new page
via `/api/render`, swaps `#elm-ssr-root` innerHTML, re-boots islands, and
syncs the `<head>`. By default, every island re-initializes from its new
flags.

To **keep an island alive** across navigation, give it an `id`:

```elm
Island.embed "MiniCart"
    { encodeFlags = encodeFlags
    , fallback = ...
    , id = Just "mini-cart"     -- ← persist
    }
```

The runtime transfers the live marker (with its full subtree and Elm runtime
state) into the new page if a marker with the same `id` is present.
Non-persistent islands are torn down — their `window` broadcast listeners are
removed, but Elm has no program teardown, so subscriptions to timers/ports
continue running until the page reloads. Keep that in mind for long-lived
non-persistent islands.

## What next

- [Routing](routing.md) — where the page that embeds the island lives.
- [examples/crypto-dashboard/](../examples/crypto-dashboard/) — islands using
  `elm/svg`, `elm/http`, `Html.Keyed`, 15s `Time.every` refresh, and the
  cross-island bus.

## Source

- [packages/elm-ssr/elm-src/ElmSsr/Island.elm](../packages/elm-ssr/elm-src/ElmSsr/Island.elm)
- [packages/elm-ssr/elm-src/ElmSsr/Island/Shared.elm](../packages/elm-ssr/elm-src/ElmSsr/Island/Shared.elm)
- [packages/elm-ssr/src/client-runtime/islands.ts](../packages/elm-ssr/src/client-runtime/islands.ts)
