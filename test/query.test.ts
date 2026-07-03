import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Type-Safe Data Layer & Schema Generation (elm query)", () => {
  it("parses migrations and generates correct type-safe Elm data modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-query-"));
    tempRoots.push(root);

    await symlink(
      resolve(process.cwd(), "node_modules"),
      join(root, "node_modules"),
      "dir"
    );

    await symlink(
      resolve(process.cwd(), ".elm-home"),
      join(root, ".elm-home"),
      "dir"
    );

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // Scaffold a new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "db-app", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // Create a custom migration with a table definition
    const migrationSql = `
      -- Schema for testing query generator
      CREATE TABLE test_members (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        score REAL NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT 0,
        nickname TEXT,
        registered_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP)
      );
    `;
    const migrationsDir = resolve(root, "db-app/migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(resolve(migrationsDir, "0001_init.sql"), migrationSql, "utf8");

    // Run the query generation command
    const queryCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "query", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await queryCmd.exited).toBe(0);

    // Verify generated module exists
    const genPath = resolve(root, "db-app/src/DbApp/Db/TestMembers.elm");
    await stat(genPath);
    const elmContent = await readFile(genPath, "utf8");

    // Check module declaration and exposed items (Elmto canonical + compat)
    expect(elmContent).toContain("module DbApp.Db.TestMembers exposing");
    expect(elmContent).toContain("testMemberSchema");
    expect(elmContent).toContain("idCol");
    expect(elmContent).toContain("emailCol");
    expect(elmContent).toContain("scoreCol");
    expect(elmContent).toContain("isAdminCol");
    expect(elmContent).toContain("nicknameCol");
    expect(elmContent).toContain("registeredAtCol");
    expect(elmContent).toContain("TestMember");
    expect(elmContent).toContain("decoder");
    expect(elmContent).toContain("all");
    expect(elmContent).toContain("insert");
    expect(elmContent).toContain("byId");
    expect(elmContent).toContain("delete");
    expect(elmContent).toContain("update");

    // Verify Elmto schema and Column references (no more Dsl)
    expect(elmContent).toContain("import ElmSsr.Db.Elmto as Elmto");
    expect(elmContent).toContain("testMemberSchema : Elmto.Schema TestMember");
    expect(elmContent).toContain("Elmto.schema \"test_members\" decoder");
    expect(elmContent).toContain("idCol : Elmto.Column TestMember Int");
    expect(elmContent).toContain("idCol =\n    Elmto.column \"id\" Encode.int");
    expect(elmContent).toContain("emailCol : Elmto.Column TestMember String");
    expect(elmContent).toContain("scoreCol : Elmto.Column TestMember Float");

    // Verify record type definition
    expect(elmContent).toContain("type alias TestMember =");
    expect(elmContent).toContain("id : Int");
    expect(elmContent).toContain("email : String");
    expect(elmContent).toContain("score : Float");
    expect(elmContent).toContain("isAdmin : Bool");
    expect(elmContent).toContain("nickname : Maybe String");
    expect(elmContent).toContain("registeredAt : Maybe String");

    // Verify decoder mappings
    expect(elmContent).toContain("Decode.field \"id\" Decode.int");
    expect(elmContent).toContain("Decode.field \"email\" Decode.string");
    expect(elmContent).toContain("Decode.field \"score\" Decode.float");
    expect(elmContent).toContain("Decode.field \"is_admin\" boolDecoder");

    // Verify query builders (SELECT, INSERT...) remain
    expect(elmContent).toContain("SELECT id, email, score, is_admin, nickname, registered_at FROM test_members");
    expect(elmContent).toContain("byId idVal =");
    expect(elmContent).toContain("INSERT INTO test_members (email, score, nickname) VALUES (?, ?, ?)");
    expect(elmContent).toContain("delete idVal =");
    expect(elmContent).toContain("DELETE FROM test_members WHERE id = ?");
    expect(elmContent).toContain("update idVal params =");
    expect(elmContent).toContain("UPDATE test_members SET email = ?, score = ?, is_admin = ?, nickname = ?, registered_at = ? WHERE id = ?");

    // Write a test page route that uses the generated module (Elmto + compat)
    const testRouteContent = `module DbApp.Routes.TestDsl exposing (page, action)

import DbApp.Db.TestMembers as TestMembers
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo
import ElmSsr.Db.Elmto.Compiler exposing (Dialect(..))
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (div, text)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ElmSsr.Action as Action exposing (Action)
import Json.Encode as Encode

showMember : TestMembers.TestMember -> String
showMember m =
    m.email ++ ":" ++ String.fromFloat m.score ++ ":" ++ (if m.isAdmin then "admin" else "user") ++ ":" ++ Maybe.withDefault "none" m.nickname

page : Request -> Loader (Document Never)
page _ =
    let
        loadAll = TestMembers.all
        loadAlice = Repo.one SQLite (Query.from TestMembers.testMemberSchema |> Query.where_ (Query.eq "alice@example.com" TestMembers.emailCol))
        loadHigh = Repo.all SQLite (Query.from TestMembers.testMemberSchema |> Query.where_ (Query.gt 8 TestMembers.scoreCol))
        loadBy = TestMembers.byId 3
    in
    loadAll
        |> Loader.andThen (\\allM ->
            loadAlice |> Loader.andThen (\\a ->
                loadHigh |> Loader.andThen (\\h ->
                    loadBy |> Loader.map (\\b ->
                        Page.page
                            { title = "DSL Test"
                            , head = []
                            , body =
                                [ div [] [ text ("ALL:" ++ String.join "," (List.map showMember allM)) ]
                                , div [] [ text ("ALICE:" ++ Maybe.withDefault "n" (Maybe.map showMember a)) ]
                                , div [] [ text ("HIGH:" ++ String.join "," (List.map showMember h)) ]
                                ]
                            }
                    )
                )
            )
        )

action : Request -> Action (Document Never)
action _ =
    let
        op =
            TestMembers.insert { email = "david@example.com", score = 7.5, nickname = Just "Dave" }
                |> Loader.andThen (\\_ -> TestMembers.update 3 { email = "charlie_updated@example.com", score = 9.9, isAdmin = True, nickname = Just "Charlie2", registeredAt = Just "2026-01-01 00:00:00" })
                |> Loader.andThen (\\_ -> TestMembers.delete 1)
    in
    Action.fromLoader op
        |> Action.andThen (\\_ -> Action.redirect "/testdsl")
`;
    await writeFile(resolve(root, "db-app/src/DbApp/Routes/TestDsl.elm"), testRouteContent, "utf8");

    // Write a custom database-backed runtime.ts file
    const customRuntime = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import type { RouteCatalog } from "elm-ssr/http";
