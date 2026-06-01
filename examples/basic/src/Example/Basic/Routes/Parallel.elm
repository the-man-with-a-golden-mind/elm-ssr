module Example.Basic.Routes.Parallel exposing (action, page)

{-| File-based routing: GET /parallel demonstrates `Loader.custom` — the
escape hatch for emitting your own effect `kind` that a TS-side adapter
handles. Here the adapter runs three "queries" via `Promise.all` and returns
the combined payload, so this route awaits ONCE instead of three times.
See docs/recipes/parallel-queries.md for the full pattern.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, code, li, p, section, span, text, ul)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode
import Json.Encode as Encode


type alias Snapshot =
    { totalOrders : Int
    , recentOrderIds : List Int
    , topCountries : List { country : String, total : Int }
    , timings : { totalMs : Int, fanout : List { name : String, ms : Int } }
    }


page : Request -> Loader (Document Never)
page _ =
    Loader.map view fetchSnapshot


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


{-| One Loader call, but the TS adapter runs three queries with Promise.all
underneath. Compare timings: total wall-clock ≈ slowest query, not the sum.
-}
fetchSnapshot : Loader Snapshot
fetchSnapshot =
    Loader.custom
        { kind = "parallelMarkets"
        , payload = Encode.object []
        , decoder = snapshotDecoder
        }


snapshotDecoder : Decode.Decoder Snapshot
snapshotDecoder =
    Decode.map4 Snapshot
        (Decode.field "totalOrders" Decode.int)
        (Decode.field "recentOrderIds" (Decode.list Decode.int))
        (Decode.field "topCountries"
            (Decode.list
                (Decode.map2 (\c t -> { country = c, total = t })
                    (Decode.field "country" Decode.string)
                    (Decode.field "total" Decode.int)
                )
            )
        )
        (Decode.field "timings"
            (Decode.map2 (\t f -> { totalMs = t, fanout = f })
                (Decode.field "totalMs" Decode.int)
                (Decode.field "fanout"
                    (Decode.list
                        (Decode.map2 (\n m -> { name = n, ms = m })
                            (Decode.field "name" Decode.string)
                            (Decode.field "ms" Decode.int)
                        )
                    )
                )
            )
        )


view : Snapshot -> Document Never
view snap =
    Shared.pageDocument "Parallel queries"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "Promise.all in the adapter" ]
            , p [] [ text "Three independent queries ran inside one effect call. The route awaited once." ]
            , timingsBlock snap.timings
            ]
        , section [ Attr.class "panel" ]
            [ p [] [ text "Totals: ", span [ Attr.class "value" ] [ text (String.fromInt snap.totalOrders) ], text " orders." ]
            , p [] [ text "Recent ids:" ]
            , ul [ Attr.class "list" ] (List.map (\n -> li [] [ code [] [ text (String.fromInt n) ] ]) snap.recentOrderIds)
            , p [] [ text "Top countries:" ]
            , ul [ Attr.class "list" ]
                (List.map
                    (\row -> li [] [ text (row.country ++ ": "), span [ Attr.class "value" ] [ text (String.fromInt row.total) ] ])
                    snap.topCountries
                )
            ]
        ]


timingsBlock : { totalMs : Int, fanout : List { name : String, ms : Int } } -> Node msg
timingsBlock t =
    let
        sumFanout =
            t.fanout |> List.map .ms |> List.sum
    in
    p []
        [ text "Wall clock: "
        , span [ Attr.class "value" ] [ text (String.fromInt t.totalMs ++ " ms") ]
        , text " — sum of per-query times: "
        , span [ Attr.class "value" ] [ text (String.fromInt sumFanout ++ " ms") ]
        , text ". (Sequential would take the sum; parallel takes the max.)"
        ]
