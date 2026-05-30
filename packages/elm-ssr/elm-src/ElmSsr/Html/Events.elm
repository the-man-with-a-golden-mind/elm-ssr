module ElmSsr.Html.Events exposing
    ( onClick, onDoubleClick
    , onMouseDown, onMouseUp, onMouseEnter, onMouseLeave, onMouseOver, onMouseOut
    , onInput, onChange, onSubmit
    , onBlur, onFocus
    )

{-| Event handlers. Mirrors `elm/html`'s `Html.Events`.

Handlers are bridged by DOM path and event name, not by serializing `Msg`, so
author code stays plain Elm.

@docs onClick, onDoubleClick
@docs onMouseDown, onMouseUp, onMouseEnter, onMouseLeave, onMouseOver, onMouseOut
@docs onInput, onChange, onSubmit
@docs onBlur, onFocus

-}

import ElmSsr.Html exposing (Attribute(..), EventCapture(..), EventValue(..))


onClick : msg -> Attribute msg
onClick message =
    EventHandler "click" NoEventData (\_ -> message)


onDoubleClick : msg -> Attribute msg
onDoubleClick message =
    EventHandler "dblclick" NoEventData (\_ -> message)


onMouseDown : msg -> Attribute msg
onMouseDown message =
    EventHandler "mousedown" NoEventData (\_ -> message)


onMouseUp : msg -> Attribute msg
onMouseUp message =
    EventHandler "mouseup" NoEventData (\_ -> message)


onMouseEnter : msg -> Attribute msg
onMouseEnter message =
    EventHandler "mouseenter" NoEventData (\_ -> message)


onMouseLeave : msg -> Attribute msg
onMouseLeave message =
    EventHandler "mouseleave" NoEventData (\_ -> message)


onMouseOver : msg -> Attribute msg
onMouseOver message =
    EventHandler "mouseover" NoEventData (\_ -> message)


onMouseOut : msg -> Attribute msg
onMouseOut message =
    EventHandler "mouseout" NoEventData (\_ -> message)


onInput : (String -> msg) -> Attribute msg
onInput toMessage =
    EventHandler "input" TargetValue (fromTargetValue toMessage)


onChange : (String -> msg) -> Attribute msg
onChange toMessage =
    EventHandler "change" TargetValue (fromTargetValue toMessage)


onSubmit : msg -> Attribute msg
onSubmit message =
    EventHandler "submit" NoEventData (\_ -> message)


onBlur : msg -> Attribute msg
onBlur message =
    EventHandler "blur" NoEventData (\_ -> message)


onFocus : msg -> Attribute msg
onFocus message =
    EventHandler "focus" NoEventData (\_ -> message)


fromTargetValue : (String -> msg) -> EventValue -> msg
fromTargetValue toMessage eventValue =
    case eventValue of
        StringValue currentValue ->
            toMessage currentValue

        NoValue ->
            toMessage ""
