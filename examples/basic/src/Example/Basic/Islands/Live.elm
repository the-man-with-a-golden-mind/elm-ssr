module Example.Basic.Islands.Live exposing
    ( embed
    , Flags, Model, Msg
    , init, main, subscriptions, update, view
    )

{-| Browser.element island that consumes a Server-Sent Events stream from
the Worker. Opens the stream in `init`, decodes ticks in `update`, and
shows the latest one. Stops the stream when the page navigates away (the
client runtime closes EventSources for non-persistent islands).
-}

import Browser
import ElmSsr.Island as Island
import ElmSsr.Island.Sse as Sse
import ElmSsr.Html as SsrHtml
import ElmSsr.Html.Attributes as SsrAttributes
import Html exposing (Html, code, div, p, span, text)
import Html.Attributes exposing (class)
import Json.Decode as Decode
import Json.Encode as Encode


streamUrl : String
streamUrl =
    "/__elm-ssr/live"


type alias Flags =
    {}


type alias Model =
    { latest : Maybe Tick
    , error : Maybe String
    }


type alias Tick =
    { time : String, n : Int }


type Msg
    = GotSseEvent Sse.Event
    | GotSseError { url : String, message : String }


embed : Flags -> SsrHtml.Node msg
embed =
    Island.embed "Live"
        { encodeFlags = \_ -> Encode.object []
        , fallback = fallback
        , id = Nothing
        }


fallback : Flags -> List (SsrHtml.Node msg)
fallback _ =
    [ SsrHtml.div [ SsrAttributes.class "counter-island fallback" ]
        [ SsrHtml.code [ SsrAttributes.class "counter-code" ]
            [ SsrHtml.text "waiting for first server event…" ]
        ]
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
init _ =
    ( { latest = Nothing, error = Nothing }, Sse.open streamUrl )


tickDecoder : Decode.Decoder Tick
tickDecoder =
    Decode.map2 Tick
        (Decode.field "time" Decode.string)
        (Decode.field "n" Decode.int)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotSseEvent event ->
            case Sse.match streamUrl tickDecoder event of
                Just (Ok tick) ->
                    ( { model | latest = Just tick, error = Nothing }, Cmd.none )

                Just (Err (Sse.DecodeError err)) ->
                    ( { model | error = Just ("Decode: " ++ err) }, Cmd.none )

                Just (Err (Sse.NetworkError err)) ->
                    ( { model | error = Just err }, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        GotSseError { message } ->
            ( { model | error = Just message }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ Sse.events GotSseEvent
        , Sse.errors GotSseError
        ]


view : Model -> Html Msg
view model =
    div [ class "counter-island" ]
        [ case model.latest of
            Just tick ->
                div [ class "counter-actions" ]
                    [ span [ class "counter-value" ] [ text (String.fromInt tick.n) ]
                    , code [ class "counter-code" ] [ text ("server time: " ++ tick.time) ]
                    ]

            Nothing ->
                p [] [ text "waiting for first server event…" ]
        , case model.error of
            Just err ->
                code [ class "counter-code" ] [ text ("error: " ++ err) ]

            Nothing ->
                text ""
        ]
