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

describe("Zero-Config Tailwind & CSS Styling Pipeline", () => {
  it("compiles and minifies plain CSS when tailwind is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-styling-plain-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // Scaffold a new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "plain-app", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // Create src/app.css with comments and whitespace
    const appCss = `
      /* This is a comment that should be removed */
      .container {
        display: flex;
        justify-content: center;
      }
    `;
    await writeFile(resolve(root, "plain-app/src/app.css"), appCss, "utf8");

    // Build the plain-app (tailwind is not set to true)
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await buildCmd.exited).toBe(0);

    // Read the generated styles.ts
    const stylesPath = resolve(root, "plain-app/styles.ts");
    await stat(stylesPath);
    const stylesContent = await readFile(stylesPath, "utf8");

    expect(stylesContent).toContain("export const stylesheet = `");
    // Verify comments are stripped and spacing is minified
    expect(stylesContent).toContain(".container { display: flex; justify-content: center; }");
    expect(stylesContent).not.toContain("This is a comment");
  }, 60000);

  it("compiles Tailwind CSS and collects classes from Elm files", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-styling-tailwind-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // Scaffold a new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "tailwind-app", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // Modify config to set "tailwind": true
    const configPath = resolve(root, "elm-ssr.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.apps[0].tailwind = true;
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    // Create src/app.css with Tailwind directives
    const appCss = `
      @tailwind base;
      @tailwind components;
      @tailwind utilities;
      
      .my-custom-button {
        color: magenta;
      }
    `;
    await writeFile(resolve(root, "tailwind-app/src/app.css"), appCss, "utf8");

    // Modify index route to include Tailwind utility classes
    const indexPath = resolve(root, "tailwind-app/src/TailwindApp/Routes/Index.elm");
    let indexContent = await readFile(indexPath, "utf8");
    // Replace a class that exists in the new template with Tailwind utilities
    indexContent = indexContent.replace(
      `class "hero-title"`,
      `class "bg-red-500 font-extrabold my-custom-button hero-title"`
    );
    await writeFile(indexPath, indexContent, "utf8");

    // Build the tailwind-app
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await buildCmd.exited).toBe(0);

    // Read the generated styles.ts
    const stylesPath = resolve(root, "tailwind-app/styles.ts");
    await stat(stylesPath);
    const stylesContent = await readFile(stylesPath, "utf8");

    expect(stylesContent).toContain("export const stylesheet = `");
    // Verify that the custom class exists
    expect(stylesContent).toContain(".my-custom-button");
    // Verify that Tailwind compiled the bg-red-500 class used in the Elm file
    expect(stylesContent).toContain("bg-red-500");
    // Verify that Tailwind compiled the font-extrabold class used in the Elm file
    expect(stylesContent).toContain("font-extrabold");
  }, 60000);

  it("behaves correctly on border cases: empty css, missing css, and symbol escaping", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-styling-border-"));
    tempRoots.push(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // Scaffold a new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "border-app", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // Case 1: missing app.css. Build should succeed but styles.ts should NOT exist.
    const stylesPath = resolve(root, "border-app/styles.ts");
    await rm(stylesPath); // Delete scaffolded default styles.ts

    const buildCmd1 = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await buildCmd1.exited).toBe(0);
    let stylesExist = true;
    try {
      await stat(stylesPath);
    } catch {
      stylesExist = false;
    }
    expect(stylesExist).toBe(false);

    // Case 2: empty app.css. styles.ts should exist with empty stylesheet export.
    await writeFile(resolve(root, "border-app/src/app.css"), "", "utf8");
    const buildCmd2 = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await buildCmd2.exited).toBe(0);
    const stylesContent2 = await readFile(stylesPath, "utf8");
    expect(stylesContent2).toBe("export const stylesheet = ``;\n");

    // Case 3: app.css with backticks and dollar signs. They should be escaped correctly.
    const trickyCss = `
      .tricky::before {
        content: "\`hello\` \${world}";
      }
    `;
    await writeFile(resolve(root, "border-app/src/app.css"), trickyCss, "utf8");
    const buildCmd3 = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await buildCmd3.exited).toBe(0);
    const stylesContent3 = await readFile(stylesPath, "utf8");
    expect(stylesContent3).toContain("export const stylesheet = `.tricky::before { content: \"\\`hello\\` \\${world}\"; }`;\n");
  }, 60000);
});
