module Example.Basic.Routes.Profile exposing (action, page)

{-| File-based routing: GET /profile reads the current session via
`Loader.session`; POST /profile?op=login sets it via `Loader.setSession`
(lifted into the action with `Action.fromLoader`); POST /profile?op=logout
calls `Loader.clearSession`. Demonstrates the full session+CSRF round-trip.

The TS side wires `sessionMiddleware` + `csrfMiddleware` +
`sessionEffects(runner)` in runtime.ts; this Elm module never touches the
underlying cookie itself.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (button, form, h1, input, label, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode
import Json.Encode as Encode


type alias Profile =
    { username : String }


profileDecoder : Decode.Decoder Profile
profileDecoder =
    Decode.map Profile (Decode.field "username" Decode.string)


encodeProfile : Profile -> Encode.Value
encodeProfile profile =
    Encode.object [ ( "username", Encode.string profile.username ) ]


page : Request -> Loader (Document Never)
page _ =
    Loader.map2 view (Loader.session profileDecoder) Loader.csrfToken


action : Request -> Action (Document Never)
action request =
    case Route.query "op" request of
        Just "logout" ->
            Action.fromLoader Loader.clearSession
                |> Action.andThen (\_ -> Action.redirect "/profile")

        _ ->
            case Maybe.map String.trim (Route.formValue "username" request) of
                Just username ->
                    if String.isEmpty username then
                        Action.fail 422 "Username is required."

                    else
                        Action.fromLoader (Loader.setSession (encodeProfile { username = username }))
                            |> Action.andThen (\_ -> Action.redirect "/profile")

                Nothing ->
                    Action.fail 422 "Username is required."


view : Maybe Profile -> Maybe String -> Document Never
view profile token =
    Shared.pageDocument "Profile"
        [ section [ Attr.class "panel" ]
            (case profile of
                Just { username } ->
                    [ h1 [] [ text "Signed in" ]
                    , p [] [ text "Hello, ", span [ Attr.class "value" ] [ text username ], text "." ]
                    , form
                        [ Attr.method "post", Attr.action "/profile?op=logout" ]
                        (csrfField token
                            ++ [ button [ Attr.type_ "submit", Attr.class "btn btn-secondary" ] [ text "Sign out" ] ]
                        )
                    ]

                Nothing ->
                    [ h1 [] [ text "Sign in" ]
                    , p [] [ text "No session yet." ]
                    , form
                        [ Attr.method "post", Attr.action "/profile", Attr.class "form" ]
                        (csrfField token
                            ++ [ label [ Attr.for "username" ] [ text "Username" ]
                               , input
                                    [ Attr.id "username"
                                    , Attr.name "username"
                                    , Attr.type_ "text"
                                    , Attr.class "input"
                                    ]
                               , button [ Attr.type_ "submit", Attr.class "btn btn-secondary" ] [ text "Sign in" ]
                               ]
                        )
                    ]
            )
        ]


csrfField : Maybe String -> List (ElmSsr.Html.Node msg)
csrfField token =
    case token of
        Just value ->
            [ input
                [ Attr.type_ "hidden"
                , Attr.name "_csrf"
                , Attr.value value
                ]
            ]

        Nothing ->
            []
