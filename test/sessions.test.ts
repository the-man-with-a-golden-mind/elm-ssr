import { describe, expect, it } from "bun:test";
import {
  cacheStore,
  csrfMiddleware,
  generateCsrfToken,
  generateSessionId,
  memorySessionStore,
  sessionEffects,
  sessionMiddleware,
  signValue,
  verifyValue,
  type RequestSession,
  type SessionRecord
} from "elm-ssr/sessions";
import type { AppContext, Middleware, WorkerExecutionContext } from "elm-ssr/http";
import { composeMiddleware } from "elm-ssr/middleware";

// === crypto ===

describe("signValue / verifyValue (HMAC-SHA256, URL-safe base64)", () => {
  it("round-trips an ascii value", async () => {
    const secret = "test-secret";
    const signed = await signValue(secret, "abc-123");
    expect(signed).toContain(".");
    expect(await verifyValue(secret, signed)).toBe("abc-123");
  });

  it("round-trips a unicode value", async () => {
    const signed = await signValue("s", "héllo 🌍");
    expect(await verifyValue("s", signed)).toBe("héllo 🌍");
  });

  it("rejects a tampered value", async () => {
    const signed = await signValue("s", "alice");
    // Flip the value portion before the signature.
    const tampered = "Ym9i." + signed.split(".")[1];
    expect(await verifyValue("s", tampered)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const signed = await signValue("s1", "alice");
    expect(await verifyValue("s2", signed)).toBeNull();
  });

  it("rejects garbage with no separator", async () => {
    expect(await verifyValue("s", "not-a-signed-value")).toBeNull();
  });
});

describe("generators", () => {
  it("generateSessionId returns a unique UUID-ish string", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("generateCsrfToken returns 32 bytes of base64 (≈43 chars)", () => {
    const t = generateCsrfToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
});

// === stores ===

describe("memorySessionStore", () => {
  it("get/set/delete round-trips a record", async () => {
    const store = memorySessionStore();
    const record: SessionRecord = { data: { user: "alice" }, csrf: "csrf-1" };
    await store.set("id-1", record);
    expect(await store.get("id-1")).toEqual(record);
    await store.delete("id-1");
    expect(await store.get("id-1")).toBeNull();
  });

  it("evicts expired records on read", async () => {
    const store = memorySessionStore();
    await store.set("expired", { data: 1, csrf: "x", expiresAt: Date.now() - 1 });
    expect(await store.get("expired")).toBeNull();
  });

  it("returns live records before expiry", async () => {
    const store = memorySessionStore();
    await store.set("live", { data: 1, csrf: "x", expiresAt: Date.now() + 60_000 });
    expect(await store.get("live")).toEqual({ data: 1, csrf: "x", expiresAt: expect.any(Number) });
  });
});

describe("cacheStore (over a CacheBackend)", () => {
  const makeBackend = () => {
    const map = new Map<string, unknown>();
    return {
      backend: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: unknown) => {
          map.set(k, v);
        }
      },
      map
    };
  };

  it("scopes keys under the configured prefix", async () => {
    const { backend, map } = makeBackend();
    const store = cacheStore(backend, { keyPrefix: "myapp:s:" });
    await store.set("id-1", { data: 42, csrf: "c" });
    expect([...map.keys()]).toEqual(["myapp:s:id-1"]);
  });

  it("round-trips a record", async () => {
    const { backend } = makeBackend();
    const store = cacheStore(backend);
    const record: SessionRecord = { data: { x: 1 }, csrf: "c", expiresAt: Date.now() + 60_000 };
    await store.set("id", record);
    expect(await store.get("id")).toEqual(record);
  });
});

// === sessionMiddleware ===

const SECRET = "test-secret-please-rotate";

const buildContext = (request: Request): AppContext => ({
  request,
  url: new URL(request.url),
  requestId: "",
  startedAt: 0,
  executionCtx: undefined,
  env: undefined
});

const runStack = async (middlewares: Middleware[], request: Request, handler: (c: AppContext) => Promise<Response>) => {
  const context = buildContext(request);
  const composed = composeMiddleware(handler, middlewares);
  const response = await composed(context);
  return { response, context };
};

const setCookiesOf = (response: Response): string[] =>
  // @ts-expect-error: getSetCookie exists on Bun/undici Headers
  typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];

const cookieFromSetHeader = (header: string): { name: string; value: string } => {
  const first = header.split(";")[0];
  const eq = first.indexOf("=");
  return { name: first.slice(0, eq), value: first.slice(eq + 1) };
};

describe("sessionMiddleware", () => {
  it("mints a fresh session when no cookie is sent and persists it", async () => {
    const store = memorySessionStore();
    let observedSession: RequestSession | undefined;

    const { response } = await runStack(
      [sessionMiddleware({ secret: SECRET, store, secure: false })],
      new Request("https://example.com/"),
      async (context) => {
        observedSession = context.session;
        return new Response("ok");
      }
    );

    expect(observedSession).toBeDefined();
    expect(observedSession?.isNew).toBe(true);
    expect(observedSession?.csrf).toBeString();

    const cookies = setCookiesOf(response);
    expect(cookies).toHaveLength(1);
    const { name, value } = cookieFromSetHeader(cookies[0]);
    expect(name).toBe("session");
    expect(value).toContain(".");

    // Round-trip: the signed value should verify to the session id.
    const verified = await verifyValue(SECRET, decodeURIComponent(value));
    expect(verified).toBe(observedSession?.id);

    // The store should have persisted the session.
    const persisted = await store.get(observedSession!.id);
    expect(persisted?.csrf).toBe(observedSession!.csrf);
  });

  it("loads an existing session when the signed cookie is valid", async () => {
    const store = memorySessionStore();
    const id = generateSessionId();
    await store.set(id, { data: { user: "alice" }, csrf: "csrf-xyz" });
    const signed = await signValue(SECRET, id);

    let observed: RequestSession | undefined;
    const { response } = await runStack(
      [sessionMiddleware({ secret: SECRET, store, secure: false })],
      new Request("https://example.com/", { headers: { cookie: `session=${signed}` } }),
      async (context) => {
        observed = context.session;
        return new Response("ok");
      }
    );

    expect(observed?.id).toBe(id);
    expect(observed?.data).toEqual({ user: "alice" });
    expect(observed?.csrf).toBe("csrf-xyz");
    expect(observed?.isNew).toBe(false);

    // No re-roll when the session is not dirty.
    expect(setCookiesOf(response)).toHaveLength(0);
  });

  it("mints a fresh session when the cookie signature is tampered", async () => {
    const store = memorySessionStore();
    let observed: RequestSession | undefined;

    await runStack(
      [sessionMiddleware({ secret: SECRET, store, secure: false })],
      new Request("https://example.com/", { headers: { cookie: "session=not.valid" } }),
      async (context) => {
        observed = context.session;
        return new Response("ok");
      }
    );

    expect(observed?.isNew).toBe(true);
  });

  it("persists and rolls the cookie when downstream sets data via sessionEffects", async () => {
    const store = memorySessionStore();

    const { response, context } = await runStack(
      [sessionMiddleware({ secret: SECRET, store, secure: false })],
      new Request("https://example.com/"),
      async (ctx) => {
        // Simulate sessionEffects' setSession effect on the live session.
        ctx.session!.data = { user: "bob" };
        ctx.session!.dirty = true;
        return new Response("ok");
      }
    );

    const cookies = setCookiesOf(response);
    expect(cookies).toHaveLength(1);

    const stored = await store.get(context.session!.id);
    expect(stored?.data).toEqual({ user: "bob" });
  });

  it("deletes the record and clears the cookie when session is destroyed", async () => {
    const store = memorySessionStore();
    const id = generateSessionId();
    await store.set(id, { data: { user: "alice" }, csrf: "c" });
    const signed = await signValue(SECRET, id);

    const { response } = await runStack(
      [sessionMiddleware({ secret: SECRET, store, secure: false })],
      new Request("https://example.com/", { headers: { cookie: `session=${signed}` } }),
      async (ctx) => {
        ctx.session!.destroyed = true;
        return new Response("ok");
      }
    );

    expect(await store.get(id)).toBeNull();
    const cookies = setCookiesOf(response);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("Max-Age=0");
  });
});

// === csrfMiddleware ===

describe("csrfMiddleware", () => {
  const sessionFixture = (csrfValue: string): Middleware => async (ctx, next) => {
    ctx.session = {
      id: "id",
      data: null,
      csrf: csrfValue,
      dirty: false,
      destroyed: false,
      isNew: false
    };
    return next(ctx);
  };

  it("passes through safe verbs without a token", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/"),
      async () => new Response("ok")
    );
    expect(response.status).toBe(200);
  });

  it("rejects POST without a token", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/", { method: "POST" }),
      async () => new Response("should not reach")
    );
    expect(response.status).toBe(403);
  });

  it("accepts POST with a matching x-csrf-token header", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/", { method: "POST", headers: { "x-csrf-token": "csrf-1" } }),
      async () => new Response("ok")
    );
    expect(response.status).toBe(200);
  });

  it("rejects POST with a wrong x-csrf-token header", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/", { method: "POST", headers: { "x-csrf-token": "wrong" } }),
      async () => new Response("should not reach")
    );
    expect(response.status).toBe(403);
  });

  it("accepts POST when the token is in a form field", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "_csrf=csrf-1&other=field"
      }),
      async () => new Response("ok")
    );
    expect(response.status).toBe(200);
  });

  it("returns JSON 403 for /api/ paths on token mismatch", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware()],
      new Request("https://example.com/api/widgets", { method: "POST" }),
      async () => new Response("should not reach")
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("csrf_token_invalid");
  });

  it("skips checks for configured prefixes", async () => {
    const { response } = await runStack(
      [sessionFixture("csrf-1"), csrfMiddleware({ skipPaths: ["/webhooks/"] })],
      new Request("https://example.com/webhooks/stripe", { method: "POST" }),
      async () => new Response("ok")
    );
    expect(response.status).toBe(200);
  });

  it("fails closed if sessionMiddleware is not installed", async () => {
    const { response } = await runStack(
      [csrfMiddleware()],
      new Request("https://example.com/", { method: "POST", headers: { "x-csrf-token": "anything" } }),
      async () => new Response("should not reach")
    );
    expect(response.status).toBe(500);
  });
});

