export const loginIslandTemplate = (namespace) => `port module ${namespace}.Islands.Login exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

-- TIP: For client validation that matches server Actions, use ElmSsr.Form
--   Form.decode decoder [ ("email", model.email), ... ] 
-- See also routes generated with --resource.

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import ElmSsr.Form as Form
import Html exposing (Html, button, div, form, h1, input, label, p, span, text)
import Html.Attributes as Attr
import Html.Events exposing (onInput, onSubmit)
import Http
import Json.Encode as Encode


port navigateTo : String -> Cmd msg


embed : Flags -> Node msg
embed =
    Island.embed "Login"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Nothing
        }


type alias Flags =
    {}


type Mode
    = SignIn
    | SignUp


type FormStatus
    = Idle
    | Submitting
    | FormError String


type alias Model =
    { mode : Mode
    , email : String
    , password : String
    , name : String
    , status : FormStatus
    }


loginDecoder : Form.Decoder { email : String, password : String, name : String }
loginDecoder =
    Form.succeed (\\e p n -> { email = e, password = p, name = n })
        |> Form.required "email" (Form.string |> Form.validate Form.email)
        |> Form.required "password" (Form.string |> Form.validate Form.nonEmpty)
        |> Form.optionalWithDefault "name" "" Form.string


type Msg
    = SetMode Mode
    | SetEmail String
    | SetPassword String
    | SetName String
    | Submit
    | GotResponse (Result Int ())


encodeFlags : Flags -> Encode.Value
encodeFlags _ =
    Encode.object []


fallback : Flags -> List (Node msg)
fallback _ =
    [ SsrHtml.div [ SsrAttributes.class "auth-card" ]
        [ SsrHtml.div [ SsrAttributes.class "auth-header" ]
            [ SsrHtml.span [ SsrAttributes.class "auth-logo" ] [ SsrHtml.text "◆" ]
            , SsrHtml.h1 [ SsrAttributes.class "auth-title" ] [ SsrHtml.text "Sign in" ]
            , SsrHtml.p [ SsrAttributes.class "auth-subtitle" ] [ SsrHtml.text "Loading…" ]
            ]
        ]
    ]


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init _ =
    ( { mode = SignIn, email = "", password = "", name = "", status = Idle }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SetMode mode ->
            ( { model | mode = mode, status = Idle }, Cmd.none )

        SetEmail v ->
            ( { model | email = v }, Cmd.none )

        SetPassword v ->
            ( { model | password = v }, Cmd.none )

        SetName v ->
            ( { model | name = v }, Cmd.none )

        Submit ->
            let
                pairs =
                    [ ( "email", model.email )
                    , ( "password", model.password )
                    , ( "name", model.name )
                    ]
            in
            case Form.decode loginDecoder pairs of
                Ok _ ->
                    ( { model | status = Submitting }, submit model )

                Err _ ->
                    ( { model | status = FormError "Invalid email or missing password." }, Cmd.none )

        GotResponse (Ok ()) ->
            ( model, navigateTo "/profile" )

        GotResponse (Err 401) ->
            ( { model | status = FormError "Invalid email or password." }, Cmd.none )

        GotResponse (Err 422) ->
            ( { model | status = FormError "An account with this email already exists." }, Cmd.none )

        GotResponse (Err _) ->
            ( { model | status = FormError "Something went wrong. Please try again." }, Cmd.none )


submit : Model -> Cmd Msg
submit model =
    let
        url =
            case model.mode of
                SignIn ->
                    "/api/auth/sign-in"

                SignUp ->
                    "/api/auth/sign-up"

        body =
            case model.mode of
                SignIn ->
                    Encode.object
                        [ ( "email", Encode.string model.email )
                        , ( "password", Encode.string model.password )
                        ]

                SignUp ->
                    Encode.object
                        [ ( "email", Encode.string model.email )
                        , ( "password", Encode.string model.password )
                        , ( "name", Encode.string model.name )
                        ]
    in
    Http.post
        { url = url
        , body = Http.jsonBody body
        , expect = Http.expectStringResponse GotResponse httpResult
        }


httpResult : Http.Response String -> Result Int ()
httpResult response =
    case response of
        Http.GoodStatus_ _ _ ->
            Ok ()

        Http.BadStatus_ meta _ ->
            Err meta.statusCode

        _ ->
            Err 0


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ Attr.class "auth-card" ]
        [ div [ Attr.class "auth-header" ]
            [ span [ Attr.class "auth-logo" ] [ text "◆" ]
            , h1 [ Attr.class "auth-title" ]
                [ text
                    (case model.mode of
                        SignIn ->
                            "Welcome back"

                        SignUp ->
                            "Create account"
                    )
                ]
            , p [ Attr.class "auth-subtitle" ]
                [ text
                    (case model.mode of
                        SignIn ->
                            "Sign in to your account to continue."

                        SignUp ->
                            "Sign up to get started."
                    )
                ]
            ]
        , div [ Attr.class "auth-tabs" ]
            [ button
                [ Attr.class
                    (if model.mode == SignIn then
                        "auth-tab auth-tab--active"

                     else
                        "auth-tab"
                    )
                , Attr.type_ "button"
                , Html.Events.onClick (SetMode SignIn)
                ]
                [ text "Sign in" ]
            , button
                [ Attr.class
                    (if model.mode == SignUp then
                        "auth-tab auth-tab--active"

                     else
                        "auth-tab"
                    )
                , Attr.type_ "button"
                , Html.Events.onClick (SetMode SignUp)
                ]
                [ text "Sign up" ]
            ]
        , case model.status of
            FormError message ->
                div [ Attr.class "auth-error" ] [ text message ]

            _ ->
                text ""
        , form [ Attr.class "auth-body", onSubmit Submit ]
            ((case model.mode of
                SignUp ->
                    [ div [ Attr.class "field" ]
                        [ label [ Attr.for "name" ] [ text "Name" ]
                        , input
                            [ Attr.id "name"
                            , Attr.type_ "text"
                            , Attr.class "input"
                            , Attr.value model.name
                            , Attr.attribute "autocomplete" "name"
                            , onInput SetName
                            ]
                            []
                        ]
                    ]

                SignIn ->
                    []
             )
                ++ [ div [ Attr.class "field" ]
                        [ label [ Attr.for "email" ] [ text "Email" ]
                        , input
                            [ Attr.id "email"
                            , Attr.type_ "email"
                            , Attr.class "input"
                            , Attr.value model.email
                            , Attr.attribute "autocomplete" "email"
                            , Attr.required True
                            , Attr.autofocus True
                            , onInput SetEmail
                            ]
                            []
                        ]
                   , div [ Attr.class "field" ]
                        [ label [ Attr.for "password" ] [ text "Password" ]
                        , input
                            [ Attr.id "password"
                            , Attr.type_ "password"
                            , Attr.class "input"
                            , Attr.value model.password
                            , Attr.attribute "autocomplete"
                                (case model.mode of
                                    SignIn ->
                                        "current-password"

                                    SignUp ->
                                        "new-password"
                                )
                            , Attr.required True
                            , onInput SetPassword
                            ]
                            []
                        ]
                   , button
                        [ Attr.type_ "submit"
                        , Attr.class "btn btn-primary btn-full"
                        , Attr.disabled (model.status == Submitting)
                        ]
                        [ text
                            (if model.status == Submitting then
                                "Please wait…"

                             else
                                case model.mode of
                                    SignIn ->
                                        "Sign in"

                                    SignUp ->
                                        "Sign up"
                            )
                        ]
                   ]
            )
        , p [ Attr.class "auth-footer" ]
            [ text "Powered by elm-ssr + BetterAuth" ]
        ]
`;