import { islands, bundleSource } from "../generated/db-app/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/db-app/app.mjs";
import { Database } from "bun:sqlite";

const elmModule = ElmRuntime;

const db = new Database(":memory:");
db.run("CREATE TABLE test_members (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, score REAL NOT NULL, is_admin BOOLEAN NOT NULL DEFAULT 0, nickname TEXT, registered_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP))");
db.run("INSERT INTO test_members (email, score, is_admin, nickname) VALUES ('alice@example.com', 9.8, 1, 'Alicia')");
db.run("INSERT INTO test_members (email, score, is_admin, nickname) VALUES ('bob@example.com', 5.4, 0, NULL)");
db.run("INSERT INTO test_members (email, score, is_admin, nickname) VALUES ('charlie@example.com', 8.2, 0, 'Charlie')");

const sqlEffects = inMemoryEffects({
  sql: ({ sql, params, mode }) => {
    const statement = db.query(sql);
    const args = params as never[];
    if (mode === "run") {
      const info = statement.run(...args);
      return { rowsAffected: Number(info.changes) };
    }
    if (mode === "first") {
      return statement.get(...args) ?? null;
    }
    return statement.all(...args);
  }
});

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/testdsl",
      methods: ["GET", "POST"],
      description: "Test page"
    }
  ],
  assets: [],
  utility: [],
  api: []
};

export const createFlags = ({ request, path }) => {
  const [pathname, search = ""] = path.split("?");
  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: {}
  };
};

export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags,
  effects: sqlEffects
});
`;
    await writeFile(resolve(root, "db-app/runtime.ts"), customRuntime, "utf8");

    // Verify the project compiles cleanly with the new generated Db module!
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: process.cwd() }
    );
    const buildExitCode = await buildCmd.exited;
    if (buildExitCode !== 0) {
      console.log("Query test Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("Query test Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(buildExitCode).toBe(0);

    // Dynamic import of the compiled worker to test E2E DSL rendering!
    // Clear any Elm module registered by an earlier test's dynamic import first —
    // Elm's _Platform_export merges into a shared globalThis.Elm across the whole
    // `bun test` process, and crashes if two different apps both register `Main`.
    delete (globalThis as any).Elm;
    const runtimePath = resolve(root, "db-app/runtime.ts");
    const { worker } = await import(runtimePath);
    
    // GET request checks initial DB state (Elmto-powered queries)
    const getResponse1 = await worker.fetch(new Request("https://example.com/testdsl"));
    expect(getResponse1.status).toBe(200);
    const html1 = await getResponse1.text();

    // Verify fetched DB data before mutations (covers generated compat + Elmto paths):
    expect(html1).toContain("ALL:alice@example.com:9.8:admin:Alicia,bob@example.com:5.4:user:none,charlie@example.com:8.2:user:Charlie");
    expect(html1).toContain("ALICE:alice@example.com:9.8:admin:Alicia");
    expect(html1).toContain("HIGH:alice@example.com:9.8:admin:Alicia,charlie@example.com:8.2:user:Charlie");

    // Perform POST mutation: Insert Dave, Update Charlie, Delete Alice (action redirects)
    const postResponse = await worker.fetch(new Request("https://example.com/testdsl", { method: "POST" }));
    expect(postResponse.status).toBe(302);

    // Verify DB state AFTER mutations via GET:
    const getResponse2 = await worker.fetch(new Request("https://example.com/testdsl"));
    expect(getResponse2.status).toBe(200);
    const html2 = await getResponse2.text();

    // Alice (id=1) is deleted, Charlie (id=3) is updated, Dave (id=4) is inserted
    expect(html2).toContain("ALL:bob@example.com:5.4:user:none,charlie_updated@example.com:9.9:admin:Charlie2,david@example.com:7.5:user:Dave");
    expect(html2).toContain("ALICE:n");
  }, 60000);
});
