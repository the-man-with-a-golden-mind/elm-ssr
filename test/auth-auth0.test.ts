import { describe, expect, it } from "bun:test";
import type { AppContext } from "elm-ssr/http";
import type { RequestSession } from "elm-ssr/sessions";
import { createAuth0Provider } from "elm-ssr/auth/auth0";

// Direct unit tests against the library provider — not via a scaffolded app.
// This is what catches protocol-level bugs (wrong content-type, wrong status
// codes) at the source instead of only through indirect E2E probing of
// generated code that nothing else type-checks or imports.

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

const baseOptions = {
  domain: () => "mock-auth0.local",
  clientId: () => "mock-client-id",
  clientSecret: () => "mock-client-secret",
  callbackUrl: () => "http://localhost:8787/api/auth/callback"
};

describe("createAuth0Provider", () => {
  it("declares /api/auth/ as its routes", () => {
    const provider = createAuth0Provider(baseOptions);
    expect(provider.name).toBe("auth0");
    expect(provider.routes).toEqual(["/api/auth/"]);
  });

  it("passes through non /api/auth/ paths", async () => {
    const provider = createAuth0Provider(baseOptions);
    const res = await provider.middleware(contextFor(new Request("https://example.com/")), next);
    expect(await res.text()).toBe("passthrough");
  });

  it("returns 500 when session middleware is missing", async () => {
    const provider = createAuth0Provider(baseOptions);
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/login")), next);
    expect(res.status).toBe(500);
  });

  it("/login without domain/clientId configured returns a clear 500", async () => {
    const provider = createAuth0Provider({
      domain: () => "",
      clientId: () => "",
      clientSecret: () => "",
      callbackUrl: () => ""
    });
    const session = fakeSession();
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/login"), session), next);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("AUTH0_DOMAIN");
  });

  it("/login redirects to Auth0 authorize with a CSRF state and persists it on the session", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession();
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/login"), session), next);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("mock-auth0.local");
    expect(location.pathname).toBe("/authorize");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid profile email");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(session.dirty).toBe(true);
    expect((session.data as any).auth.pendingOAuth).toEqual({ provider: "auth0", state });
  });

  it("/callback rejects when code or state is missing", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession();
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/callback"), session), next);
    expect(res.status).toBe(400);
  });

  it("/callback rejects a state that does not match the pending OAuth state (CSRF protection)", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession({ data: { auth: { pendingOAuth: { provider: "auth0", state: "expected" } } } });
    const res = await provider.middleware(
      contextFor(new Request("https://example.com/api/auth/callback?code=abc&state=wrong"), session),
      next
    );
    expect(res.status).toBe(400);
  });

  it("/callback exchanges the code via form-urlencoded POST (Auth0's documented format, not JSON) and validates the user via /userinfo", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession({ data: { auth: { pendingOAuth: { provider: "auth0", state: "good-state" } } } });

    const originalFetch = globalThis.fetch;
    let tokenRequestContentType: string | null = null;
    let tokenRequestBody: URLSearchParams | null = null;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/oauth/token") {
          tokenRequestContentType = req.headers.get("content-type");
          tokenRequestBody = new URLSearchParams(await req.text());
          return Response.json({ access_token: "mock-access-token" });
        }
        if (req.method === "GET" && url.pathname === "/userinfo") {
          expect(req.headers.get("authorization")).toBe("Bearer mock-access-token");
          return Response.json({ sub: "auth0|abc", email: "user@example.com", name: "Test User", picture: "https://example.com/p.png" });
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch;

      const res = await provider.middleware(
        contextFor(new Request("https://example.com/api/auth/callback?code=valid-code&state=good-state"), session),
        next
      );

      expect(tokenRequestContentType).toBe("application/x-www-form-urlencoded");
      expect(tokenRequestBody?.get("grant_type")).toBe("authorization_code");
      expect(tokenRequestBody?.get("client_id")).toBe("mock-client-id");
      expect(tokenRequestBody?.get("client_secret")).toBe("mock-client-secret");
      expect(tokenRequestBody?.get("code")).toBe("valid-code");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/profile");
      expect((session.data as any).user).toEqual({
        id: "auth0|abc",
        email: "user@example.com",
        name: "Test User",
        picture: "https://example.com/p.png",
        provider: "auth0"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("/callback returns 502 when the token exchange fails", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession({ data: { auth: { pendingOAuth: { provider: "auth0", state: "good-state" } } } });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ error: "invalid_grant" }, { status: 400 })) as typeof fetch;
      const res = await provider.middleware(
        contextFor(new Request("https://example.com/api/auth/callback?code=bad-code&state=good-state"), session),
        next
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("/logout clears the session and redirects to Auth0's OIDC logout", async () => {
    const provider = createAuth0Provider(baseOptions);
    const session = fakeSession({ data: { user: { email: "user@example.com" } } });
    const res = await provider.middleware(contextFor(new Request("https://example.com/api/auth/logout"), session), next);
    expect(res.status).toBe(302);
    expect(session.destroyed).toBe(true);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("mock-auth0.local");
    expect(location.pathname).toBe("/oidc/logout");
  });
});
