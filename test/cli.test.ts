import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("elm-ssr CLI", () => {
  it("scaffolds a new example app and registers it", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-cli-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    const command = Bun.spawn(
      [
        "bun",
        "packages/cli/bin/elm-ssr.mjs",
        "new",
        "hello-world",
        "--root",
        root
      ],
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
        root: "examples/hello-world",
        module: "HelloWorld"
      }
    ]);

    await stat(resolve(root, "examples/hello-world/elm.json"));
    await stat(resolve(root, "examples/hello-world/runtime.ts"));
    await stat(resolve(root, "examples/hello-world/src/HelloWorld/View/Shared.elm"));
    await stat(resolve(root, "examples/hello-world/src/HelloWorld/Routes/Index.elm"));
    await stat(resolve(root, "examples/hello-world/src/HelloWorld/Routes/Counter.elm"));
    await stat(resolve(root, "examples/hello-world/src/HelloWorld/Routes/NotFound.elm"));
    await stat(resolve(root, "examples/hello-world/src/HelloWorld/Islands/Counter.elm"));
  });
});
