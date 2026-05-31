import { describe, expect, it } from "bun:test";
import { createSessionExampleWorker } from "../examples/basic/runtime";

// End-to-end coverage of the Elm <-> TS session+CSRF round-trip via the
// /profile route in examples/basic. The route uses Loader.session +
// Loader.csrfToken on the page, and Action.fromLoader (setSession /
// clearSession) on the action.

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

describe("/profile session round-trip (Elm Loader.session + setSession + clearSession)", () => {
  it("shows the sign-in form for a guest and embeds a CSRF token", async () => {
    const worker = createSessionExampleWorker();
    const response = await worker.fetch(new Request("https://example.com/profile"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Sign in");
    expect(html).toMatch(/name="_csrf"/);
    // Fresh session was minted, so a Set-Cookie is on the response.
    expect(setCookies(response)).toHaveLength(1);
  });

  it("rejects POST without a CSRF token (403)", async () => {
    const worker = createSessionExampleWorker();
    const response = await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=alice"
      })
    );
    expect(response.status).toBe(403);
  });

  it("login -> setSession persists, follow-up GET reads it back via Loader.session", async () => {
    const worker = createSessionExampleWorker();

    // 1. GET the page to mint a session and obtain a CSRF token.
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const sessionCookie = cookieValue(setCookies(guestResponse)[0]);
    const guestHtml = await guestResponse.text();
    const csrf = extractCsrfFromHtml(guestHtml);

    // 2. POST the form with the same cookie + csrf.
    const loginResponse = await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${sessionCookie}`
        },
        body: `username=alice&_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe("/profile");

    // 3. GET the page again with the cookie; Loader.session should now decode the user.
    const dashResponse = await worker.fetch(
      new Request("https://example.com/profile", {
        headers: { cookie: `session=${sessionCookie}` }
      })
    );
    expect(dashResponse.status).toBe(200);
    const dashHtml = await dashResponse.text();
    expect(dashHtml).toContain("Signed in");
    expect(dashHtml).toContain("alice");
  });

  it("logout -> clearSession deletes the session and re-renders the sign-in form", async () => {
    const worker = createSessionExampleWorker();

    // Establish a session first.
    const initial = await worker.fetch(new Request("https://example.com/profile"));
    const cookie = cookieValue(setCookies(initial)[0]);
    const csrf = extractCsrfFromHtml(await initial.text());

    await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${cookie}`
        },
        body: `username=alice&_csrf=${encodeURIComponent(csrf)}`
      })
    );

    // Read the new CSRF token for the signed-in view.
    const signedIn = await worker.fetch(
      new Request("https://example.com/profile", { headers: { cookie: `session=${cookie}` } })
    );
    const signedInHtml = await signedIn.text();
    const csrf2 = extractCsrfFromHtml(signedInHtml);

    // Logout.
    const logoutResponse = await worker.fetch(
      new Request("https://example.com/profile?op=logout", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${cookie}`
        },
        body: `_csrf=${encodeURIComponent(csrf2)}`
      })
    );
    expect(logoutResponse.status).toBe(302);
    expect(setCookies(logoutResponse).some((c) => c.includes("Max-Age=0"))).toBe(true);

    // Re-fetch with the original cookie — the session is gone, so a fresh one is minted.
    const afterLogout = await worker.fetch(
      new Request("https://example.com/profile", { headers: { cookie: `session=${cookie}` } })
    );
    const afterHtml = await afterLogout.text();
    expect(afterHtml).toContain("Sign in");
    expect(afterHtml).not.toContain("Signed in");
  });

  it("rejects an empty username with 422 and does not mutate the session", async () => {
    const worker = createSessionExampleWorker();
    const guestResponse = await worker.fetch(new Request("https://example.com/profile"));
    const cookie = cookieValue(setCookies(guestResponse)[0]);
    const csrf = extractCsrfFromHtml(await guestResponse.text());

    const response = await worker.fetch(
      new Request("https://example.com/profile", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `session=${cookie}`
        },
        body: `username=&_csrf=${encodeURIComponent(csrf)}`
      })
    );
    expect(response.status).toBe(422);

    // Session is still empty.
    const followup = await worker.fetch(
      new Request("https://example.com/profile", { headers: { cookie: `session=${cookie}` } })
    );
    const html = await followup.text();
    expect(html).toContain("Sign in");
  });
});
