# Elmto — The Canonical Type-Safe Database Layer for elm-ssr

**Elmto** (Ecto in Elm) is the recommended, full-featured way to work with SQL in elm-ssr. It gives you:

- Typed **schemas** that map tables to Elm records
- **Changesets** for casting, validation, and change tracking (with proper error handling)
- Composable **queries** with joins, aggregates, grouping, ordering, CTEs, and subqueries
- Dialect-aware SQL **compilation** for SQLite and PostgreSQL
- Execution helpers via `Repo` that integrate cleanly with `Loader` and `Action`, including soft constraint error paths

Elmto is now the **canonical** database story. The `elm-ssr query` generator emits Elmto modules by default.

> **New code should use Elmto.** The old `ElmSsr.Db.Dsl` (phantom-table `Table` + `Column` + `toLoader`) is legacy and only kept for migration of existing apps.

## When to Use Elmto vs Raw SQL vs Legacy Dsl

| Need | Recommended Approach | Why |
|------|----------------------|-----|
| Simple list / get / insert on one table | Generated helpers (`all`, `byId`, `insert`) **or** `Repo` + `Query.from schema` | Type-safe, zero boilerplate |
| Validation before write, attach DB errors to form | `Changeset` + `Repo.insert` / `Repo.update` | Errors become `Err (Changeset record)` with human messages |
| Joins, aggregates (COUNT, SUM, AVG), GROUP BY, HAVING | `Query.join`, `Query.select [Query.count ...]`, `groupBy` | Full relational power with aliasing |
| Bulk operations or transactions | `Repo.updateAll`, `Repo.deleteAll`, `Repo.transaction` | Atomic, efficient |
| Complex analytics or DB-specific features | `Loader.query` + raw SQL (reuse generated decoders) | Escape hatch when Elmto doesn't express it |
| Existing code using `ElmSsr.Db.Dsl` | Keep temporarily, migrate gradually | See migration guide below |

**Rule of thumb**: Start with the generated schema + `Repo`. Drop to raw `Loader.query` only when you truly need something Elmto doesn't (yet) support.

## Defining a Schema (the heart of Elmto)

```elm
import ElmSsr.Db.Elmto as Elmto
import Json.Decode as Decode
import Json.Encode as Encode

type alias User =
    { id : Int
    , name : String
    , email : String
    , age : Maybe Int
    }

userDecoder : Decode.Decoder User
userDecoder =
    Decode.map4 User
        (Decode.field "id" Decode.int)
        (Decode.field "name" Decode.string)
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "age" Decode.int))

userSchema : Elmto.Schema User
userSchema =
    Elmto.schema "users" userDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "name" .name Elmto.string
        |> Elmto.field "email" .email Elmto.string
        |> Elmto.optionalField "age" .age Elmto.int

-- Column descriptors for queries (used with Query.eq, Query.gt, etc.)
idCol   = Elmto.column "id" Encode.int
nameCol = Elmto.column "name" Encode.string
emailCol = Elmto.column "email" Encode.string
ageCol  = Elmto.column "age" Encode.int
```

Key points:
- The schema owns the decoder — this is what `Repo` uses to turn rows back into records.
- `field` vs `optionalField` controls `Maybe` handling and `NULL` in SQL.
- Column encoders are used when building parameterized queries.

The `elm-ssr query` generator now produces exactly this shape for you (see below).

## Building Queries

Elmto queries are pipelines that stay type-safe.

```elm
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Repo as Repo

-- Basic filtered list
activeUsers : Loader (List User)
activeUsers =
    Query.from userSchema
        |> Query.where_ (Query.gt 18 ageCol)
        |> Query.where_ (Query.like "%@example.com" emailCol)
        |> Query.orderBy [ Query.asc nameCol ]
        |> Query.limit 50
        |> Repo.all SQLite
```

### Selection & Aggregates

```elm
type alias UserStats =
    { name : String
    , postCount : Int
    , avgAge : Float
    }

statsQuery =
    Query.from userSchema
        |> Query.select
            [ Query.col nameCol
            , Query.count postUserIdCol |> Query.as_ "postCount"
            , Query.avg ageCol |> Query.as_ "avgAge"
            ]
            userStatsDecoder
        |> Query.groupBy [ Query.groupByCol nameCol ]
        |> Repo.all PostgreSQL
```

Aliases are stable (`count_xxx`, `sum_yyy`, or whatever you pass to `as_`).

## Joins, Grouping, and Advanced Features

```elm
-- Users with their post counts
Query.from userSchema
    |> Query.join Query.LeftJoin postSchema idCol postUserIdCol
    |> Query.select
        [ Query.col nameCol
        , Query.joinedCount postSchema postUserIdCol |> Query.as_ "postCount"
        ]
        statsDecoder
    |> Query.groupBy [ Query.groupByCol nameCol ]
    |> Query.having (Query.gt 5 (Query.asCol "postCount"))   -- having support
    |> Repo.all SQLite
```

