port module Scaffold exposing (main)

{-| Scaffold code generator written in Elm.

This makes templates type-safe, easy to debug, test, and control.

The JS side (scaffold.mjs) calls this via the compiled JS or by spawning.

For now, this module provides pure functions and a worker interface.
-}

import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode


-- TYPES

type alias RouteSpec =
    { namespace : String
    , moduleName : String
    , routePath : String
    , parts : List String
    }


type Command
    = GeneratePage RouteSpec
    | GenerateApi RouteSpec
    | GenerateResource RouteSpec


-- PORTS

port request : (Decode.Value -> msg) -> Sub msg


port response : Encode.Value -> Cmd msg


-- MAIN (worker for CLI use)

main : Program Decode.Value () Msg
main =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = update
        , subscriptions = \_ -> request GotRequest
        }


type Msg
    = GotRequest Decode.Value


update : Msg -> () -> ( (), Cmd Msg )
update msg _ =
    case msg of
        GotRequest raw ->
            case Decode.decodeValue commandDecoder raw of
                Ok cmd ->
                    ( (), response (encodeResult (run cmd)) )

                Err err ->
                    ( (), response (Encode.object [ ( "error", Encode.string (Decode.errorToString err) ) ]) )


commandDecoder : Decoder Command
commandDecoder =
    Decode.field "kind" Decode.string
        |> Decode.andThen
            (\kind ->
                Decode.field "spec" specDecoder
                    |> Decode.map
                        (\spec ->
                            case kind of
                                "page" ->
                                    GeneratePage spec

                                "api" ->
                                    GenerateApi spec

                                "resource" ->
                                    GenerateResource spec

                                _ ->
                                    -- fallback
                                    GeneratePage spec
                        )
            )


specDecoder : Decoder RouteSpec
specDecoder =
    Decode.map4 RouteSpec
        (Decode.field "namespace" Decode.string)
        (Decode.field "moduleName" Decode.string)
        (Decode.field "routePath" Decode.string)
        (Decode.field "parts" (Decode.list Decode.string))


encodeResult : String -> Encode.Value
encodeResult content =
    Encode.object [ ( "content", Encode.string content ) ]


-- PURE GENERATORS (the heart of the scaffold - easy to test in Elm!)

run : Command -> String
run cmd =
    case cmd of
        GeneratePage spec ->
            generatePage spec

        GenerateApi spec ->
            generateApi spec

        GenerateResource spec ->
            generateResource spec


generatePage : RouteSpec -> String
generatePage spec =
    let
        last =
            List.head (List.reverse spec.parts) |> Maybe.withDefault "Page"
    in
    """module """ ++ spec.namespace ++ """.Routes.""" ++ spec.moduleName ++ """ exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Form as Form
import ElmSsr.Html exposing (button, div, form, input, p, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
import """ ++ spec.namespace ++ """.View.Shared as Shared

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view

action : Request -> Action (Document Never)
action request =
    case Form.decode messageDecoder request.formData of
        Ok { message } ->
            Action.redirect "/"

        Err _ ->
            Action.fail 422 "Message is required."

messageDecoder : Form.Decoder { message : String }
messageDecoder =
    Form.succeed (\\m -> { message = m })
        |> Form.required "message" (Form.string |> Form.validate Form.nonEmpty)

view : Document Never
view =
    Page.page
        { title = \"""" ++ last ++ """\"
        , head = Shared.head
        , body =
            [ Shared.layout \"""" ++ last ++ """\"
                [ div [ Attr.class "panel" ]
                    [ p [] [ text "A full-stack friendly page. Form validation uses ElmSsr.Form (works in Actions and islands)." ]
                    , form [ Attr.method "post", Attr.action \"""" ++ spec.routePath ++ """\" ]
                        [ input [ Attr.type_ "text", Attr.name "message", Attr.placeholder "Enter something" ]
                        , button [ Attr.type_ "submit" ] [ text "Submit" ]
                        ]
                    ]
                ]
            ]
        }
"""


generateApi : RouteSpec -> String
generateApi spec =
    """module """ ++ spec.namespace ++ """.Routes.""" ++ spec.moduleName ++ """ exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Json.Encode as Encode

page : Request -> Loader (Document Never)
page _ =
    Loader.fail 405 "GET not allowed on this API route"

action : Request -> Action (Document Never)
action request =
    -- Process request and return JSON response using Form or custom logic
    Action.json <|
        Encode.object
            [ ( "ok", Encode.bool True )
            , ( "message", Encode.string "Hello from """ ++ spec.routePath ++ """ API route!" )
            ]
"""


generateResource : RouteSpec -> String
generateResource spec =
    let
        last =
            List.head (List.reverse spec.parts) |> Maybe.withDefault "Resource"
    in
    """module """ ++ spec.namespace ++ """.Routes.""" ++ spec.moduleName ++ """ exposing (page, action)

-- RESOURCE SCAFFOLD (generated with --resource)
-- Uses ElmSsr.Form for shared validation (server + islands) – client and server error paths.
-- Swap in your Elmto / generated Db modules for real data.
-- For DB constraint errors, use Loader.softExecute / softQueryOne and attach to changeset.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Form as Form
import ElmSsr.Html exposing (button, div, form, input, li, text, ul)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
import """ ++ spec.namespace ++ """.View.Shared as Shared

type alias Item =
    { id : Int
    , title : String
    }

page : Request -> Loader (Document Never)
page _ =
    -- TODO: replace with real Loader using Elmto:
    -- Db.select ... |> Db.toLoader
    Loader.succeed (view [])

action : Request -> Action (Document Never)
action request =
    let
        pairs =
            case Route.formValue "title" request of
                Just t -> [ ( "title", t ) ]
                Nothing -> []
    in
    case Form.decode createDecoder pairs of
        Ok { title } ->
            -- TODO:
            -- To handle DB constraint errors (non-optimistic path):
            -- Action.fromLoader (MyDb.insert { title = title } |> Loader.softExecute ...)
            --     |> Action.andThen ...
            -- Action.fromLoader (MyDb.insert { title = title })
            --     |> Action.andThen (\\_ -> Action.redirect \"""" ++ spec.routePath ++ """\")
            Action.redirect \"""" ++ spec.routePath ++ """\"

        Err _ ->
            Action.fail 422 "Title is required."

createDecoder : Form.Decoder { title : String }
createDecoder =
    Form.succeed (\\t -> { title = t })
        |> Form.required "title" (Form.string |> Form.validate Form.nonEmpty)

view : List Item -> Document Never
view items =
    Page.page
        { title = \"""" ++ last ++ """\"
        , head = Shared.head
        , body =
            [ Shared.layout \"""" ++ last ++ """\"
                [ div [ Attr.class "panel" ]
                    [ form [ Attr.method "post", Attr.action \"""" ++ spec.routePath ++ """\" ]
                        [ input [ Attr.name "title", Attr.placeholder "New """ ++ last ++ """ title" ]
                        , button [ Attr.type_ "submit" ] [ text "Create" ]
                        ]
                    , ul [] (List.map (\\i -> li [] [ text i.title ]) items)
                    ]
                ]
            ]
        }
"""


-- For direct use from compiled JS (the values are available on the Elm object)
page : RouteSpec -> String
page =
    generatePage


api : RouteSpec -> String
api =
    generateApi


resource : RouteSpec -> String
resource =
    generateResource
