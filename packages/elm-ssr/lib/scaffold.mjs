import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readWorkspaceConfig, writeWorkspaceConfig } from "./workspace.mjs";

const toWords = (value) =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const toPascalCase = (value) =>
  toWords(value)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");

const ensureValidName = (name) => {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error("App name must use lowercase letters, numbers, and dashes only.");
  }
};

const ensureAppMissing = (config, name) => {
  if (config.apps.some((app) => app.name === name)) {
    throw new Error(`App "${name}" already exists in elm-ssr.config.json. If you want to recreate it, remove its entry from elm-ssr.config.json first.`);
  }
};

const elmJsonTemplate = () => ({
  type: "application",
  "source-directories": [".elm-ssr", "src", ".elm-ssr/src"],
  "elm-version": "0.19.1",
  dependencies: {
    direct: {
      "elm/browser": "1.0.2",
      "elm/core": "1.0.5",
      "elm/html": "1.0.0",
      "elm/json": "1.1.3",
      "elm/url": "1.0.0"
    },
    indirect: {
      "elm/time": "1.0.0",
      "elm/virtual-dom": "1.0.3"
    }
  },
  "test-dependencies": {
    direct: {},
    indirect: {}
  }
});

const sharedTemplate = (namespace, auth) => `module ${namespace}.View.Shared exposing (head, layout)

import ElmSsr.Html exposing (Node, a, div, header, main_, nav, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Page as Page


head : List (Node msg)
head =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Page.stylesheet "/styles.css"
    ]


layout : String -> List (Node msg) -> Node msg
layout pageTitle body =
    div [ class "page" ]
        [ header [ class "header" ]
            [ div [ class "header-inner" ]
                [ a [ class "brand", href "/" ]
                    [ span [ class "brand-icon" ] [ text "◆" ]
                    , text "elm-ssr"
                    ]
                , nav [ class "nav" ]
                    [ a [ class "nav-link", href "/" ] [ text "Home" ]
                    , a [ class "nav-link", href "/counter" ] [ text "Counter" ]${auth ? `
                    , a [ class "nav-link", href "/login" ] [ text "Sign in" ]` : ""}
                    ]
                ]
            ]
        , main_ [ class "main" ]
            [ div [ class "container" ] body
            ]
        ]
`;

const indexRouteTemplate = (namespace, auth) => `module ${namespace}.Routes.Index exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, h2, p, section, span, text)
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
        { title = "elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Home"
                [ section [ class "hero" ]
                    [ h1 [ class "hero-title" ] [ text "Ship fast." ]
                    , p [ class "hero-subtitle" ]
                        [ text "Type-safe server-side rendering with interactive islands. Runs on Cloudflare Workers and Bun." ]
                    , div [ class "hero-actions" ]
                        [ a [ class "btn btn-primary", href "/counter" ] [ text "Try the counter" ]${auth ? `
                        , a [ class "btn btn-secondary", href "/login" ] [ text "Sign in" ]` : ""}
                        ]
                    ]
                , section [ class "features" ]
                    [ featureCard "⚡" "Edge-first" "Renders in milliseconds at the edge. No cold starts."
                    , featureCard "🦺" "Fully typed" "End-to-end Elm types from DB to HTML. No runtime surprises."
                    , featureCard "🏝️" "Islands" "Add interactivity exactly where you need it. Zero JS elsewhere."
                    ]
                ]
            ]
        }


featureCard : String -> String -> String -> ElmSsr.Html.Node msg
featureCard icon title_ body =
    div [ class "feature-card" ]
        [ span [ class "feature-icon" ] [ text icon ]
        , h2 [ class "feature-title" ] [ text title_ ]
        , p [ class "feature-body" ] [ text body ]
        ]
`;

const counterRouteTemplate = (namespace) => `module ${namespace}.Routes.Counter exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (div, h1, p, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.Islands.Counter as Counter
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
        { title = "Counter | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Counter"
                [ div [ class "page-header" ]
                    [ h1 [] [ text "Interactive Counter" ]
                    , p [ class "page-subtitle" ]
                        [ text "This page is server-rendered. Only the counter widget below is a client-side island — zero JS elsewhere." ]
                    ]
                , div [ class "card" ]
                    [ Counter.embed { start = 0 } ]
                ]
            ]
        }
`;

