module Example.Basic.Routes.Status exposing (page)

import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, h1, li, p, section, span, text, ul)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode


type alias Status =
    { uptime : String
    , region : String
    , builds : Int
    }


page : Request -> Loader (Document Never)
page _ =
    Loader.fetchJson { url = "app://status", decoder = decoder }
        |> Loader.map view


decoder : Decode.Decoder Status
decoder =
    Decode.map3 Status
        (Decode.field "uptime" Decode.string)
        (Decode.field "region" Decode.string)
        (Decode.field "builds" Decode.int)


view : Status -> Document Never
view data =
    Shared.pageDocument "Edge Status"
        [ statusSection data
        , Shared.featureSection
        ]


statusSection : Status -> Node msg
statusSection data =
    section [ class "panel" ]
        [ span [ class "eyebrow" ] [ text "Loader page (server only)" ]
        , h1 [] [ text "Edge status" ]
        , p [] [ text "This page has no Model and no Msg. A Loader fetched the data on the server, the page rendered once, and no client runtime was shipped." ]
        , ul [ class "list" ]
            [ li [] [ text ("Uptime: " ++ data.uptime) ]
            , li [] [ text ("Region: " ++ data.region) ]
            , li [] [ text ("Builds: " ++ String.fromInt data.builds) ]
            ]
        ]
