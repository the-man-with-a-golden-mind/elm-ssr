module ElmSsr.Db.Elmto.Query exposing
    ( Query, Expression, Selection, JoinType(..), Join, GroupBy, Order, Stat, Having
    , from, select, where_, whereJoined, limit, offset, orderBy
    , col, joinedCol, count, joinedCount, sum, joinedSum, avg, joinedAvg, min, joinedMin, max, joinedMax, as_
    , join, groupByCol, groupByJoinedCol, groupBy
    , asc, desc, ascJoined, descJoined
    , countOf, joinedCountOf, sumOf, joinedSumOf, avgOf, joinedAvgOf, minOf, joinedMinOf, maxOf, joinedMaxOf
    , having, havingEq, havingNeq, havingGt, havingGte, havingLt, havingLte, havingAnd, havingOr
    , eq, neq, gt, gte, lt, lte, like, inList, isNull, isNotNull, and, or
    , toParts, expressionSql, expressionParams, selectionSql, joinSql, groupBySql, orderSql, havingSql, havingParams
    )

import ElmSsr.Db.Elmto as Elmto exposing (Column, Schema)
import Json.Decode as Decode
import Json.Encode as Encode


type Expression record
    = Expression ((String -> String) -> String) (List Encode.Value)


type QualifiedColumn
    = BaseColumn String
    | TableColumn String String


type AggregateKind
    = CountAggregate
    | SumAggregate
    | AvgAggregate
    | MinAggregate
    | MaxAggregate


type Selection record
    = ColumnSelection QualifiedColumn (Maybe String)
    | AggregateSelection AggregateKind QualifiedColumn (Maybe String)


type JoinType
    = InnerJoin
    | LeftJoin
    | RightJoin
    | FullJoin


type Join record
    = Join JoinType String String String


type GroupBy record
    = GroupBy QualifiedColumn


type Order
    = Asc QualifiedColumn
    | Desc QualifiedColumn


type Stat record a
    = Stat ((String -> String) -> String) (a -> Encode.Value)


type Having record
    = Having ((String -> String) -> String) (List Encode.Value)


type Query record selection
    = Query (QueryParts record selection)


type alias QueryParts record selection =
    { tableName : String
    , selectCols : List (Selection record)
    , joins : List (Join record)
    , groupByCols : List (GroupBy record)
    , conditions : List (Expression record)
    , havingConditions : List (Having record)
    , orderCols : List Order
    , limitVal : Maybe Int
    , offsetVal : Maybe Int
    , decoder : Decode.Decoder selection
    }


from : Schema record -> Query record record
from schema =
    let
        schemaFields =
            Elmto.fields schema

        colNames =
            List.map (\f -> f.name) schemaFields
    in
    Query
        { tableName = Elmto.tableName schema
        , selectCols = List.map (\name -> ColumnSelection (BaseColumn name) Nothing) colNames
        , joins = []
        , groupByCols = []
        , conditions = []
        , havingConditions = []
        , orderCols = []
        , limitVal = Nothing
        , offsetVal = Nothing
        , decoder = Elmto.decoder schema
        }


select : List (Selection record) -> Decode.Decoder selection -> Query record a -> Query record selection
select selections dec (Query q) =
    Query
        { tableName = q.tableName
        , selectCols = selections
        , joins = q.joins
        , groupByCols = q.groupByCols
        , conditions = q.conditions
        , havingConditions = q.havingConditions
        , orderCols = q.orderCols
        , limitVal = q.limitVal
        , offsetVal = q.offsetVal
        , decoder = dec
        }


col : Column record a -> Selection record
col (Elmto.Column name _) =
    ColumnSelection (BaseColumn name) Nothing


joinedCol : Schema joined -> Column joined a -> Selection record
joinedCol schema (Elmto.Column name _) =
    ColumnSelection (TableColumn (Elmto.tableName schema) name) Nothing


count : Column record a -> Selection record
count (Elmto.Column name _) =
    AggregateSelection CountAggregate (BaseColumn name) Nothing


joinedCount : Schema joined -> Column joined a -> Selection record
joinedCount schema (Elmto.Column name _) =
    AggregateSelection CountAggregate (TableColumn (Elmto.tableName schema) name) Nothing


sum : Column record a -> Selection record
sum (Elmto.Column name _) =
    AggregateSelection SumAggregate (BaseColumn name) Nothing


joinedSum : Schema joined -> Column joined a -> Selection record
joinedSum schema (Elmto.Column name _) =
    AggregateSelection SumAggregate (TableColumn (Elmto.tableName schema) name) Nothing


avg : Column record a -> Selection record
avg (Elmto.Column name _) =
    AggregateSelection AvgAggregate (BaseColumn name) Nothing


joinedAvg : Schema joined -> Column joined a -> Selection record
joinedAvg schema (Elmto.Column name _) =
    AggregateSelection AvgAggregate (TableColumn (Elmto.tableName schema) name) Nothing