const counterIslandTemplate = (namespace) => `module ${namespace}.Islands.Counter exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

-- A standard Browser.element island. The page only embeds a marker and props;
-- the browser mounts this module normally using Elm's own runtime.

import ElmSsr.Island as Island
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import Browser
import Html exposing (Html, button, div, span, text)
import Html.Attributes exposing (class, type_)
import Html.Events exposing (onClick)
import Json.Encode as Encode


embed : Flags -> Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Nothing
        }


type alias Flags =
    { start : Int }


type alias Model =
    { count : Int }


type Msg
    = Increment
    | Decrement


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object [ ( "start", Encode.int flags.start ) ]


fallback : Flags -> List (Node msg)
fallback flags =
    [ SsrHtml.div [ SsrAttributes.class "counter fallback" ]
        [ SsrHtml.span [ SsrAttributes.class "value" ] [ SsrHtml.text (String.fromInt flags.start) ] ]
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
init flags =
    ( { count = flags.start }, Cmd.none )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            ( { model | count = model.count + 1 }, Cmd.none )

        Decrement ->
            ( { model | count = model.count - 1 }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ class "counter" ]
        [ button [ class "btn btn-secondary btn-square", type_ "button", onClick Decrement ] [ text "−" ]
        , span [ class "counter-value" ] [ text (String.fromInt model.count) ]
        , button [ class "btn btn-primary btn-square", type_ "button", onClick Increment ] [ text "+" ]
        ]
`;

const notFoundRouteTemplate = (namespace) => `module ${namespace}.Routes.NotFound exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, text)
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
    Page.notFound
        { title = "Not Found | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Not Found"
                [ div [ class "error-page" ]
                    [ h1 [ class "error-code" ] [ text "404" ]
                    , p [ class "error-message" ] [ text "This page doesn't exist." ]
                    , a [ class "btn btn-primary", href "/" ] [ text "Go home" ]
                    ]
                ]
            ]
        }
`;

const authDisplayName = (authProvider) =>
  authProvider === "auth0" ? "Auth0" : "BetterAuth";

const loginRouteTemplate = (namespace, authProvider) => `module ${namespace}.Routes.Login exposing (page, action)

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
                                [ text "Continue with ${authDisplayName(authProvider)}" ]
                            ]
                        , p [ class "auth-footer" ]
                            [ text "Powered by ${authDisplayName(authProvider)} via elm-ssr" ]
                        ]
                    ]
                ]
            ]
        }
`;

const profileRouteTemplate = (namespace) => `module ${namespace}.Routes.Profile exposing (page, action)

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
    }


userDecoder : Decode.Decoder UserProfile
userDecoder =
    Decode.map2 UserProfile
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "name" Decode.string))


page : Request -> Loader (Document Never)
page _ =
    Loader.requireUser userDecoder "/login" (\\user ->
        Loader.succeed (view user)
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

const authEndpointTemplate = (authProvider) => `import { generateSessionId, signValue, generateCsrfToken, readSignedCookie } from "elm-ssr/sessions";

