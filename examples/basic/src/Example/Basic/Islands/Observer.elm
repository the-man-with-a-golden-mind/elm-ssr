module Example.Basic.Islands.Observer exposing (embed, main)

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import ElmSsr.Island.Shared as Shared
import Html exposing (Html, div, span, text)
import Html.Attributes exposing (class)
import Json.Decode as Decode
import Json.Encode as Encode


type alias Flags =
    {}


type alias Model =
    { lastCount : Int
    }


type Msg
    = OnGlobalEvent Shared.GlobalEvent


embed : Flags -> Node msg
embed =
    Island.embed "Observer"
        { encodeFlags = \_ -> Encode.null
        , fallback = \_ -> [ SsrHtml.text "Waiting for updates..." ]
        , id = Just "global-observer"
        }


main : Program Flags Model Msg
main =
    Browser.element
        { init = \_ -> ( { lastCount = 0 }, Cmd.none )
        , update = update
        , view = view
        , subscriptions = \_ -> Shared.listen OnGlobalEvent
        }


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OnGlobalEvent event ->
            if event.tag == "count-changed" then
                case Decode.decodeValue Decode.int event.payload of
                    Ok count ->
                        ( { model | lastCount = count }, Cmd.none )

                    Err _ ->
                        ( model, Cmd.none )

            else
                ( model, Cmd.none )


view : Model -> Html Msg
view model =
    div [ class "observer-island" ]
        [ span [ class "eyebrow" ] [ text "Observer Island" ]
        , div [] [ text ("Last count from bus: " ++ String.fromInt model.lastCount) ]
        ]
