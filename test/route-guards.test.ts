import { describe, expect, it } from "bun:test";
import { createSessionExampleWorker } from "../examples/basic/runtime";

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

  it("returns 405 Method Not Allowed on POST /dashboard", async () => {
    const worker = createSessionExampleWorker();

    // 1. GET /profile to mint a session and obtain CSRF token
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(guestResponse)[0]);
    const guestHtml = await guestResponse.text();
    const csrf = extractCsrfFromHtml(guestHtml);

    // 2. POST /dashboard with valid session cookie and CSRF token
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
    expect(response.status).toBe(405);
  });
});
