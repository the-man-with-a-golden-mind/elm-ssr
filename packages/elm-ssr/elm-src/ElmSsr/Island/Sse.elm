port module ElmSsr.Island.Sse exposing
    ( Event, Error(..)
    , open, close
    , events, errors, match
    )

{-| Server-Sent Events subscription for islands.

The browser opens an `EventSource` per URL; the Worker streams
`text/event-stream` from a route built with `createSseStream` (see the
TS-side `elm-ssr/sse` subpath). Multiple subscriptions to the same URL share
a single underlying connection.

Lifecycle:
  - Open the stream in `init` (or any `update` branch) with [`open url`](#open).
  - Receive raw frames via [`events`](#events) in `subscriptions`; route them
    by URL with [`match`](#match) plus your decoder.
  - Optionally observe connection errors via [`errors`](#errors).
  - Close with [`close url`](#close) when you no longer need the stream;
    SPA navigation closes them automatically for non-persistent islands.

A minimal island:

    type Msg
        = GotEvent Event
        | NoOp


    init flags =
        ( { time = "" }, Sse.open "/__elm-ssr/live" )


    subscriptions _ =
        Sse.events GotEvent


    update msg model =
        case msg of
            GotEvent event ->
                case Sse.match "/__elm-ssr/live" tickDecoder event of
                    Just (Ok tick) ->
                        ( { model | time = tick.time }, Cmd.none )

                    _ ->
                        ( model, Cmd.none )

            NoOp ->
                ( model, Cmd.none )


# Types

@docs Event, Error


# Opening and closing

@docs open, close


# Receiving

@docs events, errors, match

-}

import Json.Decode as Decode exposing (Decoder)


{-| A raw SSE message. `data` is the unparsed string payload — use
[`match`](#match) plus a decoder to turn it into a typed value.
-}
type alias Event =
    { url : String, data : String }


{-| Why an SSE callback might fail. -}
type Error
    = DecodeError String
    | NetworkError String


port sseOpen : String -> Cmd msg


port sseClose : String -> Cmd msg


port sseEventIn : (Event -> msg) -> Sub msg


port sseErrorIn : ({ url : String, message : String } -> msg) -> Sub msg


{-| Open (or reuse) an SSE connection to a URL. Idempotent — opening the same
URL twice does not open a second connection. -}
open : String -> Cmd msg
open url =
    sseOpen url


{-| Close the SSE connection for a URL. Idempotent. -}
close : String -> Cmd msg
close url =
    sseClose url


{-| Subscribe to every SSE message across every open stream. Filter by URL in
your `update` (the [`match`](#match) helper is the convenient way). -}
events : (Event -> msg) -> Sub msg
events toMsg =
    sseEventIn toMsg


{-| Subscribe to connection errors (`onerror` events from `EventSource`).
The browser auto-reconnects after these — this is informational. -}
errors : ({ url : String, message : String } -> msg) -> Sub msg
errors toMsg =
    sseErrorIn toMsg


{-| If this event is for `url`, decode its `data` with `decoder`. Returns
`Nothing` for a different URL so the caller can `Maybe`-pattern-match in
`update` without nested `case`s.

    update msg model =
        case msg of
            GotEvent event ->
                case Sse.match "/__elm-ssr/live" tickDecoder event of
                    Just (Ok tick) ->
                        ( { model | tick = tick }, Cmd.none )

                    Just (Err _) ->
                        ( model, Cmd.none )

                    Nothing ->
                        ( model, Cmd.none )

-}
match : String -> Decoder a -> Event -> Maybe (Result Error a)
match url decoder event =
    if event.url == url then
        case Decode.decodeString decoder event.data of
            Ok value ->
                Just (Ok value)

            Err err ->
                Just (Err (DecodeError (Decode.errorToString err)))

    else
        Nothing