export const handleAuth = async (
  request: Request,
  env: any,
  options?: { store?: any; secret?: string }
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/api/auth/login") {
    // Mock login session update for ${authProvider}
    let cookieVal = "__elm_ssr_session=" + encodeURIComponent(JSON.stringify({
      user: { email: "user@example.com", name: "${authProvider === "better-auth" ? "BetterAuth User" : "Auth0 User"}" }
    })) + "; Path=/; HttpOnly; SameSite=Lax";

    if (options?.store && options?.secret) {
      const sessionId = generateSessionId();
      await options.store.set(sessionId, {
        data: { email: "user@example.com", name: "${authProvider === "better-auth" ? "BetterAuth User" : "Auth0 User"}" },
        csrf: generateCsrfToken()
      });
      const signed = await signValue(options.secret, sessionId);
      cookieVal = "session=" + signed + "; Path=/; HttpOnly; SameSite=Lax";
    }

    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/profile",
        "Set-Cookie": cookieVal
      }
    });
  }

  if (url.pathname === "/api/auth/logout") {
    let cookieVal = "__elm_ssr_session=; Path=/; Max-Age=0; HttpOnly";
    if (options?.store && options?.secret) {
      cookieVal = "session=; Path=/; Max-Age=0; HttpOnly";
      const cookieHeader = request.headers.get("cookie");
      if (cookieHeader) {
        const sessionId = await readSignedCookie(cookieHeader, "session", options.secret);
        if (sessionId) {
          await options.store.delete(sessionId);
        }
      }
    }
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/login",
        "Set-Cookie": cookieVal
      }
    });
  }

  return new Response("${authProvider} Endpoint API Mock", { status: 200 });
};
`;

const runtimeTemplate = (appRoot, db = false, auth = undefined) => {
  // appRoot is a slash-separated path like "my-app" or "apps/my-app".
  // The generated bundles live at <workspaceRoot>/generated/<appRoot>/. From
  // <workspaceRoot>/<appRoot>/runtime.ts, we climb out by one ".." per segment.
  const upToRoot = appRoot === "." ? "." : appRoot.split("/").map(() => "..").join("/");
  const generatedPrefix = `${upToRoot}/generated/${appRoot === "." ? "" : appRoot}`.replace(/\/+$/, "");

  const imports = [
    `import { createWorkerApp } from "elm-ssr";`,
    `import { renderApp, type CompiledElmModule } from "elm-ssr/render";`,
    `import type { RouteCatalog } from "elm-ssr/http";`,
    `import { islands, bundleSource } from "${generatedPrefix}/islands-manifest";`,
    `import { stylesheet } from "./styles";`,
    `// @ts-expect-error Generated at build time.`,
    `import ElmRuntime from "${generatedPrefix}/app.mjs";`
  ];

  imports.push(`import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";`);
  if (auth) {
    imports.push(`import { handleAuth } from "./src/Endpoints/Auth";`);
    imports.push(`import { memorySessionStore } from "elm-ssr/sessions";`);
  }

  let dbInit = '';
  if (db) {
    dbInit = `
let sqlHandler: any = undefined;
if (typeof Bun !== "undefined") {
  try {
    const sqliteModule = "bun" + ":sqlite";
    const { Database } = require(sqliteModule);
    const db = new Database("app.db");
    sqlHandler = (query: any) => {
      const statement = db.query(query.sql);
      if (query.mode === "all") {
        return statement.all(...query.params);
      }
      if (query.mode === "first") {
        return statement.get(...query.params) ?? null;
      }
      const info = statement.run(...query.params);
      return { rowsAffected: info.changes };
    };
  } catch (err) {
    console.error("Failed to initialize bun:sqlite:", err);
  }
}
`;
  }

  let routeAuthAdditions = '';
  if (auth) {
    routeAuthAdditions = `
    {
      path: "/login",
      methods: ["GET"],
      description: "User authentication login page."
    },
    {
      path: "/profile",
      methods: ["GET"],
      description: "Authenticated user profile."
    },`;
  }

  const effectsConfig = `,
  effects: (effect, context) => {
    if (context.env) {
      return cloudflareEffects(${db ? '{ dbBinding: "DB" }' : ''})(effect, context);
    }
    return inMemoryEffects({
      env: process.env as any${db ? ',\n      sql: sqlHandler' : ''}
    })(effect, context);
  }`;

  let sessionsConfig = '';
  let authInit = '';
  if (auth) {
    authInit = `\nexport const sessionStore = memorySessionStore();\n`;
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    store: sessionStore,
    secure: false
  },
  csrf: true`;
  }

  let authIntercept = '';
  if (auth) {
    authIntercept = `
// Intercept Auth Provider requests
const baseWorkerFetch = worker.fetch;
worker.fetch = async (request, env, ctx) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/auth/")) {
    const secret = (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars";
    return handleAuth(request, env, { store: sessionStore, secret });
  }
  return baseWorkerFetch(request, env, ctx);
};
`;
  }

  return `${imports.join("\n")}

