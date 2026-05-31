module Example.Basic.Islands.Counter exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import ElmSsr.Island.Shared as Shared
import Html exposing (Html, button, code, div, span, text)
import Html.Attributes exposing (class, type_)
import Html.Events exposing (onClick)
import Json.Encode as Encode


type alias Flags =
    { start : Int
    }


type alias Model =
    { count : Int
    }


type Msg
    = Increment
    | Decrement
    | Reset


embed : Flags -> Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Just "global-counter"
        }


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object [ ( "start", Encode.int flags.start ) ]


fallback : Flags -> List (Node msg)
fallback flags =
    [ SsrHtml.div [ SsrAttributes.class "counter-island fallback" ]
        [ SsrHtml.div [ SsrAttributes.class "counter-actions" ]
            [ SsrHtml.span [ SsrAttributes.class "counter-value" ] [ SsrHtml.text (String.fromInt flags.start) ] ]
        , SsrHtml.code [ SsrAttributes.class "counter-code" ] [ SsrHtml.text "Loading counter island…" ]
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
init flags =
    ( { count = flags.start }, Cmd.none )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            let
                newCount =
                    model.count + 1
            in
            ( { model | count = newCount }, Shared.broadcast "count-changed" (Encode.int newCount) )

        Decrement ->
            let
                newCount =
                    model.count - 1
            in
            ( { model | count = newCount }, Shared.broadcast "count-changed" (Encode.int newCount) )

        Reset ->
            ( { model | count = 0 }, Shared.broadcast "count-changed" (Encode.int 0) )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ class "counter-island" ]
        [ div [ class "counter-actions" ]
            [ button [ class "btn btn-secondary btn-square", type_ "button", onClick Decrement ] [ text "-" ]
            , span [ class "counter-value" ] [ text (String.fromInt model.count) ]
            , button [ class "btn btn-primary btn-square", type_ "button", onClick Increment ] [ text "+" ]
            , button [ class "btn btn-secondary btn-square", type_ "button", onClick Reset ] [ text "reset" ]
            ]
        , code [ class "counter-code" ] [ text "Browser.element island using standard elm/html" ]
        ]
