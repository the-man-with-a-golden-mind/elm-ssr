module ElmSsr.Route exposing
    ( Request
    , segments, method, query
    , param, params
    , formValue
    , env
    , decoder
    )

{-| The incoming request a route is matched against.

Routing is file-based, so you rarely match paths by hand. Instead, dynamic
segments captured from a file name (e.g. `Routes/Posts/Slug_.elm` →
`/posts/:slug`) are available through [`param`](#param).


# Request

@docs Request
@docs segments, method, query


# Dynamic route params

@docs param, params


# Form data

@docs formValue


# Decoding

@docs decoder

-}

import Json.Decode as Decode exposing (Decoder)


{-| Everything the runtime knows about an incoming request.

`params` holds the dynamic segments captured by the generated router; it is
empty for static routes.
-}
type alias Request =
    { method : String
    , path : String
    , query : List ( String, String )
    , params : List ( String, String )
    , formData : List ( String, String )
    , env : List ( String, String )
    }


{-| The path split into non-empty segments.

    -- request.path == "/posts/hello"
    segments request --> [ "posts", "hello" ]

-}
segments : Request -> List String
segments request =
    request.path
        |> String.split "/"
        |> List.filter (not << String.isEmpty)


{-| The HTTP method, uppercased by the runtime (e.g. `"GET"`). -}
method : Request -> String
method request =
    request.method


{-| Look up a query string parameter by name.

    -- request.path == "/search?q=elm"
    query "q" request --> Just "elm"

-}
query : String -> Request -> Maybe String
query key request =
    lookup key request.query


{-| Look up a dynamic route segment by name.

    -- Routes/Posts/Slug_.elm matched against /posts/hello
    param "slug" request --> Just "hello"

-}
param : String -> Request -> Maybe String
param key request =
    lookup key request.params


{-| All captured dynamic segments, as name/value pairs. -}
params : Request -> List ( String, String )
params request =
    request.params


{-| Look up a form value by name. -}
formValue : String -> Request -> Maybe String
formValue key request =
    lookup key request.formData


{-| Look up an environment variable / flag passed to the runtime at startup.

Prefer this over `Loader.env` for configuration constants (e.g. dialect, feature
flags) that are set once at process start, not per-request. Reading from the
request is synchronous and costs no effect round-trip.

    getDialect : Request -> Dialect
    getDialect req =
        case Route.env "DB_DIALECT" req of
            Just "postgres" -> PostgreSQL
            _ -> SQLite

-}
env : String -> Request -> Maybe String
env key request =
    lookup key request.env


lookup : String -> List ( String, String ) -> Maybe String
lookup key pairs =
    pairs
        |> List.filter (\( name, _ ) -> name == key)
        |> List.head
        |> Maybe.map Tuple.second


{-| Decode the request the Worker passes in as flags. Dynamic params are filled
in by the generated router, not by the Worker, so they start empty.
-}
decoder : Decoder Request
decoder =
    Decode.map5
        (\requestMethod path queryPairs formDataPairs envPairs ->
            { method = requestMethod, path = path, query = queryPairs, params = [], formData = formDataPairs, env = envPairs }
        )
        (Decode.oneOf [ Decode.field "method" Decode.string, Decode.succeed "GET" ])
        (Decode.field "path" Decode.string)
        (Decode.oneOf
            [ Decode.field "query" (Decode.keyValuePairs Decode.string)
            , Decode.succeed []
            ]
        )
        (Decode.oneOf
            [ Decode.field "formData" (Decode.keyValuePairs Decode.string)
            , Decode.succeed []
            ]
        )
        (Decode.oneOf
            [ Decode.field "env" (Decode.keyValuePairs Decode.string)
            , Decode.succeed []
            ]
        )
