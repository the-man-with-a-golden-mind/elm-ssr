# Type-Safe SQL Query DSL & Schema Generation

`elm-ssr` provides a CLI command that reads your SQL migrations and generates a type-safe Elm module for each table, giving you compile-time checked CRUD helpers and a fluent filter DSL — no SQL strings for the common case.

## DSL vs Elmto — which to use

| Situation | Use |
|---|---|
| Simple CRUD: list, find by id, insert, update, delete | **Generated DSL** (this page) |
| Filters, pagination, `WHERE … AND …`, `LIKE`, `IN (…)` | **Generated DSL** |
| Joins, `GROUP BY`, `HAVING`, aggregates (`COUNT`, `SUM`, …) | **[Elmto](elmto.md)** |
| Complex subqueries, CTEs, `UNION` | **[Elmto](elmto.md)** |
| Constraint-safe writes (`INSERT` returning the row) | **[Elmto Repo](elmto.md)** |
| Anything the above can't express | `Loader.query` / `Loader.execute` (raw SQL) |

The generated DSL is intentionally lightweight. It delegates complex relational work to Elmto rather than trying to replace SQL.

---

## 1. Schema Generation via CLI

The CLI command scans your migrations folder (ignoring `.down.sql` files), parses the `CREATE TABLE` definitions, and generates a type-safe Elm module for each table.

```sh
elm-ssr query [--root <path>]
```

By default, this command is wired into scaffolded projects as:
```sh
bun run query
```

### Database Type Mapping

The generator maps SQL schema types to native Elm types as follows:

| SQL Type | Elm Type (NOT NULL) | Elm Type (Nullable) |
|---|---|---|
| `INTEGER`, `INT` | `Int` | `Maybe Int` |
| `REAL`, `FLOAT`, `DOUBLE` | `Float` | `Maybe Float` |
| `BOOLEAN`, `BOOL` | `Bool` | `Maybe Bool` |
| `TEXT`, `VARCHAR`, `TIMESTAMP` | `String` | `Maybe String` |

Database field names written in `snake_case` are automatically translated to `camelCase` for Elm record fields (e.g. `is_admin` becomes `isAdmin`, `registered_at` becomes `registeredAt`).

---

## 2. Generated Module Structure

For a table named `test_members`, the command generates `src/<Namespace>/Db/TestMembers.elm`.

**Concrete example** — given this migration:

```sql
CREATE TABLE trello_cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    column_id   INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT,
    position    INTEGER NOT NULL
);
```

The generated module looks like:

```elm
module Example.Db.TrelloCards exposing
    ( TrelloCard, TrelloCardsTable, table
    , id, columnId, title, description, position
    , decoder, all, byId, insert, update, delete
    )

import ElmSsr.Db.Dsl as Dsl exposing (Column, Table)
import ElmSsr.Loader as Loader exposing (Loader)
import Json.Decode as Decode
import Json.Encode as Encode


type TrelloCardsTable = TrelloCardsTable

table : Table TrelloCardsTable
table = Dsl.table "trello_cards"

id         : Column TrelloCardsTable Int
columnId   : Column TrelloCardsTable Int
title      : Column TrelloCardsTable String
description : Column TrelloCardsTable String    -- nullable → Maybe String in record
position   : Column TrelloCardsTable Int


type alias TrelloCard =
    { id          : Int
    , columnId    : Int
    , title       : String
    , description : Maybe String    -- TEXT without NOT NULL
    , position    : Int
    }


decoder : Decode.Decoder TrelloCard

-- CRUD
all    : Loader (List TrelloCard)
byId   : Int -> Loader (Maybe TrelloCard)
insert : { columnId : Int, title : String, description : Maybe String, position : Int }
       -> Loader { rowsAffected : Int }
update : Int -> { columnId : Int, title : String, description : Maybe String, position : Int }
       -> Loader { rowsAffected : Int }
delete : Int -> Loader { rowsAffected : Int }
```

Key conventions:
- `snake_case` SQL names → `camelCase` Elm names (`column_id` → `columnId`)
- Nullable columns (`TEXT` without `NOT NULL`) → `Maybe` in the record type
- Auto-increment primary keys are excluded from `insert` parameters
- `update` and `delete` take the id as the first argument, named `idVal` to avoid shadowing the `id` column descriptor

---

For a table named `test_members`, the command generates a file at `src/<Namespace>/Db/TestMembers.elm`. Let's look at what is exposed:

### Phantom Types and Column Descriptors
To ensure type safety, the generator creates a phantom type representing the table, a `Table` descriptor, and typed `Column` descriptors for every field:

```elm
type TestMembersTable = TestMembersTable

table : Table TestMembersTable
table =
    Dsl.table "test_members"

id : Column TestMembersTable Int
email : Column TestMembersTable String
score : Column TestMembersTable Float
isAdmin : Column TestMembersTable Bool
nickname : Column TestMembersTable String
registeredAt : Column TestMembersTable String
```

### Record Representation & Decoders
The module defines a record type corresponding to a single row, along with its JSON decoder:

```elm
type alias TestMember =
    { id : Int
    , email : String
    , score : Float
    , isAdmin : Bool
    , nickname : Maybe String
    , registeredAt : Maybe String
    }

decoder : Decoder TestMember
```

### Out-of-the-box CRUD Builders
Every generated module contains pre-built type-safe functions for standard database operations:

- **`all`**: Selects all columns and rows from the table.
- **`byId idVal`**: Selects a single row by its primary key.
- **`insert record`**: Inserts a new row (omitting auto-incrementing primary keys and default/nullable fields from input arguments, matching SQL conventions).
- **`delete idVal`**: Deletes a row by its primary key.
- **`update idVal params`**: Updates a row by its primary key.

