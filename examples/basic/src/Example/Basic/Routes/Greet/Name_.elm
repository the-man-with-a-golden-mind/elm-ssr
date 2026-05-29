module Example.Basic.Routes.Greet.Name_ exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, code, h1, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page request =
    Loader.succeed (view (Route.param "name" request |> Maybe.withDefault "stranger"))


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : String -> Document Never
view name =
    Shared.pageDocument ("Hello " ++ name)
        [ greeting name
        , Shared.featureSection
        ]


greeting : String -> Node msg
greeting name =
    section [ class "panel" ]
        [ span [ class "eyebrow" ] [ text "Dynamic route" ]
        , h1 [] [ text ("Hello, " ++ name ++ "!") ]
        , p [] [ text "The name above was captured from the URL by the file Routes/Greet/Name_.elm." ]
        , code [ class "counter-code" ] [ text "Route.param \"name\" request" ]
        ]
