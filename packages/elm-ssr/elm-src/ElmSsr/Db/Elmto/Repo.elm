module ElmSsr.Db.Elmto.Repo exposing
    ( all, one, get, getBy
    , count, countWhere, exists
    , insert, update, delete, insertAll
    , validateUnique
    )

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Db.Elmto as Elmto exposing (Column(..), Schema)
import ElmSsr.Db.Elmto.Changeset as Changeset exposing (Changeset)
import ElmSsr.Db.Elmto.Compiler as Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Query as Query exposing (Query)
import ElmSsr.Loader as Loader exposing (Loader)
import Json.Decode as Decode
import Json.Encode as Encode


all : Dialect -> Query record selection -> Loader (List selection)
all dialect query =
    let
        c =
            Compiler.compileSelect dialect query
    in
    Loader.query { sql = c.sql, params = c.params, decoder = c.decoder }


one : Dialect -> Query record selection -> Loader (Maybe selection)
one dialect query =
    let
        c =
            Compiler.compileSelect dialect query
    in
    Loader.queryOne { sql = c.sql, params = c.params, decoder = c.decoder }


get : Dialect -> Schema record -> Int -> Loader (Maybe record)
get dialect schema id =
    let
        idColumn =
            Elmto.column "id" Encode.int

        query =
            Query.from schema
                |> Query.where_ (Query.eq id idColumn)
                |> Query.limit 1

        c =
            Compiler.compileSelect dialect query
    in
    Loader.queryOne { sql = c.sql, params = c.params, decoder = c.decoder }


getBy : Dialect -> Schema record -> Query.Expression record -> Loader (Maybe record)
getBy dialect schema expr =
    let
        query =
            Query.from schema
                |> Query.where_ expr
                |> Query.limit 1

        c =
            Compiler.compileSelect dialect query
    in
    Loader.queryOne { sql = c.sql, params = c.params, decoder = c.decoder }


count : Dialect -> Schema record -> Loader Int
count dialect schema =
    let
        sql =
            Compiler.toDialectSql dialect ("SELECT COUNT(*) AS count FROM " ++ Elmto.tableName schema)
    in
    Loader.queryOne { sql = sql, params = [], decoder = Decode.field "count" Decode.int }
        |> Loader.map (Maybe.withDefault 0)


countWhere : Dialect -> Schema record -> Query.Expression record -> Loader Int
countWhere dialect schema expr =
    let
        baseSql =
            "SELECT COUNT(*) AS count FROM " ++ Elmto.tableName schema

        whereSql =
            " WHERE " ++ Query.expressionSql identity expr

        sql =
            Compiler.toDialectSql dialect (baseSql ++ whereSql)
    in
    Loader.queryOne { sql = sql, params = Query.expressionParams expr, decoder = Decode.field "count" Decode.int }
        |> Loader.map (Maybe.withDefault 0)


exists : Dialect -> Schema record -> Query.Expression record -> Loader Bool
exists dialect schema expr =
    countWhere dialect schema expr
        |> Loader.map (\n -> n > 0)


validateUnique : Dialect -> Schema record -> Column record a -> a -> Changeset record -> Loader (Changeset record)
validateUnique dialect schema col value changeset =
    if not changeset.isValid then
        Loader.succeed changeset

    else
        let
            colName =
                Elmto.columnName col

            query =
                Query.from schema
                    |> Query.where_ (Query.eq value col)
                    |> Query.limit 1

            c =
                Compiler.compileSelect dialect query
        in
        Loader.queryOne { sql = c.sql, params = c.params, decoder = Elmto.decoder schema }
            |> Loader.map
                (\existing ->
                    case existing of
                        Just _ ->
                            let
                                newErrors =
                                    ( colName, "has already been taken" ) :: changeset.errors
                            in
                            { changeset | errors = newErrors, isValid = False }

                        Nothing ->
                            changeset
                )


insertAll : Dialect -> Schema record -> List (Changeset record) -> Action (List (Result (Changeset record) record))
insertAll dialect schema changesets =
    List.foldl
        (\cs accAction ->
            accAction
                |> Action.andThen
                    (\acc ->
                        insert dialect schema cs
                            |> Action.map (\result -> acc ++ [ result ])
                    )
        )
        (Action.succeed [])
        changesets


