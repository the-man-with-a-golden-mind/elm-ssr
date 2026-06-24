# Elmto: Ecto-like SQL DSL for elm-ssr

Elmto is the Ecto-inspired data layer for `elm-ssr`. It splits database work into:

- `ElmSsr.Db.Elmto`: schema, fields, columns, and primitive field types.
- `ElmSsr.Db.Elmto.Changeset`: casting, validations, and change tracking.
- `ElmSsr.Db.Elmto.Query`: type-safe query construction.
- `ElmSsr.Db.Elmto.Compiler`: PostgreSQL and SQLite SQL generation.
- `ElmSsr.Db.Elmto.Repo`: Loader/Action execution helpers.

The current query DSL supports CRUD, typed filters, ordering, pagination, joins, group-by, and aggregate projections for PostgreSQL and SQLite.

## Schema

```elm
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

idCol : Elmto.Column User Int
idCol =
    Elmto.column "id" Encode.int

nameCol : Elmto.Column User String
nameCol =
    Elmto.column "name" Encode.string
```

## Query API

```elm
type Query record selection
type Selection record
type GroupBy record

type JoinType
    = InnerJoin
    | LeftJoin
    | RightJoin
    | FullJoin

from : Schema record -> Query record record
select : List (Selection record) -> Decode.Decoder selection -> Query record a -> Query record selection
where_ : Expression record -> Query record selection -> Query record selection
whereJoined : Schema joined -> Expression joined -> Query record selection -> Query record selection
orderBy : List Order -> Query record selection -> Query record selection
limit : Int -> Query record selection -> Query record selection
offset : Int -> Query record selection -> Query record selection

col : Column record a -> Selection record
joinedCol : Schema joined -> Column joined a -> Selection record
count : Column record a -> Selection record
joinedCount : Schema joined -> Column joined a -> Selection record
sum : Column record a -> Selection record
joinedSum : Schema joined -> Column joined a -> Selection record
avg : Column record a -> Selection record
joinedAvg : Schema joined -> Column joined a -> Selection record
min : Column record a -> Selection record
joinedMin : Schema joined -> Column joined a -> Selection record
max : Column record a -> Selection record
joinedMax : Schema joined -> Column joined a -> Selection record
as_ : String -> Selection record -> Selection record

join : JoinType -> Schema joined -> Column record a -> Column joined a -> Query record selection -> Query record selection
groupByCol : Column record a -> GroupBy record
groupByJoinedCol : Schema joined -> Column joined a -> GroupBy record
groupBy : List (GroupBy record) -> Query record selection -> Query record selection

having : Having record -> Query record selection -> Query record selection
countOf : Column record a -> Stat record Int
joinedCountOf : Schema joined -> Column joined a -> Stat record Int
havingGt : a -> Stat record a -> Having record
```

`Selection`, `GroupBy`, `Join`, and `Query` are opaque. Authors construct them through the DSL functions rather than raw strings.

## Joined Aggregate Example

```elm
type alias Post =
    { id : Int
    , userId : Int
    , title : String
    }

type alias UserStats =
    { name : String
    , postCount : Int
    , averageAge : Maybe Float
    }

postSchema : Elmto.Schema Post
postSchema =
    Elmto.schema "posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

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

SQLite output:

```sql
SELECT users.name, COUNT(posts.user_id) AS post_count, AVG(users.age) AS average_age
FROM users
INNER JOIN posts ON users.id = posts.user_id
WHERE posts.title LIKE ?
GROUP BY users.name
HAVING COUNT(posts.user_id) >= ?
ORDER BY users.name ASC
```

PostgreSQL output:

```sql
SELECT users.name, COUNT(posts.user_id)::int AS post_count, AVG(users.age)::float AS average_age
FROM users
INNER JOIN posts ON users.id = posts.user_id
WHERE posts.title LIKE $1
GROUP BY users.name
HAVING COUNT(posts.user_id) >= $2
ORDER BY users.name ASC
```

PostgreSQL casts `COUNT` to `int` and `SUM`/`AVG` to `float` because Bun's PostgreSQL driver returns those aggregate values as strings by default. The casts keep Elm JSON decoders receiving numbers.

## Aggregate Aliases

Aggregate aliases are generated deterministically:

| Builder | Alias |
|---|---|
| `count idCol` | `count_id` |
| `sum ageCol` | `sum_age` |
| `avg ageCol` | `avg_age` |
| `min ageCol` | `min_age` |
| `max ageCol` | `max_age` |

Use `Query.as_ "alias_name"` on any selection to override the generated name:

```elm
Query.count idCol |> Query.as_ "total_users"
Query.joinedCol postSchema postTitleCol |> Query.as_ "post_title"
```

Your decoder must match either the generated alias or your custom alias.

## Joined Table Helpers

Use joined helpers when selecting, filtering, grouping, or ordering by a joined table:

```elm
Query.from userSchema
    |> Query.select
        [ Query.col nameCol
        , Query.joinedCol postSchema postTitleCol |> Query.as_ "post_title"
        ]
        decoder
    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
    |> Query.whereJoined postSchema (Query.like "%elm%" postTitleCol)
    |> Query.groupBy [ Query.groupByCol nameCol, Query.groupByJoinedCol postSchema postTitleCol ]
    |> Query.orderBy [ Query.ascJoined postSchema postTitleCol ]
```

## Having

`HAVING` uses typed aggregate stats:

```elm
Query.having (Query.havingGt 1 (Query.joinedCountOf postSchema postUserIdCol))
Query.having (Query.havingGte 10 (Query.sumOf ageCol))
Query.having (Query.havingLt 40.0 (Query.avgOf ageCol))
```

Available stats are `countOf`, `sumOf`, `avgOf`, `minOf`, `maxOf` and their `joined*Of` variants. Combine predicates with `havingAnd` and `havingOr`.

## Grouping Mixed Column Types

Elm lists cannot contain raw columns with different value types, for example `Column User String` and `Column User (Maybe Int)`. Elmto uses opaque wrappers for this:

```elm
Query.groupBy
    [ Query.groupByCol nameCol
    , Query.groupByCol ageCol
    ]
```

The wrapper erases the column value type for the list while preserving that the column belongs to the same record/schema.

## Current Limits

- SQLite `RIGHT JOIN` and `FULL JOIN` require a SQLite version that supports them. For older SQLite versions, prefer `INNER JOIN` / `LEFT JOIN` or raw SQL fallback.
- Complex SQL features such as CTEs, window functions, subqueries, lateral joins, `HAVING` against custom SQL expressions, and vendor-specific operators remain raw SQL territory.

## Verification

The Elmto join/group/aggregate slice is covered by:

- `test/elmto.test.ts`: SQL compilation for PostgreSQL and SQLite, all join variants, all aggregate builders, custom aliases, joined-table helpers, `HAVING`, and mixed-type grouping.
- `test/integration/elmto-integration.test.ts`: real SQLite and PostgreSQL execution through `Repo.all` for joined aggregate results with aliases, joined filters, and `HAVING`.
- `bun run test:release`: full project check, unit suite, and Docker-backed integration suite.
