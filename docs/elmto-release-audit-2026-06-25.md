# Elmto Release Audit (2026-06-25)

## Scope

Audit target:

- `ElmSsr.Db.Elmto`
- `ElmSsr.Db.Elmto.Query`
- `ElmSsr.Db.Elmto.Compiler`
- `ElmSsr.Db.Elmto.Repo`

Validation goals:

- compare Elmto-generated queries with handwritten SQL
- exercise non-happy paths, not only optimistic CRUD
- measure runtime cost against raw SQL
- verify SQLite locally and PostgreSQL when environment access is available

## What Was Verified

### Compile coverage

`/Users/michalmajchrzak/Projects/elmssr/test/elmto.test.ts`

Verified SQL generation for:

- inner, left, right, and full joins
- subquery sources via `fromSubquery`
- subquery joins via `joinSubquery`
- common table expressions via `withCte`
- grouped queries across heterogeneous columns
- `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`
- custom select aliases
- raw select and where fragments
- correlated `EXISTS` / `NOT EXISTS`
- `IN (subquery)`
- typed bulk `UPDATE ... WHERE ...`
- typed bulk `DELETE ... WHERE ...`
- joined selects, joined filters, joined ordering
- `HAVING`
- `NOT IN`, `BETWEEN`, `ILIKE`
- insert and update SQL across SQLite and PostgreSQL placeholder styles

### Integration coverage

`/Users/michalmajchrzak/Projects/elmssr/test/integration/elmto-integration.test.ts`

Verified against real SQLite:

- `Repo.all`, `get`, `getBy`, `count`, `countWhere`, `exists`
- insert, update, delete
- `insertAll`
- uniqueness validation via pre-check and DB constraint path
- join + aggregate + group-by + having query execution
- `fromSubquery`, `joinSubquery`, `withCte`
- correlated `existsBy` / `notExistsBy`
- `inSubquery`
- `updateAll`
- `deleteAll`
- raw fragment execution
- `loadHasMany` and `loadBelongsTo`
- raw SQL parity for summary query
- raw SQL parity for advanced relational queries
- `ILIKE` execution path
- empty `IN` list execution path
- transaction rollback on constraint failure

Verified against real PostgreSQL in Docker:

- `test/integration/redis-postgres.test.ts`
- `test/integration/cli-scaffold.test.ts`
- `test/integration/elmto-integration.test.ts`
- `scripts/elmto-benchmark.mjs`

This run used:

- `docker compose up -d --wait`
- `DATABASE_URL=postgres://elmssr:elmssr@localhost:5432/elmssr`
- `REDIS_URL=redis://localhost:6379`

## Bugs Found And Fixed

1. `Query.ilike` was not SQLite-compatible.
   - Previous behavior: emitted `ILIKE`, which is not portable to SQLite.
   - Fixed behavior: emits `LOWER(column) LIKE LOWER(?)`, which works in both dialects.

2. `Query.inList []` could compile to invalid SQL.
   - Previous behavior: `IN ()`.
   - Fixed behavior: compiles to `1 = 0`.

3. Rollback behavior was not tested.
   - Added a failing transaction path that proves atomic rollback on duplicate-email constraint failure.

4. `D1DatabaseLike` was missing `batch(...)` in the TypeScript adapter shape.
   - Previous behavior: `bun run check` failed in `packages/elm-ssr/src/effects.ts`.
   - Fixed behavior: D1 transaction typing now matches runtime usage.

5. The join DSL was too narrow for Ecto-style composition.
   - Added `distinct`
   - Added arbitrary join predicates via `joinOn` + `On`
   - Added joined-to-joined chaining via `joinFrom`

6. `Query.select` could not safely change the result decoder type.
   - Previous behavior: record update hit Elm's type restriction.
   - Fixed behavior: `select` now rebuilds the query record with the new decoder.

7. `Query.as_` stacked aliases on aggregate selections.
   - Previous behavior: `COUNT(posts.user_id) AS count_user_id AS post_total`
   - Fixed behavior: overriding aliases now replaces the trailing alias.

8. Correlated `existsBy` / `notExistsBy` lost the outer table qualifier.
   - Previous behavior: generated predicates like `user_id = id`.
   - Fixed behavior: outer references compile to `users.id`-style qualified SQL.

9. Left-joined nullable subquery results were not exercised end-to-end.
   - Added integration coverage for `NULL` joined aggregates and corrected the decoder shape used in tests.

