import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { AppContext } from "elm-ssr/http";
import type { RequestSession } from "elm-ssr/sessions";
import { createBetterAuthProvider } from "elm-ssr/auth/better-auth";
import { betterAuthMigrationTemplate } from "../packages/elm-ssr/lib/scaffold/auth-templates.mjs";

// Direct unit tests against the library provider — not via a scaffolded app.
// This is what catches protocol-level bugs (e.g. the dash() plugin never
// actually being wired in, so the dashboard never saw real user data) at the
// source, instead of only through indirect E2E probing of generated code
// that nothing else type-checks or imports.

const fakeSession = (overrides: Partial<RequestSession> = {}): RequestSession => ({
  id: "id",
  data: null,
  csrf: "csrf-token",
  dirty: false,
  destroyed: false,
  isNew: false,
  ...overrides
});

const contextFor = (request: Request, session?: RequestSession): AppContext => ({
  request,
  url: new URL(request.url),
  requestId: "",
  startedAt: performance.now(),
  session
});

const next = async () => new Response("passthrough", { status: 200 });

describe("createBetterAuthProvider", () => {
  let root: string;
  let db: Database;
  let provider: ReturnType<typeof createBetterAuthProvider>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "elm-ssr-auth-better-auth-"));
    db = new Database(resolve(root, "app.db"));
    db.exec(betterAuthMigrationTemplate());
    provider = createBetterAuthProvider({
      baseURL: () => "http://localhost:8787",
      secret: () => "test-secret-at-least-32-characters-long-for-better-auth",
      database: () => db,
      apiKey: () => undefined
    });
  });

  afterAll(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it("declares /api/auth/ as its routes", () => {
    expect(provider.name).toBe("better-auth");
    expect(provider.routes).toEqual(["/api/auth/"]);
  });

  it("passes through non /api/auth/ paths", async () => {
    const res = await provider.middleware(contextFor(new Request("https://example.com/")), next);
    expect(await res.text()).toBe("passthrough");
  });

  it("returns 500 when session middleware is missing", async () => {
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/sign-in")), next);
    expect(res.status).toBe(500);
  });

  it("sign-up creates a real BetterAuth user and writes it into the elm-ssr session", async () => {
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(
        new Request("https://example.com/api/auth/sign-up", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "unit@test.com", password: "password123", name: "Unit Tester" })
        }),
        session
      ),
      next
    );
    expect(res.status).toBe(200);
    expect(session.dirty).toBe(true);
    expect((session.data as any).user.email).toBe("unit@test.com");
    expect((session.data as any).user.provider).toBe("better-auth");
  });

  it("duplicate sign-up is rejected and does not touch the session", async () => {
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(
        new Request("https://example.com/api/auth/sign-up", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "unit@test.com", password: "password123", name: "Unit Tester" })
        }),
        session
      ),
      next
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(session.dirty).toBe(false);
  });

  it("sign-in with the wrong password is rejected with 401", async () => {
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(
        new Request("https://example.com/api/auth/sign-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "unit@test.com", password: "wrong-password" })
        }),
        session
      ),
      next
    );
    expect(res.status).toBe(401);
    expect(session.dirty).toBe(false);
  });

  it("sign-in with correct credentials sets the session", async () => {
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(
        new Request("https://example.com/api/auth/sign-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "unit@test.com", password: "password123" })
        }),
        session
      ),
      next
    );
    expect(res.status).toBe(200);
    expect((session.data as any).user.email).toBe("unit@test.com");
  });

  it("logout destroys the session and redirects to /login", async () => {
    const session = fakeSession({ data: { user: { email: "unit@test.com" } } });
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/logout"), session), next);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(session.destroyed).toBe(true);
  });

  it("unregistered /api/auth/* paths fall through to BetterAuth's own 404", async () => {
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(new Request("https://example.com/api/auth/this-route-does-not-exist"), session),
      next
    );
    expect(res.status).toBe(404);
  });

  it("dash/validate is handled by the real dash() plugin (JWT-gated), not a fake always-200 stub", async () => {
    // No Authorization header → the real plugin's jwtValidateMiddleware must
    // reject this. A 200 here would mean the dashboard endpoint is faked
    // again instead of going through actual @better-auth/infra.
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(new Request("https://example.com/api/auth/dash/validate"), session),
      next
    );
    expect(res.status).toBe(401);
  });
});

