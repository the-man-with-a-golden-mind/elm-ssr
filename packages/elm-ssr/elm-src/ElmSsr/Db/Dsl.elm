module ElmSsr.Db.Dsl exposing
    ( Table, table
    , Column, column
    , AnyColumn, col
    , Expression
    , Query
    , select, selectAll
    , where_, limit
    , eq, neq, gt, gte, lt, lte, like, inList
    , isNull, isNotNull
    , and, or
    , toLoader, toLoaderOne
    , compileQuery
    )

{-| LEGACY. Elmto is canonical (ElmSsr.Db.Elmto + Repo + Query).
Generator no longer produces Dsl modules. This is for porting only.
-}

import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import ElmSsr.Loader as Loader exposing (Loader)


type Table table
    = Table String


table : String -> Table table
table name =
    Table name


type Column table val
    = Column String (val -> Encode.Value)


column : String -> (val -> Encode.Value) -> Column table val
column name encoder =
    Column name encoder


type AnyColumn table
    = AnyColumn String


col : Column table val -> AnyColumn table
col (Column name _) =
    AnyColumn name


type Expression table
    = Expression String (List Encode.Value)


type Query table a
    = Query
        { tableName : String
        , selection : List String
        , conditions : List (Expression table)
        , limitVal : Maybe Int
        , decoder : Decoder a
        }


eq : val -> Column table val -> Expression table
eq val (Column colName encoder) =
    Expression (colName ++ " = ?") [ encoder val ]


neq : val -> Column table val -> Expression table
neq val (Column colName encoder) =
    Expression (colName ++ " != ?") [ encoder val ]


gt : val -> Column table val -> Expression table
gt val (Column colName encoder) =
    Expression (colName ++ " > ?") [ encoder val ]


gte : val -> Column table val -> Expression table
gte val (Column colName encoder) =
    Expression (colName ++ " >= ?") [ encoder val ]


lt : val -> Column table val -> Expression table
lt val (Column colName encoder) =
    Expression (colName ++ " < ?") [ encoder val ]


lte : val -> Column table val -> Expression table
lte val (Column colName encoder) =
    Expression (colName ++ " <= ?") [ encoder val ]


like : String -> Column table val -> Expression table
like search (Column colName _) =
    Expression (colName ++ " LIKE ?") [ Encode.string search ]


inList : List val -> Column table val -> Expression table
inList values (Column colName encoder) =
    let
        placeholders =
            List.map (\_ -> "?") values |> String.join ", "
    in
    Expression (colName ++ " IN (" ++ placeholders ++ ")") (List.map encoder values)


isNull : Column table val -> Expression table
isNull (Column colName _) =
    Expression (colName ++ " IS NULL") []


isNotNull : Column table val -> Expression table
isNotNull (Column colName _) =
    Expression (colName ++ " IS NOT NULL") []


and : Expression table -> Expression table -> Expression table
and (Expression sql1 params1) (Expression sql2 params2) =
    Expression ("(" ++ sql1 ++ " AND " ++ sql2 ++ ")") (params1 ++ params2)


or : Expression table -> Expression table -> Expression table
or (Expression sql1 params1) (Expression sql2 params2) =
    Expression ("(" ++ sql1 ++ " OR " ++ sql2 ++ ")") (params1 ++ params2)


selectAll : Table table -> Decoder a -> Query table a
selectAll (Table tableName) dec =
    Query
        { tableName = tableName
        , selection = []
        , conditions = []
        , limitVal = Nothing
        , decoder = dec
        }


select : Table table -> List (AnyColumn table) -> Decoder a -> Query table a
select (Table tableName) columns dec =
    let
        selects =
            List.map (\(AnyColumn colName) -> colName) columns
    in
    Query
        { tableName = tableName
        , selection = selects
        , conditions = []
        , limitVal = Nothing
        , decoder = dec
        }


where_ : Expression table -> Query table a -> Query table a
where_ cond (Query q) =
    Query { q | conditions = q.conditions ++ [ cond ] }


limit : Int -> Query table a -> Query table a
limit val (Query q) =
    Query { q | limitVal = Just val }


compileQuery : Query table a -> { sql : String, params : List Encode.Value, decoder : Decoder a }
compileQuery (Query q) =
    let
        selectsStr =
            if List.isEmpty q.selection then
                "*"

            else
                String.join ", " q.selection

        baseSql =
            "SELECT " ++ selectsStr ++ " FROM " ++ q.tableName

        ( whereSql, params ) =
            if List.isEmpty q.conditions then
                ( "", [] )

            else
                let
                    sqls =
                        List.map (\(Expression sql _) -> sql) q.conditions
                            |> String.join " AND"
                            -- Note: we join multi-where conditions with AND
                            -- and wrap the expressions in parentheses if needed,
                            -- but a simple join with AND works since operators have higher precedence.
                    
                    vals =
                        List.map (\(Expression _ valsList) -> valsList) q.conditions
                            |> List.concat
                in
                ( " WHERE " ++ sqls, vals )

        limitSql =
            case q.limitVal of
                Just l ->
                    " LIMIT " ++ String.fromInt l

                Nothing ->
                    ""
    in
    { sql = baseSql ++ whereSql ++ limitSql
    , params = params
    , decoder = q.decoder
    }


toLoader : Query table a -> Loader (List a)
toLoader q =
    let
        c =
            compileQuery q
    in
    Loader.query { sql = c.sql, params = c.params, decoder = c.decoder }


toLoaderOne : Query table a -> Loader (Maybe a)
toLoaderOne q =
    let
        c =
            compileQuery q
    in
    Loader.queryOne { sql = c.sql, params = c.params, decoder = c.decoder }
