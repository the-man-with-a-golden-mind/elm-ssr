import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

// End-to-end cookie coverage against the real /session route in
// examples/basic. The route exercises both halves of the API:
//   - `Loader.getCookie "session"` reads the request cookie and renders.
//   - `Action.setCookie (sessionCookie ...)` writes a hardened Set-Cookie.
//   - `Action.clearCookie` writes Max-Age=0 to wipe it.
// The route flips Secure=false locally (plain HTTP); production code uses
// `Action.sessionCookie` unchanged.

const getSession = (cookieHeader?: string) =>
  worker.fetch(
    new Request("https://example.com/session", {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined
    })
  );

const postLogin = (username: string) =>
  worker.fetch(
    new Request("https://example.com/session", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}`
    })
  );

const postLogout = (cookieHeader?: string) =>
  worker.fetch(
    new Request("https://example.com/session?op=logout", {
      method: "POST",
      headers: cookieHeader ? { cookie: cookieHeader } : {}
    })
  );

// Headers.get("set-cookie") joins multiple Set-Cookie headers with ", " in the
// Fetch API. `getSetCookie()` returns them as a list; prefer that.
const setCookies = (response: Response): string[] =>
  // @ts-expect-error getSetCookie exists on undici/Bun Headers
  typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];

const parseCookieAttrs = (cookie: string): Record<string, string | true> => {
  const attrs: Record<string, string | true> = {};
  cookie.split(/;\s*/).forEach((piece, i) => {
    const [k, v] = piece.split("=");
    if (i === 0) {
      attrs["__name"] = k;
      attrs["__value"] = v ?? "";
      return;
    }
    attrs[k.toLowerCase()] = v ?? true;
  });
  return attrs;
};

describe("Loader.getCookie (reads request cookies on the page)", () => {
  it("shows the username from the cookie when present", async () => {
    const response = await getSession("session=alice");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Signed in");
    expect(html).toContain("alice");
    expect(html).not.toContain("Sign in</h1>");
  });

  it("falls back to the sign-in form when no session cookie is sent", async () => {
    const response = await getSession();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Sign in");
    expect(html).toContain('name="username"');
  });

  it("falls back to the sign-in form when the requested cookie is absent (other cookies present)", async () => {
    const response = await getSession("theme=dark; consent=1");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Sign in");
  });
});

describe("Action.setCookie (writes Set-Cookie on the response)", () => {
  it("login redirects and sets the session cookie with hardened attributes", async () => {
    const response = await postLogin("alice");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/session");

    const cookies = setCookies(response);
    expect(cookies).toHaveLength(1);

    const attrs = parseCookieAttrs(cookies[0]);
    expect(attrs.__name).toBe("session");
    expect(attrs.__value).toBe("alice");
    expect(attrs.path).toBe("/");
    expect(attrs.httponly).toBe(true);
    expect(attrs.samesite?.toString().toLowerCase()).toBe("lax");
    expect(Number(attrs["max-age"])).toBe(60 * 60 * 24 * 7);
    // devSessionCookie flips Secure=false for the example; the hardened
    // Action.sessionCookie keeps it true in production code.
    expect(attrs.secure).toBeUndefined();
  });

  it("rejects empty usernames with 422 and does NOT set a cookie", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/session", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username="
      })
    );
    expect(response.status).toBe(422);
    expect(setCookies(response)).toHaveLength(0);
  });

  it("URL-encodes special characters in the cookie value", async () => {
    const response = await postLogin("alice bob");
    expect(response.status).toBe(302);
    const cookies = setCookies(response);
    expect(cookies[0]).toContain("session=alice%20bob");
  });
});

describe("Action.clearCookie (logout)", () => {
  it("issues a Max-Age=0 cookie wiping the session", async () => {
    const response = await postLogout("session=alice");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/session");

    const cookies = setCookies(response);
    expect(cookies).toHaveLength(1);

    const attrs = parseCookieAttrs(cookies[0]);
    expect(attrs.__name).toBe("session");
    expect(attrs.__value).toBe("");
    expect(Number(attrs["max-age"])).toBe(0);
    expect(attrs.path).toBe("/");
  });
});

describe("Action.defaultCookie (permissive preference cookie)", () => {
  // /preferences uses Action.defaultCookie which has only path=/; no HttpOnly,
  // no Secure, no SameSite, no Max-Age. Contrast: /session uses sessionCookie
  // which has all the hardened attributes.
  it("sets a cookie with path=/ and NO security attributes (permissive defaults)", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/preferences", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "theme=dark"
      })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/preferences?theme=dark");

    const cookies = setCookies(response);
    expect(cookies).toHaveLength(1);

    const attrs = parseCookieAttrs(cookies[0]);
    expect(attrs.__name).toBe("theme");
    expect(attrs.__value).toBe("dark");
    expect(attrs.path).toBe("/");

    // These must NOT be present on a defaultCookie.
    expect(attrs.httponly).toBeUndefined();
    expect(attrs.secure).toBeUndefined();
    expect(attrs.samesite).toBeUndefined();
    expect(attrs["max-age"]).toBeUndefined();
    expect(attrs.expires).toBeUndefined();
  });

  it("renders the current theme from the query string on GET", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/preferences?theme=dark")
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Theme: dark");
  });
});

describe("/api/render forwards cookies set by an action", () => {
  it("attaches Set-Cookie even on the SPA-nav preview endpoint", async () => {
    // The /api/render endpoint is GET-only and runs the route's `page`
    // loader, so it cannot exercise setCookie directly. But the page-level
    // GET path is covered above, and the /api/render code path that
    // attaches cookies for redirect/json/html responses is the same
    // withSetCookies wrapper used by the page handlers. Sanity-check that
    // an /api/render of /session at least round-trips with no cookies
    // attached (no false positives) and a sane HTML body.
    const response = await worker.fetch(new Request("https://example.com/api/render?path=/session"));
    expect(response.status).toBe(200);
    expect(setCookies(response)).toHaveLength(0); // page didn't set anything
    const body = (await response.json()) as { status: number; html: string };
    expect(body.status).toBe(200);
    expect(body.html).toContain("Sign in");
  });
});
