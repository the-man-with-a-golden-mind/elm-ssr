# elmto (AI)

**Modules:** `ElmSsr.Db.Elmto`, `ElmSsr.Db.Elmto.Changeset`, `ElmSsr.Db.Elmto.Query`, `ElmSsr.Db.Elmto.Compiler`, `ElmSsr.Db.Elmto.Repo`.

Use Elmto for Ecto-like schemas, changesets, typed query construction, and execution through Loader/Action effects.

## Core Query Types

```elm
type Query record selection
type Selection record
type GroupBy record
type Join record

type JoinType
    = InnerJoin
    | LeftJoin
    | RightJoin
    | FullJoin
```

`Query`, `Selection`, `GroupBy`, and `Join` are opaque. Do not construct them manually.

## Selection Builders

```elm
col : Column record a -> Selection record
count : Column record a -> Selection record
sum : Column record a -> Selection record
avg : Column record a -> Selection record
min : Column record a -> Selection record
max : Column record a -> Selection record
joinedCol : Schema joined -> Column joined a -> Selection record
joinedCount : Schema joined -> Column joined a -> Selection record
joinedSum : Schema joined -> Column joined a -> Selection record
joinedAvg : Schema joined -> Column joined a -> Selection record
joinedMin : Schema joined -> Column joined a -> Selection record
joinedMax : Schema joined -> Column joined a -> Selection record
as_ : String -> Selection record -> Selection record
```

Aliases are fixed:

- `count idCol` -> `count_id`
- `sum ageCol` -> `sum_age`
- `avg ageCol` -> `avg_age`
- `min ageCol` -> `min_age`
- `max ageCol` -> `max_age`

Write decoders against those aliases, or override them with `as_`.

## Joins

```elm
join : JoinType -> Schema joined -> Column record a -> Column joined a -> Query record selection -> Query record selection
```

The join key columns must share the same Elm value type. The joined schema supplies the joined SQL table. Example:

```elm
Query.from userSchema
    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
```

Joined-table helper signatures:

```elm
whereJoined : Schema joined -> Expression joined -> Query record selection -> Query record selection
groupByJoinedCol : Schema joined -> Column joined a -> GroupBy record
ascJoined : Schema joined -> Column joined a -> Order
descJoined : Schema joined -> Column joined a -> Order
```

## Grouping

```elm
groupByCol : Column record a -> GroupBy record
groupBy : List (GroupBy record) -> Query record selection -> Query record selection
```

Use `groupByCol` for heterogeneous lists such as `String` + `Maybe Int` columns:

```elm
|> Query.groupBy [ Query.groupByCol nameCol, Query.groupByCol ageCol ]
```

## Having

```elm
type Stat record a
type Having record

having : Having record -> Query record selection -> Query record selection
havingEq : a -> Stat record a -> Having record
havingNeq : a -> Stat record a -> Having record
havingGt : a -> Stat record a -> Having record
havingGte : a -> Stat record a -> Having record
havingLt : a -> Stat record a -> Having record
havingLte : a -> Stat record a -> Having record
havingAnd : Having record -> Having record -> Having record
havingOr : Having record -> Having record -> Having record

countOf : Column record a -> Stat record Int
joinedCountOf : Schema joined -> Column joined a -> Stat record Int
sumOf : Column record a -> Stat record a
joinedSumOf : Schema joined -> Column joined a -> Stat record a
avgOf : Column record a -> Stat record Float
joinedAvgOf : Schema joined -> Column joined a -> Stat record Float
minOf : Column record a -> Stat record a
joinedMinOf : Schema joined -> Column joined a -> Stat record a
maxOf : Column record a -> Stat record a
joinedMaxOf : Schema joined -> Column joined a -> Stat record a
```

Example:

```elm
|> Query.having (Query.havingGt 1 (Query.joinedCountOf postSchema postUserIdCol))
```

## Joined Aggregate Pattern

```elm
statsDecoder : Decode.Decoder UserStats
statsDecoder =
    Decode.map3 UserStats
        (Decode.field "name" Decode.string)
        (Decode.field "post_count" Decode.int)
        (Decode.field "average_age" (Decode.nullable Decode.float))

statsQuery : Query.Query User UserStats
statsQuery =
    Query.from userSchema
        |> Query.select
            [ Query.col nameCol
            , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_count"
            , Query.avg ageCol |> Query.as_ "average_age"
            ]
            statsDecoder
        |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
        |> Query.whereJoined postSchema (Query.like "%" postTitleCol)
        |> Query.groupBy [ Query.groupByCol nameCol ]
        |> Query.having (Query.havingGte 1 (Query.joinedCountOf postSchema postUserIdCol))
        |> Query.orderBy [ Query.asc nameCol ]
```

PostgreSQL aggregate compilation casts:

- `COUNT(...)::int`
- `SUM(...)::float`
- `AVG(...)::float`

SQLite aggregate compilation does not add casts.

## Extended Repo API

```elm
get         : Dialect -> Schema record -> Int -> Loader (Maybe record)
getBy       : Dialect -> Schema record -> Expression record -> Loader (Maybe record)
count       : Dialect -> Schema record -> Loader Int
countWhere  : Dialect -> Schema record -> Expression record -> Loader Int
exists      : Dialect -> Schema record -> Expression record -> Loader Bool
validateUnique : Dialect -> Schema record -> Column record a -> a -> Changeset record -> Loader (Changeset record)
insertAll   : Dialect -> Schema record -> List (Changeset record) -> Action (List (Result (Changeset record) record))
```

`validateUnique` runs a `SELECT … LIMIT 1` and adds `(fieldName, "has already been taken")` to the changeset on collision. Skips the query when the changeset is already invalid.

```elm
Action.fromLoader (Repo.validateUnique dialect userSchema emailCol email changeset)
    |> Action.andThen (\cs -> Repo.insert dialect userSchema cs)
```

## Additional WHERE Operators

```elm
notInList : List a -> Column record a -> Expression record   -- col NOT IN (?, …); empty list → 1 = 1
between   : a -> a -> Column record a -> Expression record   -- col BETWEEN ? AND ?
ilike     : String -> Column record a -> Expression record   -- col ILIKE ? (PostgreSQL only)
```

## Current Limits

- `RIGHT JOIN` and `FULL JOIN` depend on SQLite version support.
- `ilike` is PostgreSQL-specific; emits `ILIKE` which is a syntax error on SQLite.
- Transactions not yet supported — each Repo call is a separate SQL effect.
- Use `Loader.query` / `Loader.execute` for CTEs, window functions, subqueries, lateral joins, `HAVING` against custom SQL expressions, and vendor-specific SQL.

## Tests

- `bun test test/elmto.test.ts`
- `bun test test/integration/elmto-integration.test.ts`
- Full gate: `bun run test:release`
