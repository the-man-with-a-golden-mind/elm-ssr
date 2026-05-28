module Example.Basic.Routes.Counter exposing (page)

-- A static page that embeds interactive islands. The page itself ships no
-- client runtime; the browser mounts each island separately, and only those
-- mounted roots update.

import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (h1, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.Islands.Counter as Counter
import Example.Basic.Islands.Tasks as Tasks
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


view : Document Never
view =
    Shared.pageDocument "Interactive Counter"
        [ section [ class "panel counter-panel" ]
            [ span [ class "eyebrow" ] [ text "Island" ]
            , h1 [] [ text "Counter route" ]
            , p [] [ text "This page is static. Only the counter below is an interactive island; clicking it patches just its subtree, not the page." ]
            , Counter.embed { start = 0 }
            ]
        , section [ class "panel tasks-panel" ]
            [ span [ class "eyebrow" ] [ text "Keyed island" ]
            , h1 [] [ text "Keyed list" ]
            , p [] [ text "Reorder or remove rows: each row is keyed, so the surviving DOM nodes (and any note you type) are preserved rather than rebuilt." ]
            , Tasks.embed { items = [ "Write the RFC", "Spike the runtime", "Cover it with tests" ] }
            ]
        , Shared.featureSection
        ]
