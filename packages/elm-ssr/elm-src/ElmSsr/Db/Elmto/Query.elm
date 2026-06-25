module ElmSsr.Db.Elmto.Query exposing
    ( Query, Expression, Selection, JoinType(..), Join, GroupBy, Order, Stat, Having, On
    , from, fromSubquery, select, distinct, withCte, where_, whereJoined, limit, offset, orderBy
    , union, unionAll
    , col, joinedCol, count, joinedCount, sum, joinedSum, avg, joinedAvg, min, joinedMin, max, joinedMax, as_, selectFragment
    , join, joinOn, joinFrom, joinSubquery, groupByCol, groupByJoinedCol, groupBy
    , asc, desc, ascJoined, descJoined
    , countOf, joinedCountOf, sumOf, joinedSumOf, avgOf, joinedAvgOf, minOf, joinedMinOf, maxOf, joinedMaxOf
    , having, havingEq, havingNeq, havingGt, havingGte, havingLt, havingLte, havingAnd, havingOr, havingFragment
    , onEq, onNeq, onGt, onGte, onLt, onLte, onLeft, onRight, onAnd, onOr
    , eq, neq, gt, gte, lt, lte, like, ilike, inList, notInList, between, isNull, isNotNull, and, or, fragment, exists, notExists, inSubquery, notInSubquery, existsBy, notExistsBy
    , toParts, rawSelect, expressionSql, expressionSqlFrom, expressionParams, selectionSql, selectionParams, joinSql, joinParams, groupBySql, orderSql, havingSql, havingParams
    )

import ElmSsr.Db.Elmto as Elmto exposing (Column, Schema)
import Json.Decode as Decode
import Json.Encode as Encode


type alias SqlFragment =
    { sql : String
    , params : List Encode.Value
    }


type alias JoinQualifiers =
    { left : String -> String
    , right : String -> String
    }


type alias ExpressionContext =
    { qualify : String -> String
    , sourceName : String
    }


type Expression record
    = Expression (Bool -> ExpressionContext -> SqlFragment)


type Selection record
    = Selection (Bool -> (String -> String) -> SqlFragment)


type JoinType
    = InnerJoin
    | LeftJoin
    | RightJoin
    | FullJoin


type JoinCondition
    = JoinCondition (Bool -> JoinQualifiers -> SqlFragment)


type On left right
    = On JoinCondition


type Source
    = TableSource String
    | DerivedSource String (Bool -> SqlFragment)


type Join record
    = Join JoinType String Source JoinCondition


type GroupBy record
    = GroupBy ((String -> String) -> String)


type Order
    = Asc ((String -> String) -> String)
    | Desc ((String -> String) -> String)


type Stat record a
    = Stat (Bool -> (String -> String) -> String) (a -> Encode.Value)


type Having record
    = Having (Bool -> (String -> String) -> SqlFragment)


type Cte
    = Cte String (Bool -> SqlFragment)


type UnionKind
    = DistinctUnion
    | AllUnion


type Compound
    = Compound UnionKind (Bool -> SqlFragment)


type Query record selection
    = Query (QueryParts record selection)


type alias QueryParts record selection =
    { sourceName : String
    , source : Source
    , ctes : List Cte
    , selectCols : List (Selection record)
    , isDistinct : Bool
    , joins : List (Join record)
    , groupByCols : List (GroupBy record)
    , conditions : List (Expression record)
    , havingConditions : List (Having record)
    , orderCols : List Order
    , limitVal : Maybe Int
    , offsetVal : Maybe Int
    , compounds : List Compound
    , decoder : Decode.Decoder selection
    }


from : Schema record -> Query record record
from schema =
    let
        sourceName =
            Elmto.tableName schema
    in
    Query
        { sourceName = sourceName
        , source = TableSource sourceName
        , ctes = []
        , selectCols = defaultSelections schema
        , isDistinct = False
        , joins = []
        , groupByCols = []
        , conditions = []
        , havingConditions = []
        , orderCols = []
        , limitVal = Nothing
        , offsetVal = Nothing
        , compounds = []
        , decoder = Elmto.decoder schema
        }


fromSubquery : Schema record -> Query inner selection -> Query record record
fromSubquery schema subquery =
    let
        sourceName =
            Elmto.tableName schema
    in
    Query
        { sourceName = sourceName
        , source = DerivedSource sourceName (\castPostgresNumbers -> rawSelect castPostgresNumbers subquery)
        , ctes = []
        , selectCols = defaultSelections schema
        , isDistinct = False
        , joins = []
        , groupByCols = []
        , conditions = []
        , havingConditions = []
        , orderCols = []
        , limitVal = Nothing
        , offsetVal = Nothing
        , compounds = []
        , decoder = Elmto.decoder schema
        }


