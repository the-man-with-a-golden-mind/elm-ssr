# Legacy Query DSL (ElmSsr.Db.Dsl)

**This page documents the old `ElmSsr.Db.Dsl` surface.**

> **Deprecated.** The `elm-ssr query` generator now produces **Elmto** modules by default (`userSchema`, `nameCol`, `Repo.all`, changesets, joins, etc.).
>
> **New code must use [Elmto](elmto.md).** The old Dsl is kept only to help migrate existing projects.

See the excellent [Elmto documentation](elmto.md) for the current story — it is richer, has proper error handling, and is what the generator and examples now use.

## DSL vs Elmto — which to use

**Always prefer Elmto** for new code (changesets, Repo, joins, aggregates, constraint error handling).

| Situation | Use |
|---|---|
| Simple CRUD + basic filters on single tables | Generated helpers (still in output) **or** Elmto `Query` / `Repo` |
| Joins, aggregates, groups, complex queries, safe writes with errors | **[Elmto](elmto.md)** (canonical) |
| Anything else | `Loader.query` / `Loader.execute` (raw SQL + your decoders) |

The old `Dsl` module is kept only for migration of existing code. Do not import `ElmSsr.Db.Dsl` in new modules.

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

The generated module (Elmto focused) looks like:

```elm
module Example.Basic.Db.TrelloCards exposing
    ( TrelloCard, trelloCardSchema, idCol, columnIdCol, titleCol, ...
    , decoder, all, byId, insert, update, delete
    )

import ElmSsr.Db.Elmto as Elmto
import ElmSsr.Loader as Loader exposing (Loader)
import Json.Decode as Decode
import Json.Encode as Encode

type alias TrelloCard = { ... }

decoder : Decode.Decoder TrelloCard

trelloCardSchema : Elmto.Schema TrelloCard
trelloCardSchema =
    Elmto.schema "trello_cards" decoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "column_id" .columnId Elmto.int
        |> Elmto.field "title" .title Elmto.string
        |> Elmto.optionalField "description" .description Elmto.string
        |> Elmto.field "position" .position Elmto.int

idCol : Elmto.Column TrelloCard Int
-- titleCol etc.

-- Simple CRUD (Loader compat) + Elmto schema/cols for Query/Repo usage.
all : Loader (List TrelloCard)
-- ...
```

Key conventions:
- `snake_case` SQL names → `camelCase` Elm names (`column_id` → `columnId`)
- Nullable columns (`TEXT` without `NOT NULL`) → `Maybe` in the record type
- Auto-increment primary keys are excluded from `insert` parameters
- `update` and `delete` take the id as the first argument, named `idVal` to avoid shadowing the `id` column descriptor

---

For a table named `test_members`, the command generates a file at `src/<Namespace>/Db/TestMembers.elm`.

### Elmto Schema + Columns (canonical)
The generator now emits an Elmto `Schema` and typed `Column` values:

```elm
testMemberSchema : Elmto.Schema TestMember
testMemberSchema =
    Elmto.schema "test_members" decoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "email" .email Elmto.string
        -- ...

idCol : Elmto.Column TestMember Int
emailCol : Elmto.Column TestMember String
-- ...
```

Use these with `ElmSsr.Db.Elmto.Query.from testMemberSchema |> Query.where_ ...` and `Repo.all dialect ...`.

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

## 3. Querying (legacy DSL surface)

The original `ElmSsr.Db.Dsl` query surface is deprecated. Use `ElmSsr.Db.Elmto.Query` + `Repo` (see elmto.md) for all new work.

Simple generated helpers (all / byId / insert) continue to work for quick ports. For filters use Elmto:

```elm
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo
import Example.Basic.Db.Entries as Entries

recent =
    Query.from Entries.entrySchema
        |> Query.where_ (Query.gt 5 Entries.idCol)
        |> Repo.all SQLite
```

For advanced queries, filters, joins, aggregates and changesets, switch to Elmto (recommended in all cases). The legacy operators are no longer generated or documented here.

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

### Executing + advanced usage

Use the simple `all` / `insert` etc from generated modules together with raw `Loader.query` when you just need the decoder, or move to full Elmto:

- `Repo.all dialect (Query.from MyDb.xxxSchema |> Query.where_ (Query.eq val MyDb.yyyCol))`
- Changesets + `Repo.insert` / `Action` error paths for writes (see elmto.md and error-handling.md).

Raw SQL fallback via `Loader.query` / `softExecute` is always available and pairs well with generated decoders.

For the complete modern API see [elmto.md](elmto.md). The legacy Dsl operators and `toLoader` are not recommended.
