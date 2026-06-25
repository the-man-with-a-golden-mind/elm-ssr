module ElmSsr.Loader exposing
    ( Loader
    , succeed, fail, redirect, requireUser
    , map, map2, andThen
    , fetchJson
    , cacheGet, cachePut
    , query, queryOne, execute, transaction
    , ConstraintError, softExecute, softQueryOne
    , env
    , getCookie
    , enqueue
    , session, csrfToken, setSession, clearSession
    , custom
    , JobId, JobStatus(..), startJob, jobStatus
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


# Custom effects

Escape hatch for emitting a `kind` your own `EffectRunner` adapter handles.
Use this to plug in things the framework does not cover natively — fan-out
SQL with `Promise.all`, external services, vector search, queues. The shape
of `payload` and the decoder for the result are entirely your contract with
your adapter.

@docs custom


# Background jobs

Long-running work that exceeds a single request budget. Submit a job with
[`startJob`](#startJob) (returns an id immediately), poll progress with
[`jobStatus`](#jobStatus). The TS-side `withJobs(runner, { store,
handlers })` adapter persists records and runs handlers via `ctx.waitUntil`.

A typical PRG flow: form action calls `startJob`, redirects to
`/jobs/<id>`, that page polls `jobStatus` (or subscribes via SSE) and
renders progress until `JobDone`.

@docs JobId, JobStatus, startJob, jobStatus


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
    | Redirect String
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


{-| Redirect the browser progressively to a same-origin or external URL. -}
redirect : String -> Loader a
redirect url =
    Redirect url


{-| Require a user session. If missing, redirect to the login path. -}
requireUser : Decoder user -> String -> (user -> Loader a) -> Loader a
requireUser userDecoder loginPath toLoader =
    session userDecoder
        |> andThen
            (\maybeUser ->
                case maybeUser of
                    Just user ->
                        toLoader user

                    Nothing ->
                        redirect loginPath
            )


{-| Transform the value a loader resolves to. -}
map : (a -> b) -> Loader a -> Loader b
map fn loader =
    case loader of
        Done value ->
            Done (fn value)

        Failed status message ->
            Failed status message

        Redirect url ->
            Redirect url

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

        Redirect url ->
            Redirect url

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


{-| A database constraint violation returned as data instead of a hard failure.

`kind` is one of `"unique"`, `"notNull"`, `"foreignKey"`, or `"check"`.
`field` is the column name when the runtime can extract it from the error message.
-}
type alias ConstraintError =
    { kind : String
    , field : Maybe String
    }


constraintErrorDecoder : Decoder ConstraintError
constraintErrorDecoder =
    Decode.map2 ConstraintError
        (Decode.field "kind" Decode.string)
        (Decode.maybe (Decode.field "field" Decode.string))


{-| Like `execute`, but catches database constraint violations and returns them
as `Err ConstraintError` instead of crashing with a 502. Use this inside
`Repo.insert` / `Repo.update` so constraint errors can be attached to the
changeset and surfaced to the user. -}
softExecute : { sql : String, params : List Encode.Value } -> Loader (Result ConstraintError { rowsAffected : Int })
softExecute config =
    Pending
        { kind = "softExecute", payload = sqlPayload config.sql config.params }
        (\result ->
            resumeFetchJson
                (Decode.oneOf
                    [ Decode.map Ok
                        (Decode.map (\n -> { rowsAffected = n })
                            (Decode.field "rowsAffected" Decode.int)
                        )
                    , Decode.map Err
                        (Decode.field "constraintError" constraintErrorDecoder)
                    ]
                )
                result
        )


{-| Like `queryOne`, but catches database constraint violations and returns
them as `Err ConstraintError`. Used for `INSERT … RETURNING *` on PostgreSQL. -}
softQueryOne : { sql : String, params : List Encode.Value, decoder : Decoder a } -> Loader (Result ConstraintError (Maybe a))
softQueryOne config =
    Pending
        { kind = "softQueryOne", payload = sqlPayload config.sql config.params }
        (\result ->
            resumeFetchJson
                (Decode.oneOf
                    [ Decode.map Ok (Decode.nullable config.decoder)
                    , Decode.map Err (Decode.field "constraintError" constraintErrorDecoder)
                    ]
                )
                result
        )


{-| Execute a list of SQL statements atomically in a single DB transaction.
Returns the total `rowsAffected` across all statements. If any statement fails
the entire transaction is rolled back. Requires `sqlTransaction` to be wired in
the effect runner (see `inMemoryEffects` docs). -}
transaction : List { sql : String, params : List Encode.Value } -> Loader Int
transaction stmts =
    Pending
        { kind = "transaction"
        , payload =
            Encode.object
                [ ( "statements"
                  , Encode.list (\s -> sqlPayload s.sql s.params) stmts
                  )
                ]
        }
        (\result -> resumeFetchJson (Decode.field "rowsAffected" Decode.int) result)


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


{-| Emit a custom effect that your TS-side `EffectRunner` handles. The runner
must inspect `effect.kind === <your kind>` and return
`{ ok: true, value: <data> }`; the `decoder` runs against that value.

The common use case is server-side fan-out — run several heavy SQL queries
or external fetches with `Promise.all` inside one effect call, then return a
combined payload so the route only awaits once:

    -- Elm:
    import Json.Decode as Decode

    type alias Dashboard =
        { totals : Int, recent : List Order, byCountry : List CountryStat }

    dashboard : Loader Dashboard
    dashboard =
        Loader.custom
            { kind = "parallelDashboard"
            , payload = Encode.object []
            , decoder = dashboardDecoder
            }

    -- TS adapter (wrap your existing runner):
    const myEffects = async (effect, ctx) => {
      if (effect.kind === "parallelDashboard") {
        const [totals, recent, byCountry] = await Promise.all([
          pg.unsafe("SELECT count(*) AS c FROM orders"),
          pg.unsafe("SELECT * FROM orders ORDER BY created DESC LIMIT 10"),
          pg.unsafe("SELECT country, sum(total) AS s FROM orders GROUP BY 1"),
        ]);
        return { ok: true, value: { totals: totals[0].c, recent, byCountry } };
      }
      return baseRunner(effect, ctx);
    };

See `docs/recipes/parallel-queries.md` for the full pattern.
-}
custom : { kind : String, payload : Encode.Value, decoder : Decoder a } -> Loader a
custom config =
    Pending
        { kind = config.kind, payload = config.payload }
        (\result -> resumeFetchJson config.decoder result)


{-| Opaque handle to a submitted background job. Treat as a string for routing
or storage; the TS-side store assigns it. -}
type alias JobId =
    String


{-| The state of a job as the TS-side `JobStore` sees it. Decoded from the
record by [`jobStatus`](#jobStatus); unknown ids decode as `JobMissing`.

  - `JobQueued` — accepted, not yet running.
  - `JobRunning { progress }` — currently executing; `progress` carries
    whatever the handler last reported (or `Nothing`).
  - `JobDone result` — handler resolved; `result` is the decoded value.
  - `JobFailed { reason }` — handler threw; `reason` is the error message.
  - `JobMissing` — no record under this id (TTL expired, never existed).

-}
type JobStatus a
    = JobQueued
    | JobRunning { progress : Maybe Decode.Value }
    | JobDone a
    | JobFailed { reason : String }
    | JobMissing


{-| Submit a background job. Returns the assigned `JobId` immediately —
the handler runs after the response goes out (via `ctx.waitUntil` on
Cloudflare, fire-and-forget locally).

Pair `kind` with a handler registered in your TS-side
`withJobs(runner, { handlers })`. `payload` is your handler's input;
decoder for the result is on [`jobStatus`](#jobStatus).

    submit : Action (Document Never)
    submit =
        Action.fromLoader
            (Loader.startJob
                { kind = "generateReport"
                , payload = Encode.object [ ( "month", Encode.string "2026-05" ) ]
                }
            )
            |> Action.andThen (\id -> Action.redirect ("/reports/" ++ id))

-}
startJob : { kind : String, payload : Encode.Value } -> Loader JobId
startJob config =
    Pending
        { kind = "startJob"
        , payload =
            Encode.object
                [ ( "kind", Encode.string config.kind )
                , ( "payload", config.payload )
                ]
        }
        (\result -> resumeFetchJson Decode.string result)


{-| Read the current state of a submitted job. Decoded into [`JobStatus`](#JobStatus).
The result decoder runs against the handler's return value when `status === "done"`.

    statusLoader : JobId -> Loader (JobStatus Report)
    statusLoader id =
        Loader.jobStatus { jobId = id, decoder = reportDecoder }

-}
jobStatus : { jobId : JobId, decoder : Decoder a } -> Loader (JobStatus a)
jobStatus config =
    Pending
        { kind = "jobStatus"
        , payload = Encode.object [ ( "jobId", Encode.string config.jobId ) ]
        }
        (\result -> resumeFetchJson (jobStatusDecoder config.decoder) result)


jobStatusDecoder : Decoder a -> Decoder (JobStatus a)
jobStatusDecoder resultDecoder =
    Decode.oneOf
        [ Decode.null JobMissing
        , Decode.field "status" Decode.string
            |> Decode.andThen
                (\status ->
                    case status of
                        "queued" ->
                            Decode.succeed JobQueued

                        "running" ->
                            Decode.map (\progress -> JobRunning { progress = progress })
                                (Decode.maybe (Decode.field "progress" Decode.value))

                        "done" ->
                            Decode.map JobDone (Decode.field "result" resultDecoder)

                        "failed" ->
                            Decode.map (\reason -> JobFailed { reason = reason })
                                (Decode.oneOf
                                    [ Decode.field "error" Decode.string
                                    , Decode.succeed "Job failed without a message"
                                    ]
                                )

                        other ->
                            Decode.fail ("Unknown job status: " ++ other)
                )
        ]


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
    | Moved String
    | Await Effect (Decode.Value -> Loader a)


{-| Inspect the next step of a loader. -}
step : Loader a -> Step a
step loader =
    case loader of
        Done value ->
            Resolved value

        Failed status message ->
            Errored status message

        Redirect url ->
            Moved url

        Pending effect continue ->
            Await effect continue


{-| Encode an effect as the JSON request the Worker receives. -}
encodeEffect : Effect -> Encode.Value
encodeEffect effect =
    Encode.object
        [ ( "kind", Encode.string effect.kind )
        , ( "payload", effect.payload )
        ]
