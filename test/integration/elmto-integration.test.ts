import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const DATABASE_URL = process.env.DATABASE_URL;

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Elmto Integration (Real SQLite and PostgreSQL Repo)", () => {
  it("runs Repo queries and mutations E2E against SQLite and PostgreSQL", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-elmto-it-"));
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

    // 1. Scaffold new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "elmto-it-app", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // 2. Add Elmto Route module
    const routeCode = `module ElmtoItApp.Routes.TestRepo exposing (page, action)

import Json.Decode as Decode
import Json.Encode as Encode
import Dict exposing (Dict)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Route as Route exposing (Request)
import ElmSsr.Page as Page
import ElmSsr.Document exposing (Document)
import ElmSsr.Html
import ElmSsr.Html.Attributes
import ElmSsr.Db.Elmto as Elmto
import ElmSsr.Db.Elmto.Changeset as Changeset
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Compiler as Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Repo as Repo

type alias User =
    { id : Int
    , name : String
    , email : String
    , age : Maybe Int
    }

type alias Post =
    { id : Int
    , userId : Int
    , title : String
    }

type alias UserStats =
    { name : String
    , postCount : Int
    , averageAge : Maybe Float
    }

userDecoder : Decode.Decoder User
userDecoder =
    Decode.map4 User
        (Decode.field "id" Decode.int)
        (Decode.field "name" Decode.string)
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "age" Decode.int))

userSchema : Elmto.Schema User
userSchema =
    Elmto.schema "elmto_users" userDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "name" .name Elmto.string
        |> Elmto.field "email" .email Elmto.string
        |> Elmto.optionalField "age" .age Elmto.int

postDecoder : Decode.Decoder Post
postDecoder =
    Decode.map3 Post
        (Decode.field "id" Decode.int)
        (Decode.field "user_id" Decode.int)
        (Decode.field "title" Decode.string)

postSchema : Elmto.Schema Post
postSchema =
    Elmto.schema "elmto_posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

statsDecoder : Decode.Decoder UserStats
statsDecoder =
    Decode.map3 UserStats
        (Decode.field "name" Decode.string)
        (Decode.field "post_count" Decode.int)
        (Decode.field "average_age" (Decode.nullable Decode.float))

idCol = Elmto.column "id" Encode.int
nameCol = Elmto.column "name" Encode.string
ageCol = Elmto.column "age" Encode.int
postUserIdCol = Elmto.column "user_id" Encode.int
postTitleCol = Elmto.column "title" Encode.string

getDialect : Loader Dialect
getDialect =
    Loader.env "DB_DIALECT"
        |> Loader.map (\\maybeVal ->
            case maybeVal of
                Just "postgres" -> PostgreSQL
                _ -> SQLite
        )

page : Request -> Loader (Document Never)
page req =
    getDialect
        |> Loader.andThen (\\dialect ->
            let
                queryMap = Dict.fromList req.query
                query =
                    Query.from userSchema
                        |> Query.orderBy [ Query.asc nameCol ]

                summaryQuery =
                    Query.from userSchema
                        |> Query.select
                            [ Query.col nameCol
                            , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_count"
                            , Query.avg ageCol |> Query.as_ "average_age"
                            ]
                            statsDecoder
                        |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                        |> Query.whereJoined postSchema (Query.like "%" postTitleCol)
                        |> Query.groupBy [ Query.groupByCol nameCol ]
                        |> Query.having (Query.havingGte 1 (Query.joinedCountOf postSchema postUserIdCol))
                        |> Query.orderBy [ Query.asc nameCol ]
            in
            if Dict.get "summary" queryMap == Just "1" then
                Repo.all dialect summaryQuery
                    |> Loader.map (\\stats ->
                        let
                            statsJson =
                                Encode.list (\\s ->
                                    Encode.object
                                        [ ("name", Encode.string s.name)
                                        , ("postCount", Encode.int s.postCount)
                                        , ("averageAge", case s.averageAge of
                                                            Just avg -> Encode.float avg
                                                            Nothing -> Encode.null
                                          )
                                        ]
                                ) stats
                        in
                        Page.page
                            { title = "Repo Test"
                            , head = []
                            , body = [ ElmSsr.Html.div [ ElmSsr.Html.Attributes.id "result" ] [ ElmSsr.Html.text (Encode.encode 0 statsJson) ] ]
                            }
                    )

            else
                Repo.all dialect query
                    |> Loader.map (\\users ->
                    let
                        usersJson =
                            Encode.list (\\u ->
                                Encode.object
                                    [ ("id", Encode.int u.id)
                                    , ("name", Encode.string u.name)
                                    , ("email", Encode.string u.email)
                                    , ("age", case u.age of
                                                Just a -> Encode.int a
                                                Nothing -> Encode.null
                                      )
                                    ]
                            ) users
                    in
                    Page.page
                        { title = "Repo Test"
                        , head = []
                        , body = [ ElmSsr.Html.div [ ElmSsr.Html.Attributes.id "result" ] [ ElmSsr.Html.text (Encode.encode 0 usersJson) ] ]
                        }
                    )
        )

action : Request -> Action (Document Never)
action req =
    Action.fromLoader getDialect
        |> Action.andThen (\\dialect ->
            let
                queryMap = Dict.fromList req.query
                op = Dict.get "op" queryMap |> Maybe.withDefault ""
            in
            if op == "insert" then
                let
                    attrs =
                        Dict.fromList
                            [ ("name", Encode.string (Dict.get "name" queryMap |> Maybe.withDefault ""))
                            , ("email", Encode.string (Dict.get "email" queryMap |> Maybe.withDefault ""))
                            , ("age", case Dict.get "age" queryMap of
                                        Just aStr -> case String.toInt aStr of
                                                        Just val -> Encode.int val
                                                        Nothing -> Encode.null
                                        Nothing -> Encode.null
                              )
                            ]

                    changeset =
                        Changeset.cast userSchema attrs
                            |> Changeset.validateRequired [ "name", "email" ]
                in
                Repo.insert dialect userSchema changeset
                    |> Action.andThen (\\result ->
                        case result of
                            Ok user ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("user", Encode.object
                                        [ ("id", Encode.int user.id)
                                        , ("name", Encode.string user.name)
                                        , ("email", Encode.string user.email)
                                        , ("age", case user.age of
                                                    Just a -> Encode.int a
                                                    Nothing -> Encode.null
                                          )
                                        ])
                                    ])

                            Err cs ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool False)
                                    , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                    ])
                    )

            else if op == "update" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                    
                    originalUser =
                        { id = idVal, name = "", email = "", age = Nothing }

                    attrs =
                        Dict.fromList [ ("name", Encode.string nameVal) ]

                    changeset =
                        Changeset.castRecord userSchema originalUser attrs
                in
                Repo.update dialect userSchema changeset
                    |> Action.andThen (\\result ->
                        case result of
                            Ok user ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("user", Encode.object
                                        [ ("id", Encode.int user.id)
                                        , ("name", Encode.string user.name)
                                        , ("email", Encode.string user.email)
                                        , ("age", case user.age of
                                                    Just a -> Encode.int a
                                                    Nothing -> Encode.null
                                          )
                                        ])
                                    ])

                            Err cs ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool False)
                                    , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                    ])
                    )

            else if op == "delete" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0
                    
                    userToDelete =
                        { id = idVal, name = "", email = "", age = Nothing }
                in
                Repo.delete dialect userSchema userToDelete
                    |> Action.andThen (\\result ->
                        case result of
                            Ok _ ->
                                Action.json (Encode.object [ ("ok", Encode.bool True) ])

                            Err err ->
                                Action.json (Encode.object [ ("ok", Encode.bool False), ("error", Encode.string err) ])
                    )

            else
                Action.fail 400 "Invalid operation"
        )
`;
    await writeFile(resolve(root, "elmto-it-app/src/ElmtoItApp/Routes/TestRepo.elm"), routeCode, "utf8");

    // 3. Write custom database-backed runtime.ts file
    const customRuntime = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import type { RouteCatalog } from "elm-ssr/http";
import { islands, bundleSource } from "../generated/elmto-it-app/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/elmto-it-app/app.mjs";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const elmModule = ElmRuntime;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/testrepo",
      methods: ["GET", "POST"],
      description: "Repo Test"
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

export const createTestWorker = (config: { dialect: "sqlite" | "postgres", sqlitePath?: string, pgUrl?: string }) => {
  let sqlHandler;
  if (config.dialect === "sqlite") {
    const db = new Database(config.sqlitePath!);
    sqlHandler = ({ sql, params, mode }) => {
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
    };
  } else {
    const sql = new SQL(config.pgUrl!);
    sqlHandler = async ({ sql: query, params, mode }) => {
      const rows = await sql.unsafe(query, params as unknown[]);
      const rowsArray = Array.isArray(rows) ? rows : [...(rows as Iterable<unknown>)];
      if (mode === "run") {
        const count = (rows as { count?: number }).count;
        return { rowsAffected: typeof count === "number" ? count : rowsArray.length };
      }
      if (mode === "first") {
        return rowsArray[0] ?? null;
      }
      return rowsArray;
    };
  }

  const effects = inMemoryEffects({
    env: { DB_DIALECT: config.dialect },
    sql: sqlHandler
  });

  return createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects
  });
};
`;
    await writeFile(resolve(root, "elmto-it-app/runtime.ts"), customRuntime, "utf8");

    // 4. Compile the scaffolded app
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      {
        cwd: "/Users/michalmajchrzak/Projects/elmssr",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    const exitCode = await buildCmd.exited;
    if (exitCode !== 0) {
      console.log("IT Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("IT Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(exitCode).toBe(0);

    // 5. Load the custom test runtime
    const runtimePath = resolve(root, "elmto-it-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { createTestWorker } = (await import(runtimePath)) as { createTestWorker: any };

    // ==========================================
    // SQLite Dialect Tests
    // ==========================================
    const sqlitePath = join(root, "test.db");
    const localDb = new Database(sqlitePath);
    localDb.run("DROP TABLE IF EXISTS elmto_posts");
    localDb.run("DROP TABLE IF EXISTS elmto_users");
    localDb.run("CREATE TABLE elmto_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
    localDb.run("CREATE TABLE elmto_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");
    localDb.close();

    const sqliteWorker = createTestWorker({ dialect: "sqlite", sqlitePath });

    // (A) GET initial list (should be empty)
    const getRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes1.status).toBe(200);
    expect(await getResultJson(getRes1)).toEqual([]);

    // (B) POST insert Alice
    const insertRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Alice&email=alice@example.com&age=25", { method: "POST" }));
    expect(insertRes1.status).toBe(200);
    const aliceData = await insertRes1.json();
    expect(aliceData).toEqual({
      ok: true,
      user: { id: 1, name: "Alice", email: "alice@example.com", age: 25 }
    });

    // (C) POST insert Bob (without optional age)
    const insertRes2 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Bob&email=bob@example.com", { method: "POST" }));
    expect(insertRes2.status).toBe(200);
    const bobData = await insertRes2.json();
    expect(bobData).toEqual({
      ok: true,
      user: { id: 2, name: "Bob", email: "bob@example.com", age: null }
    });

    const sqlitePostsDb = new Database(sqlitePath);
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'First')");
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'Second')");
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (2, 'Third')");
    sqlitePostsDb.close();

    // (D) GET updated list (sorted by name ascending: Alice, Bob)
    const getRes2 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes2.status).toBe(200);
    expect(await getResultJson(getRes2)).toEqual([
      { id: 1, name: "Alice", email: "alice@example.com", age: 25 },
      { id: 2, name: "Bob", email: "bob@example.com", age: null }
    ]);

    const summaryRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?summary=1"));
    expect(summaryRes1.status).toBe(200);
    expect(await getResultJson(summaryRes1)).toEqual([
      { name: "Alice", postCount: 2, averageAge: 25 },
      { name: "Bob", postCount: 1, averageAge: null }
    ]);

    // (E) POST update Alice to Alicia
    const updateRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=update&id=1&name=Alicia", { method: "POST" }));
    expect(updateRes1.status).toBe(200);
    expect(await updateRes1.json()).toEqual({
      ok: true,
      user: { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    });

    // (F) POST delete Bob
    const deleteRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=delete&id=2", { method: "POST" }));
    expect(deleteRes1.status).toBe(200);
    expect(await deleteRes1.json()).toEqual({ ok: true });

    // (G) GET final list (sorted by name: Alicia only)
    const getRes3 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes3.status).toBe(200);
    expect(await getResultJson(getRes3)).toEqual([
      { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    ]);

    // ==========================================
    // PostgreSQL Dialect Tests
    // ==========================================
    if (DATABASE_URL) {
      const pgSql = new SQL(DATABASE_URL);
      await pgSql.unsafe("DROP TABLE IF EXISTS elmto_posts");
      await pgSql.unsafe("DROP TABLE IF EXISTS elmto_users");
      await pgSql.unsafe("CREATE TABLE elmto_users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
      await pgSql.unsafe("CREATE TABLE elmto_posts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");
      await pgSql.close();

      const pgWorker = createTestWorker({ dialect: "postgres", pgUrl: DATABASE_URL });

      // (A) GET initial list (should be empty)
      const pgGetRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes1.status).toBe(200);
      expect(await getResultJson(pgGetRes1)).toEqual([]);

      // (B) POST insert Alice
      const pgInsertRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Alice&email=alice@example.com&age=25", { method: "POST" }));
      expect(pgInsertRes1.status).toBe(200);
      const pgAliceData = await pgInsertRes1.json();
      expect(pgAliceData).toEqual({
        ok: true,
        user: { id: 1, name: "Alice", email: "alice@example.com", age: 25 }
      });

      // (C) POST insert Bob
      const pgInsertRes2 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Bob&email=bob@example.com", { method: "POST" }));
      expect(pgInsertRes2.status).toBe(200);
      const pgBobData = await pgInsertRes2.json();
      expect(pgBobData).toEqual({
        ok: true,
        user: { id: 2, name: "Bob", email: "bob@example.com", age: null }
      });

      const pgPostsSql = new SQL(DATABASE_URL);
      await pgPostsSql.unsafe("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'First'), (1, 'Second'), (2, 'Third')");
      await pgPostsSql.close();

      // (D) GET updated list (sorted by name: Alice, Bob)
      const pgGetRes2 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes2.status).toBe(200);
      expect(await getResultJson(pgGetRes2)).toEqual([
        { id: 1, name: "Alice", email: "alice@example.com", age: 25 },
        { id: 2, name: "Bob", email: "bob@example.com", age: null }
      ]);

      const pgSummaryRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?summary=1"));
      expect(pgSummaryRes1.status).toBe(200);
      expect(await getResultJson(pgSummaryRes1)).toEqual([
        { name: "Alice", postCount: 2, averageAge: 25 },
        { name: "Bob", postCount: 1, averageAge: null }
      ]);

      // (E) POST update Alice to Alicia
      const pgUpdateRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=update&id=1&name=Alicia", { method: "POST" }));
      expect(pgUpdateRes1.status).toBe(200);
      expect(await pgUpdateRes1.json()).toEqual({
        ok: true,
        user: { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      });

      // (F) POST delete Bob
      const pgDeleteRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=delete&id=2", { method: "POST" }));
      expect(pgDeleteRes1.status).toBe(200);
      expect(await pgDeleteRes1.json()).toEqual({ ok: true });

      // (G) GET final list
      const pgGetRes3 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes3.status).toBe(200);
      expect(await getResultJson(pgGetRes3)).toEqual([
        { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      ]);
    }
  }, 30000);
});

async function getResultJson(response: Response): Promise<any> {
  const html = await response.text();
  const match = html.match(/<div id="result">([\s\S]*?)<\/div>/);
  if (!match) throw new Error("Could not find #result element in HTML output");
  const rawJson = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
  return JSON.parse(rawJson);
}
