import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  betterAuthProviderCode,
  auth0ProviderCode,
  betterAuthEndpointTemplate,
  auth0EndpointTemplate,
  loginRouteTemplateBetterAuth,
  loginRouteTemplateAuth0,
  profileRouteTemplate,
  loginIslandTemplate,
  betterAuthMigrationTemplate
} from "./auth-templates.mjs";

const PROVIDER_NAMES = { "better-auth": "betterAuth", auth0: "auth0" };

const normaliseProvider = (raw) => {
  if (raw === "betterAuth" || raw === "better-auth") return "better-auth";
  if (raw === "auth0") return "auth0";
  throw new Error(`Unknown auth provider: "${raw}". Supported: betterAuth, auth0`);
};

// Detect which providers are already wired in a runtime.ts file.
const detectProviders = (runtimeContent) => {
  const found = [];
  if (runtimeContent.includes("betterAuthProvider")) found.push("better-auth");
  if (runtimeContent.includes("auth0Provider")) found.push("auth0");
  return found;
};

// Add auth imports after the effects import line.
const addAuthImports = (content, provider) => {
  const providerName = provider === "better-auth" ? "betterAuthProvider" : "auth0Provider";
  const sessionImport = `import { memorySessionStore } from "elm-ssr/sessions";`;
  const anchor = `import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";`;
  let next = content;

  if (!next.includes(sessionImport)) {
    next = next.replace(anchor, `${anchor}\n${sessionImport}`);
  }

  const endpointImport = next.match(/import \{ ([^}]+) \} from "\.\/src\/Endpoints\/Auth";/);
  if (endpointImport) {
    const names = endpointImport[1].split(",").map((name) => name.trim()).filter(Boolean);
    for (const name of [providerName, "composeAuthProviders"]) {
      if (!names.includes(name)) names.push(name);
    }
    return next.replace(endpointImport[0], `import { ${names.join(", ")} } from "./src/Endpoints/Auth";`);
  }

  return next.replace(anchor, `${anchor}\nimport { ${providerName}, composeAuthProviders } from "./src/Endpoints/Auth";`);
};

const betterAuthRuntimeEnvBlock = `let bunAuthDb: any = undefined;
if (typeof (globalThis as any).Bun !== "undefined") {
  const sqliteModule = "bun" + ":sqlite";
  const { Database } = require(sqliteModule);
  bunAuthDb = new Database(import.meta.dir + "/app.db");
}

const getAuthEnv = (env: any): any =>
  bunAuthDb && !env?.DB ? { ...(env ?? {}), DB: bunAuthDb } : env;

`;

// Build the auth init block that goes before createWorkerApp.
const buildAuthInitBlock = (provider, hasDb) => {
  if (provider === "better-auth") {
    return `
// elm-ssr-auth:start
${betterAuthRuntimeEnvBlock}
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  betterAuthProvider({ getEnv: getAuthEnv }),
]);`;
  }
  return `
// elm-ssr-auth:start
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  auth0Provider(),
]);`;
};

// Injects auth into a runtime.ts that has no auth yet.
const injectAuthIntoRuntime = (content, provider, hasDb) => {
  // Find where the worker export starts (always near end of generated file).
  const workerIdx = content.indexOf("\nexport const worker = createWorkerApp({");
  if (workerIdx === -1) return content;

  const base = content.slice(0, workerIdx);
  const workerBlock = content.slice(workerIdx);

  // Extract the existing effects config from the worker block.
  const effectsMatch = workerBlock.match(/\n  effects: ([\s\S]*?)\n\}\);/);
  const effectsLine = effectsMatch
    ? `  effects: ${effectsMatch[1]}`
    : `  effects: (effect, context) => {\n    if (context.env) {\n      return cloudflareEffects(${hasDb ? '{ dbBinding: "DB" }' : ''})(effect, context);\n    }\n    return inMemoryEffects({ env: process.env as any${hasDb ? ', sql: sqlHandler' : ''} })(effect, context);\n  }`;

  const secretLine = provider === "better-auth"
    ? `    secret: (env) => (env?.SESSION_SECRET as string) || (env?.BETTER_AUTH_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",`
    : `    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",`;

  const newWorker = `\nexport const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags,
  sessions: {
${secretLine}
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] },
  middlewares: [authMiddleware],
${effectsLine}
});
// elm-ssr-auth:end\n`;

  const withImports = addAuthImports(base, provider);
  return withImports + buildAuthInitBlock(provider, hasDb) + newWorker;
};

