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
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
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
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
    );
    expect(await queryCmd.exited).toBe(0);

    // Verify generated module exists
    const genPath = resolve(root, "db-app/src/DbApp/Db/TestMembers.elm");
    await stat(genPath);
    const elmContent = await readFile(genPath, "utf8");

    // Check module declaration and exposed items
    expect(elmContent).toContain("module DbApp.Db.TestMembers exposing");
    expect(elmContent).toContain("TestMembersTable");
    expect(elmContent).toContain("table");
    expect(elmContent).toContain("id");
    expect(elmContent).toContain("email");
    expect(elmContent).toContain("score");
    expect(elmContent).toContain("isAdmin");
    expect(elmContent).toContain("nickname");
    expect(elmContent).toContain("registeredAt");
    expect(elmContent).toContain("TestMember");
    expect(elmContent).toContain("decoder");
    expect(elmContent).toContain("all");
    expect(elmContent).toContain("insert");
    expect(elmContent).toContain("byId");
    expect(elmContent).toContain("delete");
    expect(elmContent).toContain("update");

    // Verify DSL Table & Column references
    expect(elmContent).toContain("type TestMembersTable");
    expect(elmContent).toContain("table : Table TestMembersTable");
    expect(elmContent).toContain("table =\n    Dsl.table \"test_members\"");
    expect(elmContent).toContain("id : Column TestMembersTable Int");
    expect(elmContent).toContain("id =\n    Dsl.column \"id\" Encode.int");
    expect(elmContent).toContain("email : Column TestMembersTable String");
    expect(elmContent).toContain("email =\n    Dsl.column \"email\" Encode.string");
    expect(elmContent).toContain("score : Column TestMembersTable Float");
    expect(elmContent).toContain("score =\n    Dsl.column \"score\" Encode.float");
    expect(elmContent).toContain("isAdmin : Column TestMembersTable Bool");
    expect(elmContent).toContain("isAdmin =\n    Dsl.column \"is_admin\" Encode.bool");
    expect(elmContent).toContain("nickname : Column TestMembersTable String");
    expect(elmContent).toContain("nickname =\n    Dsl.column \"nickname\" Encode.string");
    expect(elmContent).toContain("registeredAt : Column TestMembersTable String");
    expect(elmContent).toContain("registeredAt =\n    Dsl.column \"registered_at\" Encode.string");

    // Verify record type definition
    expect(elmContent).toContain("type alias TestMember =");
    expect(elmContent).toContain("id : Int");
    expect(elmContent).toContain("email : String");
    expect(elmContent).toContain("score : Float");
    expect(elmContent).toContain("isAdmin : Bool");
    expect(elmContent).toContain("nickname : Maybe String");
    expect(elmContent).toContain("registeredAt : Maybe String");

    // Verify decoder mappings (snake_case DB names to camelCase Elm names)
    expect(elmContent).toContain("Decode.field \"id\" Decode.int");
    expect(elmContent).toContain("Decode.field \"email\" Decode.string");
    expect(elmContent).toContain("Decode.field \"score\" Decode.float");
    expect(elmContent).toContain("Decode.field \"is_admin\" boolDecoder");
    expect(elmContent).toContain("Decode.field \"nickname\" (Decode.nullable Decode.string)");
    expect(elmContent).toContain("Decode.field \"registered_at\" (Decode.nullable Decode.string)");

    // Verify query builders (SELECT, INSERT, DELETE, UPDATE) and non-shadowing parameters
    expect(elmContent).toContain("SELECT id, email, score, is_admin, nickname, registered_at FROM test_members");
    expect(elmContent).toContain("byId idVal =");
    expect(elmContent).toContain("SELECT id, email, score, is_admin, nickname, registered_at FROM test_members WHERE id = ?");
    expect(elmContent).toContain("INSERT INTO test_members (email, score, nickname) VALUES (?, ?, ?)");
    expect(elmContent).toContain("delete idVal =");
    expect(elmContent).toContain("DELETE FROM test_members WHERE id = ?");
    expect(elmContent).toContain("update idVal params =");
    expect(elmContent).toContain("UPDATE test_members SET email = ?, score = ?, is_admin = ?, nickname = ?, registered_at = ? WHERE id = ?");

    // Write a test page route that uses the DSL
    const testRouteContent = `module DbApp.Routes.TestDsl exposing (page, action)

import DbApp.Db.TestMembers as TestMembers
import ElmSsr.Db.Dsl as Db
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
        -- 1. Compiler assertions (compiling all operators)
        cEq = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.id |> Db.eq 1))
        cNeq = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.email |> Db.neq "alice@example.com"))
        cGt = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.score |> Db.gt 5.5))
        cGte = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.score |> Db.gte 5.5))
        cLt = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.score |> Db.lt 10.0))
        cLte = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.score |> Db.lte 10.0))
        cLike = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.nickname |> Db.like "%Alicia%"))
        cInList = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.id |> Db.inList [ 1, 2, 3 ]))
        cIsNull = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.nickname |> Db.isNull))
        cIsNotNull = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.nickname |> Db.isNotNull))
        cAnd = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (Db.and (TestMembers.isAdmin |> Db.eq True) (TestMembers.score |> Db.gt 8.0)))
        cOr = Db.compileQuery (Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (Db.or (TestMembers.nickname |> Db.isNull) (TestMembers.score |> Db.lt 1.0)))
        cSelect = Db.compileQuery (Db.select TestMembers.table [ Db.col TestMembers.id, Db.col TestMembers.email ] TestMembers.decoder)

        -- 2. Real DB execution assertions
        loadAll = TestMembers.all
        loadAlice = Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.email |> Db.eq "alice@example.com") |> Db.toLoaderOne
        loadHighScorers = Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.score |> Db.gt 8.0) |> Db.toLoader
        loadById = TestMembers.byId 3
        loadNullNickname = Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.nickname |> Db.isNull) |> Db.toLoader
        loadInList = Db.selectAll TestMembers.table TestMembers.decoder |> Db.where_ (TestMembers.id |> Db.inList [ 1, 3 ]) |> Db.toLoader
    in
    loadAll
        |> Loader.andThen
            (\\allMembers ->
                loadAlice
                    |> Loader.andThen
                        (\\maybeAlice ->
                            loadHighScorers
                                |> Loader.andThen
                                    (\\highScorers ->
                                        loadById
                                            |> Loader.andThen
                                                (\\maybeCharlie ->
                                                    loadNullNickname
                                                        |> Loader.andThen
                                                            (\\nullNicknames ->
                                                                loadInList
                                                                    |> Loader.map
                                                                        (\\inListMembers ->
                                                                            let
                                                                                showShow : String -> { sql : String, params : List Encode.Value, decoder : a } -> ElmSsr.Html.Node msg
                                                                                showShow name c =
                                                                                    let
                                                                                        paramsJson = Encode.list (\\v -> v) c.params |> Encode.encode 0
                                                                                    in
                                                                                    div [] [ text (name ++ " SQL: " ++ c.sql ++ " | PARAMS: " ++ paramsJson) ]
                                                                            in
                                                                            Page.page
                                                                                { title = "DSL Deep Test"
                                                                                , head = []
                                                                                , body =
                                                                                    [ showShow "EQ" cEq
                                                                                    , showShow "NEQ" cNeq
                                                                                    , showShow "GT" cGt
                                                                                    , showShow "GTE" cGte
                                                                                    , showShow "LT" cLt
                                                                                    , showShow "LTE" cLte
                                                                                    , showShow "LIKE" cLike
                                                                                    , showShow "INLIST" cInList
                                                                                    , showShow "ISNULL" cIsNull
                                                                                    , showShow "ISNOTNULL" cIsNotNull
                                                                                    , showShow "AND" cAnd
                                                                                    , showShow "OR" cOr
                                                                                    , showShow "SELECT" cSelect
                                                                                    
                                                                                    , div [] [ text ("ALL_MEMBERS: " ++ String.join "," (List.map showMember allMembers)) ]
                                                                                    , div [] [ text ("ALICE: " ++ Maybe.withDefault "none" (Maybe.map showMember maybeAlice)) ]
                                                                                    , div [] [ text ("HIGH_SCORERS: " ++ String.join "," (List.map showMember highScorers)) ]
                                                                                    , div [] [ text ("CHARLIE_BY_ID: " ++ Maybe.withDefault "none" (Maybe.map showMember maybeCharlie)) ]
                                                                                    , div [] [ text ("NULL_NICKNAMES: " ++ String.join "," (List.map showMember nullNicknames)) ]
                                                                                    , div [] [ text ("IN_LIST: " ++ String.join "," (List.map showMember inListMembers)) ]
                                                                                    ]
                                                                                }
                                                                        )
                                                            )
                                                )
                                    )
                        )
            )

action : Request -> Action (Document Never)
action request =
    let
        op =
            TestMembers.insert { email = "david@example.com", score = 7.5, nickname = Just "Dave" }
                |> Loader.andThen (\\_ -> TestMembers.update 3 { email = "charlie_updated@example.com", score = 9.9, isAdmin = True, nickname = Just "Charlie2", registeredAt = Just "2026-01-01 00:00:00" })
                |> Loader.andThen (\\_ -> TestMembers.delete 1)
    in
    Action.fromLoader op
        |> Action.andThen (\\_ ->
            Action.json (Encode.object [ ( "ok", Encode.bool True ) ])
        )
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
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
    );
    const buildExitCode = await buildCmd.exited;
    if (buildExitCode !== 0) {
      console.log("Query test Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("Query test Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(buildExitCode).toBe(0);

    // Dynamic import of the compiled worker to test E2E DSL rendering!
    const runtimePath = resolve(root, "db-app/runtime.ts");
    const { worker } = await import(runtimePath);
    
    // GET request checks initial DB state and compiled query strings:
    const getResponse1 = await worker.fetch(new Request("https://example.com/testdsl"));
    expect(getResponse1.status).toBe(200);
    const html1 = await getResponse1.text();

    // Verify compiled SQL strings and parameters:
    expect(html1).toContain("EQ SQL: SELECT * FROM test_members WHERE id = ? | PARAMS: [1]");
    expect(html1).toContain("NEQ SQL: SELECT * FROM test_members WHERE email != ? | PARAMS: [&quot;alice@example.com&quot;]");
    expect(html1).toContain("GT SQL: SELECT * FROM test_members WHERE score &gt; ? | PARAMS: [5.5]");
    expect(html1).toContain("GTE SQL: SELECT * FROM test_members WHERE score &gt;= ? | PARAMS: [5.5]");
    expect(html1).toContain("LT SQL: SELECT * FROM test_members WHERE score &lt; ? | PARAMS: [10]");
    expect(html1).toContain("LTE SQL: SELECT * FROM test_members WHERE score &lt;= ? | PARAMS: [10]");
    expect(html1).toContain("LIKE SQL: SELECT * FROM test_members WHERE nickname LIKE ? | PARAMS: [&quot;%Alicia%&quot;]");
    expect(html1).toContain("INLIST SQL: SELECT * FROM test_members WHERE id IN (?, ?, ?) | PARAMS: [1,2,3]");
    expect(html1).toContain("ISNULL SQL: SELECT * FROM test_members WHERE nickname IS NULL | PARAMS: []");
    expect(html1).toContain("ISNOTNULL SQL: SELECT * FROM test_members WHERE nickname IS NOT NULL | PARAMS: []");
    expect(html1).toContain("AND SQL: SELECT * FROM test_members WHERE (is_admin = ? AND score &gt; ?) | PARAMS: [true,8]");
    expect(html1).toContain("OR SQL: SELECT * FROM test_members WHERE (nickname IS NULL OR score &lt; ?) | PARAMS: [1]");
    expect(html1).toContain("SELECT SQL: SELECT id, email FROM test_members | PARAMS: []");

    // Verify fetched DB data before mutations:
    expect(html1).toContain("ALL_MEMBERS: alice@example.com:9.8:admin:Alicia,bob@example.com:5.4:user:none,charlie@example.com:8.2:user:Charlie");
    expect(html1).toContain("ALICE: alice@example.com:9.8:admin:Alicia");
    expect(html1).toContain("HIGH_SCORERS: alice@example.com:9.8:admin:Alicia,charlie@example.com:8.2:user:Charlie");
    expect(html1).toContain("CHARLIE_BY_ID: charlie@example.com:8.2:user:Charlie");
    expect(html1).toContain("NULL_NICKNAMES: bob@example.com:5.4:user:none");
    expect(html1).toContain("IN_LIST: alice@example.com:9.8:admin:Alicia,charlie@example.com:8.2:user:Charlie");

    // Perform POST mutation: Insert Dave, Update Charlie, Delete Alice
    const postResponse = await worker.fetch(new Request("https://example.com/testdsl", { method: "POST" }));
    expect(postResponse.status).toBe(200);
    const postText = await postResponse.text();
    console.log("POST RESPONSE TEXT IS:", postText);
    const postJson = JSON.parse(postText);
    expect(postJson).toEqual({ ok: true });

    // Verify DB state AFTER mutations:
    const getResponse2 = await worker.fetch(new Request("https://example.com/testdsl"));
    expect(getResponse2.status).toBe(200);
    const html2 = await getResponse2.text();

    // Alice (id=1) is deleted, Charlie (id=3) is updated, Dave (id=4) is inserted
    expect(html2).toContain("ALL_MEMBERS: bob@example.com:5.4:user:none,charlie_updated@example.com:9.9:admin:Charlie2,david@example.com:7.5:user:Dave");
    expect(html2).toContain("ALICE: none");
    expect(html2).toContain("HIGH_SCORERS: charlie_updated@example.com:9.9:admin:Charlie2");
    expect(html2).toContain("CHARLIE_BY_ID: charlie_updated@example.com:9.9:admin:Charlie2");
  }, 60000);
});
