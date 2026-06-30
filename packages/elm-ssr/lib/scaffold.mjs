import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readWorkspaceConfig, writeWorkspaceConfig } from "./workspace.mjs";

import { toPascalCase, ensureValidName } from "./scaffold/strings.mjs";
import {
  elmJsonTemplate,
  sharedTemplate,
  indexRouteTemplate,
  counterRouteTemplate,
  counterIslandTemplate,
  notFoundRouteTemplate
} from "./scaffold/app-templates.mjs";
import {
  loginIslandTemplate,
  betterAuthMigrationTemplate,
  auth0MigrationTemplate,
  loginRouteTemplateBetterAuth,
  loginRouteTemplateAuth0,
  profileRouteTemplate,
  betterAuthEndpointTemplate,
  auth0EndpointTemplate
} from "./scaffold/auth-templates.mjs";
import { runtimeTemplate, workerTemplate } from "./scaffold/runtime-template.mjs";
import { stylesTemplate } from "./scaffold/styles-template.mjs";
import { authPeerDependencies } from "./scaffold/auth-deps.mjs";

// Re-exported public API — kept here so callers (bin/elm-ssr.mjs, lib/build.mjs)
// don't need to know the file got split into modules.
export { generateWithElm, ensureScaffoldCodegen } from "./scaffold/codegen-bridge.mjs";
export { addAuthProvider, listAuthProviders } from "./scaffold/auth-add.mjs";
export { createRouteScaffold } from "./scaffold/route-template.mjs";

const ensureAppMissing = (config, name) => {
  if (config.apps.some((app) => app.name === name)) {
    throw new Error(`App "${name}" already exists in elm-ssr.config.json. If you want to recreate it, remove its entry from elm-ssr.config.json first.`);
  }
};

const devVarsContent = (auth) => {
  if (auth === "better-auth") {
    return `GREETING="Hello from your local .dev.vars file!"
BETTER_AUTH_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:8787"
# Connect this app at https://dash.better-auth.com to see sign-ups in the dashboard:
# BETTER_AUTH_API_KEY="your-dash-api-key"
# Uncomment to enable social providers in src/Endpoints/Auth.ts:
# GITHUB_CLIENT_ID="your-github-client-id"
# GITHUB_CLIENT_SECRET="your-github-client-secret"
`;
  }
  if (auth === "auth0") {
    return `GREETING="Hello from your local .dev.vars file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"
AUTH0_CALLBACK_URL="http://localhost:8787/api/auth/callback"
`;
  }
  return `GREETING="Hello from your local .dev.vars file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`;
};

const rootEnvContent = (auth) => {
  if (auth === "better-auth") {
    return `GREETING="Hello from your local .env file!"
BETTER_AUTH_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:8787"
# Connect this app at https://dash.better-auth.com to see sign-ups in the dashboard:
# BETTER_AUTH_API_KEY="your-dash-api-key"
`;
  }
  if (auth === "auth0") {
    return `GREETING="Hello from your local .env file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"
AUTH0_CALLBACK_URL="http://localhost:8787/api/auth/callback"
`;
  }
  return `GREETING="Hello from your local .env file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`;
};

const filesForApp = (name, appRoot, options = {}) => {
  const namespace = toPascalCase(name);
  const db = options.db || !!options.auth;
  const auth = options.auth;
  const tailwind = options.tailwind;

  const files = [
    { path: `${appRoot}/elm.json`, content: JSON.stringify(elmJsonTemplate({ http: auth === "better-auth" }), null, 2) + "\n" },
    { path: `${appRoot}/runtime.ts`, content: runtimeTemplate(appRoot, db, auth) },
    { path: `${appRoot}/worker.ts`, content: workerTemplate() },
    { path: `${appRoot}/styles.ts`, content: stylesTemplate() },
    { path: `${appRoot}/src/${namespace}/View/Shared.elm`, content: sharedTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Index.elm`, content: indexRouteTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Counter.elm`, content: counterRouteTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/NotFound.elm`, content: notFoundRouteTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Islands/Counter.elm`, content: counterIslandTemplate(namespace) },
    {
      path: `${appRoot}/.dev.vars`,
      content: devVarsContent(auth)
    }
  ];

  if (db) {
    let migrationContent;
    if (auth === "better-auth") {
      migrationContent = betterAuthMigrationTemplate();
    } else if (auth === "auth0") {
      migrationContent = auth0MigrationTemplate();
    } else {
      migrationContent = `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);\n`;
    }
    files.push({
      path: `${appRoot}/migrations/0001_init.sql`,
      content: migrationContent
    });
  }

  if (auth) {
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Login.elm`,
      content: auth === "better-auth"
        ? loginRouteTemplateBetterAuth(namespace)
        : loginRouteTemplateAuth0(namespace)
    });
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Profile.elm`,
      content: profileRouteTemplate(namespace)
    });
    files.push({
      path: `${appRoot}/src/Endpoints/Auth.ts`,
      content: auth === "better-auth" ? betterAuthEndpointTemplate() : auth0EndpointTemplate()
    });
    if (auth === "better-auth") {
      files.push({
        path: `${appRoot}/src/${namespace}/Islands/Login.elm`,
        content: loginIslandTemplate(namespace)
      });
    }
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
  .auth-header { @apply text-center mb-6; }
  .auth-tabs { @apply flex gap-2 mb-6; }
  .auth-tab { @apply flex-1 py-2 border-0 rounded-lg text-sm font-medium cursor-pointer bg-gray-100 text-gray-500 transition-all; }
  .auth-tab--active { @apply bg-gray-900 text-white; }
  .auth-error { @apply text-red-700 text-xs mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg; }
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

const ensurePackageJson = async (rootPath, appName, options = {}) => {
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

  const extraDeps = {};
  if (options.auth === "better-auth") {
    const peerDeps = await authPeerDependencies();
    extraDeps["better-auth"] = peerDeps["better-auth"] ?? "latest";
    extraDeps["@better-auth/infra"] = peerDeps["@better-auth/infra"] ?? "latest";
  }

  packageJson.devDependencies = {
    "elm-ssr": "latest",
    wrangler: "^4.0.0",
    ...extraDeps,
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
    await writeFile(envPath, rootEnvContent(options.auth), "utf8");
  }

  await writeWorkspaceConfig(rootPath, {
    ...config,
    apps: [...config.apps, configEntry]
  });

  await ensurePackageJson(rootPath, name, options);

  return configEntry;
};

/** @deprecated Use `createAppScaffold`. */
export const createExampleScaffold = createAppScaffold;
