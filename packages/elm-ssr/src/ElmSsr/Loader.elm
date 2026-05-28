module ElmSsr.Loader exposing
    ( Loader
    , succeed, fail
    , map, map2, andThen
    , fetchJson
    , Effect, Step(..), step, encodeEffect
    )

{-| A `Loader` describes the data a route needs before it can render.

It is a plain description, not a side effect. The author composes loaders with
`succeed`, `map`, `andThen`, and effect helpers like `fetchJson`; the elm-ssr
runtime interprets the description, asking the Worker to run the real IO and
feeding results back until the loader resolves.

This means loaders run on the server only, never touch ports by hand, and stay
fully typed end to end.


# Building loaders

@docs Loader
@docs succeed, fail
@docs map, map2, andThen
@docs fetchJson


# Runtime interpretation

These are used by the elm-ssr runtime to drive a loader. Application authors do
not need them.

@docs Effect, Step, step, encodeEffect

-}

import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode


{-| A description of how to produce a value of type `a` on the server. -}
type Loader a
    = Done a
    | Failed Int String
    | Pending Effect (Decode.Value -> Loader a)


{-| A single side effect the Worker knows how to run, addressed by `kind`. -}
type alias Effect =
    { kind : String
    , payload : Encode.Value
    }


{-| A loader that needs no work and resolves immediately. -}
succeed : a -> Loader a
succeed value =
    Done value


{-| Abort a load with an HTTP status and message. The runtime renders an error
response instead of the page.
-}
fail : Int -> String -> Loader a
fail status message =
    Failed status message


{-| Transform the value a loader resolves to. -}
map : (a -> b) -> Loader a -> Loader b
map fn loader =
    case loader of
        Done value ->
            Done (fn value)

        Failed status message ->
            Failed status message

        Pending effect continue ->
            Pending effect (\value -> map fn (continue value))


{-| Run a second loader that depends on the first loader's result. Loaders run
sequentially, so each effect completes before the next begins.
-}
andThen : (a -> Loader b) -> Loader a -> Loader b
andThen fn loader =
    case loader of
        Done value ->
            fn value

        Failed status message ->
            Failed status message

        Pending effect continue ->
            Pending effect (\value -> andThen fn (continue value))


{-| Combine two loaders. They run one after the other. -}
map2 : (a -> b -> c) -> Loader a -> Loader b -> Loader c
map2 fn first second =
    first |> andThen (\a -> map (fn a) second)


{-| Fetch a URL and decode its JSON body into a value.

    type alias Status =
        { uptime : String }

    statusLoader : Loader Status
    statusLoader =
        fetchJson
            { url = "https://api.example.com/status"
            , decoder =
                Decode.map Status (Decode.field "uptime" Decode.string)
            }

The Worker performs the actual `fetch`. A non-2xx response or a decode mismatch
fails the loader with a `502`.
-}
fetchJson : { url : String, decoder : Decoder a } -> Loader a
fetchJson config =
    Pending
        { kind = "fetchJson"
        , payload = Encode.object [ ( "url", Encode.string config.url ) ]
        }
        (\result -> resumeFetchJson config.decoder result)


resumeFetchJson : Decoder a -> Decode.Value -> Loader a
resumeFetchJson decoder result =
    case Decode.decodeValue effectOutcomeDecoder result of
        Ok (Ok body) ->
            case Decode.decodeValue decoder body of
                Ok value ->
                    Done value

                Err decodeError ->
                    Failed 502 ("Loader response did not match decoder: " ++ Decode.errorToString decodeError)

        Ok (Err message) ->
            Failed 502 message

        Err decodeError ->
            Failed 500 ("Malformed loader effect result: " ++ Decode.errorToString decodeError)


effectOutcomeDecoder : Decoder (Result String Decode.Value)
effectOutcomeDecoder =
    Decode.field "ok" Decode.bool
        |> Decode.andThen
            (\ok ->
                if ok then
                    Decode.map Ok (Decode.field "value" Decode.value)

                else
                    Decode.map Err
                        (Decode.oneOf
                            [ Decode.field "error" Decode.string
                            , Decode.succeed "Loader effect failed"
                            ]
                        )
            )


{-| One observable step of a loader: it is done, it failed, or it is waiting on
an effect. The runtime resumes a pending loader by calling the continuation with
the effect result.
-}
type Step a
    = Resolved a
    | Errored Int String
    | Await Effect (Decode.Value -> Loader a)


{-| Inspect the next step of a loader. -}
step : Loader a -> Step a
step loader =
    case loader of
        Done value ->
            Resolved value

        Failed status message ->
            Errored status message

        Pending effect continue ->
            Await effect continue


{-| Encode an effect as the JSON request the Worker receives. -}
encodeEffect : Effect -> Encode.Value
encodeEffect effect =
    Encode.object
        [ ( "kind", Encode.string effect.kind )
        , ( "payload", effect.payload )
        ]