withCte : Schema cteRecord -> Query source selection -> Query record out -> Query record out
withCte schema cteQuery (Query q) =
    Query
        { q
            | ctes =
                q.ctes
                    ++ [ Cte (Elmto.tableName schema) (\castPostgresNumbers -> rawSelect castPostgresNumbers cteQuery) ]
        }


select : List (Selection record) -> Decode.Decoder selection -> Query record a -> Query record selection
select selections dec (Query q) =
    Query
        { sourceName = q.sourceName
        , source = q.source
        , ctes = q.ctes
        , selectCols = selections
        , isDistinct = q.isDistinct
        , joins = q.joins
        , groupByCols = q.groupByCols
        , conditions = q.conditions
        , havingConditions = q.havingConditions
        , orderCols = q.orderCols
        , limitVal = q.limitVal
        , offsetVal = q.offsetVal
        , compounds = q.compounds
        , decoder = dec
        }


distinct : Query record selection -> Query record selection
distinct (Query q) =
    Query { q | isDistinct = True }


col : Column record a -> Selection record
col (Elmto.Column name _) =
    Selection (\_ qualify -> noParams (qualify name))


joinedCol : Schema joined -> Column joined a -> Selection record
joinedCol schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    Selection (\_ _ -> noParams (tableName ++ "." ++ name))


count : Column record a -> Selection record
count (Elmto.Column name _) =
    aggregateSelection CountAggregate (baseColumn name)


joinedCount : Schema joined -> Column joined a -> Selection record
joinedCount schema (Elmto.Column name _) =
    aggregateSelection CountAggregate (tableColumn (Elmto.tableName schema) name)


sum : Column record a -> Selection record
sum (Elmto.Column name _) =
    aggregateSelection SumAggregate (baseColumn name)


joinedSum : Schema joined -> Column joined a -> Selection record
joinedSum schema (Elmto.Column name _) =
    aggregateSelection SumAggregate (tableColumn (Elmto.tableName schema) name)


avg : Column record a -> Selection record
avg (Elmto.Column name _) =
    aggregateSelection AvgAggregate (baseColumn name)


joinedAvg : Schema joined -> Column joined a -> Selection record
joinedAvg schema (Elmto.Column name _) =
    aggregateSelection AvgAggregate (tableColumn (Elmto.tableName schema) name)


min : Column record a -> Selection record
min (Elmto.Column name _) =
    aggregateSelection MinAggregate (baseColumn name)


joinedMin : Schema joined -> Column joined a -> Selection record
joinedMin schema (Elmto.Column name _) =
    aggregateSelection MinAggregate (tableColumn (Elmto.tableName schema) name)


max : Column record a -> Selection record
max (Elmto.Column name _) =
    aggregateSelection MaxAggregate (baseColumn name)


joinedMax : Schema joined -> Column joined a -> Selection record
joinedMax schema (Elmto.Column name _) =
    aggregateSelection MaxAggregate (tableColumn (Elmto.tableName schema) name)


selectFragment : String -> List Encode.Value -> String -> Selection record
selectFragment sql params alias =
    Selection (\_ _ -> { sql = sql ++ " AS " ++ alias, params = params })


as_ : String -> Selection record -> Selection record
as_ alias (Selection build) =
    Selection
        (\castPostgresNumbers qualify ->
            let
                fragment_ =
                    build castPostgresNumbers qualify
            in
            { sql = replaceSelectionAlias alias fragment_.sql
            , params = fragment_.params
            }
        )


join : JoinType -> Schema joined -> Column record a -> Column joined a -> Query record selection -> Query record selection
join joinType joinedSchema leftColumn rightColumn query =
    joinOn joinType joinedSchema (onEq leftColumn rightColumn) query


joinOn : JoinType -> Schema joined -> On record joined -> Query record selection -> Query record selection
joinOn joinType joinedSchema onCondition (Query q) =
    Query
        { q
            | joins =
                q.joins
                    ++ [ Join joinType q.sourceName (TableSource (Elmto.tableName joinedSchema)) (eraseOn onCondition) ]
        }


