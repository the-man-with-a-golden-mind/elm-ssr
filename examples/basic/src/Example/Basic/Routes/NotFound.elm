module Example.Basic.Routes.NotFound exposing (page)

import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, article, h1, p, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


view : Document Never
view =
    Page.notFound
        { title = "Not Found | elm-ssr"
        , head = Shared.baseHead
        , body =
            [ Shared.layout
                [ article [ class "panel" ]
                    [ h1 [] [ text "404" ]
                    , p [] [ text "This route is not registered in the example app." ]
                    , a [ class "link", href "/" ] [ text "Back to home" ]
                    ]
                ]
            ]
        }