> [!NOTE]
> Parameter names for primary keys and identifiers use suffixes like `idVal` instead of `id` to prevent Elm compiler variable shadowing errors against module-level column descriptors.

---

## 3. Querying with the Elm SQL DSL

For queries that go beyond simple CRUD operations, `elm-ssr` provides a fluent, type-safe Query DSL in `ElmSsr.Db.Dsl`.

### Safe Selections

You can select all columns using `Db.selectAll`, or select specific columns using `Db.select`.

Because Elm lists require all elements to have the exact same type, list entries like `[ Entries.id, Entries.message ]` would normally cause type mismatches (since one is `Column table Int` and the other is `Column table String`). To solve this, wrap your columns in `Db.col` to erase the value type while preserving table-safety:

```elm
import ElmSsr.Db.Dsl as Db
import Example.Basic.Db.Entries as Entries

-- Select specific columns:
selectSubset : Query Entries.EntriesTable Entries.Entry
selectSubset =
    Db.select Entries.table [ Db.col Entries.id, Db.col Entries.message ] Entries.decoder
```

### Filter Conditions and Operators

Filters are constructed using comparison functions. They take the value first and the column descriptor last. This parameter ordering is designed specifically to allow readable pipeline-style filtering:

```elm
import ElmSsr.Db.Dsl as Db
import Example.Basic.Db.Entries as Entries

-- Pipeline style (recommended):
recentEntries =
    Db.selectAll Entries.table Entries.decoder
        |> Db.where_ (Entries.id |> Db.gt 5)
```

The DSL supports the following comparison operators:

| Operator | Type Signature | SQL Translation |
|---|---|---|
| `eq` | `val -> Column table val -> Expression table` | `col = ?` |
| `neq` | `val -> Column table val -> Expression table` | `col != ?` |
| `gt` | `val -> Column table val -> Expression table` | `col > ?` |
| `gte` | `val -> Column table val -> Expression table` | `col >= ?` |
| `lt` | `val -> Column table val -> Expression table` | `col < ?` |
| `lte` | `val -> Column table val -> Expression table` | `col <= ?` |
| `like` | `String -> Column table val -> Expression table` | `col LIKE ?` |
| `inList` | `List val -> Column table val -> Expression table` | `col IN (?, ?, ...)` |
| `isNull` | `Column table val -> Expression table` | `col IS NULL` |
| `isNotNull` | `Column table val -> Expression table` | `col IS NOT NULL` |

### Logical Combinations

Combine multiple filter expressions using `Db.and` and `Db.or`:

```elm
complexFilter =
    Db.selectAll Entries.table Entries.decoder
        |> Db.where_
            (Db.and
                (Entries.message |> Db.like "%announcement%")
                (Entries.createdAt |> Db.isNotNull)
            )
```

### Pagination & Limits

Limit the number of returned rows using `Db.limit`:

```elm
limitedQuery =
    Db.selectAll Entries.table Entries.decoder
        |> Db.limit 10
```

---

## 4. Executing Queries

To execute queries within your server-side route Loaders or Actions, call `Db.toLoader` (returns a list of rows) or `Db.toLoaderOne` (returns a `Maybe` row):

```elm
module Example.Basic.Routes.Guestbook exposing (page)

import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Document exposing (Document)
import ElmSsr.Db.Dsl as Db
import Example.Basic.Db.Entries as Entries

page : Request -> Loader (Document Never)
page request =
    Db.selectAll Entries.table Entries.decoder
        |> Db.where_ (Entries.id |> Db.gt 10)
        |> Db.limit 5
        |> Db.toLoader
        |> Loader.map (\entries -> ... render entries ...)
```

---

## 5. Raw SQL Fallback

For highly complex queries (like multi-table joins, subqueries, or aggregation), you can fall back to raw SQL. You can still reuse the generated decoders and encoders so you don't have to write serialization logic by hand:

```elm
import ElmSsr.Loader as Loader exposing (Loader)
import Example.Basic.Db.Entries as Entries
import Json.Encode as Encode

customSearch : String -> Loader (List Entries.Entry)
customSearch term =
    Loader.query
        { sql = "SELECT * FROM entries WHERE message LIKE ? AND created_at > datetime('now', '-7 days') ORDER BY id DESC"
        , params = [ Encode.string ("%" ++ term ++ "%") ]
        , decoder = Entries.decoder
        }
```

---

## 6. DSL Limitations & When to Use Raw SQL

While the generated Query DSL provides excellent type-safety for simple and high-frequency database lookups, it has clear design boundaries. To keep the framework runtime small and clean, this DSL is intentionally limited. Use [Elmto](elmto.md) when you want typed joins, group-by, and aggregate projections.

### What the DSL CANNOT Do
* **No `JOIN` Support in `ElmSsr.Db.Dsl`**: There are no primitives for joining tables. Relationships should be queried sequentially, using Elmto, or using raw SQL.
* **No Grouping or Aggregations in `ElmSsr.Db.Dsl`**: Functions like `GROUP BY`, `HAVING`, `SUM`, `AVG`, `COUNT`, or `MIN`/`MAX` are not supported in this generated DSL.
* **No Complex Modifiers**: Primitives for `ORDER BY`, nested sub-queries, window functions, or complex CTEs (Common Table Expressions) do not exist.
* **No Schema Migrations**: The DSL only reads schemas—it does not create, modify, or migrate database tables (use SQL migrations for schema changes).

### When to Fall Back to Raw SQL
You should use the **Raw SQL Fallback** (via `Loader.query` / `Loader.execute`) whenever:
1. You need SQL beyond Elmto's current join/group/aggregate surface.
2. You are executing analytical queries that need `HAVING`, custom aliases, subqueries, window functions, or database-specific operators.
3. You need specific database features (like Postgres JSON operators or SQLite full-text search).