min : Column record a -> Selection record
min (Elmto.Column name _) =
    AggregateSelection MinAggregate (BaseColumn name) Nothing


joinedMin : Schema joined -> Column joined a -> Selection record
joinedMin schema (Elmto.Column name _) =
    AggregateSelection MinAggregate (TableColumn (Elmto.tableName schema) name) Nothing


max : Column record a -> Selection record
max (Elmto.Column name _) =
    AggregateSelection MaxAggregate (BaseColumn name) Nothing


joinedMax : Schema joined -> Column joined a -> Selection record
joinedMax schema (Elmto.Column name _) =
    AggregateSelection MaxAggregate (TableColumn (Elmto.tableName schema) name) Nothing


as_ : String -> Selection record -> Selection record
as_ alias selection =
    case selection of
        ColumnSelection column _ ->
            ColumnSelection column (Just alias)

        AggregateSelection kind column _ ->
            AggregateSelection kind column (Just alias)


join : JoinType -> Schema joined -> Column record a -> Column joined a -> Query record selection -> Query record selection
join joinType joinedSchema (Elmto.Column leftCol _) (Elmto.Column rightCol _) (Query q) =
    Query { q | joins = q.joins ++ [ Join joinType (Elmto.tableName joinedSchema) leftCol rightCol ] }


groupByCol : Column record a -> GroupBy record
groupByCol (Elmto.Column name _) =
    GroupBy (BaseColumn name)


groupByJoinedCol : Schema joined -> Column joined a -> GroupBy record
groupByJoinedCol schema (Elmto.Column name _) =
    GroupBy (TableColumn (Elmto.tableName schema) name)


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
whereJoined schema (Expression toSql params) (Query q) =
    let
        tableName =
            Elmto.tableName schema

        joinedExpression =
            Expression (\_ -> toSql (\name -> tableName ++ "." ++ name)) params
    in
    Query { q | conditions = q.conditions ++ [ joinedExpression ] }


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


asc : Column record a -> Order
asc (Elmto.Column name _) =
    Asc (BaseColumn name)


desc : Column record a -> Order
desc (Elmto.Column name _) =
    Desc (BaseColumn name)


ascJoined : Schema joined -> Column joined a -> Order
ascJoined schema (Elmto.Column name _) =
    Asc (TableColumn (Elmto.tableName schema) name)


descJoined : Schema joined -> Column joined a -> Order
descJoined schema (Elmto.Column name _) =
    Desc (TableColumn (Elmto.tableName schema) name)


countOf : Column record a -> Stat record Int
countOf (Elmto.Column name _) =
    Stat (\qualify -> aggregateSql False CountAggregate qualify (BaseColumn name)) Encode.int


joinedCountOf : Schema joined -> Column joined a -> Stat record Int
joinedCountOf schema (Elmto.Column name _) =
    Stat (\qualify -> aggregateSql False CountAggregate qualify (TableColumn (Elmto.tableName schema) name)) Encode.int


sumOf : Column record a -> Stat record a
sumOf (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False SumAggregate qualify (BaseColumn name)) encoder


joinedSumOf : Schema joined -> Column joined a -> Stat record a
joinedSumOf schema (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False SumAggregate qualify (TableColumn (Elmto.tableName schema) name)) encoder


avgOf : Column record a -> Stat record Float
avgOf (Elmto.Column name _) =
    Stat (\qualify -> aggregateSql False AvgAggregate qualify (BaseColumn name)) Encode.float


joinedAvgOf : Schema joined -> Column joined a -> Stat record Float
joinedAvgOf schema (Elmto.Column name _) =
    Stat (\qualify -> aggregateSql False AvgAggregate qualify (TableColumn (Elmto.tableName schema) name)) Encode.float


minOf : Column record a -> Stat record a
minOf (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False MinAggregate qualify (BaseColumn name)) encoder


joinedMinOf : Schema joined -> Column joined a -> Stat record a
joinedMinOf schema (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False MinAggregate qualify (TableColumn (Elmto.tableName schema) name)) encoder


maxOf : Column record a -> Stat record a
maxOf (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False MaxAggregate qualify (BaseColumn name)) encoder


joinedMaxOf : Schema joined -> Column joined a -> Stat record a
joinedMaxOf schema (Elmto.Column name encoder) =
    Stat (\qualify -> aggregateSql False MaxAggregate qualify (TableColumn (Elmto.tableName schema) name)) encoder


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
havingAnd (Having sql1 params1) (Having sql2 params2) =
    Having (\qualify -> "(" ++ sql1 qualify ++ " AND " ++ sql2 qualify ++ ")") (params1 ++ params2)


havingOr : Having record -> Having record -> Having record
havingOr (Having sql1 params1) (Having sql2 params2) =
    Having (\qualify -> "(" ++ sql1 qualify ++ " OR " ++ sql2 qualify ++ ")") (params1 ++ params2)