insert : Dialect -> Schema record -> Changeset record -> Action (Result (Changeset record) record)
insert dialect schema changeset =
    if not (Changeset.isValid changeset) then
        Action.succeed (Err changeset)

    else
        case Compiler.compileInsert dialect schema changeset of
            Err errs ->
                let
                    errChangeset =
                        { changeset | errors = changeset.errors ++ errs, isValid = False }
                in
                Action.succeed (Err errChangeset)

            Ok c ->
                case dialect of
                    PostgreSQL ->
                        Action.fromLoader (Loader.queryOne { sql = c.sql, params = c.params, decoder = Elmto.decoder schema })
                            |> Action.map
                                (\maybeRec ->
                                     case maybeRec of
                                         Just rec ->
                                             Ok rec

                                         Nothing ->
                                             Err { changeset | errors = ( "repo", "Insert failed to return record" ) :: changeset.errors, isValid = False }
                                )

                    SQLite ->
                        Action.fromLoader (Loader.execute { sql = c.sql, params = c.params })
                            |> Action.andThen
                                (\_ ->
                                     Action.fromLoader (Loader.queryOne { sql = "SELECT last_insert_rowid() as id", params = [], decoder = Decode.field "id" Decode.int })
                                )
                            |> Action.andThen
                                (\maybeId ->
                                     case maybeId of
                                         Just rowId ->
                                             let
                                                 idColumn =
                                                     Elmto.column "id" Encode.int

                                                 fetchQuery =
                                                     Query.from schema
                                                         |> Query.where_ (Query.eq rowId idColumn)
                                                         |> Query.limit 1

                                                 fc =
                                                     Compiler.compileSelect SQLite fetchQuery
                                             in
                                             Action.fromLoader (Loader.queryOne { sql = fc.sql, params = fc.params, decoder = fc.decoder })
                                                 |> Action.map
                                                     (\maybeRec ->
                                                         case maybeRec of
                                                             Just rec ->
                                                                 Ok rec

                                                             Nothing ->
                                                                 Err { changeset | errors = ( "repo", "Failed to retrieve inserted record" ) :: changeset.errors, isValid = False }
                                                     )

                                         Nothing ->
                                             Action.succeed (Err { changeset | errors = ( "repo", "Failed to resolve last insert rowid" ) :: changeset.errors, isValid = False })
                                )


update : Dialect -> Schema record -> Changeset record -> Action (Result (Changeset record) record)
update dialect schema changeset =
    if not (Changeset.isValid changeset) then
        Action.succeed (Err changeset)

    else
        case Compiler.compileUpdate dialect schema changeset of
            Err errs ->
                let
                    errChangeset =
                        { changeset | errors = changeset.errors ++ errs, isValid = False }
                in
                Action.succeed (Err errChangeset)

            Ok c ->
                case dialect of
                    PostgreSQL ->
                        Action.fromLoader (Loader.queryOne { sql = c.sql, params = c.params, decoder = Elmto.decoder schema })
                            |> Action.map
                                (\maybeRec ->
                                     case maybeRec of
                                         Just rec ->
                                             Ok rec

                                         Nothing ->
                                             Err { changeset | errors = ( "repo", "Update failed to return record" ) :: changeset.errors, isValid = False }
                                )

                    SQLite ->
                        Action.fromLoader (Loader.execute { sql = c.sql, params = c.params })
                            |> Action.andThen
                                (\_ ->
                                     case changeset.data of
                                         Just originalRecord ->
                                             let
                                                 idField =
                                                     List.filter (\f -> f.name == "id") (Elmto.fields schema)
                                                         |> List.head

                                                 idVal =
                                                     case idField of
                                                         Just f ->
                                                             f.encoder originalRecord

                                                         Nothing ->
                                                             Encode.null
                                             in
                                             if idVal == Encode.null then
                                                 Action.succeed (Err { changeset | errors = ( "repo", "Record has no valid id" ) :: changeset.errors, isValid = False })

                                             else
                                                 let
                                                     selectSql =
                                                         "SELECT * FROM " ++ Elmto.tableName schema ++ " WHERE id = ?"
                                                 in
                                                 Action.fromLoader (Loader.queryOne { sql = selectSql, params = [ idVal ], decoder = Elmto.decoder schema })
                                                     |> Action.map
                                                         (\maybeRec ->
                                                             case maybeRec of
                                                                 Just rec ->
                                                                     Ok rec

                                                                 Nothing ->
                                                                     Err { changeset | errors = ( "repo", "Failed to retrieve updated record" ) :: changeset.errors, isValid = False }
                                                         )

                                         Nothing ->
                                             Action.succeed (Err { changeset | errors = ( "repo", "No record data to retrieve updated ID" ) :: changeset.errors, isValid = False })
                                )


delete : Dialect -> Schema record -> record -> Action (Result String Bool)
delete dialect schema record =
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
        Action.succeed (Err "Record has no valid id for deletion")

    else
        let
            c =
                Compiler.compileDelete dialect schema idVal
        in
        Action.fromLoader (Loader.execute { sql = c.sql, params = c.params })
            |> Action.map (\_ -> Ok True)
