#!/usr/bin/env bun
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { runMigrations } from "../src/migrations.ts";

// Thin Bun.serve wrapper used by `elm-ssr dev` as the default local dev
// runtime (see bin/elm-ssr.mjs). Running the app directly under Bun — instead
// of always shelling out to `wrangler dev` — is what activates the
// bun:sqlite / DATABASE_URL code paths generated for --db and --auth apps:
// wrangler dev runs in workerd, which has no `Bun` global and, without a
// hand-configured D1 binding, no `env.DB` either, so those apps were silently
// falling back to in-memory storage. This file also auto-applies pending
// *.sql migrations against the resolved local sqlite file before serving, so
// a freshly scaffolded --auth app works the moment you run `bun run dev` —
// no separate manual migrate step required. (Production/Cloudflare D1 is
// intentionally NOT auto-migrated here — that only happens for the local Bun
// sqlite file this process itself resolves and controls.)

const appRootAbs = process.argv[2];
const port = Number.parseInt(process.argv[3] ?? "8787", 10);

if (!appRootAbs) {
  console.error("Usage: bun dev-server.mjs <appRootAbs> <port>");
  process.exit(1);
}

// wrangler dev auto-loads .dev.vars into env; replicate that here since this
// dev server bypasses wrangler entirely. Values already present in the host
// environment win, same precedence convention dotenv-style tools use.
const loadDevVars = async () => {
  let raw;
  try {
    raw = await readFile(resolve(appRootAbs, ".dev.vars"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
};

// Same DATABASE_URL convention as the generated runtime.ts/Auth.ts — keep all
// three (this migrator, the app's sqlHandler, BetterAuth's bunAuthDb)
// resolving to the exact same file so there is exactly one DB per environment,
// never an accidental split between "the DB migrations ran against" and "the
// DB the server actually opened".
const resolveDbPath = () => {
  const raw = process.env.DATABASE_URL || "";
  if (raw && !raw.startsWith("sqlite://") && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    console.error(
      `[elm-ssr] DATABASE_URL=${raw} is not a local sqlite target. Local Bun dev (bun:sqlite) can't ` +
        `open Postgres/MySQL/etc URLs directly. Use DATABASE_URL=sqlite://./app.db (or unset it for the ` +
        `default ./app.db); point 'elm-ssr migrate'/'elm-ssr query' and your production effects config at ` +
        `the real database separately.`
    );
    process.exit(1);
  }
  if (raw.startsWith("sqlite://")) return raw.slice("sqlite://".length);
  return raw || resolve(appRootAbs, "app.db");
};

const applyPendingMigrations = async (dbPath) => {
  const migrationsDir = resolve(appRootAbs, "migrations");
  try {
    await readdir(migrationsDir);
  } catch {
    return; // this app has no migrations/ dir — nothing to check
  }

  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL"); // shared file with runtime.ts/Auth.ts's own connections
  try {
    const adapter = {
      exec: async (sql) => {
        db.exec(sql);
      },
      list: async (sql) => db.query(sql).all()
    };
    const result = await runMigrations(adapter, { dir: migrationsDir });
    if (result.applied.length > 0) {
      console.log(
        `[elm-ssr] migrations: applied ${result.applied.length} pending — ${result.applied.join(", ")}`
      );
    } else {
      console.log(`[elm-ssr] migrations: up to date (${result.skipped.length} applied)`);
    }
  } catch (err) {
    console.error(`[elm-ssr] migration failed against sqlite:${dbPath}`);
    console.error(err);
    db.close();
    process.exit(1);
  }
  db.close();
};

console.log(`[elm-ssr] app: ${basename(appRootAbs)}`);
console.log("[elm-ssr] runtime: bun (local dev via `elm-ssr dev`)");

await loadDevVars();
await applyPendingMigrations(resolveDbPath());

delete globalThis.Elm; // fresh Elm registration per process
const { worker } = await import(resolve(appRootAbs, "runtime.ts"));

// Bun.serve's fetch callback receives (request, server) — pass a single-arg
// wrapper so that `server` never leaks into worker.fetch's optional `env`
// param (createWorkerApp treats a truthy 2nd arg as the real env and skips
// its process.env fallback).
const server = Bun.serve({ port, fetch: (request) => worker.fetch(request) });
console.log(`[elm-ssr] listening on http://localhost:${server.port}`);