havingCompare : String -> a -> Stat record a -> Having record
havingCompare op value (Stat toSql encoder) =
    Having (\qualify -> toSql qualify ++ " " ++ op ++ " ?") [ encoder value ]


eq : a -> Column record a -> Expression record
eq val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " = ?") [ encoder val ]


neq : a -> Column record a -> Expression record
neq val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " != ?") [ encoder val ]


gt : a -> Column record a -> Expression record
gt val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " > ?") [ encoder val ]


gte : a -> Column record a -> Expression record
gte val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " >= ?") [ encoder val ]


lt : a -> Column record a -> Expression record
lt val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " < ?") [ encoder val ]


lte : a -> Column record a -> Expression record
lte val (Elmto.Column colName encoder) =
    Expression (\qualify -> qualify colName ++ " <= ?") [ encoder val ]


like : String -> Column record a -> Expression record
like search (Elmto.Column colName _) =
    Expression (\qualify -> qualify colName ++ " LIKE ?") [ Encode.string search ]


inList : List a -> Column record a -> Expression record
inList values (Elmto.Column colName encoder) =
    let
        placeholders =
            List.map (\_ -> "?") values |> String.join ", "
    in
    Expression (\qualify -> qualify colName ++ " IN (" ++ placeholders ++ ")") (List.map encoder values)


isNull : Column record a -> Expression record
isNull (Elmto.Column colName _) =
    Expression (\qualify -> qualify colName ++ " IS NULL") []


isNotNull : Column record a -> Expression record
isNotNull (Elmto.Column colName _) =
    Expression (\qualify -> qualify colName ++ " IS NOT NULL") []


and : Expression record -> Expression record -> Expression record
and (Expression sql1 params1) (Expression sql2 params2) =
    Expression (\qualify -> "(" ++ sql1 qualify ++ " AND " ++ sql2 qualify ++ ")") (params1 ++ params2)


or : Expression record -> Expression record -> Expression record
or (Expression sql1 params1) (Expression sql2 params2) =
    Expression (\qualify -> "(" ++ sql1 qualify ++ " OR " ++ sql2 qualify ++ ")") (params1 ++ params2)


expressionSql : (String -> String) -> Expression record -> String
expressionSql qualify (Expression toSql _) =
    toSql qualify


expressionParams : Expression record -> List Encode.Value
expressionParams (Expression _ params) =
    params


selectionSql : Bool -> (String -> String) -> Selection record -> String
selectionSql castPostgresNumbers qualify selection =
    case selection of
        ColumnSelection column maybeAlias ->
            addAlias (qualifiedColumnSql qualify column) maybeAlias

        AggregateSelection kind column maybeAlias ->
            addAlias
                (aggregateSql castPostgresNumbers kind qualify column)
                (Just (Maybe.withDefault (defaultAggregateAlias kind column) maybeAlias))


joinSql : String -> Join record -> String
joinSql baseTable join_ =
    case join_ of
        Join joinType tableName leftColumn rightColumn ->
            joinTypeSql joinType
                ++ " "
                ++ tableName
                ++ " ON "
                ++ baseTable
                ++ "."
                ++ leftColumn
                ++ " = "
                ++ tableName
                ++ "."
                ++ rightColumn


groupBySql : (String -> String) -> GroupBy record -> String
groupBySql qualify group =
    case group of
        GroupBy column ->
            qualifiedColumnSql qualify column


orderSql : (String -> String) -> Order -> String
orderSql qualify order =
    case order of
        Asc column ->
            qualifiedColumnSql qualify column ++ " ASC"

        Desc column ->
            qualifiedColumnSql qualify column ++ " DESC"


havingSql : (String -> String) -> Having record -> String
havingSql qualify (Having toSql _) =
    toSql qualify


havingParams : Having record -> List Encode.Value
havingParams (Having _ params) =
    params


qualifiedColumnSql : (String -> String) -> QualifiedColumn -> String
qualifiedColumnSql qualify column =
    case column of
        BaseColumn name ->
            qualify name

        TableColumn tableName name ->
            tableName ++ "." ++ name


columnName : QualifiedColumn -> String
columnName column =
    case column of
        BaseColumn name ->
            name

        TableColumn _ name ->
            name


aggregateSql : Bool -> AggregateKind -> (String -> String) -> QualifiedColumn -> String
aggregateSql castPostgresNumbers kind qualify column =
    aggregateName kind
        ++ "("
        ++ qualifiedColumnSql qualify column
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


defaultAggregateAlias : AggregateKind -> QualifiedColumn -> String
defaultAggregateAlias kind column =
    String.toLower (aggregateName kind) ++ "_" ++ columnName column


addAlias : String -> Maybe String -> String
addAlias sql maybeAlias =
    case maybeAlias of
        Just alias ->
            sql ++ " AS " ++ alias

        Nothing ->
            sql


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
