module Example.Basic.Routes.Index exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, a, div, h1, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Shared.pageDocument "Elm SSR Library"
        [ heroSection
        , Shared.featureSection
        ]


heroSection : Node msg
heroSection =
    section [ class "hero panel" ]
        [ span [ class "eyebrow" ] [ text "Pages, loaders, Browser.element islands" ]
        , h1 [] [ text "Write Elm once, render on the edge, update in the browser." ]
        , p []
            [ text "Stateless pages load data and render once with zero client JavaScript. Interactive UI lives in standard Browser.element islands mounted inside the page." ]
        , div [ class "hero-actions" ]
            [ a [ class "btn btn-primary", href "/counter" ] [ text "Open island demo" ]
            , a [ class "btn btn-secondary", href "/status" ] [ text "See a loader page" ]
            ]
        ]
