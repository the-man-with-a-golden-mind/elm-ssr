module Example.Basic.Routes.Session exposing (action, page)

{-| File-based routing: GET /session reads the "session" cookie and shows who
you are; POST /session?op=login sets a hardened session cookie via
`Action.sessionCookie`; POST /session?op=logout clears it. Demonstrates both
sides of the cookie API end-to-end with no client JS.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (button, form, h1, input, label, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.getCookie "session"
        |> Loader.map view


action : Request -> Action (Document Never)
action request =
    case Route.query "op" request of
        Just "logout" ->
            Action.redirect "/session"
                |> Action.clearCookie { name = "session", path = Just "/", domain = Nothing }

        _ ->
            case Maybe.map String.trim (Route.formValue "username" request) of
                Just username ->
                    if String.isEmpty username then
                        Action.fail 422 "Username is required."

                    else
                        -- For the example, the username *is* the session id. A real app
                        -- would mint a server-side session token, store it (KV/D1/Redis),
                        -- and put the token in the cookie.
                        Action.redirect "/session"
                            |> Action.setCookie (devSessionCookie "session" username)

                Nothing ->
                    Action.fail 422 "Username is required."


{-| The example runs over plain HTTP in tests + `wrangler dev`, so we mint a
session cookie with `Secure=False`. Production code uses `Action.sessionCookie`
unchanged.
-}
devSessionCookie : String -> String -> Action.Cookie
devSessionCookie name value =
    let
        secure =
            Action.sessionCookie name value
    in
    { secure | secure = False }


view : Maybe String -> Document Never
view session =
    Shared.pageDocument "Session"
        [ section [ Attr.class "panel" ]
            (case session of
                Just user ->
                    [ h1 [] [ text "Signed in" ]
                    , p [] [ text "Welcome back, ", span [ Attr.class "value" ] [ text user ], text "." ]
                    , form [ Attr.method "post", Attr.action "/session?op=logout" ]
                        [ button [ Attr.type_ "submit", Attr.class "btn btn-secondary" ] [ text "Sign out" ] ]
                    ]

                Nothing ->
                    [ h1 [] [ text "Sign in" ]
                    , p [] [ text "No session cookie was sent." ]
                    , form [ Attr.method "post", Attr.action "/session", Attr.class "form" ]
                        [ label [ Attr.for "username" ] [ text "Username" ]
                        , input
                            [ Attr.id "username"
                            , Attr.name "username"
                            , Attr.type_ "text"
                            , Attr.class "input"
                            , Attr.attr "autocomplete" "username"
                            ]
                        , button [ Attr.type_ "submit", Attr.class "btn btn-secondary" ] [ text "Sign in" ]
                        ]
                    ]
            )
        ]