const elmModule = ElmRuntime as CompiledElmModule;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/",
      methods: ["GET", "HEAD"],
      description: "Stateless starter page rendered from Elm (no client runtime)."
    },
    {
      path: "/counter",
      methods: ["GET", "HEAD"],
      description: "Interactive counter route rendered from Elm."
    },${routeAuthAdditions}
  ],
  assets: [
    {
      path: "/styles.css",
      methods: ["GET", "HEAD"],
      description: "Starter stylesheet."
    },
    {
      path: "/__elm-ssr/islands.js",
      methods: ["GET", "HEAD"],
      description: "Island loader runtime."
    },
    {
      path: "/__elm-ssr/islands-bundle.js",
      methods: ["GET", "HEAD"],
      description: "Shared Browser.element island bundle."
    }
  ],
  utility: [
    {
      path: "/health",
      methods: ["GET", "HEAD"],
      description: "Plain text liveness endpoint."
    }
  ],
  api: [
    {
      path: "/api/health",
      methods: ["GET", "HEAD"],
      description: "JSON health payload."
    },
    {
      path: "/api/routes",
      methods: ["GET", "HEAD"],
      description: "Route registry for the starter app."
    },
    {
      path: "/api/render",
      methods: ["GET", "HEAD"],
      description: "SSR preview endpoint."
    }
  ]
};

export const createFlags = ({ request, path, formData, env }: { request?: Request; url?: URL; path: string; formData?: Record<string, string>; env?: Record<string, unknown> }) => {
  const [pathname, search = ""] = path.split("?");

  const envVars: Record<string, string | number | boolean> = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        envVars[key] = value;
      }
    }
  }

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: formData ?? {},
    env: envVars
  };
};

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }));
${dbInit}${authInit}
export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags${sessionsConfig}${effectsConfig}
});
${authIntercept}
`;
};

const workerTemplate = () => `import { worker } from "./runtime";

export default worker;
`;

const stylesTemplate = () => `export const stylesheet = \`
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f6f5f3;
  --surface: #ffffff;
  --border: #e5e2dd;
  --text: #1a1a1a;
  --text-muted: #6b6b6b;
  --accent: #1a1a1a;
  --accent-hover: #333;
  --radius: 12px;
  --header-h: 60px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 16px;
  color: var(--text);
  background: var(--bg);
}

body { min-height: 100vh; }

/* ── Layout ────────────────────────────────────────── */
.page { display: flex; flex-direction: column; min-height: 100vh; }

.header {
  height: var(--header-h);
  border-bottom: 1px solid var(--border);
  background: rgba(246, 245, 243, 0.85);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.01em;
}

.brand-icon { font-size: 0.85em; opacity: 0.6; }

.nav { display: flex; align-items: center; gap: 0.25rem; }

.nav-link {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}
.nav-link:hover { background: var(--border); color: var(--text); }

.main { flex: 1; padding: 3rem 1.5rem; }

.container { max-width: 1100px; margin: 0 auto; }

/* ── Typography ────────────────────────────────────── */
h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
p  { line-height: 1.65; color: var(--text-muted); }

/* ── Buttons ────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.55rem 1.1rem;
  border-radius: 8px;
  border: 1.5px solid transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-secondary:hover { background: var(--bg); }

.btn-square { width: 2.5rem; height: 2.5rem; padding: 0; font-size: 1.1rem; }

.btn-full { width: 100%; }

/* ── Cards ──────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

/* ── Hero ────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 5rem 0 4rem;
  max-width: 640px;
  margin: 0 auto;
}

.hero-title {
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  margin-bottom: 1rem;
}

.hero-subtitle {
  font-size: 1.15rem;
  margin-bottom: 2rem;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

/* ── Features ────────────────────────────────────────── */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-top: 4rem;
}

.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

.feature-icon { font-size: 1.5rem; display: block; margin-bottom: 0.75rem; }

.feature-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text);
}

.feature-body { font-size: 0.9rem; }

/* ── Page header ─────────────────────────────────────── */
.page-header { margin-bottom: 2rem; }
.page-header h1 { margin-bottom: 0.5rem; }
.page-subtitle { font-size: 0.95rem; }

/* ── Counter island ──────────────────────────────────── */
.counter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
}

.counter-value {
  text-align: center;
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

/* ── Auth pages ──────────────────────────────────────── */
.auth-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3rem;
}

.auth-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 2.5rem;
  width: 100%;
  max-width: 380px;
}

.auth-header { text-align: center; margin-bottom: 2rem; }

.auth-logo {
  font-size: 1.5rem;
  display: block;
  margin-bottom: 1rem;
}

.auth-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
.auth-subtitle { font-size: 0.9rem; }

.auth-body { display: flex; flex-direction: column; gap: 0.75rem; }

.auth-footer {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 1.5rem;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

/* ── Error page ──────────────────────────────────────── */
.error-page {
  text-align: center;
  padding: 5rem 0;
}

.error-code {
  font-size: 6rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--border);
  margin-bottom: 0.5rem;
}

.error-message { margin-bottom: 2rem; }

/* ── Forms ───────────────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: 0.35rem; }
.field label, .field span { font-size: 0.875rem; font-weight: 500; }

.input {
  width: 100%;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  padding: 0.6rem 0.9rem;
  font: inherit;
  font-size: 0.9rem;
  background: white;
  color: var(--text);
  transition: border-color 0.12s;
}
.input:focus { outline: none; border-color: var(--accent); }

.error-hint { color: #c53030; font-size: 0.8rem; margin-top: 0.25rem; }
\`;
`;

