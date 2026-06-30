module ElmSsr.Form exposing
    ( Decoder, Error, FieldDecoder
    , required, optional, optionalWithDefault
    , string, int, float, bool
    , validate, custom
    , succeed, fail, map, map2, map3, map4, map5, map6, map7, map8, andThen
    , decode
    , email, nonEmpty, minInt, maxInt, minFloat, maxFloat, minLength, maxLength
    , errorFor, hasError, errorsFor
    )

{-| Type-safe form and request validation.

Decoders are pure and can be used on the server (via Request data) and in islands
(via plain key/value pairs from model state). Errors accumulate.

Use on the server with `decode` + `Request.formData` (or the thin wrappers in
`ElmSsr.Request.Decode`).

# Core types
@docs Decoder, Error

# Building decoders
@docs required, optional, optionalWithDefault
@docs string, int, float, bool
@docs validate, custom
@docs succeed, fail, map, map2, map3, map4, map5, map6, map7, map8, andThen

# Running
@docs decode

# Validators
@docs email, nonEmpty, minInt, maxInt, minFloat, maxFloat, minLength, maxLength

# Error helpers (usable on server and client)
@docs errorFor, hasError, errorsFor
-}

import Json.Decode as JD
import Json.Encode as JE


type alias Error =
    { field : String
    , message : String
    }


type Decoder a
    = Decoder (List ( String, String ) -> Result (List Error) a)


type FieldDecoder a
    = FieldDecoder (Maybe String -> Result String a)


decode : Decoder a -> List ( String, String ) -> Result (List Error) a
decode (Decoder dec) input =
    dec input


decodeField : FieldDecoder a -> Maybe String -> Result Error a
decodeField (FieldDecoder fd) raw =
    case fd raw of
        Ok v ->
            Ok v

        Err msg ->
            Err { field = "", message = msg }


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


string : FieldDecoder String
string =
    FieldDecoder (\rawValue ->
        case rawValue of
            Just val ->
                Ok val

            Nothing ->
                Err "Field is required"
    )


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


validate : (a -> Result String a) -> FieldDecoder a -> FieldDecoder a
validate validator (FieldDecoder fieldDec) =
    FieldDecoder (\rawValue ->
        fieldDec rawValue
            |> Result.andThen validator
    )


custom : (a -> Result String b) -> FieldDecoder a -> FieldDecoder b
custom f (FieldDecoder fieldDec) =
    FieldDecoder (\rawValue ->
        fieldDec rawValue
            |> Result.andThen f
    )


succeed : a -> Decoder a
succeed val =
    Decoder (\_ -> Ok val)


fail : String -> String -> Decoder a
fail fieldName msg =
    Decoder (\_ -> Err [ { field = fieldName, message = msg } ])


map : (a -> b) -> Decoder a -> Decoder b
map f (Decoder dec) =
    Decoder (\input -> Result.map f (dec input))


apply : Decoder a -> Decoder (a -> b) -> Decoder b
apply (Decoder decVal) (Decoder decFn) =
    Decoder (\input ->
        combine (decFn input) (decVal input)
    )


map2 : (a -> b -> c) -> Decoder a -> Decoder b -> Decoder c
map2 f decA decB =
    succeed f
        |> apply decA
        |> apply decB


map3 : (a -> b -> c -> d) -> Decoder a -> Decoder b -> Decoder c -> Decoder d
map3 f decA decB decC =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC


map4 : (a -> b -> c -> d -> e) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e
map4 f decA decB decC decD =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD


map5 : (a -> b -> c -> d -> e -> f) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f
map5 f decA decB decC decD decE =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE


map6 : (a -> b -> c -> d -> e -> f -> g) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g
map6 f decA decB decC decD decE decF =
    succeed f
        |> apply decA
        |> apply decB
        |> apply decC
        |> apply decD
        |> apply decE
        |> apply decF


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


nonEmpty : String -> Result String String
nonEmpty val =
    if String.isEmpty (String.trim val) then
        Err "Cannot be empty"

    else
        Ok val


minInt : Int -> Int -> Result String Int
minInt min val =
    if val >= min then
        Ok val

    else
        Err ("Must be at least " ++ String.fromInt min)


maxInt : Int -> Int -> Result String Int
maxInt max val =
    if val <= max then
        Ok val

    else
        Err ("Must be at most " ++ String.fromInt max)


minFloat : Float -> Float -> Result String Float
minFloat min val =
    if val >= min then
        Ok val

    else
        Err ("Must be at least " ++ String.fromFloat min)


maxFloat : Float -> Float -> Result String Float
maxFloat max val =
    if val <= max then
        Ok val

    else
        Err ("Must be at most " ++ String.fromFloat max)


minLength : Int -> String -> Result String String
minLength len val =
    if String.length val >= len then
        Ok val

    else
        Err ("Must be at least " ++ String.fromInt len ++ " characters")


maxLength : Int -> String -> Result String String
maxLength len val =
    if String.length val <= len then
        Ok val

    else
        Err ("Must be at most " ++ String.fromInt len ++ " characters")


errorFor : String -> List Error -> Maybe String
errorFor field errors =
    errors
        |> List.filter (\e -> e.field == field)
        |> List.head
        |> Maybe.map .message


hasError : String -> List Error -> Bool
hasError field errors =
    List.any (\e -> e.field == field) errors


errorsFor : String -> List Error -> List String
errorsFor field errors =
    errors
        |> List.filter (\e -> e.field == field)
        |> List.map .message


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