joinFrom : JoinType -> Schema left -> Schema joined -> On left joined -> Query record selection -> Query record selection
joinFrom joinType leftSchema joinedSchema onCondition (Query q) =
    Query
        { q
            | joins =
                q.joins
                    ++ [ Join joinType (Elmto.tableName leftSchema) (TableSource (Elmto.tableName joinedSchema)) (eraseOn onCondition) ]
        }


joinSubquery : JoinType -> Schema joined -> Query inner selection -> On record joined -> Query record out -> Query record out
joinSubquery joinType joinedSchema subquery onCondition (Query q) =
    Query
        { q
            | joins =
                q.joins
                    ++ [ Join joinType q.sourceName (DerivedSource (Elmto.tableName joinedSchema) (\castPostgresNumbers -> rawSelect castPostgresNumbers subquery)) (eraseOn onCondition) ]
        }


groupByCol : Column record a -> GroupBy record
groupByCol (Elmto.Column name _) =
    GroupBy (\qualify -> qualify name)


groupByJoinedCol : Schema joined -> Column joined a -> GroupBy record
groupByJoinedCol schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    GroupBy (\_ -> tableName ++ "." ++ name)


groupBy : List (GroupBy record) -> Query record selection -> Query record selection
groupBy cols (Query q) =
    Query { q | groupByCols = q.groupByCols ++ cols }


toParts : Query record selection -> QueryParts record selection
toParts (Query q) =
    q


where_ : Expression record -> Query record selection -> Query record selection
where_ cond (Query q) =
    Query { q | conditions = q.conditions ++ [ cond ] }


whereJoined : Schema joined -> Expression joined -> Query record selection -> Query record selection
whereJoined schema (Expression build) (Query q) =
    let
        tableName =
            Elmto.tableName schema
    in
    Query
        { q
            | conditions =
                q.conditions
                    ++ [ Expression (\castPostgresNumbers _ -> build castPostgresNumbers { qualify = (\name -> tableName ++ "." ++ name), sourceName = tableName }) ]
        }


having : Having record -> Query record selection -> Query record selection
having cond (Query q) =
    Query { q | havingConditions = q.havingConditions ++ [ cond ] }


limit : Int -> Query record selection -> Query record selection
limit val (Query q) =
    Query { q | limitVal = Just val }


offset : Int -> Query record selection -> Query record selection
offset val (Query q) =
    Query { q | offsetVal = Just val }


orderBy : List Order -> Query record selection -> Query record selection
orderBy orders (Query q) =
    Query { q | orderCols = q.orderCols ++ orders }


union : Query other selection -> Query record selection -> Query record selection
union otherQuery (Query q) =
    Query
        { q
            | compounds =
                q.compounds ++ [ Compound DistinctUnion (\castPostgresNumbers -> selectCore castPostgresNumbers (toParts otherQuery)) ]
        }


unionAll : Query other selection -> Query record selection -> Query record selection
unionAll otherQuery (Query q) =
    Query
        { q
            | compounds =
                q.compounds ++ [ Compound AllUnion (\castPostgresNumbers -> selectCore castPostgresNumbers (toParts otherQuery)) ]
        }


asc : Column record a -> Order
asc (Elmto.Column name _) =
    Asc (\qualify -> qualify name)


desc : Column record a -> Order
desc (Elmto.Column name _) =
    Desc (\qualify -> qualify name)


ascJoined : Schema joined -> Column joined a -> Order
ascJoined schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    Asc (\_ -> tableName ++ "." ++ name)


descJoined : Schema joined -> Column joined a -> Order
descJoined schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    Desc (\_ -> tableName ++ "." ++ name)


countOf : Column record a -> Stat record Int
countOf (Elmto.Column name _) =
    Stat (\_ qualify -> aggregateSql False CountAggregate (qualify name)) Encode.int


joinedCountOf : Schema joined -> Column joined a -> Stat record Int
joinedCountOf schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    Stat (\_ _ -> aggregateSql False CountAggregate (tableName ++ "." ++ name)) Encode.int


sumOf : Column record a -> Stat record a
sumOf (Elmto.Column name encoder) =
    Stat (\_ qualify -> aggregateSql False SumAggregate (qualify name)) encoder


joinedSumOf : Schema joined -> Column joined a -> Stat record a
joinedSumOf schema (Elmto.Column name encoder) =
    let
        tableName =
            Elmto.tableName schema
    in
    Stat (\_ _ -> aggregateSql False SumAggregate (tableName ++ "." ++ name)) encoder


avgOf : Column record a -> Stat record Float
avgOf (Elmto.Column name _) =
    Stat (\_ qualify -> aggregateSql False AvgAggregate (qualify name)) Encode.float


