import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoots: string[] = [];

async function linkNodeModules(root: string) {
  await symlink(
    resolve(process.cwd(), "node_modules"),
    join(root, "node_modules"),
    "dir"
  );
}


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
    await linkNodeModules(root);

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
    // init now creates a subdirectory named after the app
    expect(stdout).toContain("Initialized single-app in ./single-app/");

    const appDir = resolve(root, "single-app");

    const config = JSON.parse(await readFile(resolve(appDir, "elm-ssr.config.json"), "utf8")) as {
      apps: Array<{ name: string; root: string; module: string }>;
    };

    expect(config.apps).toEqual([
      {
        name: "single-app",
        root: ".",
        module: "SingleApp"
      }
    ]);

    // Should create elm.json and runtime.ts inside the app directory
    await stat(resolve(appDir, "elm.json"));
    await stat(resolve(appDir, "runtime.ts"));

    // Should create package.json with scripts and devDependencies
    const packageJson = JSON.parse(await readFile(resolve(appDir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.scripts.dev).toBe("elm-ssr dev");
    expect(packageJson.devDependencies["elm-ssr"]).toBe("latest");

    // Symlink node_modules into the app directory so the build can find them
    const { symlink } = await import("node:fs/promises");
    await symlink(resolve(process.cwd(), "node_modules"), resolve(appDir, "node_modules"), "dir");
    await symlink(resolve(process.cwd(), ".elm-home"), resolve(appDir, ".elm-home"), "dir");

    // Verify it compiles successfully
    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", appDir],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const buildExitCode = await buildCommand.exited;
    if (buildExitCode !== 0) {
      console.log("Build stdout:", await new Response(buildCommand.stdout).text());
      console.error("Build stderr:", await new Response(buildCommand.stderr).text());
    }
    expect(buildExitCode).toBe(0);

    const runtimePath = resolve(appDir, "runtime.ts");
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ship fast.");
  }, 15000);

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
    // init creates a subdirectory — "child-app" dir inside childRoot
    expect(stdout).toContain("Initialized child-app in ./child-app/");

    const childAppDir = resolve(childRoot, "child-app");

    // Verify the app directory has its own elm-ssr.config.json (not at childRoot)
    const config = JSON.parse(await readFile(resolve(childAppDir, "elm-ssr.config.json"), "utf8")) as {
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

    // Initialize workspace and app first by calling 'new'
    const newCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "my-app", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await newCmd.exited).toBe(0);

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

    // 5. Verify the entire application compiles successfully with all the newly added routes
    const buildCmd = Bun.spawn(
      ["bun", binPath, "build", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    const buildExitCode = await buildCmd.exited;
    if (buildExitCode !== 0) {
      console.log("Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(buildExitCode).toBe(0);
  }, 15000);

  it("scaffolds a new app with --db option", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);
    await linkNodeModules(root);

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

    // Verify it compiles successfully
    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );

    const buildExitCode = await buildCommand.exited;
    if (buildExitCode !== 0) {
      console.log("Build stdout:", await new Response(buildCommand.stdout).text());
      console.error("Build stderr:", await new Response(buildCommand.stderr).text());
    }
    expect(buildExitCode).toBe(0);

    const runtimePath = resolve(root, "db-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ship fast.");
  }, 15000);

  it("scaffolds a new app with --auth betterAuth: builds, routes work, full sign-up/in/out E2E", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);
    await linkNodeModules(root);
    await symlink(resolve(process.cwd(), ".elm-home"), join(root, ".elm-home"), "dir");

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "auth-app", "--auth", "betterAuth", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    expect(await command.exited).toBe(0);

    // Verify generated file structure
    await stat(resolve(root, "auth-app/migrations/0001_init.sql"));
    await stat(resolve(root, "auth-app/src/AuthApp/Routes/Login.elm"));
    await stat(resolve(root, "auth-app/src/AuthApp/Routes/Profile.elm"));
    await stat(resolve(root, "auth-app/src/Endpoints/Auth.ts"));
    await stat(resolve(root, "auth-app/.dev.vars"));

    const authTs = await readFile(resolve(root, "auth-app/src/Endpoints/Auth.ts"), "utf8");
    expect(authTs).toContain('from "better-auth"');
    expect(authTs).toContain("export interface AuthUser");      // shared contract
    expect(authTs).toContain("export const setAuthUser");       // session helper
    expect(authTs).toContain("export const composeAuthProviders");
    expect(authTs).toContain("export const betterAuthProvider"); // factory pattern
    expect(authTs).not.toContain('require("bun:sqlite")');
    expect(authTs).not.toContain("user@example.com");

    const migration = await readFile(resolve(root, "auth-app/migrations/0001_init.sql"), "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "user"');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS session");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS account");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS verification");

    await stat(resolve(root, "auth-app/src/AuthApp/Islands/Login.elm")); // Login island exists

    const loginElm = await readFile(resolve(root, "auth-app/src/AuthApp/Islands/Login.elm"), "utf8");
    expect(loginElm).toContain("port module");
    expect(loginElm).toContain("port navigateTo");
    expect(loginElm).toContain("Http.post");
    expect(loginElm).toContain("/api/auth/sign-in");     // our endpoint, not BetterAuth's direct
    expect(loginElm).toContain("/api/auth/sign-up");
    expect(loginElm).not.toContain("/api/auth/sign-in/email"); // island must not bypass our layer

    const loginRoute = await readFile(resolve(root, "auth-app/src/AuthApp/Routes/Login.elm"), "utf8");
    expect(loginRoute).toContain("LoginIsland.embed");

    const elmJson = JSON.parse(await readFile(resolve(root, "auth-app/elm.json"), "utf8"));
    expect(elmJson.dependencies.direct["elm/http"]).toBe("2.0.0");

    const runtime = await readFile(resolve(root, "auth-app/runtime.ts"), "utf8");
    expect(runtime).toContain("sessions:");
    expect(runtime).toContain("sessionStore");
    expect(runtime).toContain("composeAuthProviders");         // unified provider pattern
    expect(runtime).toContain("betterAuthProvider");
    expect(runtime).toContain("bunAuthDb");
    expect(runtime).toContain("middlewares: [authMiddleware]");
    expect(runtime).not.toContain("sessionEffects");
    expect(runtime).not.toContain("betterAuthBridge");
    expect(runtime).not.toContain("baseWorkerFetch");     // no worker.fetch wrapping

    const devVars = await readFile(resolve(root, "auth-app/.dev.vars"), "utf8");
    expect(devVars).toContain("BETTER_AUTH_SECRET=");
    expect(devVars).toContain("BETTER_AUTH_URL=");

    // package.json lives at the workspace root, not in the app subdirectory
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies?.["better-auth"]).toBe("1.6.22");

    // Elm build
    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    const buildExitCode = await buildCommand.exited;
    if (buildExitCode !== 0) {
      console.error("Build stderr:", await new Response(buildCommand.stderr).text());
    }
    expect(buildExitCode).toBe(0);

    // Load the generated runtime
    const runtimePath = resolve(root, "auth-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    // Basic routes
    const res1 = await worker.fetch(new Request("http://localhost/"));
    expect(res1.status).toBe(200);
    expect(await res1.text()).toContain("Ship fast.");

    const res2 = await worker.fetch(new Request("http://localhost/login"));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("content-type")).toContain("text/html");
    const loginBody = await res2.text();
    // Login island is embedded — form logic is client-side, not in SSR HTML
    expect(loginBody).toContain("elm-ssr-island");
    expect(loginBody).toContain('"Login"');
    expect(loginBody).not.toContain("Continue with BetterAuth"); // old redirect button gone

    // /profile unauthenticated → redirect to /login
    const res3 = await worker.fetch(new Request("http://localhost/profile"));
    expect(res3.status).toBe(302);
    expect(res3.headers.get("location")).toBe("/login");

    // Apply the BetterAuth migration so the tables exist before first use.
    // In real projects users run `elm-ssr migrate` or wrangler handles D1 migrations.
    // The runtime opens app.db relative to import.meta.dir (the app root).
    {
      const { Database: Db } = await import("bun:sqlite");
      const migrationSql = await readFile(resolve(root, "auth-app/migrations/0001_init.sql"), "utf8");
      const db = new Db(resolve(root, "auth-app/app.db"));
      db.exec(migrationSql);
      db.close();
    }

    // Real E2E via our auth endpoints (which call BetterAuth internally).
    const signUpRes = await worker.fetch(new Request("http://localhost/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123", name: "Test User" }),
    }));
    expect(signUpRes.status).toBe(200);
    expect(await signUpRes.json()).toEqual({ ok: true });

    const signInRes = await worker.fetch(new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    }));
    expect(signInRes.status).toBe(200);

    // BetterAuth sets its session via Set-Cookie
    const rawCookie = signInRes.headers.get("set-cookie") ?? "";
    expect(rawCookie).toBeTruthy();
    const sessionCookie = rawCookie.split(";")[0];

    // /profile authenticated → 200 with user info
    const profileRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie: sessionCookie },
    }));
    expect(profileRes.status).toBe(200);
    const profileHtml = await profileRes.text();
    expect(profileHtml).toContain("test@example.com");
    expect(profileHtml).toContain("Sign out");

    // /profile with invalid cookie → redirect
    const corruptRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie: "better-auth.session_token=invalid" },
    }));
    expect(corruptRes.status).toBe(302);
    expect(corruptRes.headers.get("location")).toBe("/login");

    // Logout via our endpoint (destroys elm-ssr session, sessionMiddleware clears cookie)
    const signOutRes = await worker.fetch(new Request("http://localhost/api/auth/logout", {
      headers: { cookie: sessionCookie },
    }));
    expect(signOutRes.status).toBe(302);

    // /profile after sign-out → redirect
    const postSignOutRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie: sessionCookie },
    }));
    expect(postSignOutRes.status).toBe(302);
    expect(postSignOutRes.headers.get("location")).toBe("/login");

    // ── Route isolation ────────────────────────────────────────────────────────
    // /api/auth/* must be handled by BetterAuth (or our intercept), NOT by elm-ssr.
    // BetterAuth returns 404 with an EMPTY body for unregistered routes.
    // elm-ssr returns 404 with HTML (the Elm NotFound page).
    // This assertion proves the intercept is active and routes reach BetterAuth.
    const unknownAuthRes = await worker.fetch(
      new Request("http://localhost/api/auth/this-route-does-not-exist")
    );
    expect(unknownAuthRes.status).toBe(404);
    expect(await unknownAuthRes.text()).toBe(""); // BetterAuth empty body, not elm-ssr HTML

    // /api/auth/dash/* — BetterAuth's online dashboard calls these endpoints to
    // manage the instance. They are NOT in BetterAuth's npm package and must be
    // handled by our middleware. Without them the dashboard retries until timeout.

    // validate: confirm the server is reachable before saving config changes
    const dashValidateRes = await worker.fetch(
      new Request("http://localhost/api/auth/dash/validate")
    );
    expect(dashValidateRes.status).toBe(200);
    expect(await dashValidateRes.json()).toEqual({ ok: true });

    // validate: challenge-response variant
    const challengeRes = await worker.fetch(
      new Request("http://localhost/api/auth/dash/validate?challenge=abc123")
    );
    expect(challengeRes.status).toBe(200);
    expect(await challengeRes.text()).toBe("abc123");

    // config: dashboard loads auth config after validate succeeds
    const dashConfigRes = await worker.fetch(
      new Request("http://localhost/api/auth/dash/config")
    );
    expect(dashConfigRes.status).toBe(200);
    const dashConfig = await dashConfigRes.json() as { ok: boolean; baseURL: string };
    expect(dashConfig.ok).toBe(true);
    expect(dashConfig.baseURL).toBeTruthy();

    // any other /dash/* endpoint: also returns 200 (future-proof)
    const dashOtherRes = await worker.fetch(
      new Request("http://localhost/api/auth/dash/unknown-future-endpoint")
    );
    expect(dashOtherRes.status).toBe(200);

    // GET /login — Elm SSR page with the Login island embedded.
    // No hardcoded HTML, no redirect — the island handles the form client-side.
    const loginPageRes = await worker.fetch(new Request("http://localhost/login"));
    expect(loginPageRes.status).toBe(200);
    expect(loginPageRes.headers.get("content-type")).toContain("text/html");
    const loginHtml = await loginPageRes.text();
    // Island marker must be present
    expect(loginHtml).toContain("elm-ssr-island");
    expect(loginHtml).toContain('"Login"');   // island name in data attribute
    // Elm page title
    expect(loginHtml).toContain("Sign in");

    // /api/auth/get-session returns 200 with null (no session) — proves BetterAuth
    // processed the request rather than elm-ssr returning 404.
    const noSessionRes = await worker.fetch(
      new Request("http://localhost/api/auth/get-session")
    );
    expect(noSessionRes.status).toBe(200);
    expect(await noSessionRes.json()).toBeNull();

    // CSRF is skipped for /api/auth/* (skipPaths config). A POST to our sign-in endpoint
    // must succeed — if CSRF middleware was not skipped it would return 403.
    const csrfCheckRes = await worker.fetch(new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    }));
    expect(csrfCheckRes.status).toBe(200); // 403 would mean CSRF fired incorrectly
    expect(await csrfCheckRes.json()).toEqual({ ok: true });

    // ── Error cases ────────────────────────────────────────────────────────────
    // Wrong password → 401 proxied from BetterAuth
    const wrongPwdRes = await worker.fetch(new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "wrong-password" }),
    }));
    expect(wrongPwdRes.status).toBe(401);
    const wrongPwdBody = await wrongPwdRes.json() as { ok: boolean; message: string };
    expect(wrongPwdBody.ok).toBe(false);

    // Non-existent user → same 401 (BetterAuth doesn't leak user existence)
    const unknownUserRes = await worker.fetch(new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
    }));
    expect(unknownUserRes.status).toBe(401);

    // Duplicate sign-up → 422 proxied from BetterAuth
    const dupRes = await worker.fetch(new Request("http://localhost/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123", name: "Dupe" }),
    }));
    expect(dupRes.status).toBe(422);
    const dupBody = await dupRes.json() as { ok: boolean; message: string };
    expect(dupBody.ok).toBe(false);

    // Invalid auth provider
    const badCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "bad-app", "--auth", "invalid-auth-provider", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    expect(await badCommand.exited).toBe(1);
    const stderr = await new Response(badCommand.stderr).text();
    expect(stderr).toContain("Error: --auth only supports 'betterAuth' or 'auth0'");
  }, 30000);

  it("scaffolds a single-app project using 'init --auth betterAuth' and compiles/fetches successfully", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);
    await linkNodeModules(root);

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "init", "single-auth", "--auth", "betterAuth", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    expect(await command.exited).toBe(0);

    const appDir = resolve(root, "single-auth");
    await symlink(resolve(process.cwd(), "node_modules"), resolve(appDir, "node_modules"), "dir");
    await symlink(resolve(process.cwd(), ".elm-home"), resolve(appDir, ".elm-home"), "dir");

    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", appDir],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    const buildCode = await buildCommand.exited;
    if (buildCode !== 0) {
      console.error("Build stderr:", await new Response(buildCommand.stderr).text());
    }
    expect(buildCode).toBe(0);

    const runtimePath = resolve(appDir, "runtime.ts");
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    expect((await worker.fetch(new Request("http://localhost/"))).status).toBe(200);
    const initLoginRes = await worker.fetch(new Request("http://localhost/login"));
    expect(initLoginRes.status).toBe(200);
    expect(await initLoginRes.text()).toContain("elm-ssr-island"); // Login island embedded
    expect((await worker.fetch(new Request("http://localhost/profile"))).status).toBe(302);

    // Apply the BetterAuth migration for local dev
    {
      const { Database: Db } = await import("bun:sqlite");
      const migrationSql = await readFile(resolve(appDir, "migrations/0001_init.sql"), "utf8");
      const db = new Db(resolve(appDir, "app.db"));
      db.exec(migrationSql);
      db.close();
    }

    // E2E: sign-up → sign-in → profile → logout via our auth endpoints
    await worker.fetch(new Request("http://localhost/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "init@example.com", password: "password123", name: "Init User" }),
    }));

    const signInRes = await worker.fetch(new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "init@example.com", password: "password123" }),
    }));
    expect(signInRes.status).toBe(200);
    expect(await signInRes.json()).toEqual({ ok: true });
    // elm-ssr sessionMiddleware sets the cookie on the response
    const cookie = signInRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^session=/);

    const profileRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie },
    }));
    expect(profileRes.status).toBe(200);

    const logoutRes = await worker.fetch(new Request("http://localhost/api/auth/logout", {
      headers: { cookie },
    }));
    expect(logoutRes.status).toBe(302);
  }, 30000);

  it("scaffolds a new app with --auth auth0: builds and basic routes work", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);
    await linkNodeModules(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "auth0-app", "--auth", "auth0", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    expect(await command.exited).toBe(0);

    // Verify generated file structure
    const authTs = await readFile(resolve(root, "auth0-app/src/Endpoints/Auth.ts"), "utf8");
    expect(authTs).not.toContain('from "better-auth"');
    expect(authTs).toContain("export interface AuthUser");       // shared contract
    expect(authTs).toContain("export const setAuthUser");
    expect(authTs).toContain("export const getPendingOAuth");    // state validation helper
    expect(authTs).toContain("export const auth0Provider");      // provider factory
    expect(authTs).toContain("/authorize");         // real OAuth2 redirect
    expect(authTs).toContain("/oauth/token");       // real token exchange
    expect(authTs).toContain("/api/auth/callback"); // callback route
    expect(authTs).not.toContain('"Auth0 User"');   // no hardcoded mock user

    const migration = await readFile(resolve(root, "auth0-app/migrations/0001_init.sql"), "utf8");
    expect(migration).toContain("id TEXT NOT NULL PRIMARY KEY"); // auth0 sub as TEXT id
    expect(migration).toContain("picture");

    const devVars = await readFile(resolve(root, "auth0-app/.dev.vars"), "utf8");
    expect(devVars).toContain("AUTH0_DOMAIN=");
    expect(devVars).toContain("AUTH0_CLIENT_ID=");
    expect(devVars).toContain("SESSION_SECRET=");

    const runtime = await readFile(resolve(root, "auth0-app/runtime.ts"), "utf8");
    expect(runtime).toContain("composeAuthProviders");
    expect(runtime).toContain("auth0Provider");
    expect(runtime).toContain("middlewares: [authMiddleware]");
    expect(runtime).toContain("sessions:");
    expect(runtime).toContain("sessionStore");
    expect(runtime).toContain('skipPaths: ["/api/auth/"]');
    expect(runtime).not.toContain("baseWorkerFetch");
    expect(runtime).not.toContain("isNew = false");

    // Elm build
    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
    );
    expect(await buildCommand.exited).toBe(0);

    const runtimePath = resolve(root, "auth0-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { worker, sessionStore } = (await import(runtimePath)) as { worker: any; sessionStore: any };
    expect(worker).toBeDefined();
    expect(sessionStore).toBeDefined();

    // Basic routes
    expect((await worker.fetch(new Request("http://localhost/"))).status).toBe(200);
    expect((await worker.fetch(new Request("http://localhost/login"))).status).toBe(200);

    // /profile unauthenticated → redirect to /login
    const profileRes = await worker.fetch(new Request("http://localhost/profile"));
    expect(profileRes.status).toBe(302);
    expect(profileRes.headers.get("location")).toBe("/login");

    // /api/auth/login without credentials configured → clear 500 error message
    const loginRes = await worker.fetch(new Request("http://localhost/api/auth/login"));
    expect(loginRes.status).toBe(500);
    expect(await loginRes.text()).toContain("AUTH0_DOMAIN");

    // ── Full OAuth2 flow via Bun mock server ───────────────────────────────────
    // Spin up a local HTTP server that mimics Auth0's token + userinfo endpoints.
    // The generated handler uses http:// for localhost domains so no TLS needed.
    // No JWT decoding — user is validated via the userinfo endpoint (server-to-server).

    const mockAuth0 = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/oauth/token") {
          const body = await req.json() as { code?: string };
          if (body.code !== "valid-code") {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          return Response.json({ access_token: "mock-access-token" });
        }
        // userinfo: validates the access token server-to-server (no JWT decode)
        if (req.method === "GET" && url.pathname === "/userinfo") {
          if (req.headers.get("authorization") !== "Bearer mock-access-token") {
            return Response.json({ error: "unauthorized" }, { status: 401 });
          }
          return Response.json({ sub: "auth0|mock123", email: "oauth@example.com", name: "OAuth User" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const mockDomain = `localhost:${mockAuth0.port}`;
      const mockEnv = {
        AUTH0_DOMAIN: mockDomain,
        AUTH0_CLIENT_ID: "mock-client-id",
        AUTH0_CLIENT_SECRET: "mock-client-secret",
        AUTH0_CALLBACK_URL: "http://localhost:8787/api/auth/callback",
        SESSION_SECRET: "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
      };

      // 1. Login → 302 to Auth0 authorize URL with state param (CSRF protection)
      const mockLoginRes = await worker.fetch(
        new Request("http://localhost:8787/api/auth/login"),
        mockEnv
      );
      expect(mockLoginRes.status).toBe(302);
      const authorizeUrl = new URL(mockLoginRes.headers.get("location") ?? "");
      expect(authorizeUrl.hostname).toBe("localhost");
      expect(authorizeUrl.pathname).toBe("/authorize");
      expect(authorizeUrl.searchParams.get("client_id")).toBe("mock-client-id");
      expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
      expect(authorizeUrl.searchParams.get("scope")).toBe("openid profile email");
      const state = authorizeUrl.searchParams.get("state");
      expect(state).toBeTruthy(); // state is set for CSRF protection
      // elm-ssr session cookie is set with pending OAuth state
      const loginSessionCookie = (mockLoginRes.headers.get("set-cookie") ?? "").split(";")[0];
      expect(loginSessionCookie).toMatch(/^session=/);

      // 2. Callback with valid code + correct state → userinfo validated → /profile
      const callbackRes = await worker.fetch(
        new Request(`http://localhost:8787/api/auth/callback?code=valid-code&state=${state}`, {
          headers: { cookie: loginSessionCookie },
        }),
        mockEnv
      );
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get("location")).toBe("/profile");
      const oauthCookie = (callbackRes.headers.get("set-cookie") ?? "").split(";")[0];
      expect(oauthCookie).toMatch(/^session=/);

      // 3. Authenticated /profile → 200 with user from Auth0 userinfo
      const oauthProfileRes = await worker.fetch(
        new Request("http://localhost:8787/profile", { headers: { cookie: oauthCookie } }),
        mockEnv
      );
      expect(oauthProfileRes.status).toBe(200);
      const oauthHtml = await oauthProfileRes.text();
      expect(oauthHtml).toContain("oauth@example.com");
      expect(oauthHtml).toContain("Sign out");

      // 4. Callback with wrong state → rejected (CSRF protection)
      const wrongStateRes = await worker.fetch(
        new Request(`http://localhost:8787/api/auth/callback?code=valid-code&state=wrong-state`, {
          headers: { cookie: loginSessionCookie },
        }),
        mockEnv
      );
      expect(wrongStateRes.status).toBe(400);

      // 5. Callback with invalid code → token exchange fails → 502
      const freshLoginRes = await worker.fetch(
        new Request("http://localhost:8787/api/auth/login"), mockEnv
      );
      const freshState = new URL(freshLoginRes.headers.get("location") ?? "").searchParams.get("state");
      const freshCookie = (freshLoginRes.headers.get("set-cookie") ?? "").split(";")[0];
      const badCallbackRes = await worker.fetch(
        new Request(`http://localhost:8787/api/auth/callback?code=bad-code&state=${freshState}`, {
          headers: { cookie: freshCookie },
        }),
        mockEnv
      );
      expect(badCallbackRes.status).toBe(502);

      // 6. Logout → elm-ssr session cleared + redirect to Auth0 OIDC logout
      const mockLogoutRes = await worker.fetch(
        new Request("http://localhost:8787/api/auth/logout", { headers: { cookie: oauthCookie } }),
        mockEnv
      );
      expect(mockLogoutRes.status).toBe(302);
      const logoutUrl = new URL(mockLogoutRes.headers.get("location") ?? "");
      expect(logoutUrl.hostname).toBe("localhost");
      expect(logoutUrl.pathname).toBe("/oidc/logout");
      expect(logoutUrl.searchParams.get("client_id")).toBe("mock-client-id");
      // elm-ssr sessionMiddleware clears the cookie (Set-Cookie: session=; Max-Age=0)
      expect(mockLogoutRes.headers.get("set-cookie")).toContain("session=;");

      // 7. After logout: old cookie no longer grants access
      const postLogoutRes = await worker.fetch(
        new Request("http://localhost:8787/profile", { headers: { cookie: oauthCookie } }),
        mockEnv
      );
      expect(postLogoutRes.status).toBe(302);
      expect(postLogoutRes.headers.get("location")).toBe("/login");
    } finally {
      mockAuth0.stop();
    }

    // ── Authenticated session lifecycle ────────────────────────────────────────
    // We can't call real Auth0 without credentials, so we seed a session directly.
    // This validates the full middleware path: session middleware reads cookie,
    // Elm requireUser sees user data, logout clears the store entry.
    const { generateSessionId, generateCsrfToken, signValue } = await import("elm-ssr/sessions");
    const sessionId = generateSessionId();
    const secret = "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars";
    // Seed with the AuthSessionData shape setAuthUser() produces:
    // { user: AuthUser | null, auth?: { pendingOAuth?: ... } }
    await sessionStore.set(sessionId, {
      data: { user: { email: "auth0user@example.com", name: "Auth0 User", provider: "auth0" } },
      csrf: generateCsrfToken(),
    });
    const signed = await signValue(secret, sessionId);
    const sessionCookie = `session=${signed}`;

    // Authenticated /profile → 200 with user info
    const authedProfileRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie: sessionCookie },
    }));
    expect(authedProfileRes.status).toBe(200);
    const authedHtml = await authedProfileRes.text();
    expect(authedHtml).toContain("auth0user@example.com");
    expect(authedHtml).toContain("Sign out");

    // /api/auth/logout → clears session cookie (302 to Auth0 logout URL)
    const logoutRes = await worker.fetch(new Request("http://localhost/api/auth/logout", {
      headers: { cookie: sessionCookie },
    }));
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get("set-cookie")).toContain("session=;");

    // After logout: same cookie no longer grants access
    const postLogoutRes = await worker.fetch(new Request("http://localhost/profile", {
      headers: { cookie: sessionCookie },
    }));
    expect(postLogoutRes.status).toBe(302);
    expect(postLogoutRes.headers.get("location")).toBe("/login");
  }, 20000);

  it("scaffolds a new app with --tailwind option and verifies config and file generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-tailwind-"));
    tempRoots.push(root);
    await linkNodeModules(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "tailwind-app", "--tailwind", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await command.exited).toBe(0);

    // Verify config entry contains tailwind: true
    const configContent = await readFile(resolve(root, "elm-ssr.config.json"), "utf8");
    const parsedConfig = JSON.parse(configContent);
    expect(parsedConfig.apps[0].tailwind).toBe(true);

    // Verify app.css was created with Tailwind directives
    const appCss = await readFile(resolve(root, "tailwind-app/src/app.css"), "utf8");
    expect(appCss).toContain("@tailwind base;");
    expect(appCss).toContain("@tailwind components;");
    expect(appCss).toContain("@tailwind utilities;");
  });
});

