module ElmSsr.Document exposing (Document, map)

import ElmSsr.Html as Html exposing (Node)


type alias Document msg =
    { status : Int
    , lang : String
    , head : List (Node msg)
    , body : List (Node msg)
    }


{-| Reinterpret the message type of a document. Used to lift a stateless
`Document Never` (a page that cannot emit events) into the runtime's message
type via `Document.map never`.
-}
map : (a -> b) -> Document a -> Document b
map fn document =
    { status = document.status
    , lang = document.lang
    , head = List.map (Html.mapNode fn) document.head
    , body = List.map (Html.mapNode fn) document.body
    }
