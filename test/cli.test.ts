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
});
