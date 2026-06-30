# query-dsl (AI) — legacy / migration only

**Do not use for new code.**

The generator (`elm-ssr query`) now produces **Elmto** modules (`xxxSchema`, `*Col`).

Old `ElmSsr.Db.Dsl` (phantom `Table` + curried operators + `toLoader`) is deprecated.

See `ai/elmto.md` for the current authoritative surface. Use this file only when porting old generated Db modules.

## File layout

Generated database access modules are outputted to your route's workspace:
```
src/
  <App>/
    Db/
      TestMembers.elm       # Generated database access module for table 'test_members'
```

## Generated API Signature & Shapes (Elmto)

For a generated module `src/<App>/Db/TestMembers.elm`:

```elm
type alias TestMember = { ... }
decoder : Decoder TestMember

testMemberSchema : Elmto.Schema TestMember
idCol : Elmto.Column TestMember Int
emailCol : Elmto.Column TestMember String
-- ...

-- Compat CRUD (still Loader based)
all : Loader (List TestMember)
byId, insert, delete, update ...
```

For rich usage pass schema/cols to Elmto.Query + Repo (or Compiler directly).

## Query DSL Exports (LEGACY — do not use)

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

(legacy Dsl API surface intentionally omitted — new code uses Elmto.Query, Elmto.Repo etc exclusively)
