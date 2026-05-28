#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createExampleScaffold } from "../lib/scaffold.mjs";
import { readWorkspaceConfig } from "../lib/workspace.mjs";

const defaultRootPath = resolve(new URL("../../..", import.meta.url).pathname);
const packageJsonPath = resolve(defaultRootPath, "package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
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
  dev           Build and start wrangler dev using the current workspace config
  new <name>    Create a new example app and register it in elm-ssr.config.json
  routes        Print configured apps and their public modules
  info          Print current workspace package and configured app names
`);
};

const config = await readWorkspaceConfig(rootPath);

switch (command) {
  case "build":
    await run("/Users/michalmajchrzak/.bun/bin/bun", ["run", "scripts/build-elm.mjs"], rootPath);
    break;

  case "dev":
    await run("/Users/michalmajchrzak/.bun/bin/bun", ["run", "build"], rootPath);
    await run("./node_modules/.bin/wrangler", ["dev"], rootPath);
    break;

  case "new": {
    const name = args[1];

    if (!name) {
      console.error("Usage: elm-ssr new <name>");
      process.exit(1);
    }

    const created = await createExampleScaffold(rootPath, name);
    console.log(`Created ${created.name} at ${created.root}`);
    break;
  }

  case "routes":
    for (const app of config.apps) {
      console.log(`${app.name}: root=${app.root} module=${app.module} routes=src/${app.module.split(".").join("/")}/Routes`);
    }
    break;

  case "info":
    console.log(`workspace: ${packageJson.name}`);
    console.log(`apps: ${config.apps.map((app) => app.name).join(", ")}`);
    break;

  default:
    printHelp();
    break;
}
