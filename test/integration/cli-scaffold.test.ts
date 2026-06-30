import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { redis, SQL } from "bun";
import { defaultEffectRunner } from "elm-ssr/effects";
import { postgresSql, redisCache, withCache } from "elm-ssr/backends";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const shouldSkip = !DATABASE_URL || !REDIS_URL;
const integration = shouldSkip ? describe.skip : describe;

if (shouldSkip) {
  console.warn("Skipping integration cli-scaffold tests (no DATABASE_URL/REDIS_URL).");
}

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function linkNodeModules(root: string) {
  await symlink(
    resolve(process.cwd(), "node_modules"),
    join(root, "node_modules"),
    "dir"
  );
}

integration("integration: CLI Scaffold with Real Postgres", () => {
  let sql: SQL;

  beforeAll(() => {
    sql = new SQL(DATABASE_URL!);
  });

  afterAll(async () => {
    try {
      await sql.unsafe("DROP TABLE IF EXISTS users");
      await sql.unsafe("DROP TABLE IF EXISTS __elm_ssr_migrations");
    } finally {
      await sql.close();
    }
  });

  it("scaffolds a new --db app, runs migrations against Postgres, compiles, and fetches with real postgres adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-it-cli-"));
    tempRoots.push(root);
    await linkNodeModules(root);

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // 1. Scaffold a new db app
    const command = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "db-app", "--db", "--root", root],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await command.exited).toBe(0);

    const migrationPath = resolve(root, "db-app/migrations/0001_init.sql");
    await stat(migrationPath);

    // Convert SQLite AUTOINCREMENT to Postgres SERIAL
    let sqlContent = await readFile(migrationPath, "utf8");
    sqlContent = sqlContent.replace("id INTEGER PRIMARY KEY AUTOINCREMENT", "id SERIAL PRIMARY KEY");
    await writeFile(migrationPath, sqlContent, "utf8");

    // 2. Run migrations using CLI command against PostgreSQL
    const migrateCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "migrate", "up", "--db", DATABASE_URL!, "--dir", resolve(root, "db-app/migrations")],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await migrateCommand.exited).toBe(0);

    // Verify migration tracking table exists and has our migration
    const tracking = await sql.unsafe("SELECT name FROM __elm_ssr_migrations");
    expect(tracking.some((t: any) => t.name === "0001_init.sql")).toBe(true);

    // 3. Compile the application
    const buildCommand = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(await buildCommand.exited).toBe(0);

    // 4. Overwrite runtime.ts to use the real Postgres adapter
    const runtimePath = resolve(root, "db-app/runtime.ts");
    const customRuntime = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import { postgresSql } from "elm-ssr/backends";
import { SQL } from "bun";
import { islands, bundleSource } from "../generated/db-app/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error
import ElmRuntime from "../generated/db-app/app.mjs";

const sql = new SQL("${DATABASE_URL}");
const sqlHandler = postgresSql({
  run: async (query, params) => {
    const rows = await sql.unsafe(query, params as unknown[]);
    const rowsArray = Array.isArray(rows) ? rows : [...rows];
    const count = (rows as { count?: number }).count;
    return { rows: rowsArray, rowCount: typeof count === "number" ? count : rowsArray.length };
  }
});

const baseRunner = inMemoryEffects({
  env: { GREETING: "Hello from real Postgres Docker!" },
  sql: sqlHandler
});

export const worker = createWorkerApp({
  elmModule: ElmRuntime,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes: {
    pages: [
      { path: "/", methods: ["GET"], description: "Index" }
    ],
    assets: [],
    utility: [],
    api: []
  },
  createFlags: ({ request, path }) => {
    const [pathname, search = ""] = path.split("?");
    return {
      method: request?.method ?? "GET",
      path: pathname,
      query: Object.fromEntries(new URLSearchParams(search)),
      formData: {},
      env: { GREETING: "Hello from real Postgres Docker!" }
    };
  },
  effects: baseRunner
});
`;
    await writeFile(runtimePath, customRuntime, "utf8");

    // 5. Import the compiled worker dynamically and fetch
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The scaffolded Index always renders the hero; the greeting env is available via Route.env / Loader.env in other routes if used.
    expect(html).toContain("Ship fast.");
  }, 30000);
});
