module ElmSsr.Document.Encode exposing (encode)

{-| Serialize a document to the JSON the JS runtime renders and patches.

@docs encode

-}

import ElmSsr.Document exposing (Document)
import ElmSsr.Document.Events as Events
import ElmSsr.Html exposing (Attribute(..), EventCapture(..), Node(..))
import Json.Encode as Encode


encode : Document msg -> Encode.Value
encode document =
    Encode.object
        [ ( "status", Encode.int document.status )
        , ( "lang", Encode.string document.lang )
        , ( "head", Encode.list identity (List.indexedMap (\index node -> encodeNode [ index ] node) document.head) )
        , ( "body", Encode.list identity (List.indexedMap (\index node -> encodeNode [ index ] node) document.body) )
        ]


encodeNode : List Int -> Node msg -> Encode.Value
encodeNode path node =
    Encode.object (nodeFields path node)


nodeFields : List Int -> Node msg -> List ( String, Encode.Value )
nodeFields path node =
    case node of
        Element tag attributes children ->
            [ ( "kind", Encode.string "element" )
            , ( "tag", Encode.string tag )
            , ( "attrs", Encode.list identity (List.map (encodeAttribute path) attributes) )
            , ( "children", Encode.list identity (List.indexedMap (\index child -> encodeNode (path ++ [ index ]) child) children) )
            ]

        VoidElement tag attributes ->
            [ ( "kind", Encode.string "void" )
            , ( "tag", Encode.string tag )
            , ( "attrs", Encode.list identity (List.map (encodeAttribute path) attributes) )
            ]

        Text content ->
            [ ( "kind", Encode.string "text" )
            , ( "text", Encode.string content )
            ]

        Keyed key keyedNode ->
            ( "key", Encode.string key ) :: nodeFields path keyedNode


encodeAttribute : List Int -> Attribute msg -> Encode.Value
encodeAttribute path attribute =
    case attribute of
        Property name value ->
            Encode.object
                [ ( "kind", Encode.string "attribute" )
                , ( "name", Encode.string name )
                , ( "value", Encode.string value )
                ]

        EventHandler name capture _ ->
            Encode.object
                [ ( "kind", Encode.string "event" )
                , ( "name", Encode.string name )
                , ( "payload"
                  , Events.encodeEventRef
                        { path = path
                        , event = name
                        , value = Nothing
                        }
                  )
                , ( "capture", encodeEventCapture capture )
                ]


encodeEventCapture : EventCapture -> Encode.Value
encodeEventCapture capture =
    case capture of
        NoEventData ->
            Encode.string "none"

        TargetValue ->
            Encode.string "value"