// Regression test for a real bug: when `database` resolves to something falsy
// (misresolved DATABASE_URL, missing D1 binding, etc.), better-auth silently
// substitutes an in-memory adapter — sign-up/sign-in keep returning 200s and
// setting real-looking sessions, but nothing is ever persisted. This must
// surface as a loud, immediate failure instead.
describe("createBetterAuthProvider missing database", () => {
  it("returns 500 instead of silently falling back to an in-memory store", async () => {
    const provider = createBetterAuthProvider({
      baseURL: () => "http://localhost:8787",
      secret: () => "test-secret-at-least-32-characters-long-for-better-auth",
      database: () => undefined
    });
    const session = fakeSession();
    const res = await provider.middleware(
      contextFor(
        new Request("https://example.com/api/auth/sign-up", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "nodb@test.com", password: "password123", name: "No Db" })
        }),
        session
      ),
      next
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("no database configured");
    expect(session.dirty).toBe(false);
  });

  it("also fails loud for non-/api/auth/ paths, since getAuth resolves eagerly on every request", async () => {
    const provider = createBetterAuthProvider({
      baseURL: () => "http://localhost:8787",
      secret: () => "test-secret-at-least-32-characters-long-for-better-auth",
      database: () => null
    });
    const res = await provider.middleware(contextFor(new Request("https://example.com/")), next);
    expect(res.status).toBe(500);
  });
});

// Regression test for a real bug: on Cloudflare Workers, env.DB is the same
// object reference on every request to a warm isolate. The internal
// betterAuth instance is cached for performance, but if the cache key were
// just the db reference, ANY env-dependent config (baseURL/secret/apiKey)
// resolved differently on a later request would be silently ignored —
// whatever value happened to resolve on the very first request would stick
// for the isolate's whole lifetime. This caught a real case: apiKey was
// undefined on a cold start before BETTER_AUTH_API_KEY was configured, then
// stayed "missing" forever even after the key was set, because db never
// changed. Verified here by spying on the option resolvers themselves
// (no module mocking needed) — they must be re-invoked, and a config change
// must actually reach the constructed instance, on every request.
describe("createBetterAuthProvider config cache", () => {
  it("re-resolves baseURL/secret/database/apiKey on every request, not just the first", async () => {
    const stableDb = new Database(":memory:");
    stableDb.exec(betterAuthMigrationTemplate());

    const database = mock(() => stableDb);
    const baseURL = mock(() => "http://localhost:8787");
    const secret = mock(() => "test-secret-at-least-32-characters-long-for-better-auth");
    const apiKey = mock(() => undefined as string | undefined);

    const provider = createBetterAuthProvider({ baseURL, secret, database, apiKey });
    const next = async () => new Response("passthrough", { status: 200 });
    const session = fakeSession();

    await provider.middleware(
      contextFor(new Request("https://example.com/api/auth/dash/validate"), session),
      next
    );
    expect(database).toHaveBeenCalledTimes(1);
    expect(apiKey).toHaveBeenCalledTimes(1);

    // Same db reference (simulates a warm isolate reusing the same D1/sqlite
    // binding), but apiKey now resolves to a real value.
    apiKey.mockImplementation(() => "real-key-now-configured");

    await provider.middleware(
      contextFor(new Request("https://example.com/api/auth/dash/validate"), session),
      next
    );
    // The bug: with a db-only cache key, getAuth would short-circuit before
    // even calling apiKey() again on the second request.
    expect(database).toHaveBeenCalledTimes(2);
    expect(apiKey).toHaveBeenCalledTimes(2);
    expect(baseURL).toHaveBeenCalledTimes(2);
    expect(secret).toHaveBeenCalledTimes(2);

    stableDb.close();
  });
});
