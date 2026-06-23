#!/usr/bin/env bun

import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { createAppScaffold } from "../lib/scaffold.mjs";
import { readWorkspaceConfig } from "../lib/workspace.mjs";
import { build } from "../lib/build.mjs";
import { migrate } from "../lib/migrate.mjs";

const defaultRootPath = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? "help";

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
  console.log(`elm-ssr commands

  build         Generate wrapper modules and compile configured Elm SSR apps
  compress      Pre-compress island and app bundles using Gzip for faster edge delivery
  dev           Build and start wrangler dev using the current workspace config
  init <name>   Initialize a self-contained single-app project in the current directory
  new <name>    Create a new app at <workspace>/<name>/ (or <workspace>/<subdir>/<name>/
                with --in <subdir>) and register it in elm-ssr.config.json
  routes        Print configured apps and their public modules
  info          Print current workspace package and configured app names
  migrate ...   Apply / revert / inspect SQL migrations (see: elm-ssr migrate --help)
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
          if (filename && filename.endsWith(".elm")) {
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
      console.error("Usage: elm-ssr init <name>");
      process.exit(1);
    }

    const created = await createAppScaffold(rootPath, name, { root: "." });
    console.log(`Initialized ${created.name} in current directory`);
    break;
  }

  case "new": {
    const name = args[1];

    if (!name) {
      console.error("Usage: elm-ssr new <name> [--in <subdir>]");
      console.error("  Default location: <workspace>/<name>/");
      console.error("  Use --in apps to place it under <workspace>/apps/<name>/, etc.");
      process.exit(1);
    }

    const subdir = findFlagValue("--in");
    const appRoot = subdir ? `${subdir.replace(/\/+$/, "")}/${name}` : name;
    const created = await createAppScaffold(rootPath, name, { root: appRoot });
    console.log(`Created ${created.name} at ${created.root}`);
    break;
  }

  case "routes":
    requireConfig();
    for (const app of config.apps) {
      console.log(`${app.name}: root=${app.root} module=${app.module} routes=src/${app.module.split(".").join("/")}/Routes`);
    }
    break;

  case "info":
    requireConfig();
    console.log(`workspace: ${packageJson.name}`);
    console.log(`apps: ${config.apps.map((app) => app.name).join(", ")}`);
    break;

  case "migrate":
    await migrate(args.slice(1));
    break;

  default:
    printHelp();
    break;
}
