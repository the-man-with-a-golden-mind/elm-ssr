module Example.Basic.Islands.Tasks exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import Html exposing (Html, button, div, input, li, span, text, ul)
import Html.Attributes exposing (class, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import Html.Keyed as Keyed
import Json.Encode as Encode


type alias Flags =
    { items : List String
    }


type alias Item =
    { id : Int
    , label : String
    , note : String
    }


type alias Model =
    { items : List Item
    }


type Msg
    = Remove Int
    | MoveUp Int
    | UpdateNote Int String


embed : Flags -> Node msg
embed =
    Island.embed "Tasks"
        { encodeFlags = encodeFlags
        , fallback = fallback
        }


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object [ ( "items", Encode.list Encode.string flags.items ) ]


fallback : Flags -> List (Node msg)
fallback flags =
    [ SsrHtml.div [ SsrAttributes.class "tasks-island fallback" ]
        [ SsrHtml.ul [ SsrAttributes.class "tasks-list" ]
            (List.map
                (\label ->
                    SsrHtml.li [ SsrAttributes.class "task-item" ]
                        [ SsrHtml.span [ SsrAttributes.class "task-label" ] [ SsrHtml.text label ] ]
                )
                flags.items
            )
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
    ( { items = List.indexedMap (\index label -> { id = index, label = label, note = "" }) flags.items }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Remove id ->
            ( { model | items = List.filter (\item -> item.id /= id) model.items }, Cmd.none )

        MoveUp id ->
            ( { model | items = moveUp id model.items }, Cmd.none )

        UpdateNote id note ->
            ( { model | items = List.map (updateNote id note) model.items }, Cmd.none )


updateNote : Int -> String -> Item -> Item
updateNote id note item =
    if item.id == id then
        { item | note = note }

    else
        item


moveUp : Int -> List Item -> List Item
moveUp id items =
    case items of
        first :: second :: rest ->
            if second.id == id then
                second :: first :: rest

            else
                first :: moveUp id (second :: rest)

        _ ->
            items


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ class "tasks-island" ]
        [ Keyed.ul [ class "tasks-list" ] (List.map viewItem model.items) ]


viewItem : Item -> ( String, Html Msg )
viewItem item =
    ( String.fromInt item.id
    , li [ class "task-item" ]
        [ span [ class "task-label" ] [ text item.label ]
        , input
            [ class "task-note"
            , type_ "text"
            , placeholder "note (kept across moves)"
            , value item.note
            , onInput (UpdateNote item.id)
            ]
            []
        , button [ class "task-up", type_ "button", onClick (MoveUp item.id) ] [ text "↑" ]
        , button [ class "task-remove", type_ "button", onClick (Remove item.id) ] [ text "remove" ]
        ]
    )
