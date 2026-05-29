module Example.Basic.Routes.Chart exposing (action, page)

-- File-based routing: GET /chart. A fully static page whose chart is inline SVG
-- produced by ElmSsr.Svg and serialized on the server — no client JavaScript.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, h1, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import ElmSsr.Svg as Svg exposing (Svg)
import ElmSsr.Svg.Attributes as SvgAttr
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Shared.pageDocument "SVG Chart"
        [ section [ class "panel" ]
            [ span [ class "eyebrow" ] [ text "Server-rendered SVG" ]
            , h1 [] [ text "Inline SVG, rendered on the edge" ]
            , p [] [ text "This chart is built with ElmSsr.Svg and serialized server-side. It ships zero client JavaScript." ]
            , sparkline
            ]
        ]


sparkline : Svg msg
sparkline =
    Svg.svg
        [ SvgAttr.viewBox "0 0 200 100"
        , SvgAttr.width "200"
        , SvgAttr.height "100"
        , SvgAttr.class "sparkline"
        ]
        [ Svg.defs []
            [ Svg.linearGradient
                [ SvgAttr.id "fill"
                , SvgAttr.x1 "0"
                , SvgAttr.y1 "0"
                , SvgAttr.x2 "0"
                , SvgAttr.y2 "1"
                ]
                [ Svg.stop [ SvgAttr.offset "0%", SvgAttr.stopColor "#6366f1" ] []
                , Svg.stop [ SvgAttr.offset "100%", SvgAttr.stopColor "#0ea5e9" ] []
                ]
            ]
        , Svg.rect
            [ SvgAttr.x "0"
            , SvgAttr.y "0"
            , SvgAttr.width "200"
            , SvgAttr.height "100"
            , SvgAttr.rx "8"
            , SvgAttr.fill "url(#fill)"
            ]
            []
        , Svg.polyline
            [ SvgAttr.points "0,80 40,60 80,70 120,30 160,45 200,10"
            , SvgAttr.fill "none"
            , SvgAttr.stroke "#ffffff"
            , SvgAttr.strokeWidth "3"
            , SvgAttr.strokeLinecap "round"
            , SvgAttr.strokeLinejoin "round"
            ]
            []
        , Svg.g [ SvgAttr.transform "translate(0,0)" ]
            [ Svg.circle [ SvgAttr.cx "120", SvgAttr.cy "30", SvgAttr.r "4", SvgAttr.fill "#ffffff" ] [] ]
        , Svg.text_
            [ SvgAttr.x "8"
            , SvgAttr.y "20"
            , SvgAttr.fontSize "12"
            , SvgAttr.textAnchor "start"
            , SvgAttr.fill "#ffffff"
            ]
            [ Svg.text "7-day trend & momentum" ]
        ]