joinedAvgOf : Schema joined -> Column joined a -> Stat record Float
joinedAvgOf schema (Elmto.Column name _) =
    let
        tableName =
            Elmto.tableName schema
    in
    Stat (\_ _ -> aggregateSql False AvgAggregate (tableName ++ "." ++ name)) Encode.float


minOf : Column record a -> Stat record a
minOf (Elmto.Column name encoder) =
    Stat (\_ qualify -> aggregateSql False MinAggregate (qualify name)) encoder


joinedMinOf : Schema joined -> Column joined a -> Stat record a
joinedMinOf schema (Elmto.Column name encoder) =
    let
        tableName =
            Elmto.tableName schema
    in
    Stat (\_ _ -> aggregateSql False MinAggregate (tableName ++ "." ++ name)) encoder


maxOf : Column record a -> Stat record a
maxOf (Elmto.Column name encoder) =
    Stat (\_ qualify -> aggregateSql False MaxAggregate (qualify name)) encoder


joinedMaxOf : Schema joined -> Column joined a -> Stat record a
joinedMaxOf schema (Elmto.Column name encoder) =
    let
        tableName =
            Elmto.tableName schema
    in
    Stat (\_ _ -> aggregateSql False MaxAggregate (tableName ++ "." ++ name)) encoder


havingEq : a -> Stat record a -> Having record
havingEq =
    havingCompare "="


havingNeq : a -> Stat record a -> Having record
havingNeq =
    havingCompare "!="


havingGt : a -> Stat record a -> Having record
havingGt =
    havingCompare ">"


havingGte : a -> Stat record a -> Having record
havingGte =
    havingCompare ">="


havingLt : a -> Stat record a -> Having record
havingLt =
    havingCompare "<"


havingLte : a -> Stat record a -> Having record
havingLte =
    havingCompare "<="


havingAnd : Having record -> Having record -> Having record
havingAnd (Having leftBuild) (Having rightBuild) =
    Having
        (\castPostgresNumbers qualify ->
            combineFragments " AND " (leftBuild castPostgresNumbers qualify) (rightBuild castPostgresNumbers qualify)
        )


havingOr : Having record -> Having record -> Having record
havingOr (Having leftBuild) (Having rightBuild) =
    Having
        (\castPostgresNumbers qualify ->
            combineFragments " OR " (leftBuild castPostgresNumbers qualify) (rightBuild castPostgresNumbers qualify)
        )


havingFragment : String -> List Encode.Value -> Having record
havingFragment sql params =
    Having (\_ _ -> { sql = sql, params = params })


onEq : Column left a -> Column right a -> On left right
onEq =
    onCompare "="


onNeq : Column left a -> Column right a -> On left right
onNeq =
    onCompare "!="


onGt : Column left a -> Column right a -> On left right
onGt =
    onCompare ">"


onGte : Column left a -> Column right a -> On left right
onGte =
    onCompare ">="


onLt : Column left a -> Column right a -> On left right
onLt =
    onCompare "<"


onLte : Column left a -> Column right a -> On left right
onLte =
    onCompare "<="


onLeft : Expression left -> On left right
onLeft (Expression build) =
    On (JoinCondition (\castPostgresNumbers qualify -> build castPostgresNumbers { qualify = qualify.left, sourceName = "" }))


onRight : Expression right -> On left right
onRight (Expression build) =
    On (JoinCondition (\castPostgresNumbers qualify -> build castPostgresNumbers { qualify = qualify.right, sourceName = "" }))


onAnd : On left right -> On left right -> On left right
onAnd (On (JoinCondition leftBuild)) (On (JoinCondition rightBuild)) =
    On
        (JoinCondition
            (\castPostgresNumbers qualify ->
                combineFragments " AND " (leftBuild castPostgresNumbers qualify) (rightBuild castPostgresNumbers qualify)
            )
        )


onOr : On left right -> On left right -> On left right
onOr (On (JoinCondition leftBuild)) (On (JoinCondition rightBuild)) =
    On
        (JoinCondition
            (\castPostgresNumbers qualify ->
                combineFragments " OR " (leftBuild castPostgresNumbers qualify) (rightBuild castPostgresNumbers qualify)
            )
        )


eq : a -> Column record a -> Expression record
eq val (Elmto.Column colName encoder) =
    compareValue "=" colName encoder val


neq : a -> Column record a -> Expression record
neq val (Elmto.Column colName encoder) =
    compareValue "!=" colName encoder val