export const betterAuthMigrationTemplate = () => `-- BetterAuth requires these 4 tables. Do not rename or remove columns.
-- Generated by elm-ssr. See https://www.better-auth.com/docs/concepts/database
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT NOT NULL PRIMARY KEY,
    "expiresAt" INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
    id TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" INTEGER,
    "refreshTokenExpiresAt" INTEGER,
    scope TEXT,
    password TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT NOT NULL PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" INTEGER NOT NULL,
    "createdAt" INTEGER,
    "updatedAt" INTEGER
);
`;

export const auth0MigrationTemplate = () => `-- Local user cache for Auth0 authenticated users.
-- Auth0 is the canonical identity source; this table stores profile data after first login.
CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);
`;


export const loginRouteTemplateBetterAuth = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.Islands.Login as LoginIsland
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Sign in"
                [ LoginIsland.embed {} ]
            ]
        }
`;

export const loginRouteTemplateAuth0 = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Sign in"
                [ div [ class "auth-page" ]
                    [ div [ class "auth-card" ]
                        [ div [ class "auth-header" ]
                            [ span [ class "auth-logo" ] [ text "◆" ]
                            , h1 [ class "auth-title" ] [ text "Welcome back" ]
                            , p [ class "auth-subtitle" ] [ text "Sign in to your account to continue." ]
                            ]
                        , div [ class "auth-body" ]
                            [ a [ class "btn btn-primary btn-full", href "/api/auth/login" ]
                                [ text "Continue with Auth0" ]
                            ]
                        , p [ class "auth-footer" ]
                            [ text "Powered by Auth0 via elm-ssr" ]
                        ]
                    ]
                ]
            ]
        }
`;

