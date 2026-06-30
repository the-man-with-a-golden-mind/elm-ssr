import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import type { AppContext } from "../http";
import { setAuthUser, clearAuthUser, type AuthProvider, type AuthResult } from "./contract";

export interface BetterAuthProviderOptions {
  baseURL: (env: any) => string;
  secret: (env: any) => string;
  database: (env: any) => any;
  /**
   * Connects this server to the Better Auth dashboard (dash.better-auth.com):
   * sign-ups/sign-ins show up there once set. Get a key by creating a project
   * in the dashboard and connecting this app's baseURL. Leaving this unset is
   * safe — the dashboard just won't see any data.
   */
  apiKey?: (env: any) => string | undefined;
}

const cookiePairsFromSetCookie = (setCookie: string | null): string[] => {
  if (!setCookie) return [];
  return setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part));
};

/** Creates a BetterAuth-backed AuthProvider. Sign-in/sign-up call BetterAuth for
 * credential validation only — elm-ssr sessions remain the system of record. */
export const createBetterAuthProvider = (options: BetterAuthProviderOptions): AuthProvider => {
  // Singleton per isolate — recreated only when the resolved DB binding changes.
  // Typed `any`: betterAuth()'s return type is parameterised by the exact
  // plugins/config literal passed in, which doesn't collapse to a stable
  // reusable type across the two call sites below (TS infers a fresh
  // structural type per call). The public AuthProvider surface this module
  // exports is still fully typed — this is an internal cache detail.
  let _auth: any = null;
  let _authDb: any = undefined;

  const getAuth = (env: any): any => {
    const db = options.database(env);
    if (_auth !== null && _authDb === db) return _auth;
    _auth = betterAuth({
      baseURL: options.baseURL(env),
      secret: options.secret(env),
      database: db,
      emailAndPassword: { enabled: true },
      plugins: [dash({ apiKey: options.apiKey?.(env) })],
    });
    _authDb = db;
    return _auth;
  };

  const callBetterAuth = async (
    auth: any,
    request: Request,
    path: string,
    body: Record<string, string>
  ): Promise<AuthResult> => {
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    const res = await auth.handler(
      new Request(new URL(path, request.url), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, status: res.status, message: err.message ?? "Authentication failed" };
    }
    const data = (await res.json()) as { user?: { email: string; name?: string | null; image?: string | null } };
    if (!data.user?.email) return { ok: false, status: 500, message: "Unexpected auth response" };
    return {
      ok: true,
      user: { email: data.user.email, name: data.user.name, picture: data.user.image, provider: "better-auth" },
    };
  };

  const bridgeBetterAuthSession = async (
    auth: any,
    context: AppContext,
    response: Response
  ): Promise<Response> => {
    const headers = new Headers(context.request.headers);
    const responseCookies = cookiePairsFromSetCookie(response.headers.get("set-cookie"));
    if (responseCookies.length > 0) {
      const existing = headers.get("cookie");
      headers.set("cookie", [existing, ...responseCookies].filter(Boolean).join("; "));
    }

    const session = await auth.api.getSession({ headers }).catch(() => null);
    const user = session?.user;
    if (user?.email) {
      setAuthUser(context, {
        email: user.email,
        name: user.name ?? null,
        picture: user.image ?? null,
        provider: "better-auth",
      });
    }
    return response;
  };

  return {
    name: "better-auth",
    routes: ["/api/auth/"],
    middleware: async (context, next) => {
      const env = context.env;
      const auth = getAuth(env);
      const session = context.session;
      const { pathname } = context.url;

      if (!pathname.startsWith("/api/auth/")) return next(context);
      if (!session) return Response.json({ ok: false, message: "Session middleware required" }, { status: 500 });

      if (pathname === "/api/auth/sign-in" && context.request.method === "POST") {
        const { email = "", password = "" } = (await context.request.json().catch(() => ({}))) as Record<string, string>;
        const result = await callBetterAuth(auth, context.request, "/api/auth/sign-in/email", { email, password });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/sign-up" && context.request.method === "POST") {
        const { email = "", password = "", name = "" } = (await context.request.json().catch(() => ({}))) as Record<string, string>;
        const result = await callBetterAuth(auth, context.request, "/api/auth/sign-up/email", { email, password, name });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/logout") {
        clearAuthUser(context);
        return new Response(null, { status: 302, headers: { location: "/login" } });
      }

      // /api/auth/dash/* (dashboard onboarding/sync) is handled by the real
      // dash() plugin registered above — falls through to auth.handler() like
      // any other BetterAuth route.
      const response = await auth.handler(context.request);
      return bridgeBetterAuthSession(auth, context, response);
    },
  };
};
