module ElmSsr.Loader exposing
    ( Loader
    , succeed, fail
    , map, map2, andThen
    , fetchJson
    , cacheGet, cachePut
    , query, queryOne, execute
    , env
    , getCookie
    , enqueue
    , session, csrfToken, setSession, clearSession
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
@docs cacheGet, cachePut
@docs query, queryOne, execute
@docs env
@docs getCookie
@docs enqueue


# Sessions

These require the TS-side `sessionMiddleware` + `sessionEffects(runner)` to be
wired in the Worker. Without them the effects fail with a clear message at
request time.

@docs session, csrfToken, setSession, clearSession


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


{-| Read a value from the cache, or `Nothing` on a miss. Backend-neutral: the
runner maps it to Cloudflare KV, Redis locally, etc. -}
cacheGet : { key : String, decoder : Decoder a } -> Loader (Maybe a)
cacheGet config =
    Pending
        { kind = "cacheGet"
        , payload = Encode.object [ ( "key", Encode.string config.key ) ]
        }
        (\result -> resumeFetchJson (Decode.nullable config.decoder) result)


{-| Write a value to the cache, with an optional TTL in seconds. -}
cachePut : { key : String, value : Encode.Value, ttlSeconds : Maybe Int } -> Loader ()
cachePut config =
    let
        fields =
            [ ( "key", Encode.string config.key ), ( "value", config.value ) ]
                ++ (case config.ttlSeconds of
                        Just ttl ->
                            [ ( "ttlSeconds", Encode.int ttl ) ]

                        Nothing ->
                            []
                   )
    in
    Pending
        { kind = "cachePut", payload = Encode.object fields }
        (\_ -> Done ())


{-| Run a SQL query and decode every row. Backend-neutral: the runner maps it to
Cloudflare D1, Postgres/SQLite locally, etc. Use `?` placeholders with `params`. -}
query : { sql : String, params : List Encode.Value, decoder : Decoder a } -> Loader (List a)
query config =
    Pending
        { kind = "query", payload = sqlPayload config.sql config.params }
        (\result -> resumeFetchJson (Decode.list config.decoder) result)


{-| Run a SQL query and decode only the first row, if any. -}
queryOne : { sql : String, params : List Encode.Value, decoder : Decoder a } -> Loader (Maybe a)
queryOne config =
    Pending
        { kind = "queryOne", payload = sqlPayload config.sql config.params }
        (\result -> resumeFetchJson (Decode.nullable config.decoder) result)


{-| Execute a statement (INSERT/UPDATE/DELETE) and return the number of rows
affected. Typically used by an `Action` via `Action.fromLoader`. -}
execute : { sql : String, params : List Encode.Value } -> Loader { rowsAffected : Int }
execute config =
    Pending
        { kind = "execute", payload = sqlPayload config.sql config.params }
        (\result ->
            resumeFetchJson
                (Decode.map (\rows -> { rowsAffected = rows }) (Decode.field "rowsAffected" Decode.int))
                result
        )


{-| Read an environment variable / secret / binding name. -}
env : String -> Loader (Maybe String)
env name =
    Pending
        { kind = "env", payload = Encode.object [ ( "name", Encode.string name ) ]
        }
        (\result -> resumeFetchJson (Decode.nullable Decode.string) result)


{-| Read a cookie from the incoming request by name. Returns `Nothing` if the
cookie is not present (or no `Cookie` header was sent).

    sessionToken : Loader (Maybe String)
    sessionToken =
        Loader.getCookie "session"

The Worker parses the `Cookie` header for you. To *set* a cookie on the
response, use `ElmSsr.Action.setCookie` from inside an `Action`.
-}
getCookie : String -> Loader (Maybe String)
getCookie name =
    Pending
        { kind = "cookie", payload = Encode.object [ ( "name", Encode.string name ) ]
        }
        (\result -> resumeFetchJson (Decode.nullable Decode.string) result)


{-| Enqueue a background task to run after the response (fire-and-forget). The
named handler lives in the Worker's task adapter; the request does not wait for
it. Typically used from an `Action` via `Action.fromLoader`. -}
enqueue : { task : String, payload : Encode.Value } -> Loader ()
enqueue config =
    Pending
        { kind = "enqueue"
        , payload =
            Encode.object
                [ ( "task", Encode.string config.task )
                , ( "payload", config.payload )
                ]
        }
        (\result -> resumeFetchJson (Decode.succeed ()) result)


{-| Read the current session payload (whatever was last `setSession`-ed) and
decode it. Returns `Nothing` when the session is empty.

    type alias User = { id : String, email : String }

    currentUser : Loader (Maybe User)
    currentUser =
        Loader.session userDecoder

-}
session : Decoder a -> Loader (Maybe a)
session decoder =
    Pending
        { kind = "session", payload = Encode.object [] }
        (\result -> resumeFetchJson (Decode.nullable decoder) result)


{-| Read the current request's CSRF token. Embed it in form submissions
(hidden input named `_csrf`) or in an `X-CSRF-Token` header on `fetch`. The
TS-side `csrfMiddleware` checks the match on POST/PUT/PATCH/DELETE.
-}
csrfToken : Loader (Maybe String)
csrfToken =
    Pending
        { kind = "csrfToken", payload = Encode.object [] }
        (\result -> resumeFetchJson (Decode.nullable Decode.string) result)


{-| Replace the current session payload. Typically used from an `Action` via
`Action.fromLoader` after authenticating. The middleware persists and rolls
the signed cookie on the response.

    Action.fromLoader (Loader.setSession (encodeUser user))
        |> Action.andThen (\_ -> Action.redirect "/dashboard")

-}
setSession : Encode.Value -> Loader ()
setSession value =
    Pending
        { kind = "setSession"
        , payload = Encode.object [ ( "value", value ) ]
        }
        (\_ -> Done ())


{-| Destroy the current session. The middleware deletes the record from the
store and clears the signed cookie on the response.

    Action.fromLoader Loader.clearSession
        |> Action.andThen (\_ -> Action.redirect "/")

-}
clearSession : Loader ()
clearSession =
    Pending
        { kind = "clearSession", payload = Encode.object [] }
        (\_ -> Done ())


sqlPayload : String -> List Encode.Value -> Encode.Value
sqlPayload sql params =
    Encode.object
        [ ( "sql", Encode.string sql )
        , ( "params", Encode.list identity params )
        ]


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
