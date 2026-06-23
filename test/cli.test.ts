import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("elm-ssr CLI", () => {
  it("scaffolds a new app at <root>/<name>/ and registers it", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "hello-world", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Created hello-world");

    const config = JSON.parse(await readFile(resolve(root, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };

    expect(config.apps).toEqual([
      {
        name: "hello-world",
        root: "hello-world",
        module: "HelloWorld"
      }
    ]);

    await stat(resolve(root, "hello-world/elm.json"));
    await stat(resolve(root, "hello-world/runtime.ts"));
    await stat(resolve(root, "hello-world/src/HelloWorld/View/Shared.elm"));
    await stat(resolve(root, "hello-world/src/HelloWorld/Routes/Index.elm"));
    await stat(resolve(root, "hello-world/src/HelloWorld/Routes/Counter.elm"));
    await stat(resolve(root, "hello-world/src/HelloWorld/Routes/NotFound.elm"));
    await stat(resolve(root, "hello-world/src/HelloWorld/Islands/Counter.elm"));
  });

  it("scaffolds under a subdirectory when --in is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "billing", "--in", "apps", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    expect(await command.exited).toBe(0);

    const config = JSON.parse(await readFile(resolve(root, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };
    expect(config.apps[0]).toEqual({
      name: "billing",
      root: "apps/billing",
      module: "Billing"
    });
    await stat(resolve(root, "apps/billing/runtime.ts"));
  });

  it("automatically creates elm-ssr.config.json when running 'new' in an empty directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    // Notice we do NOT write elm-ssr.config.json here.

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "my-app", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Created my-app");

    const config = JSON.parse(await readFile(resolve(root, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };

    expect(config.apps).toEqual([
      {
        name: "my-app",
        root: "my-app",
        module: "MyApp"
      }
    ]);

    await stat(resolve(root, "my-app/elm.json"));
  });

  it("exits with error when running build in a directory with no elm-ssr.config.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: elm-ssr.config.json not found");
  });

  it("automatically discovers workspace root by climbing from a subdirectory", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    // Write a workspace config at the root
    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [{ name: "my-app", root: "my-app", module: "MyApp" }] }, null, 2),
      "utf8"
    );

    // Create the app subdirectory
    const appDir = resolve(root, "my-app");
    await mkdir(appDir, { recursive: true });

    const binPath = resolve(process.cwd(), "packages/elm-ssr/bin/elm-ssr.mjs");

    // Run the 'routes' command from inside the subdirectory
    const command = Bun.spawn(
      ["bun", binPath, "routes"],
      {
        cwd: appDir,
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("my-app: root=my-app module=MyApp");
  });

  it("scaffolds a single-app project directly in the current directory using 'init'", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "init", "single-app", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Initialized single-app in current directory");

    const config = JSON.parse(await readFile(resolve(root, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };

    expect(config.apps).toEqual([
      {
        name: "single-app",
        root: ".",
        module: "SingleApp"
      }
    ]);

    // Should create elm.json and runtime.ts at root
    await stat(resolve(root, "elm.json"));
    await stat(resolve(root, "runtime.ts"));
    
    // Should create package.json with scripts and devDependencies
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.scripts.dev).toBe("elm-ssr dev");
    expect(packageJson.devDependencies["elm-ssr"]).toBe("latest");
  });

  it("scaffolding commands (like 'init') do not climb parent directories", async () => {
    const parentRoot = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(parentRoot);

    // Create a config at parent directory
    await writeFile(
      resolve(parentRoot, "elm-ssr.config.json"),
      JSON.stringify({ apps: [{ name: "parent-app", root: "parent-app", module: "ParentApp" }] }, null, 2),
      "utf8"
    );

    // Create a subdirectory representing the child workspace
    const childRoot = resolve(parentRoot, "child-workspace");
    await mkdir(childRoot, { recursive: true });

    const binPath = resolve(process.cwd(), "packages/elm-ssr/bin/elm-ssr.mjs");

    // Run 'init' inside the child subdirectory without specifying --root
    // It should initialize a new config inside the child-workspace folder, rather than climbing up to parentRoot!
    const command = Bun.spawn(
      ["bun", binPath, "init", "child-app"],
      {
        cwd: childRoot,
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Initialized child-app in current directory");

    // Verify child-workspace has its own new elm-ssr.config.json
    const config = JSON.parse(await readFile(resolve(childRoot, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };
    expect(config.apps).toEqual([
      {
        name: "child-app",
        root: ".",
        module: "ChildApp"
      }
    ]);

    // Parent config should remain completely untouched!
    const parentConfig = JSON.parse(await readFile(resolve(parentRoot, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };
    expect(parentConfig.apps).toEqual([
      {
        name: "parent-app",
        root: "parent-app",
        module: "ParentApp"
      }
    ]);
  });

  it("scaffolds all types of routes using the 'route' command", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    // Initialize workspace and app first
    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [{ name: "my-app", root: "my-app", module: "MyApp" }] }, null, 2),
      "utf8"
    );
    await mkdir(resolve(root, "my-app"), { recursive: true });

    const binPath = resolve(process.cwd(), "packages/elm-ssr/bin/elm-ssr.mjs");

    // 1. Scaffold HTML route
    const htmlCmd = Bun.spawn(
      ["bun", binPath, "route", "profile/settings", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await htmlCmd.exited).toBe(0);
    await stat(resolve(root, "my-app/src/MyApp/Routes/Profile/Settings.elm"));

    // 2. Scaffold Elm API route
    const apiCmd = Bun.spawn(
      ["bun", binPath, "route", "api/users", "--api", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await apiCmd.exited).toBe(0);
    await stat(resolve(root, "my-app/src/MyApp/Routes/Api/Users.elm"));
    const apiContent = await readFile(resolve(root, "my-app/src/MyApp/Routes/Api/Users.elm"), "utf8");
    expect(apiContent).toContain("Action.json");

    // 3. Scaffold SSE route
    const sseCmd = Bun.spawn(
      ["bun", binPath, "route", "api/live-stream", "--sse", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await sseCmd.exited).toBe(0);
    await stat(resolve(root, "my-app/src/Endpoints/Api/LiveStream.ts"));
    const sseContent = await readFile(resolve(root, "my-app/src/Endpoints/Api/LiveStream.ts"), "utf8");
    expect(sseContent).toContain("createSseStream");

    // 4. Scaffold WebSocket route
    const wsCmd = Bun.spawn(
      ["bun", binPath, "route", "chat", "--ws", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await wsCmd.exited).toBe(0);
    await stat(resolve(root, "my-app/src/Endpoints/Chat.ts"));
    const wsContent = await readFile(resolve(root, "my-app/src/Endpoints/Chat.ts"), "utf8");
    expect(wsContent).toContain("WebSocketPair");
  });

  it("scaffolds a new app with --db option", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "db-app", "--db", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    expect(await command.exited).toBe(0);

    // Verify database files & migrations
    await stat(resolve(root, "db-app/migrations/0001_init.sql"));
    await stat(resolve(root, "db-app/.dev.vars"));
    await stat(resolve(root, ".env"));

    const devVars = await readFile(resolve(root, "db-app/.dev.vars"), "utf8");
    expect(devVars).toContain("GREETING=");
    expect(devVars).toContain("SESSION_SECRET=");

    const envFile = await readFile(resolve(root, ".env"), "utf8");
    expect(envFile).toContain("GREETING=");
    expect(envFile).toContain("SESSION_SECRET=");

    const runtime = await readFile(resolve(root, "db-app/runtime.ts"), "utf8");
    expect(runtime).toContain("Database");
    expect(runtime).toContain("inMemoryEffects");
  });

  it("scaffolds a new app with --auth option (betterAuth & invalid check)", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // 1. Valid provider: betterAuth
    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "auth-app", "--auth", "betterAuth", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    expect(await command.exited).toBe(0);

    // Verify auth pages & TS endpoint
    await stat(resolve(root, "auth-app/migrations/0001_init.sql")); // Auth automatically enables DB setup
    await stat(resolve(root, "auth-app/src/AuthApp/Routes/Login.elm"));
    await stat(resolve(root, "auth-app/src/AuthApp/Routes/Profile.elm"));
    await stat(resolve(root, "auth-app/src/Endpoints/Auth.ts"));
    await stat(resolve(root, "auth-app/.dev.vars"));
    
    const runtime = await readFile(resolve(root, "auth-app/runtime.ts"), "utf8");
    expect(runtime).toContain("sessions:");
    expect(runtime).toContain("csrf: true");
    expect(runtime).toContain("handleAuth");

    // 2. Invalid provider
    const badCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "bad-app", "--auth", "invalid-auth-provider", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    expect(await badCommand.exited).toBe(1);
    const stderr = await new Response(badCommand.stderr).text();
    expect(stderr).toContain("Error: --auth only supports 'betterAuth' or 'auth0'");
  });
});
