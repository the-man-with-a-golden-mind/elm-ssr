import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Hybrid Elm codegen for scaffold content (makes templates type-safe, debuggable, and controllable in Elm).
// The JS side only handles orchestration, FS, and non-Elm files.
let elmApp = null;
let pending = null;

async function initElmCodegen() {
  if (elmApp) return elmApp;

  const mod = await import("../scaffold-codegen.mjs");
  elmApp = mod.Elm.Scaffold.init({ flags: {} });

  elmApp.ports.response.subscribe((result) => {
    if (pending) {
      const { resolve, reject, timeout } = pending;
      clearTimeout(timeout);
      pending = null;
      if (result && result.content) {
        resolve(result.content);
      } else if (result && result.error) {
        reject(new Error(result.error));
      } else {
        resolve("");
      }
    }
  });

  return elmApp;
}

export async function generateWithElm(kind, spec) {
  const validKinds = ["page", "api", "resource"];
  if (!validKinds.includes(kind)) {
    throw new Error(`Invalid scaffold kind "${kind}". Supported: ${validKinds.join(", ")}`);
  }
  if (!spec || typeof spec.namespace !== "string" || typeof spec.routePath !== "string") {
    throw new Error("Invalid spec for scaffold codegen. Required: namespace, routePath, etc.");
  }

  if (pending) {
    // serialize if multiple calls (rare)
    await new Promise(r => setTimeout(r, 10));
  }

  const app = await initElmCodegen();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending = null;
      reject(new Error("Elm scaffold generation timed out"));
    }, 5000);

    pending = { resolve, reject, timeout };
    app.ports.request.send({ kind, spec });
  });
}

// Helper to (re)build the codegen if needed. Can be called manually or from CI.
// **Never throws** - critical for test/CI environments. Logs warnings on problems.
// Rebuilds when the output is missing OR when packages/elm-ssr/codegen/Scaffold.elm is newer (mtime).
export async function ensureScaffoldCodegen() {
  const thisDir = new URL(".", import.meta.url).pathname;
  const codegenPath = resolve(thisDir, "../scaffold-codegen.mjs");
  const sourcePath = resolve(thisDir, "../../codegen/Scaffold.elm");

  let needsBuild = false;
  try {
    const outStat = await stat(codegenPath);
    const srcStat = await stat(sourcePath);
    if (srcStat.mtimeMs > outStat.mtimeMs) {
      needsBuild = true;
    }
  } catch {
    // missing output or source → will (re)build
    needsBuild = true;
  }

  if (!needsBuild) return;

  console.log("[elm-ssr] Building Elm scaffold codegen...");

  try {
    const { spawn } = await import("node:child_process");
    const codegenDir = resolve(thisDir, "../../codegen");
    const elmBin = "elm";

    const compile = spawn(elmBin, ["make", "Scaffold.elm", "--optimize", "--output", "raw-codegen.js"], {
      cwd: codegenDir,
      stdio: "inherit"
    });

    await new Promise((res, rej) => {
      compile.on("close", (code) => (code === 0 ? res() : rej(new Error(`elm exited ${code}`))));
      compile.on("error", (e) => rej(e));
    });

    const rawPath = resolve(codegenDir, "raw-codegen.js");
    let src = await readFile(rawPath, "utf8");
    src = src.replace(/\}\(this\)\);?\s*$/, "}(globalThis));\n");
    src += "\nconst Elm = globalThis.Elm;\nexport { Elm };\n";
    await writeFile(codegenPath, src, "utf8");

    console.log("[elm-ssr] Scaffold codegen built.");
  } catch (err) {
    // Do not throw to callers. This is best-effort.
    console.warn("[elm-ssr] ensureScaffoldCodegen warning (non-fatal):", err?.message || err);
  }
}
