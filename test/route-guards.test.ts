import { describe, expect, it } from "bun:test";
import { createSessionExampleWorker } from "../examples/basic/runtime";
import { memorySessionStore, signValue, generateSessionId, generateCsrfToken } from "elm-ssr/sessions";

const setCookies = (response: Response): string[] =>
  // @ts-expect-error getSetCookie exists on Bun/undici Headers
  typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];

const cookieValue = (header: string): string => {
  const first = header.split(";")[0];
  return first.slice(first.indexOf("=") + 1);
};

const extractCsrfFromHtml = (html: string): string => {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!match) {
    throw new Error("no CSRF token found in rendered form");
  }
  return match[1];
};

/** Log in and return { sessionCookie, csrf } without advancing to a new page. */
const loginUser = async (username: string) => {
  const worker = createSessionExampleWorker();

  const profileRes = await worker.fetch(new Request("https://example.com/profile"));
  const sessionCookie = cookieValue(setCookies(profileRes)[0]);
  const csrf = extractCsrfFromHtml(await profileRes.text());

  const loginRes = await worker.fetch(
    new Request("https://example.com/profile", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `session=${sessionCookie}`
      },
      body: `username=${encodeURIComponent(username)}&_csrf=${encodeURIComponent(csrf)}`
    })
  );
  expect(loginRes.status).toBe(302);

  return { worker, sessionCookie };
};

describe("Loader Redirects & requireUser Route Guards", () => {
  it("redirects an unauthenticated guest from /dashboard to /profile", async () => {
    const worker = createSessionExampleWorker();
    const response = await worker.fetch(new Request("https://example.com/dashboard"));
    
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/profile");
  });

  it("allows access to /dashboard for an authenticated user with active session", async () => {
    const worker = createSessionExampleWorker();

    // 1. GET /profile to mint a session and obtain CSRF token
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(guestResponse)[0]);
    const guestHtml = await guestResponse.text();
    const csrf = extractCsrfFromHtml(guestHtml);

    // 2. POST /profile to authenticate as "bob"
    const loginResponse = await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${sessionCookie}`
        },
        body: `username=bob&_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(loginResponse.status).toBe(302);

    // 3. GET /dashboard with the authenticated session cookie
    const dashResponse = await worker.fetch(
      new Request("https://example.com/dashboard", {
        headers: { cookie: `session=${sessionCookie}` }
      })
    );
    expect(dashResponse.status).toBe(200);
    const html = await dashResponse.text();
    expect(html).toContain("Dashboard");
    expect(html).toContain("bob");
    expect(html).toContain("Welcome to your protected dashboard");
  });

  it("Loader.requireUser: session cookie signed with a rotated key is rejected and redirects to /profile", async () => {
    // Create a worker with secret "A" and log in to get a signed session cookie.
    const workerOld = createSessionExampleWorker({ secret: "secret-key-A" });

    const profileRes = await workerOld.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(profileRes)[0]);
    const csrf = extractCsrfFromHtml(await profileRes.text());

    const loginRes = await workerOld.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${sessionCookie}`
        },
        body: `username=alice&_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(loginRes.status).toBe(302);

    // A new worker uses a DIFFERENT secret (key rotation). The old signed cookie
    // fails HMAC verification → middleware mints a fresh anonymous session → no
    // session data → requireUser redirects to /profile.
    const workerNew = createSessionExampleWorker({ secret: "secret-key-B" });
    const dashRes = await workerNew.fetch(
      new Request("https://example.com/dashboard", {
        headers: { cookie: `session=${sessionCookie}` }
      })
    );
    expect(dashRes.status).toBe(302);
    expect(dashRes.headers.get("location")).toBe("/profile");
  });

  it("Loader.map2: /profile combines Loader.session and Loader.csrfToken in a single page (two sequential effects)", async () => {
    // The Profile route is: page _ = Loader.map2 view (Loader.session profileDecoder) Loader.csrfToken
    // This test verifies that both effects resolve correctly before the page renders.
    const worker = createSessionExampleWorker();

    // 1. Anonymous visitor — session is Nothing, csrf token is Just <token>.
    const anonRes = await worker.fetch(new Request("https://example.com/profile"));
    expect(anonRes.status).toBe(200);
    const anonHtml = await anonRes.text();
    expect(anonHtml).toContain("Sign in"); // no session yet
    // csrf token must be present — Loader.map2 successfully fetched it.
    expect(anonHtml).toMatch(/name="_csrf"\s+value="[A-Za-z0-9_-]+"/);

    // 2. Log in.
    const sessionCookie = cookieValue(setCookies(anonRes)[0]);
    const csrf = extractCsrfFromHtml(anonHtml);
    const loginRes = await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${sessionCookie}`
        },
        body: `username=carol&_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(loginRes.status).toBe(302);

    // 3. Authenticated visitor — session is Just { username: "carol" }, csrf is Just <token>.
    const authedRes = await worker.fetch(
      new Request("https://example.com/profile", {
        headers: { cookie: `session=${sessionCookie}` }
      })
    );
    expect(authedRes.status).toBe(200);
    const authedHtml = await authedRes.text();
    expect(authedHtml).toContain("Signed in");
    expect(authedHtml).toContain("carol"); // session data decoded by profileDecoder
    expect(authedHtml).toMatch(/name="_csrf"\s+value="[A-Za-z0-9_-]+"/); // csrf present alongside session
  });

  it("Action.requireUser: unauthenticated POST /dashboard redirects to /profile (guard fires before action body)", async () => {
    const worker = createSessionExampleWorker();

    // No login — session is empty. Action.requireUser sees Nothing → redirect.
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(guestResponse)[0]);
    const csrf = extractCsrfFromHtml(await guestResponse.text());

    const response = await worker.fetch(
      new Request("https://example.com/dashboard", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${sessionCookie}`
        },
        body: `_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/profile");
  });

  it("Action.requireUser: authenticated POST /dashboard returns 405 (guard passes, action body runs)", async () => {
    const worker = createSessionExampleWorker();

    // Log in first so the session carries { username: "carol" }.
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(guestResponse)[0]);
    const csrf = extractCsrfFromHtml(await guestResponse.text());

    await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: `session=${sessionCookie}` },
        body: `username=carol&_csrf=${encodeURIComponent(csrf)}`
      })
    );

    // Fetch a fresh CSRF token with the now-authenticated session.
    const profileAfterLogin = await worker.fetch(
      new Request("https://example.com/profile", { headers: { cookie: `session=${sessionCookie}` } })
    );
    const csrfAfterLogin = extractCsrfFromHtml(await profileAfterLogin.text());

    const response = await worker.fetch(
      new Request("https://example.com/dashboard", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: `session=${sessionCookie}` },
        body: `_csrf=${encodeURIComponent(csrfAfterLogin)}`
      })
    );
    expect(response.status).toBe(405);
  });
});