// === sessionEffects adapter ===

describe("sessionEffects (Elm-facing effect adapter)", () => {
  const runWith = async (effect: { kind: string; payload: Record<string, unknown> }, session?: RequestSession) => {
    const passthrough = async () => ({ ok: false, error: "should not pass through" });
    const runner = sessionEffects(passthrough);
    return runner(effect, { session });
  };

  const fakeSession = (overrides: Partial<RequestSession> = {}): RequestSession => ({
    id: "id",
    data: { user: "alice" },
    csrf: "csrf-token",
    dirty: false,
    destroyed: false,
    isNew: false,
    ...overrides
  });

  it("returns session.data for the session kind", async () => {
    expect(await runWith({ kind: "session", payload: {} }, fakeSession())).toEqual({
      ok: true,
      value: { user: "alice" }
    });
  });

  it("returns session.csrf for the csrfToken kind", async () => {
    expect(await runWith({ kind: "csrfToken", payload: {} }, fakeSession())).toEqual({
      ok: true,
      value: "csrf-token"
    });
  });

  it("setSession mutates data and marks dirty", async () => {
    const session = fakeSession({ data: null, dirty: false });
    const result = await runWith({ kind: "setSession", payload: { value: { user: "bob" } } }, session);
    expect(result).toEqual({ ok: true, value: null });
    expect(session.data).toEqual({ user: "bob" });
    expect(session.dirty).toBe(true);
  });

  it("clearSession marks destroyed", async () => {
    const session = fakeSession({ destroyed: false });
    const result = await runWith({ kind: "clearSession", payload: {} }, session);
    expect(result).toEqual({ ok: true, value: null });
    expect(session.destroyed).toBe(true);
  });

  it("reports a clear error when sessionMiddleware is missing", async () => {
    const result = await runWith({ kind: "session", payload: {} }, undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("sessionMiddleware");
  });

  it("forwards unknown effects to the inner runner", async () => {
    let forwarded = false;
    const runner = sessionEffects(async () => {
      forwarded = true;
      return { ok: true, value: "forwarded" };
    });
    const result = await runner({ kind: "other", payload: {} }, { session: fakeSession() });
    expect(forwarded).toBe(true);
    expect(result.value).toBe("forwarded");
  });
});

// Mark unused import to satisfy lint
void (null as unknown as WorkerExecutionContext);
