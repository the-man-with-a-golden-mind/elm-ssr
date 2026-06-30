module ElmSsr.Document.Events exposing (EventRef, decodeEventRef, encodeEventRef, findMessage)

{-| LEGACY / vestigial.

Only used to support very old page event wiring if any; islands should use
stock `elm/html` `Html.Events` + the client runtime.

Browser events are bridged without serializing `Msg`. An event handler is
rendered as an `EventRef` (a DOM path + event name); when the browser reports an
event, the runtime looks the message back up against the current view with
[`findMessage`](#findMessage).

@docs EventRef, decodeEventRef, encodeEventRef, findMessage

-}

import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Attribute(..), EventValue(..), Node(..))
import Json.Decode as Decode
import Json.Encode as Encode


type alias EventRef =
    { path : List Int
    , event : String
    , value : Maybe String
    }


encodeEventRef : EventRef -> Encode.Value
encodeEventRef eventRef =
    Encode.object
        [ ( "path", Encode.list Encode.int eventRef.path )
        , ( "event", Encode.string eventRef.event )
        , ( "value", maybeString eventRef.value )
        ]


decodeEventRef : Decode.Decoder EventRef
decodeEventRef =
    Decode.map3 EventRef
        (Decode.field "path" (Decode.list Decode.int))
        (Decode.field "event" Decode.string)
        (Decode.maybe (Decode.field "value" Decode.string))


maybeString : Maybe String -> Encode.Value
maybeString maybeValue =
    case maybeValue of
        Just value ->
            Encode.string value

        Nothing ->
            Encode.null


findMessage : EventRef -> Document msg -> Maybe msg
findMessage eventRef document =
    document.body
        |> getNode eventRef.path
        |> Maybe.andThen (findMessageOnNode eventRef)


getNode : List Int -> List (Node msg) -> Maybe (Node msg)
getNode path nodes =
    case path of
        [] ->
            Nothing

        index :: rest ->
            case List.drop index nodes |> List.head of
                Just node ->
                    if List.isEmpty rest then
                        Just node

                    else
                        case node of
                            Element _ _ children ->
                                getNode rest children

                            VoidElement _ _ ->
                                Nothing

                            Text _ ->
                                Nothing

                Nothing ->
                    Nothing


findMessageOnNode : EventRef -> Node msg -> Maybe msg
findMessageOnNode eventRef node =
    case node of
        Element _ attributes _ ->
            findMessageOnAttributes eventRef attributes

        VoidElement _ attributes ->
            findMessageOnAttributes eventRef attributes

        Text _ ->
            Nothing


findMessageOnAttributes : EventRef -> List (Attribute msg) -> Maybe msg
findMessageOnAttributes eventRef attributes =
    case attributes of
        [] ->
            Nothing

        attribute :: rest ->
            case attribute of
                EventHandler name _ toMessage ->
                    if name == eventRef.event then
                        Just (toMessage (eventValueFromRef eventRef))

                    else
                        findMessageOnAttributes eventRef rest

                Property _ _ ->
                    findMessageOnAttributes eventRef rest


eventValueFromRef : EventRef -> EventValue
eventValueFromRef eventRef =
    case eventRef.value of
        Just value ->
            StringValue value

        Nothing ->
            NoValue
