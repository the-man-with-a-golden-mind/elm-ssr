module Example.Basic.Routes.Validate exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, button, div, form, h1, input, label, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Request.Decode as Decode
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared


type alias SignupData =
    { email : String
    , age : Int
    , subscribe : Bool
    }


signupDecoder : Decode.Decoder SignupData
signupDecoder =
    Decode.succeed SignupData
        |> Decode.required "email" (Decode.string |> Decode.validate Decode.email)
        |> Decode.required "age" (Decode.int |> Decode.validate (Decode.minInt 18))
        |> Decode.optionalWithDefault "subscribe" False Decode.bool


page : Request -> Loader (Document Never)
page request =
    Loader.succeed (view request)


action : Request -> Action (Document Never)
action request =
    case Decode.decodeForm signupDecoder request of
        Ok _ ->
            Action.redirect "/validate?status=success"

        Err errors ->
            -- Redirect back with errors as query parameters to display in the UI
            let
                queryString =
                    errors
                        |> List.map (\err -> "error_" ++ err.field ++ "=" ++ err.message)
                        |> String.join "&"
            in
            Action.redirect ("/validate?" ++ queryString)


view : Request -> Document Never
view request =
    Shared.pageDocument "Validation Demo"
        [ section [ Attr.class "panel" ]
            (case Route.query "status" request of
                Just "success" ->
                    [ span [ Attr.class "eyebrow" ] [ text "Form Submission Success" ]
                    , h1 [] [ text "Registration Successful" ]
                    , p [] [ text "Your inputs passed all server-side validation decoders perfectly!" ]
                    , p [] [ ElmSsr.Html.a [ Attr.class "btn btn-secondary", Attr.href "/validate" ] [ text "Try again" ] ]
                    ]

                _ ->
                    [ span [ Attr.class "eyebrow" ] [ text "Type-safe Input Validation" ]
                    , h1 [] [ text "Register User" ]
                    , p [] [ text "This form uses our new ElmSsr.Request.Decode to validate fields on the server. Errors are accumulated and displayed on redirect." ]
                    , signupForm request
                    ]
            )
        ]


signupForm : Request -> Node msg
signupForm request =
    let
        emailErr =
            Route.query "error_email" request

        ageErr =
            Route.query "error_age" request
    in
    form [ Attr.class "echo-form", Attr.method "post", Attr.action "/validate" ]
        [ label [ Attr.class "field" ]
            [ span [] [ text "Email Address" ]
            , input [ Attr.type_ "text", Attr.name "email", Attr.placeholder "you@example.com" ]
            , renderError emailErr
            ]
        , label [ Attr.class "field" ]
            [ span [] [ text "Age" ]
            , input [ Attr.type_ "text", Attr.name "age", Attr.placeholder "18+" ]
            , renderError ageErr
            ]
        , label [ Attr.class "checkbox-field" ]
            [ input [ Attr.type_ "checkbox", Attr.name "subscribe" ]
            , span [] [ text " Subscribe to newsletter" ]
            ]
        , button [ Attr.type_ "submit", Attr.class "btn btn-primary" ] [ text "Register" ]
        ]


renderError : Maybe String -> Node msg
renderError maybeErr =
    case maybeErr of
        Just msg ->
            div [ Attr.style "color" "red", Attr.style "font-size" "0.85rem", Attr.style "margin-top" "0.25rem" ]
                [ text msg ]

        Nothing ->
            text ""
