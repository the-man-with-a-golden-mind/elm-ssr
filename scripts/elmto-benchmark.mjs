import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const DATABASE_URL = process.env.DATABASE_URL;
const APP_NAME = "elmto-bench-app";
const MODULE_NAME = "ElmtoBenchApp";
const USERS_COUNT = 500;
const POSTS_PER_USER = 5;
const ITERATIONS = 40;

const quantile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
};

const formatMs = (value) => `${value.toFixed(2)} ms`;
const formatOps = (value) => `${value.toFixed(1)} ops/s`;

const runCase = async (label, iterations, task) => {
  for (let index = 0; index < 5; index += 1) {
    await task();
  }

  const samples = [];

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await task();
    samples.push(performance.now() - startedAt);
  }

  const total = samples.reduce((sum, sample) => sum + sample, 0);
  const avg = total / samples.length;
  const p95 = quantile(samples, 0.95);

  return {
    label,
    iterations,
    avg,
    p95,
    throughput: 1000 / avg
  };
};

const parseResultJson = async (response) => {
  const html = await response.text();
  const match = html.match(/<div id="result">([\s\S]*?)<\/div>/);
  if (!match) throw new Error("Could not find #result element in HTML output");
  const rawJson = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
  return JSON.parse(rawJson);
};

const writeFixtureApp = async (root) => {
  await symlink(resolve(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
  await symlink(resolve(process.cwd(), ".elm-home"), join(root, ".elm-home"), "dir");
  await writeFile(resolve(root, "elm-ssr.config.json"), JSON.stringify({ apps: [] }, null, 2), "utf8");

  const scaffold = Bun.spawn(
    ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", APP_NAME, "--root", root],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
  );
  const scaffoldExit = await scaffold.exited;
  if (scaffoldExit !== 0) {
    console.log(await new Response(scaffold.stdout).text());
    console.error(await new Response(scaffold.stderr).text());
    throw new Error(`Scaffold failed with exit code ${scaffoldExit}`);
  }

  const routeCode = `module ${MODULE_NAME}.Routes.Bench exposing (page, action)

import Dict exposing (Dict)
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Db.Elmto as Elmto
import ElmSsr.Db.Elmto.Compiler as Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo
import ElmSsr.Document exposing (Document)
import ElmSsr.Html
import ElmSsr.Html.Attributes
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
import Json.Decode as Decode
import Json.Encode as Encode

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

postDecoder : Decode.Decoder Post
postDecoder =
    Decode.map3 Post
        (Decode.field "id" Decode.int)
        (Decode.field "user_id" Decode.int)
        (Decode.field "title" Decode.string)

statsDecoder : Decode.Decoder UserStats
statsDecoder =
    Decode.map3 UserStats
        (Decode.field "name" Decode.string)
        (Decode.field "post_count" Decode.int)
        (Decode.field "average_age" (Decode.nullable Decode.float))

userSchema : Elmto.Schema User
userSchema =
    Elmto.schema "elmto_users" userDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "name" .name Elmto.string
        |> Elmto.field "email" .email Elmto.string
        |> Elmto.optionalField "age" .age Elmto.int

postSchema : Elmto.Schema Post
postSchema =
    Elmto.schema "elmto_posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

idCol = Elmto.column "id" Encode.int
nameCol = Elmto.column "name" Encode.string
ageCol = Elmto.column "age" Encode.int
postUserIdCol = Elmto.column "user_id" Encode.int
postTitleCol = Elmto.column "title" Encode.string

dialectFromRequest : Request -> Dialect
dialectFromRequest req =
    case Route.env "DB_DIALECT" req of
        Just "postgres" -> PostgreSQL
        _ -> SQLite

encodeUser : User -> Encode.Value
encodeUser user =
    Encode.object
        [ ("id", Encode.int user.id)
        , ("name", Encode.string user.name)
        , ("email", Encode.string user.email)
        , ("age", Maybe.map Encode.int user.age |> Maybe.withDefault Encode.null)
        ]

page : Request -> Loader (Document Never)
page req =
    let
        dialect = dialectFromRequest req
        queryMap = Dict.fromList req.query
        op = Dict.get "op" queryMap |> Maybe.withDefault ""
        searchTerm = Dict.get "name" queryMap |> Maybe.withDefault ""

        resultPage value =
            Page.page
                { title = "Elmto Bench"
                , head = []
                , body = [ ElmSsr.Html.div [ ElmSsr.Html.Attributes.id "result" ] [ ElmSsr.Html.text (Encode.encode 0 value) ] ]
                }

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

        searchQuery =
            Query.from userSchema
                |> Query.where_ (Query.ilike ("%" ++ searchTerm ++ "%") nameCol)
                |> Query.orderBy [ Query.asc nameCol ]
    in
    if Dict.get "summary" queryMap == Just "1" then
        Repo.all dialect summaryQuery
            |> Loader.map
                (\\stats ->
                    stats
                        |> List.map
                            (\\stat ->
                                Encode.object
                                    [ ("name", Encode.string stat.name)
                                    , ("postCount", Encode.int stat.postCount)
                                    , ("averageAge", Maybe.map Encode.float stat.averageAge |> Maybe.withDefault Encode.null)
                                    ]
                            )
                        |> Encode.list identity
                        |> resultPage
                )

    else if op == "search" then
        Repo.all dialect searchQuery
            |> Loader.map (\\users -> resultPage (Encode.list encodeUser users))

    else
        Repo.all dialect (Query.from userSchema |> Query.orderBy [ Query.asc nameCol ])
            |> Loader.map (\\users -> resultPage (Encode.list encodeUser users))

action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"
`;

  const runtimeCode = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import type { RouteCatalog } from "elm-ssr/http";
import { islands, bundleSource } from "../generated/${APP_NAME}/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/${APP_NAME}/app.mjs";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const elmModule = ElmRuntime;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/bench",
      methods: ["GET"],
      description: "Elmto Bench"
    }
  ],
  assets: [],
  utility: [],
  api: []
};