export const profileRouteTemplate = (namespace) => `module ${namespace}.Routes.Profile exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared
import Json.Decode as Decode


type alias UserProfile =
    { email : String
    , name : Maybe String
    , picture : Maybe String
    }


type alias AuthSession =
    { user : Maybe UserProfile
    }


userProfileDecoder : Decode.Decoder UserProfile
userProfileDecoder =
    Decode.map3 UserProfile
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "name" Decode.string))
        (Decode.maybe (Decode.field "picture" Decode.string))


authSessionDecoder : Decode.Decoder AuthSession
authSessionDecoder =
    Decode.map AuthSession
        (Decode.oneOf
            [ Decode.field "user" (Decode.nullable userProfileDecoder)
            , Decode.succeed Nothing
            ]
        )


page : Request -> Loader (Document Never)
page _ =
    Loader.session authSessionDecoder
        |> Loader.andThen
            (\\maybeSession ->
                case Maybe.andThen .user maybeSession of
                    Just user ->
                        Loader.succeed (view user)

                    Nothing ->
                        Loader.redirect "/login"
            )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : UserProfile -> Document Never
view user =
    Page.page
        { title = "Profile | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Profile"
                [ div [ class "auth-page" ]
                    [ div [ class "auth-card" ]
                        [ div [ class "auth-header" ]
                            [ span [ class "avatar" ]
                                [ text (String.left 1 (Maybe.withDefault user.email user.name) |> String.toUpper) ]
                            , h1 [ class "auth-title" ]
                                [ text (Maybe.withDefault "Your account" user.name) ]
                            , p [ class "auth-subtitle" ] [ text user.email ]
                            ]
                        , div [ class "auth-body" ]
                            [ a [ class "btn btn-secondary btn-full", href "/api/auth/logout" ]
                                [ text "Sign out" ]
                            ]
                        ]
                    ]
                ]
            ]
        }
`;

// ─── Shared auth contract (included in every provider's Auth.ts) ─────────────
// Single source for the session shape Elm reads and all TS providers write.
const authContractSnippet = `import type { AppContext } from "elm-ssr/http";

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
  middleware: import("elm-ssr/http").Middleware;
}

// Chains providers: first whose routes match handles the request.
export const composeAuthProviders = (
  providers: AuthProvider[]
): import("elm-ssr/http").Middleware =>
  async (context, next) => {
    for (const provider of providers) {
      if (provider.routes.some((r) => context.url.pathname.startsWith(r))) {
        return provider.middleware(context, next);
      }
    }
    return next(context);
  };
`;

