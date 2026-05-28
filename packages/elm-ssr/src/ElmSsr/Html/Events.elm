module ElmSsr.Html.Events exposing (onChange, onClick, onInput, onSubmit)

{-| Event handlers. Mirrors `elm/html`'s `Html.Events`.

Handlers are bridged by DOM path and event name, not by serializing `Msg`, so
author code stays plain Elm.

@docs onClick, onInput, onChange, onSubmit

-}

import ElmSsr.Html exposing (Attribute(..), EventCapture(..), EventValue(..))


onClick : msg -> Attribute msg
onClick message =
    EventHandler "click" NoEventData (\_ -> message)


onInput : (String -> msg) -> Attribute msg
onInput toMessage =
    EventHandler "input" TargetValue (fromTargetValue toMessage)


onChange : (String -> msg) -> Attribute msg
onChange toMessage =
    EventHandler "change" TargetValue (fromTargetValue toMessage)


onSubmit : msg -> Attribute msg
onSubmit message =
    EventHandler "submit" NoEventData (\_ -> message)


fromTargetValue : (String -> msg) -> EventValue -> msg
fromTargetValue toMessage eventValue =
    case eventValue of
        StringValue currentValue ->
            toMessage currentValue

        NoValue ->
            toMessage ""
