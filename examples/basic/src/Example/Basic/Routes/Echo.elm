module Example.Basic.Routes.Echo exposing (action, page)

-- File-based routing: GET /echo renders a form; POST /echo runs the action.
-- The action validates, performs a server effect, then redirects (PRG) — so the
-- form works with no client JavaScript at all.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, a, button, form, h1, input, label, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode


page : Request -> Loader (Document Never)
page request =
    Loader.succeed (view request)


action : Request -> Action (Document Never)
action request =
    case Maybe.map String.trim (Route.formValue "message" request) of
        Just message ->
            if String.isEmpty message then
                Action.fail 422 "Message is required."

            else
                -- Run a server effect (confirm the edge region), then redirect.
                Action.fromLoader confirmRegion
                    |> Action.andThen (\region -> Action.redirect ("/echo?status=received&region=" ++ region))

        Nothing ->
            Action.fail 422 "Message is required."


confirmRegion : Loader String
confirmRegion =
    Loader.fetchJson
        { url = "app://status"
        , decoder = Decode.field "region" Decode.string
        }


view : Request -> Document Never
view request =
    Shared.pageDocument "Form Action"
        [ section [ Attr.class "panel" ]
            (case Route.query "status" request of
                Just "received" ->
                    [ span [ Attr.class "eyebrow" ] [ text "Action complete" ]
                    , h1 [] [ text "Message received" ]
                    , p [] [ text ("Saved on the server (region: " ++ (Route.query "region" request |> Maybe.withDefault "unknown") ++ "). This page arrived via a POST → action → redirect, no client JavaScript.") ]
                    , p [] [ a [ Attr.class "button-link", Attr.href "/echo" ] [ text "Send another" ] ]
                    ]

                _ ->
                    [ span [ Attr.class "eyebrow" ] [ text "Forms without JS" ]
                    , h1 [] [ text "Server action" ]
                    , p [] [ text "Submitting this form POSTs to the route's action, which validates, runs a server effect, then redirects. It works with JavaScript disabled." ]
                    , echoForm
                    ]
            )
        ]


echoForm : Node msg
echoForm =
    form [ Attr.class "echo-form", Attr.method "post", Attr.action "/echo" ]
        [ label [ Attr.class "field" ]
            [ span [] [ text "Message" ]
            , input [ Attr.type_ "text", Attr.name "message", Attr.placeholder "Say something", Attr.required True ]
            ]
        , button [ Attr.type_ "submit", Attr.class "button-link primary" ] [ text "Send" ]
        ]
