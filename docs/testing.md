# Testing

The repo's test loops are split by what they need running. All run through
`bun test`.

## Scripts

| Script | Brings Docker up? | What runs |
| ------ | ----------------- | --------- |
| `bun run test:unit` | No | All `test/*.test.ts` except `test/integration/`. Fast. |
| `bun run test:integration` | Yes (PG + Redis) | Only `test/integration/`. Tears Docker back down on exit. |
| `bun run test` | Yes (PG + Redis) | Everything. Tears Docker back down on exit. |

Each Docker-managed script runs `docker compose up -d --wait`, executes the
suite, and then runs `docker compose down` — even on test failure (it
preserves the exit code).

## Local quick loop

While writing code, use `test:unit` — no Docker, ~400ms for ~108 tests:

```sh
bun run test:unit
```

## Full run

```sh
bun run test
```

This compiles the example apps (`bun run build`), brings Docker up, runs
everything (114 tests as of this writing), tears Docker down. Useful before a
PR or a release.

## Integration suite

`test/integration/redis-postgres.test.ts` exercises:

- `redisCache` (`withCache`) round-trips against a real Redis (`Bun.redis`).
- TTL expiration.
- `runMigrations` / `revertMigrations` / `listMigrations` against real
  Postgres (`Bun.sql`).
- `postgresSql` adapter (`query`/`queryOne`/`execute`) against real Postgres.

It **throws** if `DATABASE_URL` / `REDIS_URL` aren't set. That's deliberate
— it points you at `bun run test:integration` instead of silently
green-skipping when you actually wanted to run it.

## Docker services

[docker-compose.yml](../docker-compose.yml) defines:

- `postgres:16-alpine` on `localhost:5432`, user/pass/db = `elmssr`.
- `redis:7-alpine` on `localhost:6379`.

Both have healthchecks; `--wait` blocks until they're ready.

## Writing tests

Each test suite lives in `test/<area>.test.ts`. Pattern:

```ts
import { describe, expect, it } from "bun:test";
import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";

describe("worker", () => {
  it("renders a page", async () => {
    const worker = createWorkerApp({ /* … */, effects: inMemoryEffects() });
    const response = await worker.fetch(new Request("https://example.com/"));
    expect(response.status).toBe(200);
  });
});
```

Use `inMemoryEffects` (optionally with `withCache(..., redisCache(...))` /
`postgresSql(...)`) to test effect interactions without a real backend.

## Source

- Tests: [test/](../test/)
- Integration: [test/integration/](../test/integration/)
- Docker: [docker-compose.yml](../docker-compose.yml)
