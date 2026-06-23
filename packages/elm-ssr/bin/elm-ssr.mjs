#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAppScaffold } from "../lib/scaffold.mjs";
import { readWorkspaceConfig } from "../lib/workspace.mjs";
import { build } from "../lib/build.mjs";
import { migrate } from "../lib/migrate.mjs";

const defaultRootPath = process.cwd();
const packageJsonPath = resolve(defaultRootPath, "package.json");

let packageJson = { name: "unknown" };
try {
  packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
} catch {
  // Not in a package root, that's okay for some commands
}
const args = process.argv.slice(2);
const command = args[0] ?? "help";

const findFlagValue = (flagName) => {
  const index = args.indexOf(flagName);
  return index >= 0 ? args[index + 1] : undefined;
};

const rootPath = resolve(findFlagValue("--root") ?? defaultRootPath);

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

  case "dev":
    requireConfig();
    await run("bun", ["run", "build"], rootPath);
    await run("./node_modules/.bin/wrangler", ["dev"], rootPath);
    break;

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
