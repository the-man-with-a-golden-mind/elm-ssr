module Example.Basic.Routes.Preferences exposing (action, page)

{-| Demonstrates Action.defaultCookie for a non-sensitive user preference
(theme toggle). Contrast with Routes.Session which uses the hardened
Action.sessionCookie for an auth token.

A preference cookie is intentionally permissive:
  - No HttpOnly: the JS side may read it to avoid a flash of wrong theme.
  - No Secure: works over plain HTTP in local dev.
  - No SameSite, no Max-Age: browser session lifetime, no cross-site concern.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (button, form, h1, input, label, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared


page : Request -> Loader (Document Never)
page request =
    let
        theme =
            Route.query "theme" request |> Maybe.withDefault "light"
    in
    Loader.succeed (view theme)


action : Request -> Action (Document Never)
action request =
    let
        theme =
            Route.formValue "theme" request |> Maybe.withDefault "light"

        cookie =
            Action.defaultCookie "theme" theme
    in
    Action.redirect ("/preferences?theme=" ++ theme)
        |> Action.setCookie cookie


view : String -> Document Never
view theme =
    Shared.pageDocument "Preferences"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "Action.defaultCookie demo" ]
            , h1 [] [ text ("Theme: " ++ theme) ]
            , p [] [ text "POST sets a permissive theme cookie (no HttpOnly, no Secure, no SameSite, no Max-Age). Contrast with the Session route which uses the hardened sessionCookie." ]
            , form [ Attr.method "post", Attr.action "/preferences" ]
                [ label []
                    [ text "Theme: "
                    , input [ Attr.type_ "text", Attr.name "theme", Attr.value theme ]
                    ]
                , button [ Attr.type_ "submit", Attr.class "btn btn-primary" ] [ text "Save" ]
                ]
            ]
        ]
