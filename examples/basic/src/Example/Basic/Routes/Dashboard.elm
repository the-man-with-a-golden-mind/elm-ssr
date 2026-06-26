module Example.Basic.Routes.Dashboard exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (h1, p, section, span, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode


type alias Profile =
    { username : String }


profileDecoder : Decode.Decoder Profile
profileDecoder =
    Decode.map Profile (Decode.field "username" Decode.string)


page : Request -> Loader (Document Never)
page _ =
    Loader.requireUser profileDecoder "/profile" (\user ->
        Loader.succeed (view user)
    )


action : Request -> Action (Document Never)
action _ =
    -- Action.requireUser: unauthenticated POST redirects to /profile;
    -- authenticated POST still returns 405 (this page accepts no mutations).
    Action.requireUser profileDecoder "/profile" (\_ ->
        Action.fail 405 "Method not allowed"
    )


view : Profile -> Document Never
view user =
    Shared.pageDocument "Dashboard"
        [ section [ Attr.class "panel" ]
            [ h1 [] [ text "Dashboard" ]
            , p [] [ text "Welcome to your protected dashboard, ", span [ Attr.class "value" ] [ text user.username ], text "!" ]
            , p [] [ text "This page is fully protected by a declarative route guard Loader.requireUser. If you sign out, visiting this URL will automatically redirect you back to the profile/sign-in page." ]
            , p [] [ ElmSsr.Html.a [ Attr.class "btn btn-secondary", Attr.href "/profile" ] [ text "Go to Profile to Sign Out" ] ]
            ]
        ]