export const createBenchWorker = (config) => {
  // Build createFlags inside the factory so DB_DIALECT is available synchronously
  // in req.env — eliminates the Loader.env effect round-trip per request.
  const createFlags = ({ request, path }) => {
    const [pathname, search = ""] = path.split("?");
    return {
      method: request?.method ?? "GET",
      path: pathname,
      query: Object.fromEntries(new URLSearchParams(search)),
      formData: {},
      env: { DB_DIALECT: config.dialect }
    };
  };

  let sqlHandler;

  if (config.dialect === "sqlite") {
    const db = new Database(config.sqlitePath);
    sqlHandler = ({ sql, params, mode }) => {
      const statement = db.query(sql);
      const args = params;
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
    const sql = new SQL(config.pgUrl);
    sqlHandler = async ({ sql: query, params, mode }) => {
      const rows = await sql.unsafe(query, params);
      const rowsArray = Array.isArray(rows) ? rows : [...rows];
      if (mode === "run") {
        const count = rows.count;
        return { rowsAffected: typeof count === "number" ? count : rowsArray.length };
      }
      if (mode === "first") {
        return rowsArray[0] ?? null;
      }
      return rowsArray;
    };
  }

  return createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects: inMemoryEffects({
      env: { DB_DIALECT: config.dialect },
      sql: sqlHandler
    })
  });
};
`;

  await writeFile(resolve(root, APP_NAME, "src", MODULE_NAME, "Routes", "Bench.elm"), routeCode, "utf8");
  await writeFile(resolve(root, APP_NAME, "runtime.ts"), runtimeCode, "utf8");

  const build = Bun.spawn(
    ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
  );
  const buildExit = await build.exited;
  if (buildExit !== 0) {
    console.log(await new Response(build.stdout).text());
    console.error(await new Response(build.stderr).text());
    throw new Error(`Build failed with exit code ${buildExit}`);
  }
};

const seedSqlite = (sqlitePath) => {
  const db = new Database(sqlitePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.run("DROP TABLE IF EXISTS elmto_posts");
  db.run("DROP TABLE IF EXISTS elmto_users");
  db.run("CREATE TABLE elmto_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
  db.run("CREATE TABLE elmto_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");

  const insertUser = db.query("INSERT INTO elmto_users (name, email, age) VALUES (?, ?, ?)");
  const insertPost = db.query("INSERT INTO elmto_posts (user_id, title) VALUES (?, ?)");

  const tx = db.transaction(() => {
    for (let userId = 1; userId <= USERS_COUNT; userId += 1) {
      const name = `User${String(userId).padStart(4, "0")}`;
      const email = `user${String(userId).padStart(4, "0")}@example.com`;
      const age = userId % 7 === 0 ? null : 20 + (userId % 35);
      insertUser.run(name, email, age);

      for (let postIndex = 0; postIndex < POSTS_PER_USER; postIndex += 1) {
        insertPost.run(userId, `Post ${userId}-${postIndex}`);
      }
    }
  });

  tx();
  db.close();
};

const seedPostgres = async (pgUrl) => {
  const sql = new SQL(pgUrl);
  await sql.unsafe("DROP TABLE IF EXISTS elmto_posts");
  await sql.unsafe("DROP TABLE IF EXISTS elmto_users");
  await sql.unsafe("CREATE TABLE elmto_users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
  await sql.unsafe("CREATE TABLE elmto_posts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");

  await sql.begin(async (tx) => {
    for (let userId = 1; userId <= USERS_COUNT; userId += 1) {
      const name = `User${String(userId).padStart(4, "0")}`;
      const email = `user${String(userId).padStart(4, "0")}@example.com`;
      const age = userId % 7 === 0 ? null : 20 + (userId % 35);
      await tx.unsafe("INSERT INTO elmto_users (name, email, age) VALUES ($1, $2, $3)", [name, email, age]);

      for (let postIndex = 0; postIndex < POSTS_PER_USER; postIndex += 1) {
        await tx.unsafe("INSERT INTO elmto_posts (user_id, title) VALUES ($1, $2)", [userId, `Post ${userId}-${postIndex}`]);
      }
    }
  });

  await sql.close();
};

const sqliteRawSummary = (sqlitePath) => {
  const db = new Database(sqlitePath, { readonly: true });
  const rows = db
    .query(
      "SELECT elmto_users.name AS name, COUNT(elmto_posts.user_id) AS postCount, AVG(elmto_users.age) AS averageAge FROM elmto_users INNER JOIN elmto_posts ON elmto_users.id = elmto_posts.user_id WHERE elmto_posts.title LIKE ? GROUP BY elmto_users.name HAVING COUNT(elmto_posts.user_id) >= ? ORDER BY elmto_users.name ASC"
    )
    .all("%", 1)
    .map((row) => ({
      name: row.name,
      postCount: Number(row.postCount),
      averageAge: row.averageAge === null ? null : Number(row.averageAge)
    }));
  db.close();
  return rows;
};

const sqliteRawSearch = (sqlitePath, term) => {
  const db = new Database(sqlitePath, { readonly: true });
  const rows = db
    .query("SELECT id, name, email, age FROM elmto_users WHERE LOWER(name) LIKE LOWER(?) ORDER BY name ASC")
    .all(`%${term}%`);
  db.close();
  return rows;
};

const postgresRawSummary = async (pgUrl) => {
  const sql = new SQL(pgUrl);
  const rows = await sql.unsafe(
    "SELECT elmto_users.name AS name, COUNT(elmto_posts.user_id) AS \"postCount\", AVG(elmto_users.age) AS \"averageAge\" FROM elmto_users INNER JOIN elmto_posts ON elmto_users.id = elmto_posts.user_id WHERE elmto_posts.title LIKE $1 GROUP BY elmto_users.name HAVING COUNT(elmto_posts.user_id) >= $2 ORDER BY elmto_users.name ASC",
    ["%", 1]
  );
  await sql.close();
  return Array.from(rows).map((row) => ({
    name: row.name,
    postCount: Number(row.postCount),
    averageAge: row.averageAge === null ? null : Number(row.averageAge)
  }));
};

const postgresRawSearch = async (pgUrl, term) => {
  const sql = new SQL(pgUrl);
  const rows = await sql.unsafe(
    "SELECT id, name, email, age FROM elmto_users WHERE LOWER(name) LIKE LOWER($1) ORDER BY name ASC",
    [`%${term}%`]
  );
  await sql.close();
  return Array.from(rows);
};

const printCase = (result) => {
  console.log(
    `${result.label}\n  iterations: ${result.iterations}\n  avg: ${formatMs(result.avg)}\n  p95: ${formatMs(result.p95)}\n  throughput: ${formatOps(result.throughput)}`
  );
};

const main = async () => {
  const root = await mkdtemp(join(tmpdir(), "elmto-bench-"));

  try {
    await writeFixtureApp(root);
    const runtimePath = resolve(root, APP_NAME, "runtime.ts");
    const { createBenchWorker } = await import(runtimePath);

    const sqlitePath = join(root, "bench.sqlite");
    seedSqlite(sqlitePath);
    const sqliteWorker = createBenchWorker({ dialect: "sqlite", sqlitePath });

    const sqliteRouteSummary = await parseResultJson(await sqliteWorker.fetch(new Request("http://localhost/bench?summary=1")));
    const sqliteRouteSearch = await parseResultJson(await sqliteWorker.fetch(new Request("http://localhost/bench?op=search&name=User01")));
    const sqliteRawSummaryRows = sqliteRawSummary(sqlitePath);
    const sqliteRawSearchRows = sqliteRawSearch(sqlitePath, "User01");

    if (JSON.stringify(sqliteRouteSummary) !== JSON.stringify(sqliteRawSummaryRows)) {
      throw new Error("SQLite summary parity failed");
    }
    if (JSON.stringify(sqliteRouteSearch) !== JSON.stringify(sqliteRawSearchRows)) {
      throw new Error("SQLite search parity failed");
    }

    const sqliteCases = [
      await runCase("sqlite/raw summary", ITERATIONS, async () => {
        sqliteRawSummary(sqlitePath);
      }),
      await runCase("sqlite/elmto summary route", ITERATIONS, async () => {
        const response = await sqliteWorker.fetch(new Request("http://localhost/bench?summary=1"));
        await parseResultJson(response);
      }),
      await runCase("sqlite/raw search", ITERATIONS, async () => {
        sqliteRawSearch(sqlitePath, "User01");
      }),
      await runCase("sqlite/elmto search route", ITERATIONS, async () => {
        const response = await sqliteWorker.fetch(new Request("http://localhost/bench?op=search&name=User01"));
        await parseResultJson(response);
      })
    ];

    console.log("Elmto benchmark");
    console.log("===============");
    console.log(`dataset: ${USERS_COUNT} users, ${USERS_COUNT * POSTS_PER_USER} posts`);
    console.log("");
    console.log("SQLite");
    console.log("------");
    sqliteCases.forEach(printCase);

    if (!DATABASE_URL) {
      console.log("");
      console.log("PostgreSQL");
      console.log("----------");
      console.log("Skipped: DATABASE_URL is not set.");
      return;
    }

    await seedPostgres(DATABASE_URL);
    const postgresWorker = createBenchWorker({ dialect: "postgres", pgUrl: DATABASE_URL });

    const postgresRouteSummary = await parseResultJson(await postgresWorker.fetch(new Request("http://localhost/bench?summary=1")));
    const postgresRouteSearch = await parseResultJson(await postgresWorker.fetch(new Request("http://localhost/bench?op=search&name=User01")));
    const postgresRawSummaryRows = await postgresRawSummary(DATABASE_URL);
    const postgresRawSearchRows = await postgresRawSearch(DATABASE_URL, "User01");

    if (JSON.stringify(postgresRouteSummary) !== JSON.stringify(postgresRawSummaryRows)) {
      throw new Error("PostgreSQL summary parity failed");
    }
    if (JSON.stringify(postgresRouteSearch) !== JSON.stringify(postgresRawSearchRows)) {
      throw new Error("PostgreSQL search parity failed");
    }

    const postgresCases = [
      await runCase("postgres/raw summary", ITERATIONS, async () => {
        await postgresRawSummary(DATABASE_URL);
      }),
      await runCase("postgres/elmto summary route", ITERATIONS, async () => {
        const response = await postgresWorker.fetch(new Request("http://localhost/bench?summary=1"));
        await parseResultJson(response);
      }),
      await runCase("postgres/raw search", ITERATIONS, async () => {
        await postgresRawSearch(DATABASE_URL, "User01");
      }),
      await runCase("postgres/elmto search route", ITERATIONS, async () => {
        const response = await postgresWorker.fetch(new Request("http://localhost/bench?op=search&name=User01"));
        await parseResultJson(response);
      })
    ];

    console.log("");
    console.log("PostgreSQL");
    console.log("----------");
    postgresCases.forEach(printCase);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

await main();
