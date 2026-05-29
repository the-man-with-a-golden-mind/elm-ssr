import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const projectRoot = new URL("../", import.meta.url);
const rootPath = projectRoot.pathname;
const elmBinary = resolve(rootPath, "node_modules/.bin/elm");
const elmHome = resolve(rootPath, ".elm-home");
const configPath = resolve(rootPath, "elm-ssr.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

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

// A file/dir name ending in `_` is a dynamic segment: `Slug_` -> param "slug",
// matched by binding `p_slug`. Anything else is a lowercased literal segment.
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

  if (dynamic.length === 0) {
    return "request";
  }

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

      // The page-side embed names the island; the client registry keys it by
      // module path. They must agree or the marker won't mount, so check it
      // at build time rather than letting it fail silently in the browser.
      const source = await readFile(file, "utf8");
      const declared = source.match(/\.embed\s+"([^"]+)"/);

      if (!declared) {
        throw new Error(
          `Island ${moduleName} must expose an embed defined with Island.embed "${key}" { init = .., view = .., encodeFlags = .. }.`
        );
      }

      if (declared[1] !== key) {
        throw new Error(
          `Island ${moduleName} declares Island.embed "${declared[1]}" but its module path requires "${key}". Rename one to match.`
        );
      }

      return { moduleName, alias, key, file };
    })
  );
};

const generateMain = (routes) => {
  const fallback = routes.find((route) => route.isFallback);
  // Static-heavier routes must be tried before dynamic ones, so a literal
  // segment wins over a capture at the same position (e.g. /posts/new before
  // /posts/:slug).
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
  ]
    .sort()
    .join("\n");

  const routerArm = (route) => {
    const pattern = segmentPattern(route.segments);
    const request = requestExpression(route.segments);
    const argument = request === "request" ? "request" : `(${request})`;

    return `        ${pattern} ->\n            ${route.alias}.page ${argument}`;
  };

  const actionArm = (route) => {
    const pattern = segmentPattern(route.segments);
    const request = requestExpression(route.segments);
    const argument = request === "request" ? "request" : `(${request})`;

    return `        ${pattern} ->\n            ${route.alias}.action ${argument}`;
  };

  const fallbackArm = fallback
    ? `        _ ->\n            ${fallback.alias}.page request`
    : `        _ ->\n            Loader.fail 404 "Not found"`;

  const actionFallbackArm = fallback
    ? `        _ ->\n            ${fallback.alias}.action request`
    : `        _ ->\n            Action.fail 404 "Not found"`;

  const router =
    "router : Request -> Loader (Document Never)\nrouter request =\n    case Route.segments request of\n"
    + [...matched.map(routerArm), fallbackArm].join("\n\n");

  const actionRouter =
    "action : Request -> Action (Document Never)\naction request =\n    case Route.segments request of\n"
    + [...matched.map(actionArm), actionFallbackArm].join("\n\n");

  return `port module Main exposing (main)

-- This module is generated by scripts/build-elm.mjs from the route modules in
-- src/<App>/Routes. Do not edit it by hand. Every route is a stateless page;
-- interactivity lives in islands.

${imports}


port effectRequest : Encode.Value -> Cmd msg


port effectResult : (Decode.Value -> msg) -> Sub msg


port rendered : Encode.Value -> Cmd msg


port start : (Decode.Value -> msg) -> Sub msg


${router}


${actionRouter}


main : Program Decode.Value Runtime.State Runtime.Msg
main =
    Runtime.program
        { router = router
        , action = action
        , ports =
            { effectRequest = effectRequest
            , effectResult = effectResult
            , rendered = rendered
            , start = start
            }
        }
`;
};

const generateIslandsManifestModule = (islands) => {
  if (islands.length === 0) {
    return "export const islands = {};\nexport const bundleSource = \"\";\n";
  }

  const entries = islands
    .map(
      (island) =>
        `  "${island.key}": { module: "${island.moduleName}" }`
    )
    .join(",\n");

  return `import bundleSource from "./islands-source";

export const islands = {
${entries}
};

export { bundleSource };
`;
};

const compileEntrypoint = async ({ cwd, entrypoint, outputDir, outputName }) => {
  const rawOutputPath = resolve(outputDir, `${outputName}.raw.js`);
  const finalOutputPath = resolve(outputDir, `${outputName}.mjs`);
  const sourceModulePath = resolve(outputDir, `${outputName}-source.ts`);

  const entrypoints = Array.isArray(entrypoint) ? entrypoint : [entrypoint];

  await mkdir(dirname(rawOutputPath), { recursive: true });

  const build = Bun.spawn(
    [elmBinary, "make", ...entrypoints, "--optimize", "--output", rawOutputPath],
    {
      cwd,
      env: { ...process.env, ELM_HOME: elmHome },
      stdout: "inherit",
      stderr: "inherit"
    }
  );

  const exitCode = await build.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  const compiledSource = await readFile(rawOutputPath, "utf8");
  const esmSource = compiledSource.replace(/\}\(this\)\);?\s*$/, "}(globalThis));\n")
    + "\nconst Elm = globalThis.Elm;\nexport { Elm };\nexport default Elm;\n";

  await writeFile(finalOutputPath, esmSource, "utf8");
  await writeFile(sourceModulePath, `const source = ${JSON.stringify(esmSource)};\nexport default source;\n`, "utf8");

  // PRE-COMPRESSION
  const compressed = gzipSync(Buffer.from(esmSource, "utf8"));
  await writeFile(`${finalOutputPath}.gz`, compressed);

  await rm(rawOutputPath, { force: true });
};

await mkdir(elmHome, { recursive: true });

for (const appConfig of config.apps) {
  const exampleRoot = resolve(rootPath, appConfig.root);
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
  await mkdir(outputDir, { recursive: true });

  await rm(resolve(wrapperDir, "Generated"), { recursive: true, force: true });
  await rm(resolve(wrapperDir, "Islands.elm"), { force: true });
  // Legacy per-island bundles are no longer emitted (one combined bundle now).
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
