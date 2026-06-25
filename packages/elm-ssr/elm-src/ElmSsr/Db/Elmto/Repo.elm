module ElmSsr.Db.Elmto.Repo exposing
    ( all, one, get, getBy
    , count, countWhere, exists
    , insert, update, delete, insertAll, updateAll, deleteAll
    , validateUnique
    , transaction
    , loadHasMany, loadBelongsTo, preloadHasMany, preloadBelongsTo
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
            case dialect of
                PostgreSQL ->
                    "SELECT COUNT(*)::int AS count FROM " ++ Elmto.tableName schema

                SQLite ->
                    "SELECT COUNT(*) AS count FROM " ++ Elmto.tableName schema
    in
    Loader.queryOne { sql = sql, params = [], decoder = Decode.field "count" Decode.int }
        |> Loader.map (Maybe.withDefault 0)


countWhere : Dialect -> Schema record -> Query.Expression record -> Loader Int
countWhere dialect schema expr =
    let
        baseSql =
            case dialect of
                PostgreSQL ->
                    "SELECT COUNT(*)::int AS count FROM " ++ Elmto.tableName schema

                SQLite ->
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


updateAll : Dialect -> Schema record -> Query.Expression record -> Changeset record -> Action (Result (Changeset record) Int)
updateAll dialect schema expr changeset =
    if not (Changeset.isValid changeset) then
        Action.succeed (Err changeset)

    else
        case Compiler.compileUpdateAll dialect schema expr changeset of
            Err errs ->
                let
                    errChangeset =
                        { changeset | errors = changeset.errors ++ errs, isValid = False }
                in
                Action.succeed (Err errChangeset)

            Ok c ->
                Action.fromLoader (Loader.softExecute { sql = c.sql, params = c.params })
                    |> Action.map
                        (\result ->
                            case result of
                                Ok rows ->
                                    Ok rows.rowsAffected

                                Err constraintErr ->
                                    Err (applyConstraintError constraintErr changeset)
                        )


applyConstraintError : Loader.ConstraintError -> Changeset record -> Changeset record
applyConstraintError err changeset =
    let
        fieldName =
            Maybe.withDefault "base" err.field

        msg =
            case err.kind of
                "unique" ->
                    "has already been taken"

                "notNull" ->
                    "can't be blank"

                "foreignKey" ->
                    "does not exist"

                _ ->
                    "constraint violation"
    in
    { changeset | errors = ( fieldName, msg ) :: changeset.errors, isValid = False }


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
                        Action.fromLoader (Loader.softQueryOne { sql = c.sql, params = c.params, decoder = Elmto.decoder schema })
                            |> Action.map
                                (\result ->
                                     case result of
                                         Ok (Just rec) ->
                                             Ok rec

                                         Ok Nothing ->
                                             Err { changeset | errors = ( "repo", "Insert failed to return record" ) :: changeset.errors, isValid = False }

                                         Err constraintErr ->
                                             Err (applyConstraintError constraintErr changeset)
                                )

                    SQLite ->
                        Action.fromLoader (Loader.softExecute { sql = c.sql, params = c.params })
                            |> Action.andThen
                                (\result ->
                                     case result of
                                         Err constraintErr ->
                                             Action.succeed (Err (applyConstraintError constraintErr changeset))

                                         Ok _ ->
                                             Action.fromLoader (Loader.queryOne { sql = "SELECT last_insert_rowid() as id", params = [], decoder = Decode.field "id" Decode.int })
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
                        Action.fromLoader (Loader.softQueryOne { sql = c.sql, params = c.params, decoder = Elmto.decoder schema })
                            |> Action.map
                                (\result ->
                                     case result of
                                         Ok (Just rec) ->
                                             Ok rec

                                         Ok Nothing ->
                                             Err { changeset | errors = ( "repo", "Update failed to return record" ) :: changeset.errors, isValid = False }

                                         Err constraintErr ->
                                             Err (applyConstraintError constraintErr changeset)
                                )

                    SQLite ->
                        Action.fromLoader (Loader.softExecute { sql = c.sql, params = c.params })
                            |> Action.andThen
                                (\result ->
                                     case result of
                                         Err constraintErr ->
                                             Action.succeed (Err (applyConstraintError constraintErr changeset))

                                         Ok _ ->
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


deleteAll : Dialect -> Schema record -> Query.Expression record -> Action Int
deleteAll dialect schema expr =
    let
        c =
            Compiler.compileDeleteAll dialect schema expr
    in
    Action.fromLoader (Loader.execute { sql = c.sql, params = c.params })
        |> Action.map .rowsAffected


{-| Run a list of pre-compiled SQL statements atomically in a single DB
transaction. Returns the total `rowsAffected` across all statements. Any
failure rolls back the entire transaction.

Build the list from `Compiler.compile*` results:

    let
        steps =
            List.filterMap identity
                [ Compiler.compileInsert dialect userSchema userCs |> Result.toMaybe
                , Compiler.compileInsert dialect postSchema postCs |> Result.toMaybe
                ]
    in
    Repo.transaction steps

Requires `sqlTransaction` to be configured in your `inMemoryEffects` options.
-}
transaction : List { sql : String, params : List Encode.Value } -> Action Int
transaction stmts =
    Action.fromLoader (Loader.transaction stmts)


{-| For a list of parent records, load all related child records via a foreign
key and group them per parent (hasMany / one-to-many).

    usersWithPosts : Loader (List ( User, List Post ))
    usersWithPosts =
        Repo.all dialect userQuery
            |> Loader.andThen
                (Repo.loadHasMany dialect postSchema postUserIdCol .userId users .id)

Arguments:
- `dialect` — SQLite or PostgreSQL
- `relatedSchema` — schema of the child table (e.g. postSchema)
- `fkCol` — the FK column on the child table (e.g. `column "user_id" Encode.int`)
- `getFk` — extract the FK value from a decoded child record (e.g. `.userId`)
- `parents` — the list of already-loaded parent records
- `getParentId` — extract the PK from a parent record (e.g. `.id`)
-}
loadHasMany :
    Dialect
    -> Schema related
    -> Column related Int
    -> (related -> Int)
    -> List record
    -> (record -> Int)
    -> Loader (List ( record, List related ))
loadHasMany dialect relatedSchema fkCol getFk parents getParentId =
    if List.isEmpty parents then
        Loader.succeed (List.map (\p -> ( p, [] )) parents)

    else
        let
            parentIds =
                List.map getParentId parents

            query =
                Query.from relatedSchema
                    |> Query.where_ (Query.inList parentIds fkCol)

            c =
                Compiler.compileSelect dialect query
        in
        Loader.query { sql = c.sql, params = c.params, decoder = Elmto.decoder relatedSchema }
            |> Loader.map
                (\related ->
                    List.map
                        (\parent ->
                            let
                                pid =
                                    getParentId parent

                                children =
                                    List.filter (\r -> getFk r == pid) related
                            in
                            ( parent, children )
                        )
                        parents
                )


{-| For a list of child records, load each record's single parent via the
child's foreign key (belongsTo / many-to-one). Assumes the parent's PK is
named `id`.

    postsWithUsers : Loader (List ( Post, Maybe User ))
    postsWithUsers =
        Repo.all dialect postQuery
            |> Loader.andThen
                (Repo.loadBelongsTo dialect userSchema .id .userId posts)

Arguments:
- `dialect` — SQLite or PostgreSQL
- `relatedSchema` — schema of the parent table (e.g. userSchema)
- `getRelatedId` — extract the PK from a decoded parent record (e.g. `.id`)
- `getFk` — extract the FK value from a child record (e.g. `.userId`)
- `records` — the list of already-loaded child records
-}
loadBelongsTo :
    Dialect
    -> Schema related
    -> (related -> Int)
    -> (record -> Int)
    -> List record
    -> Loader (List ( record, Maybe related ))
loadBelongsTo dialect relatedSchema getRelatedId getFk records =
    if List.isEmpty records then
        Loader.succeed (List.map (\r -> ( r, Nothing )) records)

    else
        let
            fkIds =
                List.map getFk records

            idColumn =
                Elmto.column "id" Encode.int

            query =
                Query.from relatedSchema
                    |> Query.where_ (Query.inList fkIds idColumn)

            c =
                Compiler.compileSelect dialect query
        in
        Loader.query { sql = c.sql, params = c.params, decoder = Elmto.decoder relatedSchema }
            |> Loader.map
                (\related ->
                    List.map
                        (\record ->
                            let
                                fk =
                                    getFk record

                                matched =
                                    List.filter (\r -> getRelatedId r == fk) related
                                        |> List.head
                            in
                            ( record, matched )
                        )
                        records
                )


preloadHasMany :
    Dialect
    -> Schema related
    -> Column related Int
    -> (related -> Int)
    -> (record -> Int)
    -> (record -> List related -> result)
    -> List record
    -> Loader (List result)
preloadHasMany dialect relatedSchema fkCol getFk getParentId buildResult records =
    loadHasMany dialect relatedSchema fkCol getFk records getParentId
        |> Loader.map (List.map (\( record, related ) -> buildResult record related))


preloadBelongsTo :
    Dialect
    -> Schema related
    -> (related -> Int)
    -> (record -> Int)
    -> (record -> Maybe related -> result)
    -> List record
    -> Loader (List result)
preloadBelongsTo dialect relatedSchema getRelatedId getFk buildResult records =
    loadBelongsTo dialect relatedSchema getRelatedId getFk records
        |> Loader.map (List.map (\( record, related ) -> buildResult record related))