// Adds a second provider to an already-auth runtime.ts.
const addProviderToRuntime = (content, provider) => {
  let next = addAuthImports(content, provider);
  const providerCall = provider === "better-auth"
    ? "betterAuthProvider({ getEnv: getAuthEnv })"
    : "auth0Provider()";
  if (next.includes(providerCall)) return next;
  if (provider === "better-auth" && !next.includes("const getAuthEnv =")) {
    next = next.replace("// elm-ssr-auth:start\n", `// elm-ssr-auth:start\n${betterAuthRuntimeEnvBlock}`);
  }
  return next.replace(
    /composeAuthProviders\(\[\n([\s\S]*?)\]\)/,
    (_, inner) => `composeAuthProviders([\n${inner}  ${providerCall},\n])`
  );
};

// Patch or create runtime.ts for a new provider.
const patchRuntimeForAuth = (content, provider, hasDb) => {
  if (content.includes("// elm-ssr-auth:start")) {
    return addProviderToRuntime(content, provider);
  }
  // Provider already present without markers (e.g. scaffolded with --auth) — leave unchanged.
  const providerFn = provider === "better-auth" ? "betterAuthProvider" : "auth0Provider";
  if (content.includes(providerFn)) return content;
  return injectAuthIntoRuntime(content, provider, hasDb);
};

// Adds a provider to Auth.ts (creates full file if missing, appends code otherwise).
const updateAuthTs = (existingContent, provider) => {
  const providerFn = provider === "better-auth" ? "betterAuthProvider" : "auth0Provider";
  if (existingContent.includes(providerFn)) return null; // already present
  const snippet = provider === "better-auth" ? betterAuthProviderCode : auth0ProviderCode;
  // If file already has the contract section, just append provider code.
  if (existingContent.includes("composeAuthProviders")) {
    return existingContent.trimEnd() + "\n" + snippet + "\n";
  }
  // No contract yet — generate full file.
  return provider === "better-auth"
    ? betterAuthEndpointTemplate()
    : auth0EndpointTemplate();
};

// Returns provider-specific env vars to add to .dev.vars / .env.
const missingEnvVars = (existingContent, provider) => {
  const vars = provider === "better-auth"
    ? [
        ['BETTER_AUTH_SECRET', '"change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"'],
        ['BETTER_AUTH_URL', '"http://localhost:8787"'],
      ]
    : [
        ['SESSION_SECRET', '"change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"'],
        ['AUTH0_DOMAIN', '"your-tenant.auth0.com"'],
        ['AUTH0_CLIENT_ID', '"your-client-id"'],
        ['AUTH0_CLIENT_SECRET', '"your-client-secret"'],
        ['AUTH0_CALLBACK_URL', '"http://localhost:8787/api/auth/callback"'],
      ];
  return vars.filter(([key]) => !existingContent.includes(`${key}=`));
};

/**
 * Add an auth provider to an existing elm-ssr app.
 * Idempotent: running it twice has no effect.
 */
