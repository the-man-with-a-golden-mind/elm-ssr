#!/usr/bin/env bun

import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { createAppScaffold, createRouteScaffold } from "../lib/scaffold.mjs";
import { readWorkspaceConfig } from "../lib/workspace.mjs";
import { build } from "../lib/build.mjs";
import { migrate } from "../lib/migrate.mjs";
import { generateQueries } from "../lib/query.mjs";

const defaultRootPath = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? "help";

const ownPkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const VERSION = ownPkg.version;

const findFlagValue = (flagName) => {
  const index = args.indexOf(flagName);
  return index >= 0 ? args[index + 1] : undefined;
};

const findWorkspaceRoot = async (startPath) => {
  let current = startPath;
  while (true) {
    try {
      const configPath = resolve(current, "elm-ssr.config.json");
      await stat(configPath);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return startPath;
};

const userRoot = findFlagValue("--root");
let rootPath;
if (userRoot) {
  rootPath = resolve(userRoot);
} else if (["new", "init", "migrate", "help"].includes(command)) {
  rootPath = defaultRootPath;
} else {
  rootPath = resolve(await findWorkspaceRoot(defaultRootPath));
}
const packageJsonPath = resolve(rootPath, "package.json");

let packageJson = { name: "unknown" };
try {
  packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
} catch {
  // Not in a package root, that's okay for some commands
}

const run = async (cmd, cmdArgs, cwd = rootPath) => {
  const child = Bun.spawn([cmd, ...cmdArgs], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env
  });

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
};

const printHelp = () => {
  console.log(`elm-ssr ${VERSION}

  build         Generate wrapper modules and compile configured Elm SSR apps
  compress      Pre-compress island and app bundles using Gzip for faster edge delivery
  dev           Build and start wrangler dev using the current workspace config
  init <name>   Create ./<name>/ and scaffold a self-contained single-app project inside it
                (use --db to wire SQLite/migrations, --auth betterAuth|auth0 for auth guards, --tailwind for Tailwind CSS)
  new <name>    Create a new app at <workspace>/<name>/ and register it in elm-ssr.config.json
                (use --in <subdir> to group, --db for SQLite, --auth betterAuth|auth0 for auth, --tailwind for Tailwind)
  routes        Print configured apps and their public modules
  route <path>  Scaffold a new route (standard HTML, --api JSON, --ws WebSocket, or --sse EventSource)
  query         Generate type-safe Elm Db modules from SQL table definitions
  info          Print current workspace package and configured app names
  migrate ...   Apply / revert / inspect SQL migrations (see: elm-ssr migrate --help)
  version       Print the elm-ssr version
`);
};

let config = null;
try {
  config = await readWorkspaceConfig(rootPath);
} catch (err) {
  if (!err || typeof err !== "object" || !("code" in err) || err.code !== "ENOENT") {
    throw err;
  }
}

const requireConfig = () => {
  if (!config) {
    console.error(`Error: elm-ssr.config.json not found at ${rootPath}`);
    console.error("Please run 'elm-ssr new <name>' to create a new workspace and app.");
    process.exit(1);
  }
};

if (command === "--version" || command === "-v" || command === "version") {
  console.log(VERSION);
  process.exit(0);
}

switch (command) {
  case "build":
  case "compress":
    requireConfig();
    await build({ rootPath, config });
    break;

  case "dev": {
    requireConfig();
    if (packageJson && packageJson.scripts && packageJson.scripts.build) {
      await run("bun", ["run", "build"], rootPath);
    } else {
      await build({ rootPath, config });
    }

    let buildTimeout = null;
    const triggerBuild = () => {
      if (buildTimeout) clearTimeout(buildTimeout);
      buildTimeout = setTimeout(async () => {
        console.log("\n[elm-ssr] File change detected. Rebuilding...");
        try {
          await build({ rootPath, config });
          console.log("[elm-ssr] Rebuild successful.");
        } catch (err) {
          console.error("[elm-ssr] Rebuild failed:", err);
        }
      }, 100);
    };

    const watchers = [];
    for (const app of config.apps) {
      const srcDir = resolve(rootPath, app.root, "src");
      try {
        const watcher = watch(srcDir, { recursive: true }, (eventType, filename) => {
          if (filename && (filename.endsWith(".elm") || filename.endsWith(".css"))) {
            triggerBuild();
          }
        });
        watchers.push(watcher);
      } catch (err) {
        console.warn(`[elm-ssr] Could not watch directory ${srcDir}:`, err);
      }
    }

    const cleanup = () => {
      for (const w of watchers) w.close();
    };

    process.on("SIGINT", cleanup);
    process.on("exit", cleanup);

    let wranglerCmd = "./node_modules/.bin/wrangler";
    let wranglerArgs = ["dev"];
    try {
      await readFile(resolve(rootPath, wranglerCmd));
    } catch {
      wranglerCmd = "bunx";
      wranglerArgs = ["wrangler", "dev"];
    }

    let hasWranglerConfig = false;
    try {
      const tomlContent = await readFile(resolve(rootPath, "wrangler.toml"), "utf8");
      if (tomlContent.trim().length > 0) hasWranglerConfig = true;
    } catch {}
    try {
      const jsonContent = await readFile(resolve(rootPath, "wrangler.jsonc"), "utf8");
      if (jsonContent.trim().length > 0) hasWranglerConfig = true;
    } catch {}

    if (!hasWranglerConfig) {
      const app = config.apps[0];
      if (app) {
        wranglerArgs.push(`${app.root}/worker.ts`);
        wranglerArgs.push("--compatibility-date", "2026-05-28");
        wranglerArgs.push("--compatibility-flags", "nodejs_compat");
      }
    }

    try {
      await run(wranglerCmd, wranglerArgs, rootPath);
    } finally {
      cleanup();
    }
    break;
  }

  case "init": {
    const name = args[1];

    if (!name) {
      console.error("Usage: elm-ssr init <name> [--db] [--auth betterAuth|auth0] [--tailwind]");
      process.exit(1);
    }

    const db = args.includes("--db");
    const tailwind = args.includes("--tailwind");
    let auth = findFlagValue("--auth");
    if (auth) {
      if (auth === "better-auth" || auth === "betterAuth") {
        auth = "better-auth";
      } else if (auth !== "auth0") {
        console.error("Error: --auth only supports 'betterAuth' or 'auth0'");
        process.exit(1);
      }
    }

    // Create a dedicated directory for the project — elm-ssr init t creates ./t/
    // and scaffolds a self-contained single-app project inside it (root: ".").
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    const targetDir = resolve(rootPath, name);
    await mkdirFn(targetDir, { recursive: true });

    const created = await createAppScaffold(targetDir, name, { root: ".", db, auth, tailwind });
    console.log(`Initialized ${created.name} in ./${name}/`);
    console.log(`\nNext:\n  cd ${name}\n  bun install\n  bun run build\n  bun run dev`);
    break;
  }

  case "new": {
    const name = args[1];

    if (!name) {
      console.error("Usage: elm-ssr new <name> [--in <subdir>] [--db] [--auth betterAuth|auth0] [--tailwind]");
      console.error("  Default location: <workspace>/<name>/");
      console.error("  Use --in apps to place it under <workspace>/apps/<name>/, etc.");
      process.exit(1);
    }

    const subdir = findFlagValue("--in");
    const appRoot = subdir ? `${subdir.replace(/\/+$/, "")}/${name}` : name;
    
    const db = args.includes("--db");
    const tailwind = args.includes("--tailwind");
    let auth = findFlagValue("--auth");
    if (auth) {
      if (auth === "better-auth" || auth === "betterAuth") {
        auth = "better-auth";
      } else if (auth !== "auth0") {
        console.error("Error: --auth only supports 'betterAuth' or 'auth0'");
        process.exit(1);
      }
    }

    const created = await createAppScaffold(rootPath, name, { root: appRoot, db, auth, tailwind });
    console.log(`Created ${created.name} at ${created.root}`);
    break;
  }

  case "routes":
    requireConfig();
    for (const app of config.apps) {
      console.log(`${app.name}: root=${app.root} module=${app.module} routes=src/${app.module.split(".").join("/")}/Routes`);
    }
    break;

  case "route": {
    requireConfig();
    const routePath = args[1];
    if (!routePath) {
      console.error("Usage: elm-ssr route <path> [--app <app-name>] [--api] [--ws] [--sse]");
      process.exit(1);
    }
    
    const appName = findFlagValue("--app");
    let appConfig;
    if (appName) {
      appConfig = config.apps.find(a => a.name === appName);
      if (!appConfig) {
        console.error(`Error: App "${appName}" not found in elm-ssr.config.json`);
        process.exit(1);
      }
    } else {
      if (config.apps.length === 1) {
        appConfig = config.apps[0];
      } else {
        console.error("Error: Multiple apps found in workspace config. Please specify which app to add the route to using --app <app-name>");
        console.error("Available apps:", config.apps.map(a => a.name).join(", "));
        process.exit(1);
      }
    }

    const isApi = args.includes("--api");
    const isWs = args.includes("--ws") || args.includes("--websocket");
    const isSse = args.includes("--sse");

    const result = await createRouteScaffold(rootPath, appConfig, routePath, { isApi, isWs, isSse });
    console.log(`Scaffolded ${result.type} route at ${result.path}`);
    if (result.instructions) {
      console.log("\nInstructions to wire it up:\n" + result.instructions);
    }
    break;
  }

  case "info":
    requireConfig();
    console.log(`workspace: ${packageJson.name}`);
    console.log(`apps: ${config.apps.map((app) => app.name).join(", ")}`);
    break;

  case "query": {
    requireConfig();
    const appName = findFlagValue("--app");
    let appConfig;
    if (appName) {
      appConfig = config.apps.find(a => a.name === appName);
      if (!appConfig) {
        console.error(`Error: App "${appName}" not found in elm-ssr.config.json`);
        process.exit(1);
      }
    } else {
      if (config.apps.length === 1) {
        appConfig = config.apps[0];
      } else {
        console.error("Error: Multiple apps found in workspace config. Please specify which app to query using --app <app-name>");
        console.error("Available apps:", config.apps.map(a => a.name).join(", "));
        process.exit(1);
      }
    }

    const migrationsDir = findFlagValue("--dir");
    const outputDir = findFlagValue("--output");

    try {
      await generateQueries({ rootPath, appConfig, migrationsDir, outputDir });
    } catch (err) {
      console.error(`Error generating query modules: ${err.message}`);
      process.exit(1);
    }
    break;
  }

  case "migrate":
    await migrate(args.slice(1));
    break;

  default:
    printHelp();
    break;
}
