import type { AppContext, Middleware } from "../http";

// Stable shape that every auth provider normalises its user into.
// Elm reads only this — never raw provider-specific session payloads.
export interface AuthUser {
  id?: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  provider?: string;
}

// The full session payload shape — provider-neutral.
// session.user drives Elm guards; session.auth holds transient OAuth state.
interface AuthSessionData {
  user: AuthUser | null;
  auth?: {
    pendingOAuth?: { provider: string; state: string; returnTo?: string };
  };
}

// Writes the authenticated user into the elm-ssr session.
// sessionMiddleware persists and sets the cookie automatically on response.
export const setAuthUser = (context: AppContext, user: AuthUser): void => {
  const existing = (context.session?.data ?? {}) as Partial<AuthSessionData>;
  const { auth: _auth, ...rest } = existing;
  context.session!.data = { ...rest, user };
  context.session!.dirty = true;
};

// Destroys the elm-ssr session — sessionMiddleware clears the cookie.
export const clearAuthUser = (context: AppContext): void => {
  context.session!.destroyed = true;
};

// Stores transient OAuth state so the callback can verify it (CSRF protection).
export const setPendingOAuth = (
  context: AppContext,
  provider: string,
  state: string,
  returnTo?: string
): void => {
  const existing = (context.session?.data ?? {}) as Partial<AuthSessionData>;
  context.session!.data = {
    ...existing,
    auth: { pendingOAuth: { provider, state, ...(returnTo ? { returnTo } : {}) } },
  };
  context.session!.dirty = true;
};

// Reads pending OAuth state and verifies it belongs to the expected provider.
export const getPendingOAuth = (
  context: AppContext,
  provider: string
): { state: string; returnTo?: string } | null => {
  const data = (context.session?.data ?? null) as AuthSessionData | null;
  const p = data?.auth?.pendingOAuth;
  if (!p || p.provider !== provider) return null;
  return { state: p.state, returnTo: p.returnTo };
};

// Result of a credential or OAuth operation before writing to the session.
export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; message: string };

// Contract each provider must satisfy.
export interface AuthProvider {
  name: string;
  /** URL path prefixes this provider owns (e.g. ["/api/auth/"]). */
  routes: string[];
  middleware: Middleware;
}

// Chains providers: first whose routes match handles the request.
export const composeAuthProviders = (providers: AuthProvider[]): Middleware =>
  async (context, next) => {
    for (const provider of providers) {
      if (provider.routes.some((r) => context.url.pathname.startsWith(r))) {
        return provider.middleware(context, next);
      }
    }
    return next(context);
  };
