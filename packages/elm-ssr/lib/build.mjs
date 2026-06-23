import { mkdir, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// This lib is part of elm-ssr. It handles generating Main.elm and 
// compiling the route apps and island bundles.

export const build = async ({ rootPath, config }) => {
  const cliRoot = resolve(new URL("..", import.meta.url).pathname);
  
  // Try to find elm in local node_modules first (for monorepo/dev), then fall back to global 'elm'
  let elmBinary = "elm";
  try {
    const localElm = resolve(rootPath, "node_modules", ".bin", "elm");
    await readFile(localElm); // Check if exists
    elmBinary = localElm;
  } catch {
    // fall back to "elm" in PATH
  }

  const elmHome = resolve(rootPath, ".elm-home");

  const moduleToPath = (moduleName) => moduleName.split(".").join("/");

  const walkElmFiles = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkElmFiles(full)));
      } else if (entry.isFile() && entry.name.endsWith(".elm")) {
        files.push(full);
      }
    }
    return files;
  };

  const parseSegment = (part) => {
    if (part.endsWith("_")) {
      const name = part.slice(0, -1).toLowerCase();
      return { kind: "dynamic", name, binding: `p_${name}` };
    }
    return { kind: "static", value: part.toLowerCase() };
  };

  const segmentPattern = (segments) =>
    segments.length === 0
      ? "[]"
      : `[ ${segments.map((segment) => (segment.kind === "dynamic" ? segment.binding : `"${segment.value}"`)).join(", ")} ]`;

  const dynamicCount = (segments) => segments.filter((segment) => segment.kind === "dynamic").length;

  const requestExpression = (segments) => {
    const dynamic = segments.filter((segment) => segment.kind === "dynamic");
    if (dynamic.length === 0) return "request";
    const pairs = dynamic.map((segment) => `( "${segment.name}", ${segment.binding} )`).join(", ");
    return `{ request | params = [ ${pairs} ] }`;
  };

  const collectRoutes = async (namespace, routesDir) => {
    const files = (await walkElmFiles(routesDir)).sort();
    return files.map((file) => {
      const parts = relative(routesDir, file).replace(/\.elm$/, "").split("/");
      const last = parts[parts.length - 1];
      const isFallback = parts.length === 1 && last === "NotFound";
      const segmentParts = last === "Index" ? parts.slice(0, -1) : parts;
      return {
        moduleName: `${namespace}.Routes.${parts.join(".")}`,
        alias: parts.join("_"),
        isFallback,
        segments: segmentParts.map(parseSegment)
      };
    });
  };

  const collectIslands = async (namespace, islandsDir) => {
    const files = (await walkElmFiles(islandsDir)).sort();
    return Promise.all(
      files.map(async (file) => {
        const parts = relative(islandsDir, file).replace(/\.elm$/, "").split("/");
        const alias = parts.join("_");
        const key = alias;
        const moduleName = `${namespace}.Islands.${parts.join(".")}`;
        const source = await readFile(file, "utf8");
        const declared = source.match(/\.embed\s+"([^"]+)"/);
        if (!declared) {
          throw new Error(`Island ${moduleName} must expose an embed defined with Island.embed "${key}" { .. }.`);
        }
        if (declared[1] !== key) {
          throw new Error(`Island ${moduleName} declares Island.embed "${declared[1]}" but its module path requires "${key}".`);
        }
        return { moduleName, alias, key, file };
      })
    );
  };

  const generateMain = (routes) => {
    const fallback = routes.find((route) => route.isFallback);
    const matched = routes
      .filter((route) => !route.isFallback)
      .sort((left, right) => dynamicCount(left.segments) - dynamicCount(right.segments));

    const imports = [
      "import ElmSsr.Action as Action exposing (Action)",
      "import ElmSsr.Document exposing (Document)",
      "import ElmSsr.Loader as Loader exposing (Loader)",
      "import ElmSsr.Route as Route exposing (Request)",
      "import ElmSsr.Runtime as Runtime",
      ...routes.map((route) => `import ${route.moduleName} as ${route.alias}`),
      "import Json.Decode as Decode",
      "import Json.Encode as Encode"
    ].sort().join("\n");

    const routerArm = (route) => {
      const pattern = segmentPattern(route.segments);
      const request = requestExpression(route.segments);
      return `        ${pattern} ->\n            ${route.alias}.page ${request === "request" ? "request" : `(${request})`}`;
    };

    const actionArm = (route) => {
      const pattern = segmentPattern(route.segments);
      const request = requestExpression(route.segments);
      return `        ${pattern} ->\n            ${route.alias}.action ${request === "request" ? "request" : `(${request})`}`;
    };

    const fallbackArm = fallback ? `        _ ->\n            ${fallback.alias}.page request` : `        _ ->\n            Loader.fail 404 "Not found"`;
    const actionFallbackArm = fallback ? `        _ ->\n            ${fallback.alias}.action request` : `        _ ->\n            Action.fail 404 "Not found"`;

    return `port module Main exposing (main)
-- Generated by elm-ssr. Do not edit.
${imports}

port effectRequest : Encode.Value -> Cmd msg
port effectResult : (Decode.Value -> msg) -> Sub msg
port rendered : Encode.Value -> Cmd msg
port start : (Decode.Value -> msg) -> Sub msg

router : Request -> Loader (Document Never)
router request =
    case Route.segments request of
${[...matched.map(routerArm), fallbackArm].join("\n\n")}

action : Request -> Action (Document Never)
action request =
    case Route.segments request of
${[...matched.map(actionArm), actionFallbackArm].join("\n\n")}

main : Program Decode.Value Runtime.State Runtime.Msg
main =
    Runtime.program
        { router = router
        , action = action
        , ports = { effectRequest = effectRequest, effectResult = effectResult, rendered = rendered, start = start }
        }
`;
  };

  const generateIslandsManifestModule = (islands) => {
    if (islands.length === 0) return "export const islands = {};\nexport const bundleSource = \"\";\n";
    const entries = islands.map((island) => `  "${island.key}": { module: "${island.moduleName}" }`).join(",\n");
    return `import bundleSource from "./islands-source";\nexport const islands = {\n${entries}\n};\nexport { bundleSource };\n`;
  };

  const compileEntrypoint = async ({ cwd, entrypoint, outputDir, outputName }) => {
    const rawOutputPath = resolve(outputDir, `${outputName}.raw.js`);
    const finalOutputPath = resolve(outputDir, `${outputName}.mjs`);
    const sourceModulePath = resolve(outputDir, `${outputName}-source.ts`);
    const entrypoints = Array.isArray(entrypoint) ? entrypoint : [entrypoint];

    await mkdir(dirname(rawOutputPath), { recursive: true });

    const buildChild = Bun.spawn(
      [elmBinary, "make", ...entrypoints, "--optimize", "--output", rawOutputPath],
      {
        cwd,
        env: { ...process.env, ELM_HOME: elmHome },
        stdout: "inherit",
        stderr: "inherit"
      }
    );

    const exitCode = await buildChild.exited;
    if (exitCode !== 0) process.exit(exitCode);

    const compiledSource = await readFile(rawOutputPath, "utf8");
    const esmSource = compiledSource.replace(/\}\(this\)\);?\s*$/, "}(globalThis));\n")
      + "\nconst Elm = globalThis.Elm;\nexport { Elm };\nexport default Elm;\n";

    await writeFile(finalOutputPath, esmSource, "utf8");
    await writeFile(sourceModulePath, `const source = ${JSON.stringify(esmSource)};\nexport default source;\n`, "utf8");
    const compressed = gzipSync(Buffer.from(esmSource, "utf8"));
    await writeFile(`${finalOutputPath}.gz`, compressed);
    await rm(rawOutputPath, { force: true });
  };

