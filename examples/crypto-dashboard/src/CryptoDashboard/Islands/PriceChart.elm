module CryptoDashboard.Islands.PriceChart exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import ElmSsr.Island.Shared as SharedBus
import Html exposing (Html, div, text)
import Html.Attributes as HtmlAttr
import Http
import Json.Decode as Decode
import Json.Encode as Encode
import Svg exposing (Svg, svg)
import Svg.Attributes as SvgAttr
import Time


embed : Flags -> SsrHtml.Node msg
embed =
    Island.embed "PriceChart"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Just "btc-price-chart"
        }


type alias Flags =
    { coinId : String }


type alias DataPoint =
    { time : Float
    , price : Float
    }


type Model
    = Loading String
    | Loaded String (List DataPoint)
    | Error String String


type Msg
    = GotData String (Result Http.Error (List DataPoint))
    | OnGlobalEvent SharedBus.GlobalEvent
    | Refresh


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object [ ( "coinId", Encode.string flags.coinId ) ]


fallback : Flags -> List (SsrHtml.Node msg)
fallback _ =
    [ SsrHtml.div [ SsrAttributes.class "h-64 flex items-center justify-center bg-slate-900/50 rounded-lg animate-pulse" ]
        [ SsrHtml.text "Loading market data..." ]
    ]


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init flags =
    ( Loading flags.coinId, fetchData flags.coinId )


fetchData : String -> Cmd Msg
fetchData coinId =
    Http.get
        { url = "https://api.coingecko.com/api/v3/coins/" ++ coinId ++ "/market_chart?vs_currency=usd&days=7"
        , expect = Http.expectJson (GotData coinId) chartDecoder
        }


chartDecoder : Decode.Decoder (List DataPoint)
chartDecoder =
    Decode.field "prices"
        (Decode.list
            (Decode.map2 DataPoint
                (Decode.index 0 Decode.float)
                (Decode.index 1 Decode.float)
            )
        )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotData coinId (Ok data) ->
            ( Loaded coinId data, Cmd.none )

        GotData coinId (Err _) ->
            ( Error coinId "Failed to load chart", Cmd.none )

        OnGlobalEvent event ->
            if event.tag == "coin-selected" then
                case Decode.decodeValue Decode.string event.payload of
                    Ok newCoinId ->
                        ( Loading newCoinId, fetchData newCoinId )

                    Err _ ->
                        ( model, Cmd.none )

            else
                ( model, Cmd.none )

        Refresh ->
            -- Silently refetch the current coin (keep showing the last chart).
            ( model, fetchData (currentCoin model) )


currentCoin : Model -> String
currentCoin model =
    case model of
        Loading coinId ->
            coinId

        Loaded coinId _ ->
            coinId

        Error coinId _ ->
            coinId


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ SharedBus.listen OnGlobalEvent
        , Time.every 15000 (\_ -> Refresh)
        ]


view : Model -> Html Msg
view model =
    div [ HtmlAttr.class "w-full" ]
        [ case model of
            Loading id ->
                div [ HtmlAttr.class "h-64 flex items-center justify-center text-slate-500 italic" ] [ text ("Fetching " ++ id ++ " history...") ]

            Loaded _ data ->
                renderChart data

            Error _ msg ->
                div [ HtmlAttr.class "h-64 flex items-center justify-center text-rose-500" ] [ text msg ]
        ]


renderChart : List DataPoint -> Html Msg
renderChart data =
    let
        w = 800
        h = 250
        padding = 30

        prices = List.map .price data
        minPrice = List.minimum prices |> Maybe.withDefault 0
        maxPrice = List.maximum prices |> Maybe.withDefault 1
        priceDiff = maxPrice - minPrice
        
        times = List.map .time data
        minTime = List.minimum times |> Maybe.withDefault 0
        maxTime = List.maximum times |> Maybe.withDefault 1
        timeDiff = maxTime - minTime

        toX t = padding + ((t - minTime) / (if timeDiff == 0 then 1 else timeDiff) * (w - 2 * padding))
        toY p = (h - padding) - ((p - minPrice) / (if priceDiff == 0 then 1 else priceDiff) * (h - 2 * padding))

        points =
            data
                |> List.map (\d -> String.fromFloat (toX d.time) ++ "," ++ String.fromFloat (toY d.price))
                |> String.join " "
    in
    svg
        [ SvgAttr.viewBox ("0 0 " ++ String.fromFloat w ++ " " ++ String.fromFloat h)
        , SvgAttr.class "w-full overflow-visible"
        ]
        [ Svg.polyline
            [ SvgAttr.points points
            , SvgAttr.fill "none"
            , SvgAttr.stroke "#6366f1"
            , SvgAttr.strokeWidth "3"
            , SvgAttr.strokeLinecap "round"
            , SvgAttr.strokeLinejoin "round"
            ]
            []
        ]
