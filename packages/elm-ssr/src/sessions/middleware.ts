import { parse as parseCookieHeader, serialize as serializeCookie } from "cookie";
import type { Middleware } from "../http";
import { json, text } from "../http";
import { generateCsrfToken, generateSessionId, signValue, verifyValue } from "./crypto";
import type { RequestSession, SessionStore } from "./types";

export interface SessionMiddlewareOptions {
  /** HMAC-SHA256 secret used to sign the session cookie. Must not leak. */
  secret: string | ((env: any) => string);
  /** Where to persist sessions. Use `memorySessionStore()` in dev, `cacheStore(...)` in prod. */
  store: SessionStore;
  /** Cookie name. Default `"session"`. */
  cookieName?: string;
  /** Cookie + record max-age, in seconds. Default 7 days. */
  maxAgeSeconds?: number;
  /** Cookie Path attribute. Default `"/"`. */
  cookiePath?: string;
  /** Cookie Domain attribute. Default unset. */
  cookieDomain?: string;
  /** Cookie Secure attribute. Default `true`. Set `false` for plain-HTTP local dev. */
  secure?: boolean;
  /** Cookie SameSite attribute. Default `"lax"`. */
  sameSite?: "lax" | "strict" | "none";
}

const defaultMaxAge = 60 * 60 * 24 * 7;

const buildSetCookie = (
  name: string,
  value: string,
  maxAge: number,
  options: { path: string; domain?: string; secure: boolean; sameSite: "lax" | "strict" | "none" }
): string =>
  serializeCookie(name, value, {
    maxAge,
    path: options.path,
    domain: options.domain,
    secure: options.secure,
    httpOnly: true,
    sameSite: options.sameSite
  });

const appendSetCookie = (response: Response, header: string): Response => {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", header);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const readSignedCookie = async (header: string | null, name: string, secret: string): Promise<string | null> => {
  if (!header) {
    return null;
  }
  const parsed = parseCookieHeader(header);
  const signed = parsed[name];
  if (!signed) {
    return null;
  }
  return verifyValue(secret, signed);
};

const mintSession = (): RequestSession => ({
  id: generateSessionId(),
  data: null,
  csrf: generateCsrfToken(),
  dirty: false,
  destroyed: false,
  isNew: true
});

/**
 * Adds a per-request `session` to `AppContext`. Reads + verifies a signed
 * cookie, loads the record from `store`, and persists if a downstream effect
 * marked it `dirty` or `destroyed`. Always provides a session (mints one if
 * the cookie is missing or invalid) so downstream code never has to nil-check.
 */
export const sessionMiddleware = (options: SessionMiddlewareOptions): Middleware => {
  const cookieName = options.cookieName ?? "session";
  const maxAge = options.maxAgeSeconds ?? defaultMaxAge;
  const cookieOptions = {
    path: options.cookiePath ?? "/",
    domain: options.cookieDomain,
    secure: options.secure ?? true,
    sameSite: options.sameSite ?? "lax" as const
  };

  const resolveSecret = (env: any): string => {
    if (typeof options.secret === "function") {
      return options.secret(env);
    }
    return options.secret;
  };

  return async (context, next) => {
    const env = context.env ?? {};
    const secret = resolveSecret(env);
    const cookieHeader = context.request.headers.get("cookie");
    const sessionId = await readSignedCookie(cookieHeader, cookieName, secret);

    let session: RequestSession;
    if (sessionId) {
      const existing = await options.store.get(sessionId);
      if (existing) {
        if (existing.expiresAt && Date.now() > existing.expiresAt) {
          // Session expired
          await options.store.delete(sessionId);
          session = mintSession();
          session.destroyed = true; // Ensure the cookie gets cleared as well
        } else {
          session = {
            id: sessionId,
            data: existing.data,
            csrf: existing.csrf,
            dirty: false,
            destroyed: false,
            isNew: false
          };
        }
      } else {
        session = mintSession();
      }
    } else {
      session = mintSession();
    }

    context.session = session;

    const response = await next(context);

    if (session.destroyed) {
      await options.store.delete(session.id);
      return appendSetCookie(response, buildSetCookie(cookieName, "", 0, cookieOptions));
    }

    if (session.dirty || session.isNew) {
      await options.store.set(session.id, {
        data: session.data,
        csrf: session.csrf,
        expiresAt: Date.now() + maxAge * 1000
      });
      const signed = await signValue(secret, session.id);
      return appendSetCookie(response, buildSetCookie(cookieName, signed, maxAge, cookieOptions));
    }

    return response;
  };
};

export interface CsrfMiddlewareOptions {
  /** Header used to submit the token. Default `"x-csrf-token"`. */
  headerName?: string;
  /** Form field used to submit the token. Default `"_csrf"`. */
  fieldName?: string;
  /** Pathname prefixes to skip the check on (e.g. webhook receivers). */
  skipPaths?: string[];
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const readFormCsrfToken = async (request: Request, fieldName: string): Promise<string | null> => {
  const contentType = request.headers.get("content-type") || "";
  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return null;
  }
  try {
    // Clone — the route handler will re-read the body downstream.
    const data = await request.clone().formData();
    const value = data.get(fieldName);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

/**
 * Rejects unsafe verbs (POST/PUT/PATCH/DELETE) without a CSRF token matching
 * `context.session.csrf`. Token is read from the configured header or form
 * field. Returns 403 on mismatch; safe methods pass through untouched.
 *
 * Mount **after** `sessionMiddleware` (which populates `context.session`).
 */
export const csrfMiddleware = (options: CsrfMiddlewareOptions = {}): Middleware => {
  const headerName = options.headerName ?? "x-csrf-token";
  const fieldName = options.fieldName ?? "_csrf";
  const skipPaths = options.skipPaths ?? [];

  return async (context, next) => {
    if (safeMethods.has(context.request.method)) {
      return next(context);
    }
    if (skipPaths.some((prefix) => context.url.pathname.startsWith(prefix))) {
      return next(context);
    }
    if (!context.session) {
      // sessionMiddleware missing — fail closed.
      return text("CSRF protection requires sessionMiddleware to be installed first.", { status: 500 });
    }

    const supplied =
      context.request.headers.get(headerName) ?? (await readFormCsrfToken(context.request, fieldName));

    if (!supplied || supplied !== context.session.csrf) {
      if (context.url.pathname.startsWith("/api/")) {
        return json({ error: "csrf_token_invalid" }, { status: 403 });
      }
      return text("Invalid CSRF token", { status: 403 });
    }

    return next(context);
  };
};
