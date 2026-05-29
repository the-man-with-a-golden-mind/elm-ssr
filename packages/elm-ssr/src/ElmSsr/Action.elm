module ElmSsr.Action exposing
    ( Action
    , succeed, fail, redirect, json
    , map, andThen, fromLoader
    , Effect, Step(..), step, encodeStep
    )

{-| An `Action` describes what should happen in response to a non-GET request
(usually a `POST` form submission).

Like `Loader`, it is a description of work, not a side effect: the author
composes it, and the runtime interprets it — running any effects through the
Worker — until it resolves to a document, a redirect, a JSON body, or an error.

A typical form action validates `Route.formValue`s, performs an effect, then
redirects (the Post/Redirect/Get pattern):

    action request =
        case Route.formValue "email" request of
            Nothing ->
                Action.fail 422 "Email is required"

            Just email ->
                Action.fromLoader (saveSubscriber email)
                    |> Action.andThen (\_ -> Action.redirect "/thanks")


# Building actions

@docs Action
@docs succeed, fail, redirect, json
@docs map, andThen, fromLoader


# Runtime interpretation

Used by the elm-ssr runtime to drive an action. Application authors do not need
these.

@docs Effect, Step, step, encodeStep

-}

import ElmSsr.Loader as Loader exposing (Loader)
import Json.Decode as Decode
import Json.Encode as Encode


{-| A description of how to respond to a non-GET request. -}
type Action a
    = Done a
    | Failed Int String
    | Redirect String
    | JsonResult Encode.Value
    | Pending Effect (Decode.Value -> Action a)


{-| A single side effect the Worker runs, addressed by `kind`. Shared with
[`ElmSsr.Loader`](./Loader.elm), so actions reuse the same effect vocabulary. -}
type alias Effect =
    Loader.Effect


{-| An action that resolves to a value with no further work. -}
succeed : a -> Action a
succeed =
    Done


{-| Fail an action with an HTTP status and message. -}
fail : Int -> String -> Action a
fail =
    Failed


{-| Redirect the client to a new URL (303-style Post/Redirect/Get). -}
redirect : String -> Action a
redirect =
    Redirect


{-| Respond with a JSON body directly. -}
json : Encode.Value -> Action a
json =
    JsonResult


{-| Transform the value an action resolves to. -}
map : (a -> b) -> Action a -> Action b
map fn action =
    case action of
        Done value ->
            Done (fn value)

        Failed status message ->
            Failed status message

        Redirect url ->
            Redirect url

        JsonResult value ->
            JsonResult value

        Pending effect continue ->
            Pending effect (\value -> map fn (continue value))


{-| Sequence actions: run a second step that depends on the first's result.
Effects run one after the other, each completing before the next begins. -}
andThen : (a -> Action b) -> Action a -> Action b
andThen fn action =
    case action of
        Done value ->
            fn value

        Failed status message ->
            Failed status message

        Redirect url ->
            Redirect url

        JsonResult value ->
            JsonResult value

        Pending effect continue ->
            Pending effect (\value -> andThen fn (continue value))


{-| Lift a [`Loader`](./Loader.elm) into an action so its effects run as part of
the action. This is how an action does server work (fetch, KV, D1, …) before
deciding how to respond. -}
fromLoader : Loader a -> Action a
fromLoader loader =
    case Loader.step loader of
        Loader.Resolved value ->
            Done value

        Loader.Errored status message ->
            Failed status message

        Loader.Await effect continue ->
            Pending effect (\value -> fromLoader (continue value))


{-| One observable step of an action. The runtime resumes a pending action by
calling the continuation with the effect result. -}
type Step a
    = Resolved a
    | Errored Int String
    | Moved String
    | SentJson Encode.Value
    | Await Effect (Decode.Value -> Action a)


{-| Inspect the next step of an action. -}
step : Action a -> Step a
step action =
    case action of
        Done value ->
            Resolved value

        Failed status message ->
            Errored status message

        Redirect url ->
            Moved url

        JsonResult value ->
            SentJson value

        Pending effect continue ->
            Await effect continue


{-| Encode a terminal step for the Worker runtime. `Await` is never encoded —
the runtime runs its effect first — so it is reported defensively as an error. -}
encodeStep : (a -> Encode.Value) -> Step a -> Encode.Value
encodeStep encoder step_ =
    case step_ of
        Resolved value ->
            Encode.object
                [ ( "kind", Encode.string "resolved" )
                , ( "value", encoder value )
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

        SentJson value ->
            Encode.object
                [ ( "kind", Encode.string "json" )
                , ( "value", value )
                ]

        Await _ _ ->
            Encode.object
                [ ( "kind", Encode.string "errored" )
                , ( "status", Encode.int 500 )
                , ( "message", Encode.string "Action step was not resolved before encoding." )
                ]
