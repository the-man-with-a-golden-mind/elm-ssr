module CryptoDashboard.View.Shared exposing (head, shell)

import ElmSsr.Html as Html exposing (Node, a, div, h1, header, main_, nav, p, section, span, text)
import ElmSsr.Html.Attributes as SsrAttributes exposing (class, href)
import ElmSsr.Page as Page


head : List (Node msg)
head =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Html.script [ class "tailwind-cdn", SsrAttributes.src "https://cdn.tailwindcss.com" ] []
    , Page.stylesheet "/styles.css"
    ]


shell : String -> List (Node msg) -> Node msg
shell heading body =
    div [ class "min-h-screen bg-slate-950 text-slate-100 font-sans" ]
        [ nav [ class "border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50" ]
            [ div [ class "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" ]
                [ div [ class "flex items-center gap-2" ]
                    [ div [ class "w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20" ] [ text "Σ" ]
                    , span [ class "font-bold text-xl tracking-tight" ] [ text "CryptoPulse" ]
                    ]
                , div [ class "flex gap-4 text-sm font-medium text-slate-400" ]
                    [ a [ class "hover:text-white transition-colors", href "/" ] [ text "Dashboard" ]
                    , a [ class "hover:text-white transition-colors", href "/market" ] [ text "Markets" ]
                    ]
                ]
            ]
        , main_ [ class "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" ]
            (header [ class "mb-8" ]
                [ h1 [ class "text-3xl font-bold text-white tracking-tight" ] [ text heading ]
                , p [ class "text-slate-400 mt-1" ] [ text "Real-time market insights powered by Elm SSR" ]
                ]
                :: body
            )
        ]
