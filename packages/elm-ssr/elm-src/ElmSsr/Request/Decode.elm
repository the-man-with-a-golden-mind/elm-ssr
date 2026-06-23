module ElmSsr.Request.Decode exposing
    ( Decoder, Error
    , required, optional, optionalWithDefault
    , string, int, float, bool
    , validate, custom
    , succeed, fail, map, map2, map3, map4, map5, map6, map7, map8, andThen
    , decodeForm, decodeQuery, decodeParams, decodeRaw
    , email, nonEmpty, minInt, maxInt, minFloat, maxFloat, minLength, maxLength
    )

import ElmSsr.Route as Route exposing (Request)


{-| Represents a single validation error on a field. -}
type alias Error =
    { field : String
    , message : String
    }


{-| A Request/Form decoder that compiles a validation result. -}
type Decoder a
    = Decoder (List ( String, String ) -> Result (List Error) a)


{-| A field decoder for a single, individual field's string representation. -}
type FieldDecoder a
    = FieldDecoder (Maybe String -> Result String a)


-- RUNNING DECODERS

{-| Decode from the request's raw form data (POST body). -}
decodeForm : Decoder a -> Request -> Result (List Error) a
decodeForm (Decoder dec) request =
    dec request.formData


{-| Decode from the request's query string parameters (GET parameters). -}
decodeQuery : Decoder a -> Request -> Result (List Error) a
decodeQuery (Decoder dec) request =
    dec request.query


{-| Decode from the dynamic route params. -}
decodeParams : Decoder a -> Request -> Result (List Error) a
decodeParams (Decoder dec) request =
    dec request.params


{-| Decode directly from a raw key-value list. -}
decodeRaw : Decoder a -> List ( String, String ) -> Result (List Error) a
decodeRaw (Decoder dec) pairs =
    dec pairs


-- BASE DECODERS

{-| Decodes a required string field. -}
string : FieldDecoder String
string =
    FieldDecoder (\rawValue ->
        case rawValue of
            Just val ->
                Ok val

            Nothing ->
                Err "Field is required"
    )


{-| Decodes an integer. -}
int : FieldDecoder Int
int =
    FieldDecoder (\rawValue ->
        case rawValue of
            Just val ->
                case String.toInt val of
                    Just num ->
                        Ok num

                    Nothing ->
                        Err "Must be a valid integer"

            Nothing ->
                Err "Field is required"
    )


{-| Decodes a float. -}
float : FieldDecoder Float
float =
    FieldDecoder (\rawValue ->
        case rawValue of
            Just val ->
                case String.toFloat val of
                    Just num ->
                        Ok num

                    Nothing ->
                        Err "Must be a valid number"

            Nothing ->
                Err "Field is required"
    )


{-| Decodes a boolean checkbox. Returns `True` for `"true"`, `"on"`, or presence.
Returns `False` otherwise or if omitted.
-}
bool : FieldDecoder Bool
bool =
    FieldDecoder (\rawValue ->
        case rawValue of
            Just "true" ->
                Ok True

            Just "false" ->
                Ok False

            Just "on" ->
                Ok True

            Just "" ->
                Ok False

            Just _ ->
                Ok False

            Nothing ->
                Ok False
    )


-- PIPELINE HELPERS

{-| Decodes a required field. If missing or invalid, accumulates the error. -}
required : String -> FieldDecoder b -> Decoder (b -> a) -> Decoder a
required name (FieldDecoder fieldDec) (Decoder decFn) =
    Decoder (\input ->
        let
            rawValue =
                lookup name input

            resFn =
                decFn input

            resVal =
                case fieldDec rawValue of
                    Ok val ->
                        Ok val

                    Err msg ->
                        Err [ { field = name, message = msg } ]
        in
        combine resFn resVal
    )


{-| Decodes an optional field, defaulting to `Nothing` if missing or empty. -}
optional : String -> FieldDecoder b -> Decoder (Maybe b -> a) -> Decoder a
optional name (FieldDecoder fieldDec) (Decoder decFn) =
    Decoder (\input ->
        let
            rawValue =
                lookup name input

            resFn =
                decFn input

            resVal =
                case rawValue of
                    Nothing ->
                        Ok Nothing

                    Just "" ->
                        Ok Nothing

                    Just val ->
                        case fieldDec (Just val) of
                            Ok decoded ->
                                Ok (Just decoded)

                            Err msg ->
                                Err [ { field = name, message = msg } ]
        in
        combine resFn resVal
    )


{-| Decodes an optional field, defaulting to the provided value if missing or empty. -}
optionalWithDefault : String -> b -> FieldDecoder b -> Decoder (b -> a) -> Decoder a
optionalWithDefault name defaultVal (FieldDecoder fieldDec) (Decoder decFn) =
    Decoder (\input ->
        let
            rawValue =
                lookup name input

            resFn =
                decFn input

            resVal =
                case rawValue of
                    Nothing ->
                        Ok defaultVal

                    Just "" ->
                        Ok defaultVal

                    Just val ->
                        case fieldDec (Just val) of
                            Ok decoded ->
                                Ok decoded

                            Err msg ->
                                Err [ { field = name, message = msg } ]
        in
        combine resFn resVal
    )


-- APPLICATIVE COMBINATORS

{-| A decoder that always succeeds with the given value. -}
succeed : a -> Decoder a
succeed val =
    Decoder (\_ -> Ok val)


{-| A decoder that always fails with a single general validation error. -}
fail : String -> String -> Decoder a
fail fieldName msg =
    Decoder (\_ -> Err [ { field = fieldName, message = msg } ])


{-| Transform a decoded value. -}
map : (a -> b) -> Decoder a -> Decoder b
map f (Decoder dec) =
    Decoder (\input -> Result.map f (dec input))


{-| Apply a function inside a decoder to a value inside a decoder. -}
apply : Decoder a -> Decoder (a -> b) -> Decoder b
apply (Decoder decVal) (Decoder decFn) =
    Decoder (\input ->
        combine (decFn input) (decVal input)
    )


{-| Map over 2 decoders, accumulating errors. -}
map2 : (a -> b -> c) -> Decoder a -> Decoder b -> Decoder c
map2 f decA decB =
    succeed f
        |> apply decA
        |> apply decB


{-| Map over 3 decoders, accumulating errors. -}
map3 : (a -> b -> c -> d) -> Decoder a -> Decoder b -> Decoder c -> Decoder d
map3 f decA decB decC =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC


{-| Map over 4 decoders, accumulating errors. -}
map4 : (a -> b -> c -> d -> e) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e
map4 f decA decB decC decD =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD


{-| Map over 5 decoders, accumulating errors. -}
map5 : (a -> b -> c -> d -> e -> f) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f
map5 f decA decB decC decD decE =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE


{-| Map over 6 decoders, accumulating errors. -}
map6 : (a -> b -> c -> d -> e -> f -> g) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g
map6 f decA decB decC decD decE decF =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE
        |> apply decF


{-| Map over 7 decoders, accumulating errors. -}
map7 : (a -> b -> c -> d -> e -> f -> g -> h) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g -> Decoder h
map7 f decA decB decC decD decE decF decG =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE
        |> apply decF
        |> apply decG


{-| Map over 8 decoders, accumulating errors. -}
map8 : (a -> b -> c -> d -> e -> f -> g -> h -> i) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g -> Decoder h -> Decoder i
map8 f decA decB decC decD decE decF decG decH =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE
        |> apply decF
        |> apply decG
        |> apply decH


{-| Chain two decoders, short-circuiting on failure. -}
andThen : (a -> Decoder b) -> Decoder a -> Decoder b
andThen f (Decoder decA) =
    Decoder (\input ->
        case decA input of
            Ok a ->
                let
                    (Decoder decB) =
                        f a
                in
                decB input

            Err errs ->
                Err errs
    )


-- VALIDATION & CUSTOM TRANSFORMS

{-| Run a custom validation function on a field. -}
validate : (a -> Result String a) -> FieldDecoder a -> FieldDecoder a
validate validator (FieldDecoder fieldDec) =
    FieldDecoder (\rawValue ->
        fieldDec rawValue
            |> Result.andThen validator
    )


{-| Map a value to a new type, allowing custom validation errors. -}
custom : (a -> Result String b) -> FieldDecoder a -> FieldDecoder b
custom f (FieldDecoder fieldDec) =
    FieldDecoder (\rawValue ->
        fieldDec rawValue
            |> Result.andThen f
    )


-- COMMON VALIDATORS

{-| Validates a string is a standard email address. -}
email : String -> Result String String
email val =
    let
        parts =
            String.split "@" val
    in
    case parts of
        [ _, domain ] ->
            if String.contains "." domain then
                Ok val

            else
                Err "Invalid email address"

        _ ->
            Err "Invalid email address"


{-| Validates a string is not empty or only whitespace. -}
nonEmpty : String -> Result String String
nonEmpty val =
    if String.isEmpty (String.trim val) then
        Err "Cannot be empty"

    else
        Ok val


{-| Validates a minimum integer value. -}
minInt : Int -> Int -> Result String Int
minInt min val =
    if val >= min then
        Ok val

    else
        Err ("Must be at least " ++ String.fromInt min)


{-| Validates a maximum integer value. -}
maxInt : Int -> Int -> Result String Int
maxInt max val =
    if val <= max then
        Ok val

    else
        Err ("Must be at most " ++ String.fromInt max)


{-| Validates a minimum float value. -}
minFloat : Float -> Float -> Result String Float
minFloat min val =
    if val >= min then
        Ok val

    else
        Err ("Must be at least " ++ String.fromFloat min)


{-| Validates a maximum float value. -}
maxFloat : Float -> Float -> Result String Float
maxFloat max val =
    if val <= max then
        Ok val

    else
        Err ("Must be at most " ++ String.fromFloat max)


{-| Validates a minimum string length. -}
minLength : Int -> String -> Result String String
minLength len val =
    if String.length val >= len then
        Ok val

    else
        Err ("Must be at least " ++ String.fromInt len ++ " characters")


{-| Validates a maximum string length. -}
maxLength : Int -> String -> Result String String
maxLength len val =
    if String.length val <= len then
        Ok val

    else
        Err ("Must be at most " ++ String.fromInt len ++ " characters")


-- INTERNAL HELPERS

lookup : String -> List ( String, String ) -> Maybe String
lookup key pairs =
    pairs
        |> List.filter (\( name, _ ) -> name == key)
        |> List.head
        |> Maybe.map Tuple.second


combine : Result (List Error) (a -> b) -> Result (List Error) a -> Result (List Error) b
combine resFn resVal =
    case ( resFn, resVal ) of
        ( Ok fn, Ok val ) ->
            Ok (fn val)

        ( Err errsFn, Err errsVal ) ->
            Err (errsFn ++ errsVal)

        ( Err errs, Ok _ ) ->
            Err errs

        ( Ok _, Err errs ) ->
            Err errs
