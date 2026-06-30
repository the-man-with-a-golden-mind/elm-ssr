# ElmSsr.Form (and Request.Decode)

**Use `ElmSsr.Form`** for type-safe form validation that works on the server (in `Action`s and `Loader`s) **and** in client islands.

It is a pure decoder with `Form.decode decoder pairs` (pairs from `Route.formValue` or model state).

`Request.Decode` is a thin layer on top for backwards compat with the full `Request`.

The CLI `elm-ssr route --resource` and basic route scaffolds now generate examples using `Form`.

See also the scaffolded routes for live examples.

## Quick example

```elm
import ElmSsr.Request.Decode as Decode


type alias SignupData =
    { email : String
    , age   : Int
    , newsletter : Bool
    }


signupDecoder : Decode.Decoder SignupData
signupDecoder =
    Decode.succeed SignupData
        |> Decode.required "email"
            (Decode.string |> Decode.validate Decode.email)
        |> Decode.required "age"
            (Decode.int |> Decode.validate (Decode.minInt 18))
        |> Decode.optionalWithDefault "newsletter" False Decode.bool


action : Request -> Action (Document Never)
action request =
    case Decode.decodeForm signupDecoder request of
        Ok data ->
            Action.fromLoader (saveSignup data)
                |> Action.andThen (\_ -> Action.redirect "/thanks")

        Err errors ->
            -- Redirect back with all errors encoded in the query string.
            let
                query =
                    errors
                        |> List.map (\e -> "err_" ++ e.field ++ "=" ++ e.message)
                        |> String.join "&"
            in
            Action.redirect ("/signup?" ++ query)
```

All errors are collected before `Err` is returned — submitting a form with
three invalid fields gives three errors at once, not one at a time.

## Running a decoder

Four runners; pick the source to decode from:

```elm
-- POST body (application/x-www-form-urlencoded or JSON with string values)
Decode.decodeForm   : Decoder a -> Request -> Result (List Error) a

-- Query string (?foo=bar)
Decode.decodeQuery  : Decoder a -> Request -> Result (List Error) a

-- Dynamic route params (/posts/:slug)
Decode.decodeParams : Decoder a -> Request -> Result (List Error) a

-- Arbitrary key-value list (for testing / composition)
Decode.decodeRaw    : Decoder a -> List ( String, String ) -> Result (List Error) a
```

Each returns `Result (List Error) a`.  `Error` is:

```elm
type alias Error =
    { field   : String
    , message : String
    }
```

## Building a decoder

### Pipeline-style (most common)

```elm
Decode.succeed MyRecord
    |> Decode.required          "fieldName" fieldDecoder
    |> Decode.optional          "optField"  fieldDecoder    -- → Maybe a
    |> Decode.optionalWithDefault "flag"    False Decode.bool
```

- **`required`** — field must be present and valid; missing or invalid adds an error.
- **`optional`** — absent or empty string becomes `Nothing`; invalid value still adds an error.
- **`optionalWithDefault`** — absent or empty becomes the default value; invalid still errors.

### Field decoders

```elm
Decode.string  : FieldDecoder String   -- any non-null string
Decode.int     : FieldDecoder Int      -- parseable integer
Decode.float   : FieldDecoder Float    -- parseable float
Decode.bool    : FieldDecoder Bool     -- "true"/"on" → True; absent/"false"/"" → False
```

### Adding validation

`validate` chains a validator onto any `FieldDecoder`. The validator receives
the already-decoded value and returns `Ok value` or `Err "message"`:

```elm
Decode.string |> Decode.validate Decode.email
Decode.int    |> Decode.validate (Decode.minInt 0)
Decode.string |> Decode.validate (Decode.minLength 8)
```

`custom` converts to a different type, with the same error plumbing:

```elm
Decode.string
    |> Decode.custom (\s ->
        case parseSlug s of
            Just slug -> Ok slug
            Nothing   -> Err "Invalid slug format"
       )
```

## Built-in validators

| Validator | Type | Fails when |
|---|---|---|
| `email` | `String -> Result String String` | No `@`, or domain has no `.` |
| `nonEmpty` | `String -> Result String String` | Blank or whitespace-only |
| `minInt n` | `Int -> Result String Int` | Value < n |
| `maxInt n` | `Int -> Result String Int` | Value > n |
| `minFloat n` | `Float -> Result String Float` | Value < n |
| `maxFloat n` | `Float -> Result String Float` | Value > n |
| `minLength n` | `String -> Result String String` | Length < n |
| `maxLength n` | `String -> Result String String` | Length > n |

## Applicative combinators

For cases where the pipeline style doesn't fit — e.g. two independent
validations that both produce the same error collection:

```elm
Decode.map2 : (a -> b -> c) -> Decoder a -> Decoder b -> Decoder c
-- map3 … map8 follow the same pattern
```

## `andThen` — sequential validation

When validation of one field depends on another's result, use `andThen`.
Unlike the pipeline operators, `andThen` **short-circuits** — errors from the
first decoder stop the second from running.

```elm
Decode.succeed identity
    |> Decode.required "password" Decode.string
    |> Decode.andThen
        (\password ->
            if String.length password >= 12 then
                Decode.succeed password
            else
                Decode.fail "password" "Must be at least 12 characters"
        )
```

## Displaying errors back to the user

The PRG pattern: validate in the action, redirect with error info if invalid,
re-render the form on GET using the error params.

```elm
-- Action
action request =
    case Decode.decodeForm formDecoder request of
        Ok data ->
            Action.fromLoader (save data)
                |> Action.andThen (\_ -> Action.redirect "/form?ok=1")

        Err errors ->
            let query = errors |> List.map encodeError |> String.join "&"
            in  Action.redirect ("/form?" ++ query)


-- Page — read back the errors and inject them into the form
page request =
    Loader.succeed
        { emailError = Route.query "err_email" request
        , ageError   = Route.query "err_age"   request
        }
        |> Loader.map view
```

## Decoding query parameters

The same decoder type works for GET query strings — useful for search forms
or filter endpoints:

```elm
type alias SearchParams =
    { q : Maybe String
    , page : Int
    }


searchDecoder : Decode.Decoder SearchParams
searchDecoder =
    Decode.succeed SearchParams
        |> Decode.optional          "q"    Decode.string
        |> Decode.optionalWithDefault "page" 1 Decode.int


page : Request -> Loader (Document Never)
page request =
    let
        params =
            Decode.decodeQuery searchDecoder request
                |> Result.withDefault { q = Nothing, page = 1 }
    in
    Loader.map (view params) (search params)
```

## Source

- [packages/elm-ssr/elm-src/ElmSsr/Request/Decode.elm](../packages/elm-ssr/elm-src/ElmSsr/Request/Decode.elm)
- [examples/basic/src/Example/Basic/Routes/Validate.elm](../examples/basic/src/Example/Basic/Routes/Validate.elm) — live reference implementation