gt : a -> Column record a -> Expression record
gt val (Elmto.Column colName encoder) =
    compareValue ">" colName encoder val


gte : a -> Column record a -> Expression record
gte val (Elmto.Column colName encoder) =
    compareValue ">=" colName encoder val


lt : a -> Column record a -> Expression record
lt val (Elmto.Column colName encoder) =
    compareValue "<" colName encoder val


lte : a -> Column record a -> Expression record
lte val (Elmto.Column colName encoder) =
    compareValue "<=" colName encoder val


like : String -> Column record a -> Expression record
like search (Elmto.Column colName _) =
    Expression (\_ ctx -> { sql = ctx.qualify colName ++ " LIKE ?", params = [ Encode.string search ] })


ilike : String -> Column record a -> Expression record
ilike search (Elmto.Column colName _) =
    Expression (\_ ctx -> { sql = "LOWER(" ++ ctx.qualify colName ++ ") LIKE LOWER(?)", params = [ Encode.string search ] })


inList : List a -> Column record a -> Expression record
inList values (Elmto.Column colName encoder) =
    if List.isEmpty values then
        fragment "1 = 0" []

    else
        let
            placeholders =
                List.map (\_ -> "?") values |> String.join ", "
        in
        Expression
            (\_ ctx ->
                { sql = ctx.qualify colName ++ " IN (" ++ placeholders ++ ")"
                , params = List.map encoder values
                }
            )


notInList : List a -> Column record a -> Expression record
notInList values (Elmto.Column colName encoder) =
    if List.isEmpty values then
        fragment "1 = 1" []

    else
        let
            placeholders =
                List.map (\_ -> "?") values |> String.join ", "
        in
        Expression
            (\_ ctx ->
                { sql = ctx.qualify colName ++ " NOT IN (" ++ placeholders ++ ")"
                , params = List.map encoder values
                }
            )


between : a -> a -> Column record a -> Expression record
between low high (Elmto.Column colName encoder) =
    Expression
        (\_ ctx ->
            { sql = ctx.qualify colName ++ " BETWEEN ? AND ?"
            , params = [ encoder low, encoder high ]
            }
        )


isNull : Column record a -> Expression record
isNull (Elmto.Column colName _) =
    Expression (\_ ctx -> noParams (ctx.qualify colName ++ " IS NULL"))


isNotNull : Column record a -> Expression record
isNotNull (Elmto.Column colName _) =
    Expression (\_ ctx -> noParams (ctx.qualify colName ++ " IS NOT NULL"))


and : Expression record -> Expression record -> Expression record
and (Expression leftBuild) (Expression rightBuild) =
    Expression
        (\castPostgresNumbers ctx ->
            combineFragments " AND " (leftBuild castPostgresNumbers ctx) (rightBuild castPostgresNumbers ctx)
        )


or : Expression record -> Expression record -> Expression record
or (Expression leftBuild) (Expression rightBuild) =
    Expression
        (\castPostgresNumbers ctx ->
            combineFragments " OR " (leftBuild castPostgresNumbers ctx) (rightBuild castPostgresNumbers ctx)
        )


fragment : String -> List Encode.Value -> Expression record
fragment sql params =
    Expression (\_ _ -> { sql = sql, params = params })


