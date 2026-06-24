module ElmSsr.Db.Elmto.Compiler exposing
    ( Dialect(..)
    , compileSelect
    , compileInsert
    , compileUpdate
    , compileDelete
    , toDialectSql
    )

import Dict
import ElmSsr.Db.Elmto as Elmto exposing (Schema, Field)
import ElmSsr.Db.Elmto.Changeset as Changeset exposing (Changeset)
import ElmSsr.Db.Elmto.Query as Query exposing (Query)
import Json.Decode as Decode
import Json.Encode as Encode


type Dialect
    = PostgreSQL
    | SQLite


toDialectSql : Dialect -> String -> String
toDialectSql dialect baseSql =
    case dialect of
        SQLite ->
            baseSql

        PostgreSQL ->
            let
                parts =
                    String.split "?" baseSql

                joinParts index list acc =
                    case list of
                        [] ->
                            acc

                        x :: xs ->
                            if index == 0 then
                                joinParts 1 xs x

                            else
                                joinParts (index + 1) xs (acc ++ "$" ++ String.fromInt index ++ x)
            in
            joinParts 0 parts ""


compileSelect : Dialect -> Query record selection -> { sql : String, params : List Encode.Value, decoder : Decode.Decoder selection }
compileSelect dialect query =
    let
        q =
            Query.toParts query

        qualifyBase name =
            if List.isEmpty q.joins then
                name

            else
                q.tableName ++ "." ++ name

        castPostgresNumbers =
            case dialect of
                PostgreSQL ->
                    True

                SQLite ->
                    False

        selectsStr =
            String.join ", " (List.map (Query.selectionSql castPostgresNumbers qualifyBase) q.selectCols)

        baseSql =
            "SELECT " ++ selectsStr ++ " FROM " ++ q.tableName

        joinSql =
            if List.isEmpty q.joins then
                ""

            else
                " " ++ String.join " " (List.map (Query.joinSql q.tableName) q.joins)

        ( whereSql, whereParams ) =
            if List.isEmpty q.conditions then
                ( "", [] )

            else
                let
                    sqls =
                        List.map (Query.expressionSql qualifyBase) q.conditions
                            |> String.join " AND "

                    vals =
                        List.map Query.expressionParams q.conditions
                            |> List.concat
                in
                ( " WHERE " ++ sqls, vals )

        groupBySql =
            if List.isEmpty q.groupByCols then
                ""

            else
                " GROUP BY " ++ (List.map (Query.groupBySql qualifyBase) q.groupByCols |> String.join ", ")

        ( havingSql, havingParams ) =
            if List.isEmpty q.havingConditions then
                ( "", [] )

            else
                let
                    sqls =
                        List.map (Query.havingSql qualifyBase) q.havingConditions
                            |> String.join " AND "

                    vals =
                        List.map Query.havingParams q.havingConditions
                            |> List.concat
                in
                ( " HAVING " ++ sqls, vals )

        orderSql =
            if List.isEmpty q.orderCols then
                ""

            else
                let
                    orders =
                        List.map (Query.orderSql qualifyBase) q.orderCols
                            |> String.join ", "
                in
                " ORDER BY " ++ orders

        limitSql =
            case q.limitVal of
                Just l ->
                    " LIMIT " ++ String.fromInt l

                Nothing ->
                    ""

        offsetSql =
            case q.offsetVal of
                Just o ->
                    " OFFSET " ++ String.fromInt o

                Nothing ->
                    ""

        rawSql =
            baseSql ++ joinSql ++ whereSql ++ groupBySql ++ havingSql ++ orderSql ++ limitSql ++ offsetSql
    in
    { sql = toDialectSql dialect rawSql
    , params = whereParams ++ havingParams
    , decoder = q.decoder
    }


compileInsert : Dialect -> Schema record -> Changeset record -> Result (List (String, String)) { sql : String, params : List Encode.Value }
compileInsert dialect schema changeset =
    if not (Changeset.isValid changeset) then
        Err (Changeset.errors changeset)

    else
        let
            changeList =
                Dict.toList (Changeset.changes changeset)
        in
        if List.isEmpty changeList then
            case dialect of
                SQLite ->
                    Ok
                        { sql = "INSERT INTO " ++ Elmto.tableName schema ++ " DEFAULT VALUES"
                        , params = []
                        }

                PostgreSQL ->
                    Ok
                        { sql = "INSERT INTO " ++ Elmto.tableName schema ++ " DEFAULT VALUES RETURNING *"
                        , params = []
                        }

        else
            let
                cols =
                    List.map Tuple.first changeList

                vals =
                    List.map Tuple.second changeList

                placeholders =
                    List.map (\_ -> "?") cols
                        |> String.join ", "

                columnsStr =
                    String.join ", " cols

                returningStr =
                    case dialect of
                        PostgreSQL ->
                            " RETURNING *"

                        SQLite ->
                            ""

                rawSql =
                    "INSERT INTO " ++ Elmto.tableName schema ++ " (" ++ columnsStr ++ ") VALUES (" ++ placeholders ++ ")" ++ returningStr
            in
            Ok
                { sql = toDialectSql dialect rawSql
                , params = vals
                }


compileUpdate : Dialect -> Schema record -> Changeset record -> Result (List (String, String)) { sql : String, params : List Encode.Value }
compileUpdate dialect schema changeset =
    if not (Changeset.isValid changeset) then
        Err (Changeset.errors changeset)

    else
        case changeset.data of
            Nothing ->
                Err [ ( "changeset", "cannot update a changeset without a loaded record" ) ]

            Just record ->
                let
                    idField =
                        List.filter (\f -> f.name == "id") (Elmto.fields schema)
                            |> List.head

                    idVal =
                        case idField of
                            Just f ->
                                f.encoder record

                            Nothing ->
                                Encode.null
                in
                if idVal == Encode.null then
                    Err [ ( "changeset", "record has no id field for updates" ) ]

                else
                    let
                        changeList =
                            Dict.toList (Changeset.changes changeset)
                    in
                    if List.isEmpty changeList then
                        Err [ ( "changeset", "no changes to update" ) ]

                    else
                        let
                            setClauses =
                                List.map (\( col, _ ) -> col ++ " = ?") changeList
                                    |> String.join ", "

                            params =
                                List.map Tuple.second changeList ++ [ idVal ]

                            returningStr =
                                case dialect of
                                    PostgreSQL ->
                                        " RETURNING *"

                                    SQLite ->
                                        ""

                            rawSql =
                                "UPDATE " ++ Elmto.tableName schema ++ " SET " ++ setClauses ++ " WHERE id = ?" ++ returningStr
                        in
                        Ok
                            { sql = toDialectSql dialect rawSql
                            , params = params
                            }


compileDelete : Dialect -> Schema record -> Encode.Value -> { sql : String, params : List Encode.Value }
compileDelete dialect schema idVal =
    let
        rawSql =
            "DELETE FROM " ++ Elmto.tableName schema ++ " WHERE id = ?"
    in
    { sql = toDialectSql dialect rawSql
    , params = [ idVal ]
    }
