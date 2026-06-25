# Elmto

Elmto is the Ecto-like database layer for `elm-ssr`. It provides typed schemas, changesets, composable queries, SQL compilation for SQLite/PostgreSQL, and Loader/Action execution through `Repo`.

## Query Shape

```elm
Query.from userSchema
    |> Query.distinct
    |> Query.select
        [ Query.col nameCol
        , Query.count idCol
        , Query.avg ageCol
        ]
        statsDecoder
    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
    |> Query.groupBy [ Query.groupByCol nameCol ]
    |> Query.orderBy [ Query.asc nameCol ]
```

This compiles to qualified joined SQL. PostgreSQL aggregate projections cast `COUNT` to `int` and `SUM`/`AVG` to `float` so JSON decoders receive numbers instead of driver-returned strings.

## Selection And Aggregates

Use `Selection` builders inside `Query.select`:

```elm
Query.select
    [ Query.col nameCol
    , Query.count idCol
    , Query.sum ageCol
    , Query.avg ageCol
    , Query.min ageCol
    , Query.max ageCol
    ]
    decoder
```

Generated aliases:

| Builder | Alias |
|---|---|
| `count idCol` | `count_id` |
| `sum ageCol` | `sum_age` |
| `avg ageCol` | `avg_age` |
| `min ageCol` | `min_age` |
| `max ageCol` | `max_age` |

Your decoder must read those names.

Use `as_` to override either column or aggregate aliases:

```elm
Query.count idCol |> Query.as_ "total_users"
Query.joinedCol postSchema postTitleCol |> Query.as_ "post_title"
```

## Joins

```elm
Query.join Query.InnerJoin postSchema idCol postUserIdCol
Query.join Query.LeftJoin postSchema idCol postUserIdCol
Query.join Query.RightJoin postSchema idCol postUserIdCol
Query.join Query.FullJoin postSchema idCol postUserIdCol
```

The two join columns must have the same Elm value type. The joined schema supplies the joined table name.

Joined-table helpers:

```elm
Query.joinedCol postSchema postTitleCol
Query.joinedCount postSchema postUserIdCol
Query.whereJoined postSchema (Query.like "%elm%" postTitleCol)
Query.groupByJoinedCol postSchema postTitleCol
Query.ascJoined postSchema postTitleCol
Query.descJoined postSchema postTitleCol
```

For arbitrary `ON` clauses:

```elm
Query.joinOn Query.InnerJoin postSchema
    (Query.onAnd
        (Query.onEq idCol postUserIdCol)
        (Query.onRight (Query.like "F%" postTitleCol))
    )
```

For joined-to-joined chains:

```elm
Query.joinFrom Query.InnerJoin postSchema commentSchema
    (Query.onEq postIdCol commentPostIdCol)
```

Available `ON` builders:

```elm
Query.onEq
Query.onNeq
Query.onGt
Query.onGte
Query.onLt
Query.onLte
Query.onLeft
Query.onRight
Query.onAnd
Query.onOr
```

Subquery joins are also supported:

```elm
postsPerUser =
    Query.from postSchema
        |> Query.select
            [ Query.col postUserIdCol
            , Query.count postIdCol |> Query.as_ "post_count"
            ]
            postCountDecoder
        |> Query.groupBy [ Query.groupByCol postUserIdCol ]

Query.from userSchema
    |> Query.joinSubquery Query.LeftJoin postCountSchema postsPerUser (Query.onEq idCol postUserIdCol)
```

## Group By

Use `groupByCol` to build heterogeneous grouping lists:

```elm
Query.groupBy
    [ Query.groupByCol nameCol
    , Query.groupByCol ageCol
    ]
```

This lets `String`, `Int`, `Maybe Int`, and other column value types appear in one group-by list while preserving the base record phantom type.

## Having

Use typed aggregate stats in `HAVING`:

```elm
Query.having (Query.havingGt 1 (Query.joinedCountOf postSchema postUserIdCol))
Query.having (Query.havingGte 10 (Query.sumOf ageCol))
Query.having (Query.havingLt 40.0 (Query.avgOf ageCol))
```

Available stats:

```elm
countOf, joinedCountOf
sumOf, joinedSumOf
avgOf, joinedAvgOf
minOf, joinedMinOf
maxOf, joinedMaxOf
```

Combine predicates with `havingAnd` and `havingOr`.

Use `havingFragment` for raw aggregate predicates when the typed helpers are not enough:

```elm
Query.having (Query.havingFragment "COUNT(*) FILTER (WHERE age IS NOT NULL) > ?" [ Encode.int 1 ])
```

## Execution

```elm
Repo.all dialect statsQuery
Repo.one dialect statsQuery
Repo.get dialect userSchema 42
Repo.getBy dialect userSchema (Query.eq "alice@example.com" emailCol)
```

`dialect` is `Compiler.SQLite` or `Compiler.PostgreSQL`.

## Counting and Existence

```elm
Repo.count dialect userSchema               -- SELECT COUNT(*) FROM users
Repo.countWhere dialect userSchema expr     -- SELECT COUNT(*) FROM users WHERE …
Repo.exists dialect userSchema expr         -- true / false
```

## Uniqueness Validation

Check before insert — avoids a changeset that would fail a DB constraint silently:

```elm
Action.fromLoader (Repo.validateUnique dialect userSchema emailCol email changeset)
    |> Action.andThen (\cs -> Repo.insert dialect userSchema cs)
```

Returns the changeset unchanged if the value is unique; adds `(field, "has already been taken")` if not.

## DB Constraint Errors

`Repo.insert` and `Repo.update` catch database constraint violations and return
`Err changeset` with a structured error instead of crashing:

| Constraint | Field | Message |
|---|---|---|
| UNIQUE | column name | `"has already been taken"` |
| NOT NULL | column name | `"can't be blank"` |
| FOREIGN KEY | `"base"` | `"does not exist"` |
| CHECK | `"base"` | `"constraint violation"` |

```elm
Repo.insert SQLite userSchema changeset
    |> Action.andThen (\result ->
        case result of
            Ok user -> -- success
            Err cs  -> -- constraint or validation error, same Err branch
    )
```

Use `validateUnique` to catch uniqueness before the DB call when you want to
avoid the extra round-trip.

## Batch Insert

```elm
Repo.insertAll dialect userSchema changesets
-- : Action (List (Result (Changeset record) record))
```

Runs inserts sequentially and returns one `Result` per changeset.

## Additional WHERE Operators

```elm
Query.notInList [ 1, 2, 3 ] idCol      -- id NOT IN (?, ?, ?)
Query.between 18 65 ageCol             -- age BETWEEN ? AND ?
Query.ilike "%alice%" nameCol          -- LOWER(name) LIKE LOWER(?)
```

`inList []` compiles to `1 = 0` so an empty inclusion list is safe.
`notInList []` compiles to `1 = 1` so an empty exclusion list is safe.

## Subqueries, CTEs, And Fragments

```elm
Query.fromSubquery postCountSchema postsPerUser
    |> Query.where_ (Query.gte 2 postCountCol)

Query.from postCountSchema
    |> Query.withCte postCountSchema postsPerUser
    |> Query.where_ (Query.gt 1 postCountCol)

Query.where_ (Query.existsBy idCol postUserIdCol (Query.from postSchema))
Query.where_ (Query.notExistsBy idCol postUserIdCol (Query.from postSchema))
Query.where_ (Query.inSubquery idCol (Query.from postSchema |> Query.select [ Query.col postUserIdCol ] userIdDecoder))

Query.select [ Query.selectFragment "UPPER(name)" [] "upper_name" ] upperNameDecoder
Query.where_ (Query.fragment "name <> ?" [ Encode.string "Frank" ])
```

Available raw and relational builders:

```elm
fromSubquery
withCte
joinSubquery
selectFragment
fragment
exists
notExists
existsBy
notExistsBy
inSubquery
notInSubquery
havingFragment
```

## Transactions

```elm
Repo.transaction steps  -- steps : List { sql : String, params : List Encode.Value }
-- : Action Int         -- total rowsAffected; rolls back on any failure
```

Build steps from compiled operations:

```elm
let
    steps =
        List.filterMap identity
            [ Compiler.compileInsert dialect userSchema userCs |> Result.toMaybe
            , Compiler.compileInsert dialect postSchema postCs |> Result.toMaybe
            ]
in
Repo.transaction steps
```

Requires `sqlTransaction` in `inMemoryEffects`. On Cloudflare D1 the runtime uses `db.batch` automatically.

## Bulk Updates And Deletes

```elm
Repo.updateAll dialect userSchema (Query.isNull ageCol)
    (Changeset.cast userSchema (Dict.fromList [ ( "age", Encode.int 50 ) ]))
-- : Action (Result (Changeset User) Int)

Repo.deleteAll dialect userSchema (Query.eq 50 ageCol)
-- : Action Int
```

`updateAll` validates the changeset, compiles one `UPDATE ... WHERE ...`, and returns affected row count.
Constraint violations come back as `Err changeset`, the same way `insert` and `update` do.

`deleteAll` compiles one `DELETE ... WHERE ...` and returns `rowsAffected`.

## Associations

```elm
-- One query, no N+1. Groups children per parent.
Repo.loadHasMany dialect postSchema postUserIdCol .userId users .id
    : Loader (List ( User, List Post ))

-- One query, no N+1. Matches each child to its parent.
Repo.loadBelongsTo dialect userSchema .id .userId posts
    : Loader (List ( Post, Maybe User ))

-- Same fetch pattern, but map directly into your result shape.
Repo.preloadHasMany dialect postSchema postUserIdCol .userId .id
    (\user posts -> { user = user, posts = posts })
    users
    : Loader (List { user : User, posts : List Post })

Repo.preloadBelongsTo dialect userSchema .id .userId
    (\post user -> { post = post, user = user })
    posts
    : Loader (List { post : Post, user : Maybe User })
```

Both emit a single `WHERE fk IN (…)` query and zip results in Elm.

## Limits

- SQLite `RIGHT JOIN` and `FULL JOIN` require a SQLite version that supports them.
- `ilike` compiles to `LOWER(col) LIKE LOWER(?)`, so it works on SQLite and PostgreSQL, but it is not index-friendly unless the DB has matching functional indexes/collation strategy.
- `Repo.transaction` cannot chain intermediate results — compile all SQL before calling.
- Use raw SQL for window functions, lateral joins, vendor-specific operators, or very complex analytical SQL.
