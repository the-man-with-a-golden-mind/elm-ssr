export const runtimeTemplate = (appRoot, db = false, auth = undefined) => {
  // appRoot is a slash-separated path like "my-app" or "apps/my-app".
  // The generated bundles live at <workspaceRoot>/generated/<appRoot>/. From
  // <workspaceRoot>/<appRoot>/runtime.ts, we climb out by one ".." per segment.
  const upToRoot = appRoot === "." ? "." : appRoot.split("/").map(() => "..").join("/");
  const generatedPrefix = `${upToRoot}/generated/${appRoot === "." ? "" : appRoot}`.replace(/\/+$/, "");

  const isBetterAuth = auth === "better-auth";
  const isAuth0 = auth === "auth0";

  const imports = [
    `import { createWorkerApp } from "elm-ssr";`,
    `import { renderApp, type CompiledElmModule } from "elm-ssr/render";`,
    `import type { RouteCatalog } from "elm-ssr/http";`,
    `import { islands, bundleSource } from "${generatedPrefix}/islands-manifest";`,
    `import { stylesheet } from "./styles";`,
    `// @ts-expect-error Generated at build time.`,
    `import ElmRuntime from "${generatedPrefix}/app.mjs";`,
    `import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";`
  ];

  if (isBetterAuth) {
    imports.push(`import { memorySessionStore } from "elm-ssr/sessions";`);
    imports.push(`import { composeAuthProviders } from "elm-ssr/auth";`);
    imports.push(`import { betterAuthProvider } from "./src/Endpoints/Auth";`);
  } else if (isAuth0) {
    imports.push(`import { memorySessionStore } from "elm-ssr/sessions";`);
    imports.push(`import { composeAuthProviders } from "elm-ssr/auth";`);
    imports.push(`import { auth0Provider } from "./src/Endpoints/Auth";`);
  }

  let dbInit = '';
  if (db) {
    dbInit = `
let sqlHandler: any = undefined;
if (typeof Bun !== "undefined") {
  try {
    const sqliteModule = "bun" + ":sqlite";
    const { Database } = require(sqliteModule);
    const db = new Database(import.meta.dir + "/app.db");
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

  const baseEffectsBody = `(effect, context) => {
    if (context.env) {
      return cloudflareEffects(${db ? '{ dbBinding: "DB" }' : ''})(effect, context);
    }
    return inMemoryEffects({
      env: process.env as any${db ? ',\n      sql: sqlHandler' : ''}
    })(effect, context);
  }`;

  // Both auth providers use elm-ssr sessions as the single source of truth.
  // authMiddleware is always composeAuthProviders([...provider]) — same shape regardless of provider.
  const effectsConfig = auth
    ? `,\n  effects: ${baseEffectsBody},\n  middlewares: [authMiddleware]`
    : `,\n  effects: ${baseEffectsBody}`;

  let sessionsConfig = '';
  let authInit = '';

  if (isBetterAuth) {
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || (env?.BETTER_AUTH_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] }`;
    authInit = `
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  betterAuthProvider,
]);
`;
  } else if (isAuth0) {
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] }`;
    authInit = `
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  auth0Provider,
]);
`;
  }

  // Auth routing is handled entirely through elm-ssr's middlewares option —
  // no worker.fetch wrapping needed.

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
${dbInit}${auth ? "// elm-ssr-auth:start" : ""}${authInit}
export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags${sessionsConfig}${effectsConfig}
});
${auth ? "// elm-ssr-auth:end" : ""}
`;
};

export const workerTemplate = () => `import { worker } from "./runtime";

export default worker;
`;