10. Live PostgreSQL duplicate-key errors from `Bun.sql` were parsed incompletely.
   - Previous behavior: only `String(error)` was inspected, which omitted the `detail` field carrying `Key (email)=...`.
   - Fixed behavior: constraint parsing now reads Bun.sql-style structured `detail` metadata and correctly returns `field = "email"`.

11. The PostgreSQL benchmark fixture teardown was invalid.
   - Previous behavior: the script tried to drop `elmto_posts` before dependent tables.
   - Fixed behavior: benchmark setup now drops dependent tables in valid order.

12. The benchmark compared reused Elmto DB clients against per-iteration raw Postgres clients.
   - Previous behavior: raw Postgres numbers were inflated by connection setup overhead.
   - Fixed behavior: raw benchmark paths now reuse the same DB client, making the comparison meaningful.

13. Elmto had no typed bulk update/delete-by-query path.
   - Added `Repo.updateAll`
   - Added `Repo.deleteAll`
   - Added compiler coverage and SQLite/PostgreSQL execution coverage

14. Elmto had no typed union support or preload mapping helpers.
   - Added `Query.union`
   - Added `Query.unionAll`
   - Added `Repo.preloadHasMany`
   - Added `Repo.preloadBelongsTo`
   - Added compile coverage plus SQLite/PostgreSQL execution coverage

## Performance

Measured with:

- `/Users/michalmajchrzak/Projects/elmssr/scripts/elmto-benchmark.mjs`
- dataset: `500` users, `2500` posts
- iterations per case: `40`

### SQLite

| Case | Avg | P95 | Throughput |
|---|---:|---:|---:|
| raw summary SQL | 0.72 ms | 1.40 ms | 1383.8 ops/s |
| Elmto summary route | 3.19 ms | 4.43 ms | 313.2 ops/s |
| raw search SQL | 0.10 ms | 0.11 ms | 9942.3 ops/s |
| Elmto search route | 2.17 ms | 5.08 ms | 460.7 ops/s |

Interpretation:

- SQL execution itself is not the bottleneck.
- The extra cost is framework/runtime overhead: Elm loader/action loop, worker request handling, JSON decode/encode, and SSR document rendering.
- For the measured dataset, Elmto route execution stays under `5 ms` average on SQLite.
- Summary queries still show noticeable framework overhead relative to handwritten SQL; search queries are materially closer.

### PostgreSQL

| Case | Avg | P95 | Throughput |
|---|---:|---:|---:|
| raw summary SQL | 1.33 ms | 2.27 ms | 754.4 ops/s |
| Elmto summary route | 3.76 ms | 4.29 ms | 265.9 ops/s |
| raw search SQL | 0.53 ms | 0.61 ms | 1890.2 ops/s |
| Elmto search route | 2.38 ms | 3.41 ms | 420.9 ops/s |

Interpretation:

- PostgreSQL route overhead is real but not extreme on this dataset.
- Summary routes stay within roughly `1.6x` of raw SQL average latency.
- Search routes show larger framework overhead because the raw query path is very cheap.
- The benchmark was corrected to reuse raw DB clients before recording these numbers.

## Release Blockers

1. No hard release blocker remains from the PostgreSQL proof path.
   - Docker-backed PostgreSQL integration and benchmark execution are now complete.

2. The repo-wide unit gate is still red in a network-restricted environment.
   - `bun run test:unit` currently reports `221` pass / `9` fail.
   - The failures are in CLI/styling tests that spawn fresh Elm builds and require live access to `https://package.elm-lang.org/all-packages`.
   - That is not an Elmto regression, but it does mean the broader release gate is not hermetic offline.

## Missing Features Relative To Ecto-Level Expectations

Observed from current API shape:

- no window functions
- no lateral joins
- no migration/generator layer comparable to Ecto schemas + contexts

## Conclusion

Elmto is materially stronger after this audit:

- compile coverage is broad
- SQLite execution coverage now includes parity and failure cases
- new union/preload APIs are exercised against SQLite and PostgreSQL
- several real DSL/runtime bugs were fixed
- benchmark tooling now exists

It is closer to release-ready now, but I would still hold the "final release" label until:

- the remaining Ecto-parity gaps are either accepted explicitly or implemented
- the broader repo test gate is made hermetic or is run in an environment with external Elm package access

## Next Steps

1. Decide whether "Ecto-like" for this project includes:
   - window/lateral query features
   - migration/generator ergonomics
2. If the target is real Ecto parity, extend the DSL before calling the release final.