exists : Query inner selection -> Expression record
exists query =
    Expression
        (\castPostgresNumbers _ ->
            let
                compiled =
                    rawSelect castPostgresNumbers query
            in
            { sql = "EXISTS (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


notExists : Query inner selection -> Expression record
notExists query =
    Expression
        (\castPostgresNumbers _ ->
            let
                compiled =
                    rawSelect castPostgresNumbers query
            in
            { sql = "NOT EXISTS (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


inSubquery : Column record a -> Query inner selection -> Expression record
inSubquery (Elmto.Column colName _) query =
    Expression
        (\castPostgresNumbers ctx ->
            let
                compiled =
                    rawSelect castPostgresNumbers query
            in
            { sql = ctx.qualify colName ++ " IN (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


notInSubquery : Column record a -> Query inner selection -> Expression record
notInSubquery (Elmto.Column colName _) query =
    Expression
        (\castPostgresNumbers ctx ->
            let
                compiled =
                    rawSelect castPostgresNumbers query
            in
            { sql = ctx.qualify colName ++ " NOT IN (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


existsBy : Column outer a -> Column inner a -> Query inner selection -> Expression outer
existsBy (Elmto.Column outerName _) (Elmto.Column innerName _) query =
    Expression
        (\castPostgresNumbers ctx ->
            let
                correlatedQuery =
                    where_
                        (Expression
                            (\_ innerCtx ->
                                noParams (innerCtx.qualify innerName ++ " = " ++ ctx.sourceName ++ "." ++ outerName)
                            )
                        )
                        query

                compiled =
                    rawSelect castPostgresNumbers correlatedQuery
            in
            { sql = "EXISTS (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


notExistsBy : Column outer a -> Column inner a -> Query inner selection -> Expression outer
notExistsBy (Elmto.Column outerName _) (Elmto.Column innerName _) query =
    Expression
        (\castPostgresNumbers ctx ->
            let
                correlatedQuery =
                    where_
                        (Expression
                            (\_ innerCtx ->
                                noParams (innerCtx.qualify innerName ++ " = " ++ ctx.sourceName ++ "." ++ outerName)
                            )
                        )
                        query

                compiled =
                    rawSelect castPostgresNumbers correlatedQuery
            in
            { sql = "NOT EXISTS (" ++ compiled.sql ++ ")"
            , params = compiled.params
            }
        )


rawSelect : Bool -> Query record selection -> SqlFragment
rawSelect castPostgresNumbers query =
    let
        q =
            toParts query

        baseFragment =
            selectCore castPostgresNumbers q

        qualifyBase name =
            if List.isEmpty q.joins then
                name

            else
                q.sourceName ++ "." ++ name

        orderClause =
            if List.isEmpty q.orderCols then
                ""

            else
                " ORDER BY " ++ String.join ", " (List.map (orderSql qualifyBase) q.orderCols)

        limitClause =
            case q.limitVal of
                Just value ->
                    " LIMIT " ++ String.fromInt value

                Nothing ->
                    ""

        offsetClause =
            case q.offsetVal of
                Just value ->
                    " OFFSET " ++ String.fromInt value

                Nothing ->
                    ""

        compoundFragments =
            List.map (compoundFragment castPostgresNumbers) q.compounds

        unionSql =
            if List.isEmpty compoundFragments then
                baseFragment.sql

            else
                baseFragment.sql ++ " " ++ String.join " " (List.map .sql compoundFragments)
    in
    { sql =
        unionSql
            ++ orderClause
            ++ limitClause
            ++ offsetClause
    , params =
        baseFragment.params
            ++ List.concatMap .params compoundFragments
    }


selectCore : Bool -> QueryParts record selection -> SqlFragment
selectCore castPostgresNumbers q =
    let
        qualifyBase name =
            if List.isEmpty q.joins then
                name

            else
                q.sourceName ++ "." ++ name

        cteFragments =
            List.map (cteFragment castPostgresNumbers) q.ctes

        withSql =
            if List.isEmpty cteFragments then
                ""

            else
                "WITH " ++ String.join ", " (List.map .sql cteFragments) ++ " "

        selectFragments =
            List.map (\selection_ -> selectionFragment castPostgresNumbers qualifyBase selection_) q.selectCols

        selectSqls =
            List.map .sql selectFragments

        sourceFragment =
            sourceSql castPostgresNumbers q.source

        joinFragments =
            List.map (joinFragment castPostgresNumbers) q.joins

        whereFragments =
            List.map (\expr -> expressionFragment castPostgresNumbers qualifyBase q.sourceName expr) q.conditions

        havingFragments =
            List.map (\having_ -> havingFragmentInternal castPostgresNumbers qualifyBase having_) q.havingConditions

        groupByClause =
            if List.isEmpty q.groupByCols then
                ""

            else
                " GROUP BY " ++ String.join ", " (List.map (groupBySql qualifyBase) q.groupByCols)

        whereClause =
            if List.isEmpty whereFragments then
                ""

            else
                " WHERE " ++ String.join " AND " (List.map .sql whereFragments)

        havingClause =
            if List.isEmpty havingFragments then
                ""

            else
                " HAVING " ++ String.join " AND " (List.map .sql havingFragments)
    in
    { sql =
        withSql
            ++ "SELECT "
            ++ (if q.isDistinct then
                    "DISTINCT "

                else
                    ""
               )
            ++ String.join ", " selectSqls
            ++ " FROM "
            ++ sourceFragment.sql
            ++ joinClause joinFragments
            ++ whereClause
            ++ groupByClause
            ++ havingClause
    , params =
        List.concatMap .params cteFragments
            ++ List.concatMap .params selectFragments
            ++ sourceFragment.params
            ++ List.concatMap .params joinFragments
            ++ List.concatMap .params whereFragments
            ++ List.concatMap .params havingFragments
    }


expressionSql : (String -> String) -> Expression record -> String
expressionSql qualify (Expression build) =
    (build False { qualify = qualify, sourceName = "" }).sql


expressionSqlFrom : String -> (String -> String) -> Expression record -> String
expressionSqlFrom sourceName qualify (Expression build) =
    (build False { qualify = qualify, sourceName = sourceName }).sql


expressionParams : Expression record -> List Encode.Value
expressionParams (Expression build) =
    (build False { qualify = identity, sourceName = "" }).params


selectionSql : Bool -> (String -> String) -> Selection record -> String
selectionSql castPostgresNumbers qualify (Selection build) =
    (build castPostgresNumbers qualify).sql


selectionParams : Bool -> Selection record -> List Encode.Value
selectionParams castPostgresNumbers (Selection build) =
    (build castPostgresNumbers identity).params


joinSql : String -> Join record -> String
joinSql _ join_ =
    (joinFragment False join_).sql


joinParams : Join record -> List Encode.Value
joinParams join_ =
    (joinFragment False join_).params


groupBySql : (String -> String) -> GroupBy record -> String
groupBySql qualify (GroupBy build) =
    build qualify


orderSql : (String -> String) -> Order -> String
orderSql qualify order =
    case order of
        Asc build ->
            build qualify ++ " ASC"

        Desc build ->
            build qualify ++ " DESC"


havingSql : (String -> String) -> Having record -> String
havingSql qualify (Having build) =
    (build False qualify).sql


havingParams : Having record -> List Encode.Value
havingParams (Having build) =
    (build False identity).params


type AggregateKind
    = CountAggregate
    | SumAggregate
    | AvgAggregate
    | MinAggregate
    | MaxAggregate


defaultSelections : Schema record -> List (Selection record)
defaultSelections schema =
    Elmto.fields schema
        |> List.map (\field -> Selection (\_ qualify -> noParams (qualify field.name)))


aggregateSelection : AggregateKind -> (Bool -> (String -> String) -> String) -> Selection record
aggregateSelection kind buildColumn =
    Selection
        (\castPostgresNumbers qualify ->
            let
                columnSql =
                    buildColumn castPostgresNumbers qualify

                sql =
                    aggregateSql castPostgresNumbers kind columnSql

                alias =
                    defaultAggregateAlias kind columnSql
            in
            noParams (sql ++ " AS " ++ alias)
        )


baseColumn : String -> Bool -> (String -> String) -> String
baseColumn name _ qualify =
    qualify name


tableColumn : String -> String -> Bool -> (String -> String) -> String
tableColumn tableName name _ _ =
    tableName ++ "." ++ name


aggregateSql : Bool -> AggregateKind -> String -> String
aggregateSql castPostgresNumbers kind columnSql =
    aggregateName kind
        ++ "("
        ++ columnSql
        ++ ")"
        ++ postgresAggregateCast castPostgresNumbers kind


aggregateName : AggregateKind -> String
aggregateName kind =
    case kind of
        CountAggregate ->
            "COUNT"

        SumAggregate ->
            "SUM"

        AvgAggregate ->
            "AVG"

        MinAggregate ->
            "MIN"

        MaxAggregate ->
            "MAX"


postgresAggregateCast : Bool -> AggregateKind -> String
postgresAggregateCast castPostgresNumbers kind =
    if not castPostgresNumbers then
        ""

    else
        case kind of
            CountAggregate ->
                "::int"

            SumAggregate ->
                "::float"

            AvgAggregate ->
                "::float"

            MinAggregate ->
                ""

            MaxAggregate ->
                ""


defaultAggregateAlias : AggregateKind -> String -> String
defaultAggregateAlias kind columnSql =
    String.toLower (aggregateName kind) ++ "_" ++ lastSqlName columnSql


lastSqlName : String -> String
lastSqlName sql =
    case List.reverse (String.split "." sql) of
        name :: _ ->
            name

        [] ->
            sql


compareValue : String -> String -> (a -> Encode.Value) -> a -> Expression record
compareValue op colName encoder value =
    Expression
        (\_ ctx ->
            { sql = ctx.qualify colName ++ " " ++ op ++ " ?"
            , params = [ encoder value ]
            }
        )


havingCompare : String -> a -> Stat record a -> Having record
havingCompare op value (Stat build encoder) =
    Having
        (\castPostgresNumbers qualify ->
            { sql = build castPostgresNumbers qualify ++ " " ++ op ++ " ?"
            , params = [ encoder value ]
            }
        )


onCompare : String -> Column left a -> Column right a -> On left right
onCompare op (Elmto.Column leftName _) (Elmto.Column rightName _) =
    On
        (JoinCondition
            (\_ qualify ->
                noParams (qualify.left leftName ++ " " ++ op ++ " " ++ qualify.right rightName)
            )
        )


eraseOn : On left right -> JoinCondition
eraseOn (On condition) =
    condition


sourceNameOf : Source -> String
sourceNameOf source =
    case source of
        TableSource name ->
            name

        DerivedSource alias _ ->
            alias


sourceSql : Bool -> Source -> SqlFragment
sourceSql castPostgresNumbers source =
    case source of
        TableSource name ->
            noParams name

        DerivedSource alias build ->
            let
                compiled =
                    build castPostgresNumbers
            in
            { sql = "(" ++ compiled.sql ++ ") AS " ++ alias
            , params = compiled.params
            }


cteFragment : Bool -> Cte -> SqlFragment
cteFragment castPostgresNumbers (Cte name build) =
    let
        compiled =
            build castPostgresNumbers
    in
    { sql = name ++ " AS (" ++ compiled.sql ++ ")"
    , params = compiled.params
    }


compoundFragment : Bool -> Compound -> SqlFragment
compoundFragment castPostgresNumbers compound =
    case compound of
        Compound kind build ->
            let
                compiled =
                    build castPostgresNumbers
            in
            { sql = unionKindSql kind ++ " " ++ compiled.sql
            , params = compiled.params
            }


selectionFragment : Bool -> (String -> String) -> Selection record -> SqlFragment
selectionFragment castPostgresNumbers qualify (Selection build) =
    build castPostgresNumbers qualify


expressionFragment : Bool -> (String -> String) -> String -> Expression record -> SqlFragment
expressionFragment castPostgresNumbers qualify sourceName (Expression build) =
    build castPostgresNumbers { qualify = qualify, sourceName = sourceName }


havingFragmentInternal : Bool -> (String -> String) -> Having record -> SqlFragment
havingFragmentInternal castPostgresNumbers qualify (Having build) =
    build castPostgresNumbers qualify


joinFragment : Bool -> Join record -> SqlFragment
joinFragment castPostgresNumbers join_ =
    case join_ of
        Join joinType leftName rightSource (JoinCondition buildCondition) ->
            let
                rightFragment =
                    sourceSql castPostgresNumbers rightSource

                rightName =
                    sourceNameOf rightSource

                conditionFragment =
                    buildCondition castPostgresNumbers
                        { left = \name -> leftName ++ "." ++ name
                        , right = \name -> rightName ++ "." ++ name
                        }
            in
            { sql = joinTypeSql joinType ++ " " ++ rightFragment.sql ++ " ON " ++ conditionFragment.sql
            , params = rightFragment.params ++ conditionFragment.params
            }


joinClause : List SqlFragment -> String
joinClause fragments =
    if List.isEmpty fragments then
        ""

    else
        " " ++ String.join " " (List.map .sql fragments)


unionKindSql : UnionKind -> String
unionKindSql kind =
    case kind of
        DistinctUnion ->
            "UNION"

        AllUnion ->
            "UNION ALL"


joinTypeSql : JoinType -> String
joinTypeSql joinType =
    case joinType of
        InnerJoin ->
            "INNER JOIN"

        LeftJoin ->
            "LEFT JOIN"

        RightJoin ->
            "RIGHT JOIN"

        FullJoin ->
            "FULL JOIN"


combineFragments : String -> SqlFragment -> SqlFragment -> SqlFragment
combineFragments operator leftFragment rightFragment =
    { sql = "(" ++ leftFragment.sql ++ operator ++ rightFragment.sql ++ ")"
    , params = leftFragment.params ++ rightFragment.params
    }


noParams : String -> SqlFragment
noParams sql =
    { sql = sql, params = [] }


replaceSelectionAlias : String -> String -> String
replaceSelectionAlias alias sql =
    stripTrailingAlias sql ++ " AS " ++ alias


stripTrailingAlias : String -> String
stripTrailingAlias sql =
    let
        parts =
            String.split " AS " sql
    in
    case List.reverse parts of
        _ :: restReversed ->
            case List.reverse restReversed of
                [] ->
                    sql

                remaining ->
                    String.join " AS " remaining

        [] ->
            sql