describe("Loader.requireUser — session payload cannot be decoded (502, not redirect)", () => {
  // requireUser calls `Loader.session profileDecoder`. If session data IS present
  // but does not match the decoder (e.g. missing 'username' field), resumeFetchJson
  // returns `Failed 502 "Loader response did not match decoder: …"`.
  // This is different from the "no session" case (which redirects to /profile).
  // Documenting this as a test so the footgun is explicit: use Decode.maybe / a
  // robust decoder to avoid 502 on stale/incompatible session payloads.
  it("returns 500 when session data exists but does not match profileDecoder", async () => {
    const secret = "elm-ssr-example-dev-secret-do-not-use-in-prod";
    const store = memorySessionStore();
    const sessionId = generateSessionId();
    const csrf = generateCsrfToken();

    // Pre-seed a session whose payload has no 'username' field, so profileDecoder fails.
    await store.set(sessionId, { data: { role: "admin", id: 9 }, csrf });

    // Sign the cookie the same way the middleware would.
    const signedCookie = await signValue(secret, sessionId);

    const worker = createSessionExampleWorker({ store });
    const response = await worker.fetch(
      new Request("https://example.com/dashboard", {
        headers: { cookie: `session=${signedCookie}` }
      })
    );

    // Loader.session profileDecoder finds data but decode fails → Failed 502.
    // This surfaces as a real 502 HTTP response (it is a controlled loader failure,
    // not an uncaught exception, so errorMiddleware does not intercept it).
    expect(response.status).toBe(502);
    // Confirm it is NOT a redirect to /profile (that would mean the guard treated
    // it as "no session", which is the wrong code path).
    expect(response.headers.get("location")).toBeNull();
  });
});
