module Example.Basic.Routes.Counter exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (h1, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.Islands.Counter as Counter
import Example.Basic.Islands.Observer as Observer
import Example.Basic.Islands.Tasks as Tasks
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Shared.pageDocument "Interactive Counter"
        [ section [ class "panel counter-panel" ]
            [ span [ class "eyebrow" ] [ text "Island" ]
            , h1 [] [ text "Counter route" ]
            , p [] [ text "This page is static. Only the counter below is an interactive island; clicking it patches just its subtree, not the page." ]
            , Counter.embed { start = 0 }
            , Observer.embed {}
            ]
        , section [ class "panel tasks-panel" ]
            [ span [ class "eyebrow" ] [ text "Keyed island" ]
            , h1 [] [ text "Keyed list" ]
            , p [] [ text "Reorder or remove rows: each row is keyed, so the surviving DOM nodes (and any note you type) are preserved rather than rebuilt." ]
            , Tasks.embed { items = [ "Write the RFC", "Spike the runtime", "Cover it with tests" ] }
            ]
        , Shared.featureSection
        ]