// Provider-only code — added to a full Auth.ts by auth add.
export const betterAuthProviderCode = `
import { betterAuth } from "better-auth";

// Singleton per isolate — recreated only when the DB binding changes.
let _auth: ReturnType<typeof betterAuth> | null = null;
let _authDb: any = undefined;

const getAuth = (env: any) => {
  const db = env?.DB;
  if (_auth !== null && _authDb === db) return _auth;
  _auth = betterAuth({
    baseURL: (env?.BETTER_AUTH_URL as string) ?? "http://localhost:8787",
    secret: (env?.BETTER_AUTH_SECRET as string) ?? "change-me-in-production",
    database: db,
    emailAndPassword: { enabled: true },
    // socialProviders: {
    //   github: { clientId: env?.GITHUB_CLIENT_ID, clientSecret: env?.GITHUB_CLIENT_SECRET },
    // },
  });
  _authDb = db;
  return _auth;
};

const callBetterAuth = async (
  auth: ReturnType<typeof getAuth>,
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
    const err = await res.json().catch(() => ({})) as { message?: string };
    return { ok: false, status: res.status, message: err.message ?? "Authentication failed" };
  }
  const data = await res.json() as { user?: { email: string; name?: string | null; image?: string | null } };
  if (!data.user?.email) return { ok: false, status: 500, message: "Unexpected auth response" };
  return {
    ok: true,
    user: { email: data.user.email, name: data.user.name, picture: data.user.image, provider: "better-auth" },
  };
};

const cookiePairsFromSetCookie = (setCookie: string | null): string[] => {
  if (!setCookie) return [];
  return setCookie
    .split(/,(?=\\s*[^;,]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part));
};

const bridgeBetterAuthSession = async (
  auth: ReturnType<typeof getAuth>,
  context: import("elm-ssr/http").AppContext,
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

// Factory: runtime.ts passes getEnv so Auth.ts stays platform-agnostic.
// getEnv injects bun:sqlite locally; on Cloudflare env.DB is the D1 binding.
export const betterAuthProvider = (
  options: { getEnv?: (env: any) => any } = {}
): AuthProvider => {
  const resolveEnv = options.getEnv ?? ((env: any) => env);
  return {
    name: "better-auth",
    routes: ["/api/auth/"],
    middleware: async (context, next) => {
      const env = resolveEnv(context.env);
      const auth = getAuth(env);
      const session = context.session;
      const { pathname } = context.url;

      if (!pathname.startsWith("/api/auth/")) return next(context);
      if (!session) return Response.json({ ok: false, message: "Session middleware required" }, { status: 500 });

      if (pathname === "/api/auth/sign-in" && context.request.method === "POST") {
        const { email = "", password = "" } = await context.request.json().catch(() => ({})) as Record<string, string>;
        const result = await callBetterAuth(auth, context.request, "/api/auth/sign-in/email", { email, password });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/sign-up" && context.request.method === "POST") {
        const { email = "", password = "", name = "" } = await context.request.json().catch(() => ({})) as Record<string, string>;
        const result = await callBetterAuth(auth, context.request, "/api/auth/sign-up/email", { email, password, name });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/logout") {
        clearAuthUser(context);
        return new Response(null, { status: 302, headers: { location: "/login" } });
      }

      // BetterAuth cloud dashboard (routes not in the npm package).
      if (pathname.startsWith("/api/auth/dash/")) {
        if (pathname === "/api/auth/dash/validate") {
          const challenge = context.url.searchParams.get("challenge");
          return new Response(challenge ?? JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": challenge ? "text/plain" : "application/json" },
          });
        }
        const baseURL = (env?.BETTER_AUTH_URL as string) ?? new URL(context.request.url).origin;
        return Response.json({ ok: true, baseURL });
      }

      const response = await auth.handler(context.request);
      return bridgeBetterAuthSession(auth, context, response);
    },
  };
};
`;

export const betterAuthEndpointTemplate = () => authContractSnippet + betterAuthProviderCode;

// Provider-only code — added to a full Auth.ts by auth add.
export const auth0ProviderCode = `

interface Auth0Config {
  domain: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const getConfig = (env: any): Auth0Config => ({
  domain: (env?.AUTH0_DOMAIN as string) ?? "",
  clientId: (env?.AUTH0_CLIENT_ID as string) ?? "",
  clientSecret: (env?.AUTH0_CLIENT_SECRET as string) ?? "",
  callbackUrl: (env?.AUTH0_CALLBACK_URL as string) ?? "http://localhost:8787/api/auth/callback",
});

// http for localhost (dev/test), https for real Auth0 domains.
const proto = (domain: string) =>
  domain.startsWith("localhost") || domain.startsWith("127.") ? "http" : "https";

export const auth0Provider = (): AuthProvider => ({
  name: "auth0",
  routes: ["/api/auth/"],
  middleware: async (context, next) => {
    const { pathname } = context.url;
    const config = getConfig(context.env);
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
        headers: { location: \`\${proto(config.domain)}://\${config.domain}/authorize?\${params}\` },
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

      const tokenRes = await fetch(\`\${proto(config.domain)}://\${config.domain}/oauth/token\`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.callbackUrl,
        }),
      });
      if (!tokenRes.ok) return new Response("Token exchange with Auth0 failed", { status: 502 });
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Server-to-server user validation — never trust an unverified JWT payload.
      const userRes = await fetch(\`\${proto(config.domain)}://\${config.domain}/userinfo\`, {
        headers: { authorization: \`Bearer \${access_token}\` },
      });
      if (!userRes.ok) return new Response("Failed to fetch user info from Auth0", { status: 502 });
      const user = await userRes.json() as { email: string; name?: string; picture?: string; sub: string };

      setAuthUser(context, { id: user.sub, email: user.email, name: user.name, picture: user.picture, provider: "auth0" });
      return new Response(null, { status: 302, headers: { location: pending.returnTo ?? "/profile" } });
    }

    if (pathname === "/api/auth/logout") {
      clearAuthUser(context);
      if (config.domain && config.clientId) {
        const params = new URLSearchParams({ client_id: config.clientId, returnTo: new URL(context.request.url).origin });
        return new Response(null, {
          status: 302,
          headers: { location: \`\${proto(config.domain)}://\${config.domain}/oidc/logout?\${params}\` },
        });
      }
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    return next(context);
  },
});
`;

export const auth0EndpointTemplate = () => authContractSnippet + auth0ProviderCode;
