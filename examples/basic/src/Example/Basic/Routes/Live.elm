module Example.Basic.Routes.Live exposing (action, page)

{-| File-based routing: GET /live renders a static page that embeds the
`Live` island. The island opens an SSE connection to `/__elm-ssr/live`
(served by the Worker, see runtime.ts) and updates in place as the server
pushes ticks. No client JS on the page itself — only the island.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.Islands.Live as Live
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Shared.pageDocument "Live (SSE)"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "Server push" ]
            , p [] [ text "The clock below is updated by the server via Server-Sent Events. The page itself ships no client JS — only the island." ]
            , Live.embed {}
            ]
        ]
