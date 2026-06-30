import { setAuthUser, clearAuthUser, setPendingOAuth, getPendingOAuth, type AuthProvider } from "./contract";

export interface Auth0ProviderOptions {
  domain: (env: any) => string;
  clientId: (env: any) => string;
  clientSecret: (env: any) => string;
  callbackUrl: (env: any) => string;
}

// http for localhost (dev/test), https for real Auth0 domains.
const proto = (domain: string) =>
  domain.startsWith("localhost") || domain.startsWith("127.") ? "http" : "https";

/** Creates an Auth0-backed AuthProvider: real OAuth2 Authorization Code flow
 * with CSRF state verification and server-to-server /userinfo validation. */
export const createAuth0Provider = (options: Auth0ProviderOptions): AuthProvider => ({
  name: "auth0",
  routes: ["/api/auth/"],
  middleware: async (context, next) => {
    const { pathname } = context.url;
    const config = {
      domain: options.domain(context.env),
      clientId: options.clientId(context.env),
      clientSecret: options.clientSecret(context.env),
      callbackUrl: options.callbackUrl(context.env),
    };
    const session = context.session;

    if (!pathname.startsWith("/api/auth/")) return next(context);
    if (!session) return new Response("Session middleware required", { status: 500 });

    // Start OAuth2 flow: generate state, persist under session.auth.pendingOAuth.
    if (pathname === "/api/auth/login") {
      if (!config.domain || !config.clientId) {
        return new Response("Auth0 not configured — set AUTH0_DOMAIN and AUTH0_CLIENT_ID in .dev.vars", { status: 500 });
      }
      const state = crypto.randomUUID();
      setPendingOAuth(context, "auth0", state);
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        scope: "openid profile email",
        state,
      });
      return new Response(null, {
        status: 302,
        headers: { location: `${proto(config.domain)}://${config.domain}/authorize?${params}` },
      });
    }

    // Finish OAuth2 flow: validate state, exchange code, fetch user via userinfo.
    if (pathname === "/api/auth/callback") {
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      if (!code || !state) return new Response("Missing code or state", { status: 400 });

      const pending = getPendingOAuth(context, "auth0");
      if (!pending || pending.state !== state) {
        return new Response("Invalid OAuth state — possible CSRF attack", { status: 400 });
      }

      // Auth0's documented /oauth/token content type is form-urlencoded, not JSON.
      const tokenRes = await fetch(`${proto(config.domain)}://${config.domain}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.callbackUrl,
        }),
      });
      if (!tokenRes.ok) return new Response("Token exchange with Auth0 failed", { status: 502 });
      const { access_token } = (await tokenRes.json()) as { access_token: string };

      // Server-to-server user validation — never trust an unverified JWT payload.
      const userRes = await fetch(`${proto(config.domain)}://${config.domain}/userinfo`, {
        headers: { authorization: `Bearer ${access_token}` },
      });
      if (!userRes.ok) return new Response("Failed to fetch user info from Auth0", { status: 502 });
      const user = (await userRes.json()) as { email: string; name?: string; picture?: string; sub: string };

      setAuthUser(context, { id: user.sub, email: user.email, name: user.name, picture: user.picture, provider: "auth0" });
      return new Response(null, { status: 302, headers: { location: pending.returnTo ?? "/profile" } });
    }

    if (pathname === "/api/auth/logout") {
      clearAuthUser(context);
      if (config.domain && config.clientId) {
        const params = new URLSearchParams({ client_id: config.clientId, returnTo: new URL(context.request.url).origin });
        return new Response(null, {
          status: 302,
          headers: { location: `${proto(config.domain)}://${config.domain}/oidc/logout?${params}` },
        });
      }
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    return next(context);
  },
});
