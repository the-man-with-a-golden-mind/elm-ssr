port module ElmSsr.Island.Shared exposing (GlobalEvent, broadcast, listen)

{-| Standardized ports for cross-island communication.

Islands are isolated by default. Use these functions to communicate across island
boundaries using the browser's global event bus.

@docs GlobalEvent, broadcast, listen
-}

import Json.Encode exposing (Value)


{-| A message captured from the global event bus. -}
type alias GlobalEvent =
    { tag : String
    , payload : Value
    }


port broadcastOut : GlobalEvent -> Cmd msg


port broadcastIn : (GlobalEvent -> msg) -> Sub msg


{-| Send a message to all other islands. -}
broadcast : String -> Value -> Cmd msg
broadcast tag payload =
    broadcastOut { tag = tag, payload = payload }


{-| Subscribe to the global event bus. You should filter by `tag` in your `update`
function to ignore messages intended for other components.
-}
listen : (GlobalEvent -> msg) -> Sub msg
listen =
    broadcastIn
