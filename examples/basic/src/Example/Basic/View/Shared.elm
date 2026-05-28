module Example.Basic.View.Shared exposing (baseHead, featureSection, layout, pageDocument)

import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, a, article, div, h2, h3, header, main_, nav, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Page as Page


pageDocument : String -> List (Node msg) -> Document msg
pageDocument pageTitle sections =
    Page.page
        { title = pageTitle ++ " | elm-ssr"
        , head = baseHead
        , body = [ layout sections ]
        }


baseHead : List (Node msg)
baseHead =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Page.metaName "description" "Elm SSR library prototype with client-side updates."
    , Page.stylesheet "/styles.css"
    ]


layout : List (Node msg) -> Node msg
layout sections =
    div [ class "shell" ]
        [ header [ class "topbar" ]
            [ div [ class "brand" ]
                [ span [ class "brand-badge" ] [ text "elm-ssr" ]
                , h2 [ class "brand-title" ] [ text "Library Example" ]
                ]
            , nav [ class "nav" ]
                [ a [ class "nav-link", href "/" ] [ text "Home" ]
                , a [ class "nav-link", href "/status" ] [ text "Status" ]
                , a [ class "nav-link", href "/counter" ] [ text "Counter" ]
                ]
            ]
        , main_ [ class "content" ] sections
        ]


featureSection : Node msg
featureSection =
    section [ class "grid" ]
        [ article [ class "panel" ]
            [ h3 [] [ text "Page" ]
            , p [] [ text "Route + Loader + view. Stateless, no client runtime, Document Never enforces it." ]
            ]
        , article [ class "panel" ]
            [ h3 [] [ text "Loader" ]
            , p [] [ text "Describe the data a route needs. The Worker runs the IO and feeds results back, fully typed." ]
            ]
        , article [ class "panel" ]
            [ h3 [] [ text "Interactive" ]
            , p [] [ text "Opt into the MVU loop only where you need it. Events patch the server-rendered DOM in place." ]
            ]
        ]
