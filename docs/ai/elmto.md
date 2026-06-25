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

## DB Constraint → Changeset Error

`Repo.insert` and `Repo.update` now catch database constraint violations and
return `Err changeset` instead of crashing with a 502.

| DB constraint | Changeset error |
|---|---|
| UNIQUE | `(field, "has already been taken")` |
| NOT NULL | `(field, "can't be blank")` |
| FOREIGN KEY | `("base", "does not exist")` |
| CHECK | `("base", "constraint violation")` |

The field name is extracted from the DB error message when possible (works for
SQLite and PostgreSQL UNIQUE violations). Use `validateUnique` to check before
hitting the DB when you want to avoid the round-trip.

The low-level primitives behind this are `Loader.softExecute` (SQLite path) and
`Loader.softQueryOne` (PostgreSQL RETURNING * path). Both return
`Result Loader.ConstraintError …` instead of failing hard.

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

## Transactions

```elm
-- Loader.transaction (low-level, available via Action.fromLoader)
Loader.transaction : List { sql : String, params : List Encode.Value } -> Loader Int

-- Repo.transaction (Action wrapper)
Repo.transaction : List { sql : String, params : List Encode.Value } -> Action Int
```

Executes all statements atomically. Any failure rolls back. Returns total `rowsAffected`.

Requires `sqlTransaction` in `inMemoryEffects`:

```typescript
sqlTransaction: (stmts) => {
  const txn = db.transaction(() => {
    let rows = 0;
    for (const s of stmts) rows += db.query(s.sql).run(...s.params).changes;
    return { rowsAffected: rows };
  });
  return Promise.resolve(txn());
}
```

Cloudflare D1: uses `db.batch(stmts)` — no extra config needed.

Limitation: all SQL must be compiled upfront; cannot use result of step N in step N+1 parameters.

## Associations

```elm
loadHasMany :
    Dialect
    -> Schema related
    -> Column related Int    -- FK col on child table (e.g. postUserIdCol)
    -> (related -> Int)      -- FK getter on child record (e.g. .userId)
    -> List record           -- parent records
    -> (record -> Int)       -- PK getter on parent (e.g. .id)
    -> Loader (List ( record, List related ))

loadBelongsTo :
    Dialect
    -> Schema related
    -> (related -> Int)      -- PK getter on parent (e.g. .id)
    -> (record -> Int)       -- FK getter on child (e.g. .userId)
    -> List record
    -> Loader (List ( record, Maybe related ))
```

Both issue **one** `WHERE fk IN (…)` query and group results in Elm — no N+1. Always chain after `Repo.all` via `Loader.andThen`.

## Current Limits

- `RIGHT JOIN` and `FULL JOIN` depend on SQLite version support.
- `ilike` is PostgreSQL-specific; emits `ILIKE` which is a syntax error on SQLite.
- `Repo.transaction` cannot chain intermediate results — compile all SQL before calling.
- Use `Loader.query` / `Loader.execute` for CTEs, window functions, subqueries, lateral joins, `HAVING` against custom SQL expressions, and vendor-specific SQL.

## Tests

- `bun test test/elmto.test.ts`
- `bun test test/integration/elmto-integration.test.ts`
- Full gate: `bun run test:release`
