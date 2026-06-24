module ElmSsr.Db.Elmto.Changeset exposing
    ( Changeset
    , cast, castRecord
    , validateRequired
    , validateFormat
    , validateLength
    , validateNumber
    , applyChanges
    , errors, isValid, changes
    )

import Dict exposing (Dict)
import ElmSsr.Db.Elmto as Elmto exposing (Schema, Field)
import Json.Decode as Decode
import Json.Encode as Encode


type alias Changeset record =
    { data : Maybe record
    , changes : Dict String Encode.Value
    , errors : List (String, String)
    , isValid : Bool
    }


cast : Schema record -> Dict String Decode.Value -> Changeset record
cast schema schemaAttrs =
    let
        schemaFields =
            Elmto.fields schema

        processField : Field record -> ( Dict String Encode.Value, List (String, String) ) -> ( Dict String Encode.Value, List (String, String) )
        processField f ( accChanges, accErrors ) =
            case Dict.get f.name schemaAttrs of
                Just rawVal ->
                    case Decode.decodeValue f.decoder rawVal of
                        Ok encodedVal ->
                            ( Dict.insert f.name encodedVal accChanges, accErrors )

                        Err err ->
                            ( accChanges, ( f.name, "is invalid: " ++ Decode.errorToString err ) :: accErrors )

                Nothing ->
                    ( accChanges, accErrors )

        ( finalChanges, finalErrors ) =
            List.foldl processField ( Dict.empty, [] ) schemaFields
    in
    { data = Nothing
    , changes = finalChanges
    , errors = finalErrors
    , isValid = List.isEmpty finalErrors
    }


castRecord : Schema record -> record -> Dict String Decode.Value -> Changeset record
castRecord schema record schemaAttrs =
    let
        initial =
            cast schema schemaAttrs
    in
    { initial | data = Just record }


validateRequired : List String -> Changeset record -> Changeset record
validateRequired requiredFields changeset =
    let
        checkField : String -> List (String, String) -> List (String, String)
        checkField fieldName acc =
            let
                changeVal =
                    Dict.get fieldName changeset.changes

                isBlank =
                    case changeVal of
                        Just val ->
                            val == Encode.null

                        Nothing ->
                            case changeset.data of
                                Just _ ->
                                    False

                                Nothing ->
                                    True
            in
            if isBlank then
                ( fieldName, "can't be blank" ) :: acc

            else
                acc

        newErrors =
            List.foldl checkField changeset.errors requiredFields
    in
    { changeset
        | errors = newErrors
        , isValid = List.isEmpty newErrors
    }


validateFormat : String -> (String -> Bool) -> String -> Changeset record -> Changeset record
validateFormat fieldName formatFn msg changeset =
    let
        val =
            Dict.get fieldName changeset.changes

        isInvalid =
            case val of
                Just encodedVal ->
                    case Decode.decodeValue Decode.string encodedVal of
                        Ok str ->
                            not (formatFn str)

                        Err _ ->
                            False

                Nothing ->
                    False
    in
    if isInvalid then
        let
            newErrors =
                ( fieldName, msg ) :: changeset.errors
        in
        { changeset | errors = newErrors, isValid = False }

    else
        changeset


validateLength : String -> { min : Maybe Int, max : Maybe Int } -> Changeset record -> Changeset record
validateLength fieldName opts changeset =
    let
        val =
            Dict.get fieldName changeset.changes

        isInvalid =
            case val of
                Just encodedVal ->
                    case Decode.decodeValue Decode.string encodedVal of
                        Ok str ->
                            let
                                len =
                                    String.length str

                                tooShort =
                                    case opts.min of
                                        Just m ->
                                            len < m

                                        Nothing ->
                                            False

                                tooLong =
                                    case opts.max of
                                        Just m ->
                                            len > m

                                        Nothing ->
                                            False
                            in
                            tooShort || tooLong

                        Err _ ->
                            False

                Nothing ->
                    False
    in
    if isInvalid then
        let
            msg =
                case ( opts.min, opts.max ) of
                    ( Just minVal, Just maxVal ) ->
                        "should be between " ++ String.fromInt minVal ++ " and " ++ String.fromInt maxVal ++ " characters"

                    ( Just minVal, Nothing ) ->
                        "should be at least " ++ String.fromInt minVal ++ " characters"

                    ( Nothing, Just maxVal ) ->
                        "should be at most " ++ String.fromInt maxVal ++ " characters"

                    _ ->
                        "invalid length"

            newErrors =
                ( fieldName, msg ) :: changeset.errors
        in
        { changeset | errors = newErrors, isValid = False }

    else
        changeset


validateNumber : String -> { greaterThan : Maybe Float, lessThan : Maybe Float } -> Changeset record -> Changeset record
validateNumber fieldName opts changeset =
    let
        val =
            Dict.get fieldName changeset.changes

        isInvalid =
            case val of
                Just encodedVal ->
                    case Decode.decodeValue Decode.float encodedVal of
                        Ok num ->
                            let
                                tooSmall =
                                    case opts.greaterThan of
                                        Just gtVal ->
                                            num <= gtVal

                                        Nothing ->
                                            False

                                tooLarge =
                                    case opts.lessThan of
                                        Just ltVal ->
                                            num >= ltVal

                                        Nothing ->
                                            False
                            in
                            tooSmall || tooLarge

                        Err _ ->
                            False

                Nothing ->
                    False
    in
    if isInvalid then
        let
            msg =
                case ( opts.greaterThan, opts.lessThan ) of
                    ( Just gtVal, Just ltVal ) ->
                        "must be greater than " ++ String.fromFloat gtVal ++ " and less than " ++ String.fromFloat ltVal

                    ( Just gtVal, Nothing ) ->
                        "must be greater than " ++ String.fromFloat gtVal

                    ( Nothing, Just ltVal ) ->
                        "must be less than " ++ String.fromFloat ltVal

                    _ ->
                        "invalid number"

            newErrors =
                ( fieldName, msg ) :: changeset.errors
        in
        { changeset | errors = newErrors, isValid = False }

    else
        changeset


applyChanges : Schema record -> Changeset record -> Result (List (String, String)) record
applyChanges schema schemaChangeset =
    if not schemaChangeset.isValid then
        Err schemaChangeset.errors

    else
        let
            originalJson =
                case schemaChangeset.data of
                    Just rec ->
                        let
                            schemaFields =
                                Elmto.fields schema

                            encField f acc =
                                ( f.name, f.encoder rec ) :: acc
                        in
                        List.foldl encField [] schemaFields
                            |> Encode.object

                    Nothing ->
                        Encode.object []

            mergedJson =
                case Decode.decodeValue (Decode.dict Decode.value) originalJson of
                    Ok dict ->
                        let
                            mergedDict =
                                Dict.foldl (\k v acc -> Dict.insert k v acc) dict schemaChangeset.changes
                        in
                        Encode.dict identity (\v -> v) mergedDict

                    Err _ ->
                        originalJson

            decoded =
                Decode.decodeValue (Elmto.decoder schema) mergedJson
        in
        case decoded of
            Ok rec ->
                Ok rec

            Err err ->
                Err [ ( "changeset", "Failed to apply changes: " ++ Decode.errorToString err ) ]


errors : Changeset record -> List (String, String)
errors changeset =
    changeset.errors


isValid : Changeset record -> Bool
isValid changeset =
    changeset.isValid


changes : Changeset record -> Dict String Encode.Value
changes changeset =
    changeset.changes
