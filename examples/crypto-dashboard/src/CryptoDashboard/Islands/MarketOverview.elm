module CryptoDashboard.Islands.MarketOverview exposing
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
import ElmSsr.Island.Sse as Sse
import Html exposing (Html, div, h3, p, span, text)
import Html.Attributes as HtmlAttr exposing (class)
import Html.Events exposing (onClick)
import Json.Decode as Decode
import Json.Encode as Encode


type alias Coin =
    { id : String
    , symbol : String
    , name : String
    , price : Float
    , change24h : Float
    }


type alias Flags =
    { coins : List Coin }


type alias Model =
    { coins : List Coin
    , selectedId : String
    }


type Msg
    = SelectCoin String
    | GotMarketEvent Sse.Event
    | GotSseError { url : String, message : String }


embed : Flags -> SsrHtml.Node msg
embed =
    Island.embed "MarketOverview"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Just "global-market-overview"
        }


fallback : Flags -> List (SsrHtml.Node msg)
fallback flags =
    [ SsrHtml.div [ SsrAttributes.class "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" ]
        (List.map
            (\coin ->
                SsrHtml.div [ SsrAttributes.class "bg-slate-900 rounded-xl border border-slate-800 p-5 shadow-sm opacity-50" ]
                    [ SsrHtml.h3 [ SsrAttributes.class "font-bold text-slate-400 text-xs uppercase tracking-wider" ] [ SsrHtml.text coin.name ] ]
            )
            flags.coins
        )
    ]


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object
        [ ( "coins"
          , Encode.list
                (\c ->
                    Encode.object
                        [ ( "id", Encode.string c.id )
                        , ( "symbol", Encode.string c.symbol )
                        , ( "name", Encode.string c.name )
                        , ( "price", Encode.float c.price )
                        , ( "change24h", Encode.float c.change24h )
                        ]
                )
                flags.coins
          )
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
    -- Flags carry the server-rendered snapshot; the SSE stream pushes live updates.
    ( { coins = flags.coins, selectedId = "bitcoin" }, Sse.open streamUrl )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SelectCoin id ->
            ( { model | selectedId = id }
            , SharedBus.broadcast "coin-selected" (Encode.string id)
            )

        GotMarketEvent event ->
            case Sse.match streamUrl marketDecoder event of
                Just (Ok coins) ->
                    ( { model | coins = coins }, Cmd.none )

                _ ->
                    ( model, Cmd.none )

        GotSseError _ ->
            -- EventSource auto-reconnects; nothing for the model to do.
            ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ Sse.events GotMarketEvent
        , Sse.errors GotSseError
        ]


streamUrl : String
streamUrl =
    "/__elm-ssr/markets/stream"


marketDecoder : Decode.Decoder (List Coin)
marketDecoder =
    Decode.field "coins"
        (Decode.list
            (Decode.map5 Coin
                (Decode.field "id" Decode.string)
                (Decode.field "symbol" Decode.string)
                (Decode.field "name" Decode.string)
                (Decode.field "current_price" Decode.float)
                (Decode.field "price_change_percentage_24h" Decode.float)
            )
        )


view : Model -> Html Msg
view model =
    div [ class "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" ]
        (List.map (coinCard model.selectedId) model.coins)


coinCard : String -> Coin -> Html Msg
coinCard selectedId coin =
    let
        isSelected =
            selectedId == coin.id
    in
    div
        [ class
            ("bg-slate-900 rounded-xl border p-5 shadow-sm transition-all group cursor-pointer "
                ++ (if isSelected then
                        "border-indigo-500 ring-1 ring-indigo-500/50 shadow-indigo-500/20 shadow-lg"

                    else
                        "border-slate-800 hover:border-slate-700"
                   )
            )
        , onClick (SelectCoin coin.id)
        ]
        [ div [ class "flex justify-between items-start mb-4" ]
            [ div []
                [ h3 [ class "font-bold text-slate-400 text-xs uppercase tracking-wider" ] [ text coin.name ]
                , p [ class ("text-2xl font-bold transition-colors " ++ (if isSelected then "text-indigo-400" else "text-white group-hover:text-indigo-400")) ] [ text ("$" ++ String.fromFloat coin.price) ]
                ]
            , span
                [ class
                    (if coin.change24h >= 0 then
                        "text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded text-xs font-bold"

                     else
                        "text-rose-400 bg-rose-400/10 px-2 py-1 rounded text-xs font-bold"
                    )
                ]
                [ text (String.fromFloat (roundTo 2 coin.change24h) ++ "%") ]
            ]
        , div [ class "h-1 w-full bg-slate-800 rounded-full overflow-hidden" ]
            [ div [ class "h-full bg-indigo-500 rounded-full", HtmlAttr.style "width" (String.fromFloat (clamp 0 100 (50 + coin.change24h)) ++ "%") ] []
            ]
        ]


roundTo : Int -> Float -> Float
roundTo decimalPlaces num =
    let
        factor =
            10 ^ decimalPlaces |> toFloat
    in
    (num * factor |> round |> toFloat) / factor