export const addAuthProvider = async (rootPath, appConfig, rawProvider) => {
  const provider = normaliseProvider(rawProvider);
  const appRoot = resolve(rootPath, appConfig.root);
  const namespace = appConfig.module;

  // ── Auth.ts ───────────────────────────────────────────────────────────────
  const authTsPath = resolve(appRoot, "src/Endpoints/Auth.ts");
  let authTsContent = "";
  try { authTsContent = await readFile(authTsPath, "utf8"); } catch {}
  const newAuthTs = updateAuthTs(authTsContent, provider);
  if (newAuthTs !== null) {
    await mkdir(dirname(authTsPath), { recursive: true });
    await writeFile(authTsPath, newAuthTs, "utf8");
  }

  // ── runtime.ts ───────────────────────────────────────────────────────────
  const runtimePath = resolve(appRoot, "runtime.ts");
  const runtimeContent = await readFile(runtimePath, "utf8").catch(() => "");
  if (runtimeContent) {
    const hasDb = runtimeContent.includes("let sqlHandler") || runtimeContent.includes("import.meta.dir");
    const patched = patchRuntimeForAuth(runtimeContent, provider, hasDb);
    if (patched !== runtimeContent) {
      await writeFile(runtimePath, patched, "utf8");
    }
  }

  // ── elm.json: add elm/http for BetterAuth (Login island needs Http.post) ──
  if (provider === "better-auth") {
    const elmJsonPath = resolve(appRoot, "elm.json");
    try {
      const elmJson = JSON.parse(await readFile(elmJsonPath, "utf8"));
      if (!elmJson.dependencies.direct["elm/http"]) {
        elmJson.dependencies.direct["elm/http"] = "2.0.0";
        elmJson.dependencies.indirect["elm/bytes"] = elmJson.dependencies.indirect["elm/bytes"] ?? "1.0.8";
        elmJson.dependencies.indirect["elm/file"] = elmJson.dependencies.indirect["elm/file"] ?? "1.0.5";
        await writeFile(elmJsonPath, JSON.stringify(elmJson, null, 2) + "\n", "utf8");
      }
    } catch {}
  }

  // ── Elm pages: create only if missing ────────────────────────────────────
  const loginPath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Routes/Login.elm`);
  try { await stat(loginPath); } catch {
    await mkdir(dirname(loginPath), { recursive: true });
    const content = provider === "better-auth"
      ? loginRouteTemplateBetterAuth(namespace)
      : loginRouteTemplateAuth0(namespace);
    await writeFile(loginPath, content, "utf8");
  }
  const profilePath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Routes/Profile.elm`);
  try { await stat(profilePath); } catch {
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, profileRouteTemplate(namespace), "utf8");
  }
  // Login island for BetterAuth
  if (provider === "better-auth") {
    const islandPath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Islands/Login.elm`);
    try { await stat(islandPath); } catch {
      await mkdir(dirname(islandPath), { recursive: true });
      await writeFile(islandPath, loginIslandTemplate(namespace), "utf8");
    }
  }

  // ── Migration: create only if BetterAuth and no migration exists ──────────
  if (provider === "better-auth") {
    const migDir = resolve(appRoot, "migrations");
    let hasMigration = false;
    try {
      const files = await (await import("node:fs/promises")).readdir(migDir);
      hasMigration = files.some(f => f.endsWith(".sql") && !f.endsWith(".down.sql"));
    } catch {}
    if (!hasMigration) {
      await mkdir(migDir, { recursive: true });
      await writeFile(resolve(migDir, "0001_init.sql"), betterAuthMigrationTemplate(), "utf8");
    }
  }

  // ── package.json: at workspace root (not app dir) ────────────────────────
  if (provider === "better-auth") {
    const pkgPath = resolve(rootPath, "package.json");
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (!pkg.devDependencies?.["better-auth"]) {
        pkg.devDependencies = { ...pkg.devDependencies, "better-auth": "1.6.22" };
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      }
    } catch {}
  }

  // ── .dev.vars (app dir) / .env (workspace root): add missing env vars ─────
  for (const filePath of [resolve(appRoot, ".dev.vars"), resolve(rootPath, ".env")]) {
    let existing = "";
    try { existing = await readFile(filePath, "utf8"); } catch {}
    const missing = missingEnvVars(existing, provider);
    if (missing.length > 0) {
      const toAdd = missing.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
      await writeFile(filePath, (existing ? existing.trimEnd() + "\n" : "") + toAdd, "utf8");
    }
  }

  return { provider, name: PROVIDER_NAMES[provider] };
};

/**
 * List auth providers already wired in an app's runtime.ts.
 */
export const listAuthProviders = async (rootPath, appConfig) => {
  const runtimePath = resolve(rootPath, appConfig.root, "runtime.ts");
  try {
    const content = await readFile(runtimePath, "utf8");
    return detectProviders(content);
  } catch {
    return [];
  }
};
