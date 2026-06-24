import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const sharedTemplate = (namespace) => `module ${namespace}.View.Shared exposing (head, shell)

import ElmSsr.Html exposing (Node, div, h1, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Page as Page


head : List (Node msg)
head =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Page.stylesheet "/styles.css"
    ]


shell : String -> List (Node msg) -> Node msg
shell heading body =
    div [ class "shell" ] (h1 [] [ text heading ] :: body)
`;

const indexRouteTemplate = (namespace) => `module ${namespace}.Routes.Index exposing (page, action)

-- File-based routing: this module maps to GET /.
-- A page is stateless (no Model/Msg) and ships no client JavaScript.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, p, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.env "GREETING"
        |> Loader.map (\\maybeGreeting ->
            view (Maybe.withDefault "Hello from default env!" maybeGreeting)
        )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : String -> Document Never
view greeting =
    Page.page
        { title = "Starter | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.shell "elm-ssr starter"
                [ p [] [ text ("Greeting from environment: " ++ greeting) ]
                , p [] [ text "This page is stateless and renders on the edge with no client runtime." ]
                , p [] [ a [ class "link", href "/counter" ] [ text "Open the interactive counter" ] ]
                ]
            ]
        }
`;

const counterRouteTemplate = (namespace) => `module ${namespace}.Routes.Counter exposing (page, action)

-- File-based routing: GET /counter. A static page that embeds an interactive
-- island. The page ships no client runtime; the browser mounts the island
-- separately, and only that root updates.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (p, text)
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
            [ Shared.shell "Counter"
                [ p [] [ text "This page is static. Only the counter below is an interactive island." ]
                , Counter.embed { start = 0 }
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
        [ button [ class "button", type_ "button", onClick Decrement ] [ text "-" ]
        , span [ class "value" ] [ text (String.fromInt model.count) ]
        , button [ class "button primary", type_ "button", onClick Increment ] [ text "+" ]
        ]
`;

const notFoundRouteTemplate = (namespace) => `module ${namespace}.Routes.NotFound exposing (page, action)

-- File-based routing: NotFound is the fallback when no other route matches.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (p, text)
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
        , body = [ Shared.shell "404" [ p [] [ text "This route does not exist." ] ] ]
        }
`;

const loginRouteTemplate = (namespace, authProvider) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, p, text)
import ElmSsr.Html.Attributes as Attr
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
        { title = "Login | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.shell "Sign In"
                [ div [ Attr.class "login-container" ]
                    [ p [] [ text "Access user authentication example (${authProvider})." ]
                    , div [ Attr.style "margin-top" "20px" ]
                        [ a 
                            [ Attr.class "button primary"
                            , Attr.href "/api/auth/login"
                            ] 
                            [ text "Sign In with Auth Provider" ]
                        ]
                    ]
                ]
            ]
        }
`;

const profileRouteTemplate = (namespace) => `module ${namespace}.Routes.Profile exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h2, p, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
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
            [ Shared.shell "User Profile"
                [ div []
                    [ h2 [] [ text ("Welcome, " ++ (Maybe.withDefault user.email user.name)) ]
                    , p [] [ text ("Email: " ++ user.email) ]
                    , p [ Attr.style "margin-top" "20px" ]
                        [ a [ Attr.class "button", Attr.href "/api/auth/logout" ] [ text "Sign Out" ] ]
                    ]
                ]
            ]
        }
`;

const authEndpointTemplate = (authProvider) => `export const handleAuth = async (request: Request, env: any): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/api/auth/login") {
    // Mock login session update for ${authProvider}
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/profile",
        "Set-Cookie": "__elm_ssr_session=" + encodeURIComponent(JSON.stringify({
          user: { email: "user@example.com", name: "${authProvider === "better-auth" ? "BetterAuth User" : "Auth0 User"}" }
        })) + "; Path=/; HttpOnly; SameSite=Lax"
      }
    });
  }

  if (url.pathname === "/api/auth/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/login",
        "Set-Cookie": "__elm_ssr_session=; Path=/; Max-Age=0; HttpOnly"
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

  if (db) {
    imports.push(`import { Database } from "bun:sqlite";`);
    imports.push(`import { inMemoryEffects } from "elm-ssr/effects";`);
  }
  if (auth) {
    imports.push(`import { handleAuth } from "./src/Endpoints/Auth";`);
  }

  let dbInit = '';
  if (db) {
    dbInit = `\nconst db = new Database("app.db");\n`;
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

  let effectsConfig = '';
  if (db) {
    effectsConfig = `,
  effects: inMemoryEffects({
    env: process.env as any,
    sql: (sql, params) => {
      const query = db.prepare(sql);
      return query.all(...params);
    }
  })`;
  }

  let sessionsConfig = '';
  if (auth) {
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
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
    return handleAuth(request, env);
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
${dbInit}
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
:root {
  color-scheme: light;
  font-family: "IBM Plex Sans", sans-serif;
  background: #f3efe7;
  color: #18222f;
}

body {
  margin: 0;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.85), transparent 45%),
    linear-gradient(180deg, #f8f3ea 0%, #efe7dc 100%);
}

.shell {
  max-width: 44rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
}

.counter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  margin: 2rem 0;
}

.button,
.input {
  border-radius: 999px;
  border: 1px solid #18222f;
  padding: 0.85rem 1.1rem;
  font: inherit;
  background: white;
}

.button {
  cursor: pointer;
}

.value {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
}

.form {
  margin-top: 1rem;
}

.input {
  width: 100%;
  box-sizing: border-box;
}
\`;
`;

const filesForApp = (name, appRoot, options = {}) => {
  const namespace = toPascalCase(name);
  const db = options.db || !!options.auth;
  const auth = options.auth;

  const files = [
    { path: `${appRoot}/elm.json`, content: JSON.stringify(elmJsonTemplate(), null, 2) + "\n" },
    { path: `${appRoot}/runtime.ts`, content: runtimeTemplate(appRoot, db, auth) },
    { path: `${appRoot}/worker.ts`, content: workerTemplate() },
    { path: `${appRoot}/styles.ts`, content: stylesTemplate() },
    { path: `${appRoot}/src/${namespace}/View/Shared.elm`, content: sharedTemplate(namespace) },
    { path: `${appRoot}/src/${namespace}/Routes/Index.elm`, content: indexRouteTemplate(namespace) },
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

  return {
    configEntry: {
      name,
      root: appRoot,
      module: namespace
    },
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
