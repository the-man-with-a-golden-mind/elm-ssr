module ElmSsr.Action exposing
    ( Action
    , succeed, fail, redirect, json
    , Step(..), step, encodeStep
    )

{-| An `Action` describes what should happen in response to a non-GET request
(usually a `POST` form submission).

Like `Loader`, it is a description of work, not a side effect.

# Building actions
@docs Action, succeed, fail, redirect, json

# Runtime interpretation
@docs Step, step, encodeStep
-}

import Json.Decode as Decode
import Json.Encode as Encode


type Action a
    = Done a
    | Failed Int String
    | Redirect String
    | JsonResult Encode.Value


type Step a
    = Resolved a
    | Errored Int String
    | Moved String
    | SentJson Encode.Value


{-| A successful action that resolves to a value. -}
succeed : a -> Action a
succeed =
    Done


{-| Fail an action with an HTTP status and message. -}
fail : Int -> String -> Action a
fail =
    Failed


{-| Redirect the user to a new URL. -}
redirect : String -> Action a
redirect =
    Redirect


{-| Return a JSON response directly. -}
json : Encode.Value -> Action a
json =
    JsonResult


{-| Inspect the next step of an action. -}
step : Action a -> Step a
step action =
    case action of
        Done val ->
            Resolved val

        Failed status message ->
            Errored status message

        Redirect url ->
            Moved url

        JsonResult val ->
            SentJson val


{-| Encode the resolved step for the Worker runtime. -}
encodeStep : (a -> Encode.Value) -> Step a -> Encode.Value
encodeStep encoder step_ =
    case step_ of
        Resolved val ->
            Encode.object
                [ ( "kind", Encode.string "resolved" )
                , ( "value", encoder val )
                ]

        Errored status message ->
            Encode.object
                [ ( "kind", Encode.string "errored" )
                , ( "status", Encode.int status )
                , ( "message", Encode.string message )
                ]

        Moved url ->
            Encode.object
                [ ( "kind", Encode.string "redirect" )
                , ( "url", Encode.string url )
                ]

        SentJson val ->
            Encode.object
                [ ( "kind", Encode.string "json" )
                , ( "value", val )
                ]
