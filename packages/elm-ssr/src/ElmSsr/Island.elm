module ElmSsr.Island exposing
    ( Config
    , embed
    )

{-| Embed a standard `Browser.element` island into an SSR page.

An island is mounted client-side by plain Elm, not by a custom DOM patcher. The
server emits a marker element with encoded flags plus optional fallback markup.
The browser runtime later finds that marker and runs the island's own
`main : Program flags model msg`.

This keeps authoring compatible with normal `elm/html`, `Html.Keyed`, `elm/http`
and the broader Elm ecosystem.


# Embedding

@docs Config, embed

-}

import ElmSsr.Html as Html exposing (Node)
import Json.Encode as Encode


{-| SSR-side config for embedding an island. -}
type alias Config flags pageMsg =
    { encodeFlags : flags -> Encode.Value
    , fallback : flags -> List (Node pageMsg)
    }


{-| Render the island marker into a page.

The `name` must match the generated browser bundle key for the island module.
`fallback` is optional SSR-only markup shown before the client bundle mounts.
-}
embed : String -> Config flags pageMsg -> flags -> Node pageMsg
embed name config flags =
    Html.element "elm-ssr-island"
        [ Html.Property "data-elmssr-island" name
        , Html.Property "data-elmssr-props" (Encode.encode 0 (config.encodeFlags flags))
        ]
        (config.fallback flags)
