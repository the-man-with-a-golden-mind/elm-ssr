module ElmSsr.Db.Elmto exposing
    ( Schema, schema
    , Field, FieldType
    , Column(..), column
    , field, optionalField
    , string, int, float, bool
    , tableName, fields, decoder, columnName
    )

import Json.Decode as Decode
import Json.Encode as Encode


type Column record a
    = Column String (a -> Encode.Value)


column : String -> (a -> Encode.Value) -> Column record a
column name encoder =
    Column name encoder


type FieldType a
    = FieldType (Decode.Decoder a) (a -> Encode.Value)


string : FieldType String
string =
    FieldType Decode.string Encode.string


int : FieldType Int
int =
    FieldType Decode.int Encode.int


float : FieldType Float
float =
    FieldType Decode.float Encode.float


bool : FieldType Bool
bool =
    FieldType Decode.bool Encode.bool


type alias Field record =
    { name : String
    , encoder : record -> Encode.Value
    , decoder : Decode.Decoder Encode.Value
    , isOptional : Bool
    }


type Schema record
    = Schema
        { tableName : String
        , fields : List (Field record)
        , decoder : Decode.Decoder record
        }


schema : String -> Decode.Decoder record -> Schema record
schema name dec =
    Schema
        { tableName = name
        , fields = []
        , decoder = dec
        }


field : String -> (record -> a) -> FieldType a -> Schema record -> Schema record
field name getter (FieldType dec enc) (Schema s) =
    let
        fieldValDecoder =
            Decode.map enc dec

        newField =
            { name = name
            , encoder = \rec -> enc (getter rec)
            , decoder = fieldValDecoder
            , isOptional = False
            }
    in
    Schema { s | fields = s.fields ++ [ newField ] }


optionalField : String -> (record -> Maybe a) -> FieldType a -> Schema record -> Schema record
optionalField name getter (FieldType dec enc) (Schema s) =
    let
        optionalEnc val =
            case val of
                Just v ->
                    enc v

                Nothing ->
                    Encode.null

        fieldValDecoder =
            Decode.nullable dec
                |> Decode.map optionalEnc

        newField =
            { name = name
            , encoder = \rec -> optionalEnc (getter rec)
            , decoder = fieldValDecoder
            , isOptional = True
            }
    in
    Schema { s | fields = s.fields ++ [ newField ] }


columnName : Column record a -> String
columnName (Column name _) =
    name


tableName : Schema record -> String
tableName (Schema s) =
    s.tableName


fields : Schema record -> List (Field record)
fields (Schema s) =
    s.fields


decoder : Schema record -> Decode.Decoder record
decoder (Schema s) =
    s.decoder
