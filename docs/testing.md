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

While writing code, use `test:unit` — no Docker, seconds for 260+ tests:

```sh
bun run test:unit
```

## Full run

```sh
bun run test
```

This compiles the example apps (`bun run build`), brings Docker up, runs
everything, tears Docker down. Run before a PR or a release.

---

## Writing tests

### Testing a page route

Use `renderPath` (from `examples/basic/runtime.ts`) for quick HTML assertions,
or `createExampleWorker` for full HTTP round-trips:

```ts
import { describe, expect, it } from "bun:test";
import { renderPath } from "../examples/basic/runtime";
import { renderHtmlDocument } from "elm-ssr/render";

describe("/guestbook", () => {
  it("renders the entry list", async () => {
    const result = await renderPath("/guestbook");
    const html = renderHtmlDocument(result.document);
    expect(result.status).toBe(200);
    expect(html).toContain("Guestbook");
  });
});
```

### Testing a form action (PRG pattern)

```ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createExampleWorker } from "../examples/basic/runtime";
import { inMemoryEffects, type SqlQuery } from "elm-ssr/effects";

describe("POST /guestbook", () => {
  const setup = () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))");
    const sql = ({ sql, params, mode }: SqlQuery) => {
      const stmt = db.query(sql);
      if (mode === "run") return { rowsAffected: Number(stmt.run(...(params as never[])).changes) };
      if (mode === "first") return stmt.get(...(params as never[])) ?? null;
      return stmt.all(...(params as never[]));
    };
    return createExampleWorker({ effects: inMemoryEffects({ sql }) });
  };

  it("inserts a row and redirects (PRG)", async () => {
    const worker = setup();

    const post = await worker.fetch(
      new Request("https://example.com/guestbook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message=hello"
      })
    );
    expect(post.status).toBe(302);
    expect(post.headers.get("location")).toBe("/guestbook");

    const get = await (await worker.fetch(new Request("https://example.com/guestbook"))).text();
    expect(get).toContain("hello");
  });

  it("rejects blank messages with 422", async () => {
    const worker = setup();
    const post = await worker.fetch(
      new Request("https://example.com/guestbook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "message="
      })
    );
    expect(post.status).toBe(422);
  });
});
```

### Testing effects directly

Call `inMemoryEffects` like a function to verify runner behaviour without an
Elm app:

```ts
import { inMemoryEffects } from "elm-ssr/effects";
import { Database } from "bun:sqlite";

it("softExecute returns constraintError on UNIQUE violation", async () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)");
  db.run("INSERT INTO users VALUES (1, 'alice@example.com')");

  const effects = inMemoryEffects({
    sql: ({ sql, params, mode }) => {
      const stmt = db.query(sql);
      if (mode === "run") return { rowsAffected: Number(stmt.run(...(params as never[])).changes) };
      if (mode === "first") return stmt.get(...(params as never[])) ?? null;
      return stmt.all(...(params as never[]));
    }
  });

  const result = await effects(
    { kind: "softExecute", payload: { sql: "INSERT INTO users VALUES (?, ?)", params: [99, "alice@example.com"] } },
    {}
  ) as { ok: boolean; value: { constraintError: { kind: string; field: string } } };

  expect(result.ok).toBe(true);
  expect(result.value.constraintError.kind).toBe("unique");
  expect(result.value.constraintError.field).toBe("email");
});
```

### Testing sessions

Use `createSessionExampleWorker` (exported from `examples/basic/runtime.ts`)
which wires `memorySessionStore` + CSRF middleware in one call:

```ts
import { createSessionExampleWorker } from "../examples/basic/runtime";

it("login → session → protected page", async () => {
  const worker = createSessionExampleWorker();

  // 1. GET login page to mint a session and get a CSRF token
  const loginPage = await worker.fetch(new Request("https://example.com/profile"));
  const cookie = loginPage.headers.getSetCookie()[0].split(";")[0];
  const csrf = loginPage.text().then(html => html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] ?? "");

  // 2. POST credentials
  const loginRes = await worker.fetch(
    new Request("https://example.com/profile", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: `username=alice&_csrf=${encodeURIComponent(await csrf)}`
    })
  );
  expect(loginRes.status).toBe(302);

  // 3. Visit protected page
  const dashboard = await worker.fetch(
    new Request("https://example.com/dashboard", { headers: { cookie } })
  );
  expect(dashboard.status).toBe(200);
  expect(await dashboard.text()).toContain("alice");
});
```

### Testing islands (Browser.element)

Use `happy-dom` to mount an island and drive its Elm runtime:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

let window: Window;

beforeEach(() => {
  window = new Window();
  // Install globals expected by Elm
  for (const [k, v] of [["window", window], ["document", window.document], /* … */]) {
    Reflect.set(globalThis, k, v);
  }
});

afterEach(() => { /* restore globals */ });

it("Counter island increments on click", async () => {
  delete (globalThis as any).Elm;
  const runtime = (await import("../generated/examples/basic/islands.mjs?cache=" + Date.now())).default;

  const root = window.document.createElement("div");
  window.document.body.appendChild(root);
  (runtime as any)["Example"]["Basic"]["Islands"]["Counter"].init({ node: root, flags: { start: 5 } });

  await new Promise(r => setTimeout(r, 0));
  expect(root.textContent).toContain("5");

  root.querySelector(".btn-primary")?.dispatchEvent(
    new window.Event("click", { bubbles: true }) as unknown as Event
  );
  await new Promise(r => setTimeout(r, 0));
  expect(root.textContent).toContain("6");
});
```

See [test/browser-island.test.ts](../test/browser-island.test.ts) for the
complete happy-dom setup helpers (`installWindowGlobals`, `mountIsland`, etc.).

---

## Integration suite

`test/integration/redis-postgres.test.ts` exercises:

- `redisCache` (`withCache`) round-trips against real Redis (`Bun.redis`).
- TTL expiration.
- `runMigrations` / `revertMigrations` / `listMigrations` against real Postgres.
- `postgresSql` adapter against real Postgres.

It **throws** if `DATABASE_URL` / `REDIS_URL` aren't set — use
`bun run test:integration` rather than `bun test test/integration/` directly.

## Docker services

[docker-compose.yml](../docker-compose.yml) defines:

- `postgres:16-alpine` on `localhost:5432`, user/pass/db = `elmssr`.
- `redis:7-alpine` on `localhost:6379`.

Both have healthchecks; `--wait` blocks until they're ready.

## Source

- Tests: [test/](../test/)
- Integration: [test/integration/](../test/integration/)
- Docker: [docker-compose.yml](../docker-compose.yml)