const findLocalTailwind = async (startDir) => {
  let current = resolve(startDir);
  while (true) {
    const candidate = resolve(current, "node_modules", ".bin", "tailwindcss");
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // ignore
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

  const compileStylesheet = async ({ inputPath, outputPath, appConfig, appRoot }) => {
    try {
      await stat(inputPath);
    } catch {
      return;
    }

    let css = "";
    const isTailwindEnabled = appConfig.tailwind === true;

    if (isTailwindEnabled) {
      try {
        console.log(`[elm-ssr] Compiling Tailwind CSS for app "${appConfig.name}"...`);
        const contentGlob = "src/**/*.elm,src/**/*.ts,src/**/*.js";
        
        let tailwindBin = await findLocalTailwind(rootPath);
        if (!tailwindBin) {
          tailwindBin = await findLocalTailwind(cliRoot);
        }
        const binCommand = tailwindBin ? tailwindBin : "npx --yes tailwindcss";

        const command = `${binCommand} -i ${inputPath} --content "${contentGlob}" --minify`;
        const { stdout } = await execAsync(command, { cwd: appRoot });
        css = stdout.toString().trim();
      } catch (err) {
        console.warn(`[elm-ssr] Tailwind CSS compilation failed. Falling back to plain CSS read. Error:`, err.message);
        const raw = await readFile(inputPath, "utf8");
        css = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      }
    } else {
      const raw = await readFile(inputPath, "utf8");
      css = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
    }

    const tsContent = `export const stylesheet = \`${css.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`;\n`;
    await writeFile(outputPath, tsContent, "utf8");
  };

  await mkdir(elmHome, { recursive: true });

  for (const appConfig of config.apps) {
    const exampleRoot = resolve(rootPath, appConfig.root);
    await compileStylesheet({
      inputPath: resolve(exampleRoot, "src", "app.css"),
      outputPath: resolve(exampleRoot, "styles.ts"),
      appConfig,
      appRoot: exampleRoot
    });
    const namespace = appConfig.module;
    const namespacePath = resolve(exampleRoot, "src", moduleToPath(namespace));
    const routes = await collectRoutes(namespace, resolve(namespacePath, "Routes"));
    const islands = await collectIslands(namespace, resolve(namespacePath, "Islands"));

    if (routes.length === 0) {
      console.error(`No route modules found under ${resolve(namespacePath, "Routes")}`);
      process.exit(1);
    }

    const wrapperDir = resolve(exampleRoot, ".elm-ssr");
    const outputDir = resolve(rootPath, "generated", appConfig.root);

    await mkdir(wrapperDir, { recursive: true });
    
    // Sync ElmSsr source files from the CLI package to the project
    const elmSsrSource = resolve(cliRoot, "elm-src");
    const targetSourceDir = resolve(wrapperDir, "src");
    await mkdir(targetSourceDir, { recursive: true });
    
    const sync = Bun.spawn(["cp", "-r", `${elmSsrSource}/.`, targetSourceDir], {
      stdout: "inherit",
      stderr: "inherit"
    });
    await sync.exited;

    await mkdir(outputDir, { recursive: true });
    await rm(resolve(wrapperDir, "Generated"), { recursive: true, force: true });
    await rm(resolve(wrapperDir, "Islands.elm"), { force: true });
    await rm(resolve(outputDir, "islands"), { recursive: true, force: true });

    await writeFile(resolve(wrapperDir, "Main.elm"), generateMain(routes), "utf8");

    await compileEntrypoint({
      cwd: exampleRoot,
      entrypoint: resolve(wrapperDir, "Main.elm"),
      outputDir,
      outputName: "app"
    });

    if (islands.length > 0) {
      await compileEntrypoint({
        cwd: exampleRoot,
        entrypoint: islands.map((island) => island.file),
        outputDir,
        outputName: "islands"
      });
    }
    await writeFile(resolve(outputDir, "islands-manifest.ts"), generateIslandsManifestModule(islands), "utf8");
  }
};