const filesForApp = (name, appRoot, options = {}) => {
  const namespace = toPascalCase(name);
  const db = options.db || !!options.auth;
  const auth = options.auth;
  const tailwind = options.tailwind;

  const files = [
    { path: `${appRoot}/elm.json`, content: JSON.stringify(elmJsonTemplate(), null, 2) + "\n" },
    { path: `${appRoot}/runtime.ts`, content: runtimeTemplate(appRoot, db, auth) },
    { path: `${appRoot}/worker.ts`, content: workerTemplate() },
    { path: `${appRoot}/styles.ts`, content: stylesTemplate() },
    { path: `${appRoot}/src/${namespace}/View/Shared.elm`, content: sharedTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Index.elm`, content: indexRouteTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Counter.elm`, content: counterRouteTemplate(namespace) },
    { path: `${appRoot}/src/${namespace}/Routes/NotFound.elm`, content: notFoundRouteTemplate(namespace) },
    { path: `${appRoot}/src/${namespace}/Islands/Counter.elm`, content: counterIslandTemplate(namespace) },
    {
      path: `${appRoot}/.dev.vars`,
      content: `GREETING="Hello from your local .dev.vars file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`
    }
  ];

  if (db) {
    files.push({
      path: `${appRoot}/migrations/0001_init.sql`,
      content: `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`
    });
  }

  if (auth) {
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Login.elm`,
      content: loginRouteTemplate(namespace, auth)
    });
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Profile.elm`,
      content: profileRouteTemplate(namespace)
    });
    files.push({
      path: `${appRoot}/src/Endpoints/Auth.ts`,
      content: authEndpointTemplate(auth)
    });
  }

  if (tailwind) {
    files.push({
      path: `${appRoot}/src/app.css`,
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  h1 { @apply text-3xl font-bold tracking-tight text-gray-900 mb-4; }
  h2 { @apply text-xl font-semibold text-gray-900 mb-3; }
  p  { @apply leading-relaxed text-gray-600 mb-4; }
  a  { @apply text-gray-900 underline underline-offset-2 hover:no-underline; }
}

@layer components {
  .page { @apply flex flex-col min-h-screen; }
  .header { @apply sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-md; }
  .header-inner { @apply max-w-6xl mx-auto px-6 h-16 flex items-center justify-between; }
  .brand { @apply flex items-center gap-2 font-bold text-gray-900 no-underline; }
  .nav { @apply flex items-center gap-1; }
  .nav-link { @apply px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 no-underline hover:bg-gray-100 hover:text-gray-900 transition-colors; }
  .main { @apply flex-1 px-6 py-12; }
  .container { @apply max-w-6xl mx-auto; }
  .card { @apply bg-white border border-gray-200 rounded-xl p-6; }

  .btn { @apply inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium no-underline cursor-pointer transition-colors whitespace-nowrap; }
  .btn-primary { @apply bg-gray-900 text-white border-gray-900 hover:bg-gray-700; }
  .btn-secondary { @apply bg-white text-gray-900 border-gray-200 hover:bg-gray-50; }
  .btn-square { @apply w-10 h-10 p-0 text-lg; }
  .btn-full { @apply w-full; }

  .hero { @apply text-center py-20 max-w-2xl mx-auto; }
  .hero-title { @apply text-6xl font-extrabold tracking-tight mb-4; }
  .hero-subtitle { @apply text-lg text-gray-500 mb-8 max-w-lg mx-auto; }
  .hero-actions { @apply flex gap-3 justify-center flex-wrap; }

  .features { @apply grid gap-4 mt-16; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .feature-card { @apply bg-white border border-gray-200 rounded-xl p-6; }
  .feature-icon { @apply text-2xl block mb-3; }
  .feature-title { @apply text-base font-semibold mb-2; }
  .feature-body { @apply text-sm text-gray-500; }

  .page-header { @apply mb-8; }
  .page-subtitle { @apply text-gray-500 mt-2; }

  .counter { @apply grid items-center gap-4; grid-template-columns: auto 1fr auto; }
  .counter-value { @apply text-center text-5xl font-bold tracking-tight; }

  .auth-page { @apply flex justify-center pt-12; }
  .auth-card { @apply bg-white border border-gray-200 rounded-2xl p-10 w-full max-w-sm; }
  .auth-header { @apply text-center mb-8; }
  .auth-logo { @apply text-2xl block mb-4; }
  .auth-title { @apply text-2xl font-bold tracking-tight mb-2; }
  .auth-subtitle { @apply text-sm text-gray-500; }
  .auth-body { @apply flex flex-col gap-3; }
  .auth-footer { @apply text-center text-xs text-gray-400 mt-6; }
  .avatar { @apply inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-900 text-white text-2xl font-bold mb-4; }

  .error-page { @apply text-center py-20; }
  .error-code { @apply text-8xl font-extrabold text-gray-200 mb-2; }
  .error-message { @apply text-gray-500 mb-8; }

  .field { @apply flex flex-col gap-1.5; }
  .input { @apply w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-gray-900 transition-colors; }
  .error-hint { @apply text-red-600 text-xs mt-1; }
}
`
    });
  }

  const configEntry = {
    name,
    root: appRoot,
    module: namespace
  };
  if (tailwind) {
    configEntry.tailwind = true;
  }

  return {
    configEntry,
    files
  };
};

const normalizeAppRoot = (rawRoot, name) => {
  const candidate = (rawRoot ?? name).trim().replace(/^\/+|\/+$/g, "");
  if (candidate.length === 0) {
    throw new Error("App root cannot be empty.");
  }
  if (candidate.includes("..")) {
    throw new Error(`App root must not contain '..': ${candidate}`);
  }
  return candidate;
};

const ensurePackageJson = async (rootPath, appName) => {
  const packageJsonPath = resolve(rootPath, "package.json");
  let packageJson = {};
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    packageJson = {
      name: appName,
      version: "0.1.0",
      type: "module",
      scripts: {},
      devDependencies: {}
    };
  }

  packageJson.scripts = {
    build: "elm-ssr build",
    dev: "elm-ssr dev",
    routes: "elm-ssr routes",
    migrate: "elm-ssr migrate",
    ...packageJson.scripts
  };

  packageJson.devDependencies = {
    "elm-ssr": "latest",
    wrangler: "^4.0.0",
    ...packageJson.devDependencies
  };

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
};

/**
 * Scaffold a new elm-ssr app under `<rootPath>/<appRoot>/` and register it in
 * elm-ssr.config.json. `appRoot` defaults to the app's `name`; pass an
 * explicit value to place the app under a subdirectory (e.g. "apps/my-app").
 */
export const createAppScaffold = async (rootPath, name, options = {}) => {
  ensureValidName(name);

  let config;
  try {
    config = await readWorkspaceConfig(rootPath);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      config = { apps: [] };
    } else {
      throw err;
    }
  }
  ensureAppMissing(config, name);

  const appRoot = normalizeAppRoot(options.root, name);

  const { configEntry, files } = filesForApp(name, appRoot, options);

  for (const file of files) {
    const filePath = resolve(rootPath, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }

  // Create .env at workspace root if it doesn't exist
  const envPath = resolve(rootPath, ".env");
  let envExists = false;
  try {
    await stat(envPath);
    envExists = true;
  } catch {}

  if (!envExists) {
    await writeFile(envPath, `GREETING="Hello from your local .env file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`, "utf8");
  }

  await writeWorkspaceConfig(rootPath, {
    ...config,
    apps: [...config.apps, configEntry]
  });

  await ensurePackageJson(rootPath, name);

  return configEntry;
};

/** @deprecated Use `createAppScaffold`. */
export const createExampleScaffold = createAppScaffold;

const parseRoutePath = (routePath) => {
  const parts = routePath.split("/").map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid route path: "${routePath}"`);
  }
  
  return parts.map(part => {
    const clean = part.replace(/_+$/, "");
    const underscores = part.slice(clean.length);
    return toPascalCase(clean) + underscores;
  });
};

export const createRouteScaffold = async (rootPath, appConfig, routePath, options = {}) => {
  const parts = parseRoutePath(routePath);
  const namespace = appConfig.module;
  
  if (options.isWs || options.isSse) {
    const endpointName = parts.join("");
    const fileSubpath = `src/Endpoints/${parts.join("/")}.ts`;
    const filePath = resolve(rootPath, appConfig.root, fileSubpath);
    
    let content = "";
    let type = "";
    let instructions = "";
    
    if (options.isWs) {
      type = "WebSocket";
      content = `export const handleWebSocket = (request: Request): Response => {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();
  server.addEventListener("message", (event) => {
    console.log("WS received:", event.data);
    server.send(JSON.stringify({ echo: event.data, time: new Date().toISOString() }));
  });

  server.addEventListener("close", () => {
    console.log("WS connection closed");
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
};
`;
      instructions = `1. Import this handler in your worker entrypoint (${appConfig.root}/worker.ts or runtime.ts):
   import { handleWebSocket } from "./src/Endpoints/${parts.join("/")}";

2. Intercept the request in your fetch handler:
   if (url.pathname === "/${routePath}") {
     return handleWebSocket(request);
   }`;
    } else {
      type = "Server-Sent Events (SSE)";
      content = `import { createSseStream } from "elm-ssr/sse";

export const handleSse = (request: Request): Response => {
  return createSseStream(request, async (send, signal) => {
    let count = 0;
    while (!signal.aborted && count < 100) {
      count += 1;
      send(JSON.stringify({ event: "tick", count, time: new Date().toISOString() }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
};
`;
      instructions = `1. Import this handler in your worker entrypoint (${appConfig.root}/worker.ts or runtime.ts):
   import { handleSse } from "./src/Endpoints/${parts.join("/")}";

2. Intercept the request in your fetch handler:
   if (url.pathname === "/${routePath}") {
     return handleSse(request);
   }`;
    }
    
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    
    return { type, path: fileSubpath, instructions };
  } else {
    const moduleName = parts.join(".");
    const fileSubpath = `src/${namespace.split(".").join("/")}/Routes/${parts.join("/")}.elm`;
    const filePath = resolve(rootPath, appConfig.root, fileSubpath);
    
    let content = "";
    let type = "";
    
    if (options.isApi) {
      type = "Elm JSON API";
      content = `module ${namespace}.Routes.${moduleName} exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Json.Encode as Encode

page : Request -> Loader (Document Never)
page _ =
    Loader.fail 405 "GET not allowed on this API route"

action : Request -> Action (Document Never)
action request =
    -- Process request and return JSON response
    Action.json <|
        Encode.object
            [ ( "ok", Encode.bool True )
            , ( "message", Encode.string "Hello from ${routePath} API route!" )
            ]
`;
    } else {
      type = "Elm Page";
      content = `module ${namespace}.Routes.${moduleName} exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (div, text)
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
        { title = "${parts[parts.length - 1]}"
        , head = Shared.head
        , body = [ div [] [ text "Hello from ${routePath}!" ] ]
        }
`;
    }
    
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    
    return { type, path: fileSubpath };
  }
};
