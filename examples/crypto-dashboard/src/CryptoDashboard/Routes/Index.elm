module CryptoDashboard.Routes.Index exposing (page, action)

import CryptoDashboard.Islands.MarketOverview as MarketOverview
import CryptoDashboard.Islands.PriceChart as PriceChart
import CryptoDashboard.View.Shared as Shared
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, div, h2, section, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import Json.Decode as Decode


type alias Coin =
    { id : String
    , symbol : String
    , name : String
    , price : Float
    , change24h : Float
    }


type alias MarketData =
    { coins : List Coin
    }


page : Request -> Loader (Document Never)
page _ =
    Loader.fetchJson { url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,cardano,solana&order=market_cap_desc", decoder = coinsDecoder }
        |> Loader.map (\coins -> view { coins = coins })


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


coinsDecoder : Decode.Decoder (List Coin)
coinsDecoder =
    Decode.list
        (Decode.map5 Coin
            (Decode.field "id" Decode.string)
            (Decode.field "symbol" Decode.string)
            (Decode.field "name" Decode.string)
            (Decode.field "current_price" Decode.float)
            (Decode.field "price_change_percentage_24h" Decode.float)
        )


view : MarketData -> Document Never
view data =
    Page.page
        { title = "Crypto Dashboard | CryptoPulse"
        , head = Shared.head
        , body =
            [ Shared.shell "Market Overview"
                [ MarketOverview.embed { coins = data.coins }
                , section [ class "mt-12 bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl" ]
                    [ h2 [ class "text-xl font-bold text-white mb-6" ] [ text "Real-time Price Trend" ]
                    , PriceChart.embed { coinId = "bitcoin" }
                    ]
                ]
            ]
        }
