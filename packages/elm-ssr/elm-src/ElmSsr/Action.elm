module ElmSsr.Action exposing
    ( Action
    , succeed, fail, redirect, json, requireUser
    , map, andThen, fromLoader
    , Cookie, SameSite(..), setCookie, clearCookie, defaultCookie, sessionCookie
    , Effect, Step(..), step, collectCookies, encodeStep, encodeCookies
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


# Cookies

Attach `Set-Cookie` headers to any action's response (including redirects and
JSON responses). The Worker serializes the attributes for you.

@docs Cookie, SameSite, setCookie, clearCookie, defaultCookie, sessionCookie


# Runtime interpretation

Used by the elm-ssr runtime to drive an action. Application authors do not need
these.

@docs Effect, Step, step, collectCookies, encodeStep, encodeCookies

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
    | WithCookies (List Cookie) (Action a)


{-| A single side effect the Worker runs, addressed by `kind`. Shared with
[`ElmSsr.Loader`](./Loader.elm), so actions reuse the same effect vocabulary. -}
type alias Effect =
    Loader.Effect


{-| `SameSite` policy for a cookie. Maps to the `SameSite=` attribute. -}
type SameSite
    = Lax
    | Strict
    | None


{-| A cookie to attach to the response. Build one with
[`defaultCookie`](#defaultCookie) and override the attributes you care about.
-}
type alias Cookie =
    { name : String
    , value : String
    , maxAge : Maybe Int
    , expires : Maybe String
    , domain : Maybe String
    , path : Maybe String
    , secure : Bool
    , httpOnly : Bool
    , sameSite : Maybe SameSite
    }


{-| A cookie with sensible defaults: `path=/`, no other attributes set. Override
fields with record update syntax.

    Action.setCookie
        { defaultCookie "session" sessionId | httpOnly = True, secure = True, maxAge = Just (60 * 60 * 24 * 7) }
        (Action.redirect "/dashboard")

-}
defaultCookie : String -> String -> Cookie
defaultCookie name value =
    { name = name
    , value = value
    , maxAge = Nothing
    , expires = Nothing
    , domain = Nothing
    , path = Just "/"
    , secure = False
    , httpOnly = False
    , sameSite = Nothing
    }


{-| A cookie hardened for session use: `HttpOnly` (JS can't read it),
`Secure` (HTTPS-only), `SameSite=Lax` (sent on top-level navigations,
blocked on cross-site sub-requests), `Path=/`, and a 7-day `Max-Age`.

Use this for anything that grants authority — session IDs, auth tokens —
and override only what you need.

    Action.redirect "/dashboard"
        |> Action.setCookie (Action.sessionCookie "session" sessionId)

To use a stricter `SameSite=Strict`, or shorter/longer lifetime:

    Action.sessionCookie "session" sid
        |> (\c -> { c | sameSite = Just Action.Strict, maxAge = Just (60 * 30) })
        |> (\c -> Action.setCookie c (Action.redirect "/dashboard"))

If you are testing locally over plain HTTP, you'll need to set `secure = False`
on the cookie — modern browsers ignore `Secure` cookies on `http://`.

-}
sessionCookie : String -> String -> Cookie
sessionCookie name value =
    { name = name
    , value = value
    , maxAge = Just (60 * 60 * 24 * 7)
    , expires = Nothing
    , domain = Nothing
    , path = Just "/"
    , secure = True
    , httpOnly = True
    , sameSite = Just Lax
    }


{-| Attach a `Set-Cookie` header to the action's response. Stackable — call
multiple times to set multiple cookies. Works with any terminal step (success,
fail, redirect, JSON) and is preserved through `map`/`andThen`.

    Action.fromLoader (createSession email)
        |> Action.andThen
            (\sessionId ->
                Action.redirect "/dashboard"
                    |> Action.setCookie
                        ({ defaultCookie "session" sessionId
                            | httpOnly = True
                            , secure = True
                            , sameSite = Just Lax
                            , maxAge = Just (60 * 60 * 24 * 7)
                         })
            )

-}
setCookie : Cookie -> Action a -> Action a
setCookie cookie action =
    case action of
        WithCookies cookies inner ->
            WithCookies (cookies ++ [ cookie ]) inner

        _ ->
            WithCookies [ cookie ] action


{-| Clear a cookie by setting `Max-Age=0`. Honors the same `path`/`domain` you
used to set it — pass them in if you scoped the original cookie that way.

    Action.redirect "/login"
        |> Action.clearCookie { name = "session", path = Just "/", domain = Nothing }

-}
clearCookie : { name : String, path : Maybe String, domain : Maybe String } -> Action a -> Action a
clearCookie config action =
    setCookie
        { name = config.name
        , value = ""
        , maxAge = Just 0
        , expires = Nothing
        , domain = config.domain
        , path = config.path
        , secure = False
        , httpOnly = False
        , sameSite = Nothing
        }
        action


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


{-| Require a user session for an action. If missing, redirect to the login path. -}
requireUser : Decode.Decoder user -> String -> (user -> Action a) -> Action a
requireUser userDecoder loginPath toAction =
    fromLoader (Loader.session userDecoder)
        |> andThen
            (\maybeUser ->
                case maybeUser of
                    Just user ->
                        toAction user

                    Nothing ->
                        redirect loginPath
            )


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

        WithCookies cookies inner ->
            WithCookies cookies (map fn inner)


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

        WithCookies cookies inner ->
            WithCookies cookies (andThen fn inner)


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

        Loader.Moved url ->
            Redirect url

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


{-| Inspect the next step of an action. `WithCookies` wrappers are skipped —
use [`collectCookies`](#collectCookies) first if you need the attached cookies.
-}
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

        WithCookies _ inner ->
            step inner


{-| Strip the top-level `WithCookies` wrappers and return the accumulated
cookies plus the unwrapped action. Used by the runtime so terminal steps can
carry `Set-Cookie` headers.
-}
collectCookies : Action a -> ( List Cookie, Action a )
collectCookies action =
    case action of
        WithCookies cookies inner ->
            let
                ( more, base ) =
                    collectCookies inner
            in
            ( cookies ++ more, base )

        _ ->
            ( [], action )


{-| JSON-encode a list of cookies in the shape the Worker runtime expects.
Used internally; exposed for cases that build a terminal response by hand
(e.g. error responses from the runtime). -}
encodeCookies : List Cookie -> Encode.Value
encodeCookies cookies =
    Encode.list encodeCookie cookies


{-| Encode a terminal step plus any attached `Set-Cookie`s for the Worker
runtime. `Await` is never encoded — the runtime runs its effect first — so it
is reported defensively as an error. -}
encodeStep : List Cookie -> (a -> Encode.Value) -> Step a -> Encode.Value
encodeStep cookies encoder step_ =
    let
        cookieField =
            ( "cookies", encodeCookies cookies )
    in
    case step_ of
        Resolved value ->
            Encode.object
                [ ( "kind", Encode.string "resolved" )
                , ( "value", encoder value )
                , cookieField
                ]

        Errored status message ->
            Encode.object
                [ ( "kind", Encode.string "errored" )
                , ( "status", Encode.int status )
                , ( "message", Encode.string message )
                , cookieField
                ]

        Moved url ->
            Encode.object
                [ ( "kind", Encode.string "redirect" )
                , ( "url", Encode.string url )
                , cookieField
                ]

        SentJson value ->
            Encode.object
                [ ( "kind", Encode.string "json" )
                , ( "value", value )
                , cookieField
                ]

        Await _ _ ->
            Encode.object
                [ ( "kind", Encode.string "errored" )
                , ( "status", Encode.int 500 )
                , ( "message", Encode.string "Action step was not resolved before encoding." )
                , cookieField
                ]


encodeCookie : Cookie -> Encode.Value
encodeCookie cookie =
    Encode.object
        [ ( "name", Encode.string cookie.name )
        , ( "value", Encode.string cookie.value )
        , ( "maxAge", encodeMaybe Encode.int cookie.maxAge )
        , ( "expires", encodeMaybe Encode.string cookie.expires )
        , ( "domain", encodeMaybe Encode.string cookie.domain )
        , ( "path", encodeMaybe Encode.string cookie.path )
        , ( "secure", Encode.bool cookie.secure )
        , ( "httpOnly", Encode.bool cookie.httpOnly )
        , ( "sameSite", encodeMaybe encodeSameSite cookie.sameSite )
        ]


encodeMaybe : (a -> Encode.Value) -> Maybe a -> Encode.Value
encodeMaybe encoder value =
    case value of
        Just inner ->
            encoder inner

        Nothing ->
            Encode.null


encodeSameSite : SameSite -> Encode.Value
encodeSameSite sameSite =
    case sameSite of
        Lax ->
            Encode.string "lax"

        Strict ->
            Encode.string "strict"

        None ->
            Encode.string "none"
