# islands (AI)

**Elm modules:** `ElmSsr.Island`, `ElmSsr.Island.Shared`, `ElmSsr.Island.Sse`.
**Build:** CLI scans `src/<Namespace>/Islands/*.elm` and emits a combined
client bundle plus an islands manifest.

Islands are **stock `Browser.element` programs**. Use `elm/html`, `elm/svg`,
`elm/http`, `Html.Keyed`, etc. — anything Elm supports in the browser. The
server emits `<elm-ssr-island>` markers with encoded flags; the client
runtime mounts the island into a child of each marker.

## `ElmSsr.Island`

```elm
type alias Config flags pageMsg =
    { encodeFlags : flags -> Json.Encode.Value
    , fallback : flags -> List (ElmSsr.Html.Node pageMsg)  -- SSR-only placeholder
    , id : Maybe String                                     -- persistent across SPA nav if Just
    }

embed : String -> Config flags pageMsg -> flags -> ElmSsr.Html.Node pageMsg
-- name MUST match the bundle key (the island module's basename).
```

## `ElmSsr.Island.Shared` (cross-island bus)

```elm
type alias GlobalEvent = { tag : String, payload : Json.Encode.Value }

broadcast : String -> Json.Encode.Value -> Cmd msg
listen : (GlobalEvent -> msg) -> Sub msg
-- Implementation: window CustomEvent("elm-ssr-broadcast"). A broadcaster
-- also receives its own broadcast — filter by tag in update.
```

## `ElmSsr.Island.Sse` (Server-Sent Events subscription)

```elm
type alias Event = { url : String, data : String }
type Error = DecodeError String | NetworkError String

open : String -> Cmd msg              -- idempotent
close : String -> Cmd msg             -- idempotent
events : (Event -> msg) -> Sub msg
errors : ({ url : String, message : String } -> msg) -> Sub msg
match : String -> Decoder a -> Event -> Maybe (Result Error a)
-- match returns Nothing if event.url != target; otherwise decodes data.
```

## Minimal example: standard island

```elm
module Demo.Islands.Counter exposing (embed, main)

import Browser
import ElmSsr.Island as Island
import ElmSsr.Html as SsrHtml
import Html exposing (Html, button, div, span, text)
import Html.Events exposing (onClick)
import Json.Encode as Encode


embed : { start : Int } -> SsrHtml.Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = \f -> Encode.object [ ( "start", Encode.int f.start ) ]
        , fallback = \_ -> []
        , id = Nothing  -- non-persistent; Just "..." to survive SPA nav
        }


type alias Model = { count : Int }
type Msg = Inc | Dec


main : Program { start : Int } Model Msg
main =
    Browser.element
        { init = \flags -> ( { count = flags.start }, Cmd.none )
        , update = \msg m ->
            case msg of
                Inc -> ( { m | count = m.count + 1 }, Cmd.none )
                Dec -> ( { m | count = m.count - 1 }, Cmd.none )
        , view = \m -> div [] [ button [ onClick Dec ] [ text "-" ], span [] [ text (String.fromInt m.count) ], button [ onClick Inc ] [ text "+" ] ]
        , subscriptions = \_ -> Sub.none
        }
```

Page embedding:
```elm
import Demo.Islands.Counter as Counter

view = Page.page { title = "...", head = [], body = [ Counter.embed { start = 0 } ] }
```

## Minimal example: cross-island bus

```elm
-- Sender:
update msg model = ( { model | selected = id }, Shared.broadcast "coin-selected" (Encode.string id) )

-- Receiver:
subscriptions _ = Shared.listen GotGlobalEvent

update msg model =
    case msg of
        GotGlobalEvent event ->
            if event.tag == "coin-selected" then
                case Decode.decodeValue Decode.string event.payload of
                    Ok id -> handleSelect id model
                    Err _ -> ( model, Cmd.none )
            else ( model, Cmd.none )
```

## Minimal example: SSE

```elm
init _ = ( initial, Sse.open "/__elm-ssr/live" )

subscriptions _ = Sub.batch [ Sse.events GotEvent, Sse.errors GotError ]

update msg model =
    case msg of
        GotEvent event ->
            case Sse.match "/__elm-ssr/live" tickDecoder event of
                Just (Ok tick) -> ( { model | tick = tick }, Cmd.none )
                _ -> ( model, Cmd.none )

        GotError _ -> ( model, Cmd.none )  -- EventSource auto-reconnects
```

## Patterns

- Persistent island across SPA nav: `id = Just "stable-id"`. The client
  runtime transfers the live marker (preserving Elm runtime state) when
  another page embeds the same id.
- Fallback shown until bundle mounts: use `ElmSsr.Html` (server-side AST)
  inside the `fallback` function; switches to `elm/html` once mounted.
- Cross-island state: prefer `Island.Shared` bus over a global store.
  Each island filters by `tag` in its `update`.
- SSE multiple streams: open multiple URLs; filter by `event.url` in
  `update` using `Sse.match`.

## Footguns

- **Islands use `elm/html`, NOT `ElmSsr.Html`.** Only the `fallback` uses
  the SSR AST (because it's part of the page tree, not the live island).
- `Island.embed "Counter"` name MUST match the bundle key — typically the
  module basename. Mismatch → unknown-island error at boot.
- Non-persistent islands LEAK timer/port subscriptions across SPA nav
  (Elm has no program teardown). Persistent islands keep their subs alive;
  prefer `id = Just "..."` for islands with long-running subscriptions.
- `Sse.events` fires for EVERY open SSE stream. Filter with `Sse.match`.
- Cross-island bus echoes the sender's own broadcast — filter by tag.
- `Browser.element` replaces the mount node. The client runtime mounts
  into a child `<div>` to keep `<elm-ssr-island>` alive as the persistent
  unit. Don't try to interact with the marker innards directly.
