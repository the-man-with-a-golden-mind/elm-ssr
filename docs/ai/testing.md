# testing (AI)

**Runner:** `bun test` via npm scripts.

## Scripts

```sh
bun run test:unit          # all test/*.test.ts except test/integration/. Fast (~400ms).
bun run test:integration   # only test/integration/. Brings PG+Redis via docker compose. Tears down on exit.
bun run test               # full suite (unit + integration). Also docker-managed.
```

Docker scripts bring `postgres:16-alpine` (port 5432) + `redis:7-alpine` (port 6379) up via `docker compose up -d --wait`, run, then `docker compose down`. Exit code preserved across teardown.

## Layout

```
test/
  *.test.ts            # unit (fast, no servers)
  integration/
    *.test.ts          # need DATABASE_URL + REDIS_URL set; throw at import time if missing
```

## Common patterns

### Test through the example worker

```ts
import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

it("renders the home page", async () => {
  const response = await worker.fetch(new Request("https://example.com/"));
  expect(response.status).toBe(200);
});
```

### Custom effects in a test

```ts
import { createExampleWorker } from "../examples/basic/runtime";
import { inMemoryEffects } from "elm-ssr/effects";

const fakeEffects = inMemoryEffects({
  fetchJson: (url) => url === "app://status" ? { region: "test" } : { throw new Error("unexpected: " + url); },
});
const app = createExampleWorker({ effects: fakeEffects });
```

### Synthetic Elm module (no real Elm)

```ts
import type { CompiledElmModule } from "elm-ssr/render";

const brokenModule: CompiledElmModule = {
  Main: {
    init() { throw new Error("boom"); },
  },
};
const app = createWorkerApp({ elmModule: brokenModule, /* ... */ });
// → exercises the error path without compiling Elm
```

### Polling a store

```ts
const waitForStatus = async (store, id, target, timeoutMs = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = await store.get(id);
    if (record?.status === target) return record;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`did not reach ${target}`);
};
```

### SSE end-to-end

```ts
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (events.length < expected) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value);
  let idx;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const data = frame.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
    if (data) events.push(JSON.parse(data));
  }
}
await reader.cancel();
```

### Form action (PRG)

```ts
const response = await worker.fetch(
  new Request("https://example.com/echo", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "message=hello",
  })
);
expect(response.status).toBe(302);
expect(response.headers.get("location")).toBe("/echo?status=received&...");
```

### Cookie / Set-Cookie

```ts
// Multiple Set-Cookie headers — use getSetCookie() not .get("set-cookie") (the latter joins them).
const cookies: string[] =
  typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
```

### Island runtime (happy-dom)

Use `test/island-runtime.test.ts` as the template: load `islandsCoreSource` from `elm-ssr/islands-runtime`, eval as a Function returning `createIslandsRuntime`, install happy-dom globals, mount with the real generated bundle.

## Footguns

- Integration suite THROWS at import if `DATABASE_URL`/`REDIS_URL` aren't set — by design, points you at `bun run test:integration`. Don't add try/catch.
- happy-dom's `querySelector` is broken on some selectors — existing tests use `getElementsByTagName` + manual class walkers.
- `tsc` doesn't include `test/`. Tests can import `bun:sqlite` etc. even though they wouldn't typecheck elsewhere.
- `bun test <file>` runs only that file. `bun test` runs everything. `bun run test:unit` filters via `find`.
- Logging middleware spams stdout — pass `log: () => {}` when creating a worker for benchmarks/load tests to silence.
- `Headers.get("set-cookie")` returns a single comma-joined string (wrong); use `Headers.getSetCookie()` for the array.
- For SSE tests: always `reader.cancel()` in a finally — leftover open streams keep the suite running.
