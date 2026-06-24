# query-dsl (AI)

**Subpath:** `ElmSsr.Db.Dsl`. **CLI:** `elm-ssr query`.

Type-safe, edge-compatible SQL Query DSL & CLI code generator. Scans `.sql` migrations (excluding `.down.sql`), parses `CREATE TABLE` structures, and outputs type-safe Elm data access modules containing phantom types, encoders/decoders, and standard CRUD query builders.

This file is for `ElmSsr.Db.Dsl`. For the newer Ecto-like `ElmSsr.Db.Elmto.*` API with joins, group-by, and aggregate projections, use [elmto.md](elmto.md).

## File layout

Generated database access modules are outputted to your route's workspace:
```
src/
  <App>/
    Db/
      TestMembers.elm       # Generated database access module for table 'test_members'
```

## Generated API Signature & Shapes

For a generated module `src/<App>/Db/TestMembers.elm`:

```elm
-- Phantom type for table identification & isolation
type TestMembersTable

-- Descriptor references for DSL building
table : Table TestMembersTable
id : Column TestMembersTable Int
email : Column TestMembersTable String
score : Column TestMembersTable Float
isAdmin : Column TestMembersTable Bool
nickname : Column TestMembersTable String
registeredAt : Column TestMembersTable String

-- Type alias & decoders
type alias TestMember = { ... }
decoder : Decoder TestMember

-- Standard CRUD Builders (Loader / Action-ready)
all : Loader (List TestMember)
byId : Int -> Loader (Maybe TestMember)
insert : { email : String, score : Float, nickname : Maybe String } -> Loader { rowsAffected : Int }
delete : Int -> Loader { rowsAffected : Int }
update : Int -> { email : String, score : Float, isAdmin : Bool, nickname : Maybe String, registeredAt : Maybe String } -> Loader { rowsAffected : Int }
```

## Query DSL Exports (`ElmSsr.Db.Dsl`)

```elm
type Table table
type Column table val
type AnyColumn table
type Expression table
type Query table a

-- Table & Column creators (used by codegen)
table : String -> Table table
column : String -> (val -> Encode.Value) -> Column table val

-- Type erasure for mixed-type column selection lists
col : Column table val -> AnyColumn table

-- Selection builders
select : Table table -> List (AnyColumn table) -> Decoder a -> Query table a
selectAll : Table table -> Decoder a -> Query table a

-- Filter constraints (Curried: value first, column last for pipeline styling)
eq : val -> Column table val -> Expression table
neq : val -> Column table val -> Expression table
gt : val -> Column table val -> Expression table
gte : val -> Column table val -> Expression table
lt : val -> Column table val -> Expression table
lte : val -> Column table val -> Expression table
like : String -> Column table val -> Expression table
inList : List val -> Column table val -> Expression table
isNull : Column table val -> Expression table
isNotNull : Column table val -> Expression table

-- Logical combinations
and : Expression table -> Expression table -> Expression table
or : Expression table -> Expression table -> Expression table

-- Query modifiers & execution
where_ : Expression table -> Query table a -> Query table a
limit : Int -> Query table a -> Query table a
toLoader : Query table a -> Loader (List a)
toLoaderOne : Query table a -> Loader (Maybe a)
compileQuery : Query table a -> { sql : String, params : List Encode.Value, decoder : Decoder a }
```

## Minimal Example: Querying in a Route

```elm
module Example.Basic.Routes.Guestbook exposing (page)

import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Db.Dsl as Db
import Example.Basic.Db.Entries as Entries

page : Request -> Loader (Document Never)
page request =
    Db.selectAll Entries.table Entries.decoder
        |> Db.where_ (Entries.id |> Db.gt 10)
        |> Db.where_ (Db.or (Entries.message |> Db.like "%announcement%") (Entries.createdAt |> Db.isNull))
        |> Db.limit 5
        |> Db.toLoader
        |> Loader.map (\entries -> ... render entries ...)
```

## Common Pitfalls & Footguns

1. **Mixed-type Column selections**: Inside `Db.select`, a raw list like `[ Entries.id, Entries.message ]` will trigger an Elm type mismatch. You MUST wrap them in `Db.col`:
   `Db.select Entries.table [ Db.col Entries.id, Db.col Entries.message ]`
2. **Variable Shadowing**: Codegen defines local variable parameters inside functions like `byId` or `delete` as `idVal` instead of `id` (and similar names for other fields) to prevent Elm compiler variable shadowing errors against module-level column descriptors.
3. **Curried Operators**: All comparison operators (`eq`, `neq`, etc.) take the comparison value first, and the column descriptor last. This aligns with pipelining: `Entries.id |> Db.gt 5` (which expands to `Db.gt 5 Entries.id`).
4. **Generated DSL limitations**: `ElmSsr.Db.Dsl` does NOT support JOINs, GROUP BY, aggregates (SUM/COUNT/MIN/MAX), ORDER BY, or CTEs. Use Elmto for the supported join/group/aggregate surface; otherwise fall back to raw SQL via `Loader.query` / `Loader.execute` (you can still reuse generated decoders).
