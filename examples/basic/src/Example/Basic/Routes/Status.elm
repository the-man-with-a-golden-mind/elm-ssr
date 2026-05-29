module Example.Basic.Routes.Status exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, h1, li, p, section, span, text, ul)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode
import Json.Encode as Encode


type alias Status =
    { uptime : String
    , region : String
    , builds : Int
    }


page : Request -> Loader (Document Never)
page _ =
    Loader.map2 view cachedStatus (Loader.env "GREETING")


{-| Read the status from the cache; on a miss, fetch it and populate the cache
(with a 60s TTL). Backend-neutral: cache is KV on Cloudflare, Redis/Map locally.
-}
cachedStatus : Loader Status
cachedStatus =
    Loader.cacheGet { key = "status", decoder = decoder }
        |> Loader.andThen
            (\cached ->
                case cached of
                    Just status ->
                        Loader.succeed status

                    Nothing ->
                        Loader.fetchJson { url = "app://status", decoder = decoder }
                            |> Loader.andThen
                                (\status ->
                                    Loader.cachePut { key = "status", value = encode status, ttlSeconds = Just 60 }
                                        |> Loader.map (\_ -> status)
                                )
            )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


decoder : Decode.Decoder Status
decoder =
    Decode.map3 Status
        (Decode.field "uptime" Decode.string)
        (Decode.field "region" Decode.string)
        (Decode.field "builds" Decode.int)


encode : Status -> Encode.Value
encode status =
    Encode.object
        [ ( "uptime", Encode.string status.uptime )
        , ( "region", Encode.string status.region )
        , ( "builds", Encode.int status.builds )
        ]


view : Status -> Maybe String -> Document Never
view data greeting =
    Shared.pageDocument "Edge Status"
        [ statusSection data greeting
        , Shared.featureSection
        ]


statusSection : Status -> Maybe String -> Node msg
statusSection data greeting =
    section [ class "panel" ]
        [ span [ class "eyebrow" ] [ text "Loader page (server only)" ]
        , h1 [] [ text "Edge status" ]
        , p [] [ text "This page has no Model and no Msg. A Loader read the cache (filling it from a fetch on a miss) and read an env value on the server, then rendered once with no client runtime." ]
        , ul [ class "list" ]
            [ li [] [ text ("Uptime: " ++ data.uptime) ]
            , li [] [ text ("Region: " ++ data.region) ]
            , li [] [ text ("Builds: " ++ String.fromInt data.builds) ]
            , li [] [ text ("Env GREETING: " ++ Maybe.withDefault "—" greeting) ]
            ]
        ]