Full support exists for `whereJoined`, `ascJoined`, `onEq` / `onAnd`, subqueries, CTEs (`withCte`), unions, etc.

## Safe Writes with Changesets + Repo

This is where Elmto shines for "full-stack" feel:

```elm
import ElmSsr.Db.Elmto.Changeset as Changeset
import ElmSsr.Action as Action exposing (Action)

createUser : { name : String, email : String, age : Maybe Int } -> Action (Result (Changeset.Changeset User) User)
createUser input =
    let
        changeset =
            Changeset.cast userSchema
                (Dict.fromList
                    [ ("name", Encode.string input.name)
                    , ("email", Encode.string input.email)
                    , ("age", Maybe.map Encode.int input.age |> Maybe.withDefault Encode.null)
                    ]
                )
                |> Changeset.validateRequired ["name", "email"]
                |> Changeset.validateFormat "email" (\e -> String.contains "@" e) "must contain @"
    in
    Repo.insert SQLite userSchema changeset
        -- On constraint violation (unique email, not null, etc.) the error
        -- is automatically attached to the changeset and returned as Err.
```

`Repo.insert`, `Repo.update`, `Repo.updateAll`, `Repo.validateUnique`, and transaction support all follow the same `Result Changeset record` or `Int` (rows affected) pattern.

Non-optimistic paths are first-class — no more "insert succeeded" then surprise 500 on duplicate email.

## Using Generated Modules (elm-ssr query)

Run:

```sh
elm-ssr query
# or in scaffolded projects
bun run query
```

It now produces modules like:

```elm
module Example.Basic.Db.Users exposing (User, userSchema, idCol, nameCol, emailCol, ...)

userSchema : Elmto.Schema User
idCol : Elmto.Column User Int
...
```

Usage in a route:

```elm
import Example.Basic.Db.Users as Users
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo

page _ =
    Repo.all SQLite (Query.from Users.userSchema |> Query.limit 20)
        |> Loader.map view
```

This is the happy path the generator is designed to enable.

## Migration from Legacy Dsl → Elmto

If you have code using the old generator output:

**Before (legacy)**
```elm
import ElmSsr.Db.Dsl as Db
import Example.Basic.Db.Entries as Entries

recent =
    Db.select Entries.table [Db.col Entries.id, Db.col Entries.message] Entries.decoder
        |> Db.where_ (Entries.message |> Db.like "%foo%")
        |> Db.toLoader
```

**After (Elmto)**
```elm
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo
import Example.Basic.Db.Entries as Entries

recent =
    Query.from Entries.entrySchema
        |> Query.where_ (Query.like "%foo%" Entries.messageCol)
        |> Repo.all SQLite
```

You can keep using the generated `all`, `byId`, `insert` etc. helpers during transition — they still exist for compatibility.

## Error Handling & Non-Optimistic Paths

See [error-handling.md](error-handling.md) for the full picture. Highlights with Elmto:

- `Repo.insert` / `update` return `Result (Changeset r) record`
- Constraint errors are turned into changeset errors (`"has already been taken"`, `"can't be blank"`, etc.)
- Use `Loader.softExecute` / `softQueryOne` when you want raw `Result ConstraintError ...`
- Always validate first with changesets — the DB layer will still protect you.

## Full-Stack Pattern: Form + Elmto + Action

```elm
-- In an Action
pairs = Route.formPairs request
case Form.decode createUserDecoder pairs of
    Ok data ->
        let
            cs = Changeset.cast userSchema ... |> validate...
        in
        Repo.insert SQLite userSchema cs
            |> Action.andThen (handleResult >> view)
    Err errs ->
        Action.succeed (viewWithErrors errs)
```

This gives you server-side validation + client-reusable decoders + proper DB constraint surfacing — all in Elm.

## Performance & Dialect Notes

- PostgreSQL aggregates are cast to native numbers (`COUNT::int`, `SUM::float`).
- Use `Repo.transaction` for multi-statement atomic work.
- For very hot paths you can still compile once with `Compiler.compileSelect` and run raw queries.
- See `scripts/elmto-benchmark.mjs` for real measurements.

Elmto gives you most of the safety and ergonomics of an ORM while staying a thin, transparent layer over `Loader`/`Action`.

Start here for new features. Use raw `Loader.query` when you need to go lower. The old Dsl is for legacy only.

---

*Next*: read [loaders-and-actions.md](loaders-and-actions.md) to see how to compose these inside pages and form actions, and [error-handling.md](error-handling.md) for complete failure mode coverage.

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
