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

describe("Elmto (Ecto-like SQL DSL for Elm)", () => {
  it("compiles and executes changeset validations, query builders, and SQL dialects end-to-end", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-elmto-"));
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
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "elmto-app", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // 2. Add Elmto Route module
    const routeCode = `module ElmtoApp.Routes.TestDb exposing (page, action)

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
    , averageAge : Float
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
    Elmto.schema "users" userDecoder
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
    Elmto.schema "posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

statsDecoder : Decode.Decoder UserStats
statsDecoder =
    Decode.map3 UserStats
        (Decode.field "name" Decode.string)
        (Decode.field "count_id" Decode.int)
        (Decode.field "avg_age" Decode.float)

idCol = Elmto.column "id" Encode.int
nameCol = Elmto.column "name" Encode.string
ageCol = Elmto.column "age" Encode.int
postUserIdCol = Elmto.column "user_id" Encode.int
postTitleCol = Elmto.column "title" Encode.string

page : Request -> Loader (Document Never)
page req =
    let
        query =
            Query.from userSchema
                |> Query.where_ (Query.eq 18 idCol)
                |> Query.where_ (Query.gt 30 ageCol)
                |> Query.orderBy [ Query.asc nameCol ]
                |> Query.limit 5

        compiledSqlite =
            Compiler.compileSelect SQLite query

        compiledPostgres =
            Compiler.compileSelect PostgreSQL query

        aggregateQuery =
            Query.from userSchema
                |> Query.select [ Query.col nameCol, Query.count idCol, Query.avg ageCol ]
                    statsDecoder
                |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                |> Query.groupBy [ Query.groupByCol nameCol ]
                |> Query.orderBy [ Query.asc nameCol ]

        aggregateSqlite =
            Compiler.compileSelect SQLite aggregateQuery

        aggregatePostgres =
            Compiler.compileSelect PostgreSQL aggregateQuery

        leftJoinSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select [ Query.col nameCol, Query.count idCol ] statsDecoder
                    |> Query.join Query.LeftJoin postSchema idCol postUserIdCol
                    |> Query.groupBy [ Query.groupByCol nameCol ]
                )

        rightJoinSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select [ Query.col nameCol, Query.count idCol ] statsDecoder
                    |> Query.join Query.RightJoin postSchema idCol postUserIdCol
                    |> Query.groupBy [ Query.groupByCol nameCol ]
                )

        fullJoinSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select [ Query.col nameCol, Query.count idCol ] statsDecoder
                    |> Query.join Query.FullJoin postSchema idCol postUserIdCol
                    |> Query.groupBy [ Query.groupByCol nameCol ]
                )

        mixedGroupSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select [ Query.col nameCol, Query.col ageCol, Query.count idCol ] statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                    |> Query.groupBy [ Query.groupByCol nameCol, Query.groupByCol ageCol ]
                )

        allAggregateSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select [ Query.count idCol, Query.sum ageCol, Query.avg ageCol, Query.min ageCol, Query.max ageCol ] statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                )

        allAggregatePostgres =
            Compiler.compileSelect PostgreSQL
                (Query.from userSchema
                    |> Query.select [ Query.count idCol, Query.sum ageCol, Query.avg ageCol, Query.min ageCol, Query.max ageCol ] statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                )

        aliasedJoinedSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select
                        [ Query.col nameCol |> Query.as_ "user_name"
                        , Query.joinedCol postSchema postTitleCol |> Query.as_ "post_title"
                        , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_total"
                        ]
                        statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                    |> Query.orderBy [ Query.ascJoined postSchema postTitleCol ]
                )

        joinedFilterHavingSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.select
                        [ Query.col nameCol
                        , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_count"
                        ]
                        statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                    |> Query.whereJoined postSchema (Query.like "%First%" postTitleCol)
                    |> Query.groupBy [ Query.groupByCol nameCol ]
                    |> Query.having (Query.havingGt 1 (Query.joinedCountOf postSchema postUserIdCol))
                    |> Query.orderBy [ Query.descJoined postSchema postTitleCol ]
                )

        joinedFilterHavingPostgres =
            Compiler.compileSelect PostgreSQL
                (Query.from userSchema
                    |> Query.select
                        [ Query.col nameCol
                        , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_count"
                        ]
                        statsDecoder
                    |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                    |> Query.whereJoined postSchema (Query.like "%First%" postTitleCol)
                    |> Query.groupBy [ Query.groupByCol nameCol ]
                    |> Query.having (Query.havingGt 1 (Query.joinedCountOf postSchema postUserIdCol))
                    |> Query.orderBy [ Query.descJoined postSchema postTitleCol ]
                )

        notInListSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.where_ (Query.notInList [ 1, 2, 3 ] idCol)
                )

        notInListPostgres =
            Compiler.compileSelect PostgreSQL
                (Query.from userSchema
                    |> Query.where_ (Query.notInList [ 1, 2, 3 ] idCol)
                )

        notInListEmpty =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.where_ (Query.notInList [] idCol)
                )

        betweenSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.where_ (Query.between 18 65 ageCol)
                )

        betweenPostgres =
            Compiler.compileSelect PostgreSQL
                (Query.from userSchema
                    |> Query.where_ (Query.between 18 65 ageCol)
                )

        ilikeSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.where_ (Query.ilike "%alice%" nameCol)
                )

        hasManyLoadSqlite =
            Compiler.compileSelect SQLite
                (Query.from postSchema
                    |> Query.where_ (Query.inList [ 1, 2 ] postUserIdCol)
                )

        belongsToLoadSqlite =
            Compiler.compileSelect SQLite
                (Query.from userSchema
                    |> Query.where_ (Query.inList [ 10, 20 ] idCol)
                )

        validAttrs =
            Dict.fromList
                [ ( "id", Encode.int 0 )
                , ( "name", Encode.string "Alice" )
                , ( "email", Encode.string "alice@example.com" )
                , ( "age", Encode.int 25 )
                ]

        changeset1 =
            Changeset.cast userSchema validAttrs
                |> Changeset.validateRequired [ "name", "email" ]
                |> Changeset.validateLength "name" { min = Just 2, max = Nothing }
                |> Changeset.validateFormat "email" (\\s -> String.contains "@" s) "must contain @"

        appliedRecord =
            Changeset.applyChanges userSchema changeset1

        invalidAttrs =
            Dict.fromList
                [ ( "name", Encode.string "A" )
                ]

        changeset2 =
            Changeset.cast userSchema invalidAttrs
                |> Changeset.validateRequired [ "name", "email" ]
                |> Changeset.validateLength "name" { min = Just 2, max = Nothing }

        insertSqlite =
            Compiler.compileInsert SQLite userSchema changeset1

        insertPostgres =
            Compiler.compileInsert PostgreSQL userSchema changeset1

        loadedUser =
            { id = 42, name = "Bob", email = "bob@example.com", age = Nothing }

        updateAttrs =
            Dict.fromList
                [ ( "name", Encode.string "Robert" ) ]

        updateChangeset =
            Changeset.castRecord userSchema loadedUser updateAttrs

        updateSqlite =
            Compiler.compileUpdate SQLite userSchema updateChangeset

        updatePostgres =
            Compiler.compileUpdate PostgreSQL userSchema updateChangeset

        resultJson =
            Encode.object
                [ ( "query_sqlite", Encode.string compiledSqlite.sql )
                , ( "query_postgres", Encode.string compiledPostgres.sql )
                , ( "aggregate_sqlite", Encode.string aggregateSqlite.sql )
                , ( "aggregate_postgres", Encode.string aggregatePostgres.sql )
                , ( "left_join_sqlite", Encode.string leftJoinSqlite.sql )
                , ( "right_join_sqlite", Encode.string rightJoinSqlite.sql )
                , ( "full_join_sqlite", Encode.string fullJoinSqlite.sql )
                , ( "mixed_group_sqlite", Encode.string mixedGroupSqlite.sql )
                , ( "all_aggregate_sqlite", Encode.string allAggregateSqlite.sql )
                , ( "all_aggregate_postgres", Encode.string allAggregatePostgres.sql )
                , ( "aliased_joined_sqlite", Encode.string aliasedJoinedSqlite.sql )
                , ( "joined_filter_having_sqlite", Encode.string joinedFilterHavingSqlite.sql )
                , ( "joined_filter_having_postgres", Encode.string joinedFilterHavingPostgres.sql )
                , ( "joined_filter_having_param_count", Encode.int (List.length joinedFilterHavingSqlite.params) )
                , ( "changeset1_valid", Encode.bool (Changeset.isValid changeset1) )
                , ( "changeset1_applied", case appliedRecord of
                                            Ok rec -> Encode.object [ ("name", Encode.string rec.name), ("email", Encode.string rec.email), ("age", case rec.age of
                                                                                                                                                    Just a -> Encode.int a
                                                                                                                                                    Nothing -> Encode.null) ]
                                            Err _ -> Encode.null )
                , ( "changeset2_valid", Encode.bool (Changeset.isValid changeset2) )
                , ( "changeset2_errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors changeset2) )
                , ( "insert_sqlite", case insertSqlite of
                                        Ok c -> Encode.string c.sql
                                        Err _ -> Encode.null )
                , ( "insert_postgres", case insertPostgres of
                                        Ok c -> Encode.string c.sql
                                        Err _ -> Encode.null )
                , ( "update_sqlite", case updateSqlite of
                                        Ok c -> Encode.string c.sql
                                        Err _ -> Encode.null )
                , ( "update_postgres", case updatePostgres of
                                        Ok c -> Encode.string c.sql
                                        Err _ -> Encode.null )
                , ( "not_in_list_sqlite", Encode.string notInListSqlite.sql )
                , ( "not_in_list_postgres", Encode.string notInListPostgres.sql )
                , ( "not_in_list_empty", Encode.string notInListEmpty.sql )
                , ( "between_sqlite", Encode.string betweenSqlite.sql )
                , ( "between_postgres", Encode.string betweenPostgres.sql )
                , ( "ilike_sqlite", Encode.string ilikeSqlite.sql )
                , ( "has_many_load_sqlite", Encode.string hasManyLoadSqlite.sql )
                , ( "belongs_to_load_sqlite", Encode.string belongsToLoadSqlite.sql )
                ]
    in
    Loader.succeed
        (Page.page
            { title = "Elmto Test"
            , head = []
            , body = [ ElmSsr.Html.div [ ElmSsr.Html.Attributes.id "result" ] [ ElmSsr.Html.text (Encode.encode 0 resultJson) ] ]
            }
        )

action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"
`;
    await writeFile(resolve(root, "elmto-app/src/ElmtoApp/Routes/TestDb.elm"), routeCode, "utf8");

    // 3. Compile the scaffolded app
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
      console.log("Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(exitCode).toBe(0);

    // 4. Load the worker app and run the TestDb route E2E
    const runtimePath = resolve(root, "elmto-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { worker } = (await import(runtimePath)) as { worker: any };
    expect(worker).toBeDefined();

    const response = await worker.fetch(new Request("http://localhost/testdb"));
    expect(response.status).toBe(200);

    const html = await response.text();
    // Parse result JSON from the #result div
    const match = html.match(/<div id="result">([\s\S]*?)<\/div>/);
    expect(match).not.toBeNull();
    const rawJson = match![1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'");
    const data = JSON.parse(rawJson);

    // Assert Query compilation dialects
    expect(data.query_sqlite).toBe("SELECT id, name, email, age FROM users WHERE id = ? AND age > ? ORDER BY name ASC LIMIT 5");
    expect(data.query_postgres).toBe("SELECT id, name, email, age FROM users WHERE id = $1 AND age > $2 ORDER BY name ASC LIMIT 5");
    expect(data.aggregate_sqlite).toBe("SELECT users.name, COUNT(users.id) AS count_id, AVG(users.age) AS avg_age FROM users INNER JOIN posts ON users.id = posts.user_id GROUP BY users.name ORDER BY users.name ASC");
    expect(data.aggregate_postgres).toBe("SELECT users.name, COUNT(users.id)::int AS count_id, AVG(users.age)::float AS avg_age FROM users INNER JOIN posts ON users.id = posts.user_id GROUP BY users.name ORDER BY users.name ASC");
    expect(data.left_join_sqlite).toBe("SELECT users.name, COUNT(users.id) AS count_id FROM users LEFT JOIN posts ON users.id = posts.user_id GROUP BY users.name");
    expect(data.right_join_sqlite).toBe("SELECT users.name, COUNT(users.id) AS count_id FROM users RIGHT JOIN posts ON users.id = posts.user_id GROUP BY users.name");
    expect(data.full_join_sqlite).toBe("SELECT users.name, COUNT(users.id) AS count_id FROM users FULL JOIN posts ON users.id = posts.user_id GROUP BY users.name");
    expect(data.mixed_group_sqlite).toBe("SELECT users.name, users.age, COUNT(users.id) AS count_id FROM users INNER JOIN posts ON users.id = posts.user_id GROUP BY users.name, users.age");
    expect(data.all_aggregate_sqlite).toBe("SELECT COUNT(users.id) AS count_id, SUM(users.age) AS sum_age, AVG(users.age) AS avg_age, MIN(users.age) AS min_age, MAX(users.age) AS max_age FROM users INNER JOIN posts ON users.id = posts.user_id");
    expect(data.all_aggregate_postgres).toBe("SELECT COUNT(users.id)::int AS count_id, SUM(users.age)::float AS sum_age, AVG(users.age)::float AS avg_age, MIN(users.age) AS min_age, MAX(users.age) AS max_age FROM users INNER JOIN posts ON users.id = posts.user_id");
    expect(data.aliased_joined_sqlite).toBe("SELECT users.name AS user_name, posts.title AS post_title, COUNT(posts.user_id) AS post_total FROM users INNER JOIN posts ON users.id = posts.user_id ORDER BY posts.title ASC");
    expect(data.joined_filter_having_sqlite).toBe("SELECT users.name, COUNT(posts.user_id) AS post_count FROM users INNER JOIN posts ON users.id = posts.user_id WHERE posts.title LIKE ? GROUP BY users.name HAVING COUNT(posts.user_id) > ? ORDER BY posts.title DESC");
    expect(data.joined_filter_having_postgres).toBe("SELECT users.name, COUNT(posts.user_id)::int AS post_count FROM users INNER JOIN posts ON users.id = posts.user_id WHERE posts.title LIKE $1 GROUP BY users.name HAVING COUNT(posts.user_id) > $2 ORDER BY posts.title DESC");
    expect(data.joined_filter_having_param_count).toBe(2);

    // Assert Changeset casting & validation pipelines
    expect(data.changeset1_valid).toBe(true);
    expect(data.changeset1_applied).toEqual({ name: "Alice", email: "alice@example.com", age: 25 });
    expect(data.changeset2_valid).toBe(false);
    expect(data.changeset2_errors).toContainEqual({ field: "name", message: "should be at least 2 characters" });
    expect(data.changeset2_errors).toContainEqual({ field: "email", message: "can't be blank" });

    // Assert Writes compilation dialects
    expect(data.insert_sqlite).toBe("INSERT INTO users (age, email, id, name) VALUES (?, ?, ?, ?)");
    expect(data.insert_postgres).toBe("INSERT INTO users (age, email, id, name) VALUES ($1, $2, $3, $4) RETURNING *");

    expect(data.update_sqlite).toBe("UPDATE users SET name = ? WHERE id = ?");
    expect(data.update_postgres).toBe("UPDATE users SET name = $1 WHERE id = $2 RETURNING *");

    // Assert new operators
    expect(data.not_in_list_sqlite).toBe("SELECT id, name, email, age FROM users WHERE id NOT IN (?, ?, ?)");
    expect(data.not_in_list_postgres).toBe("SELECT id, name, email, age FROM users WHERE id NOT IN ($1, $2, $3)");
    expect(data.not_in_list_empty).toBe("SELECT id, name, email, age FROM users WHERE 1 = 1");
    expect(data.between_sqlite).toBe("SELECT id, name, email, age FROM users WHERE age BETWEEN ? AND ?");
    expect(data.between_postgres).toBe("SELECT id, name, email, age FROM users WHERE age BETWEEN $1 AND $2");
    expect(data.ilike_sqlite).toBe("SELECT id, name, email, age FROM users WHERE name ILIKE ?");
    expect(data.has_many_load_sqlite).toBe("SELECT id, user_id, title FROM posts WHERE user_id IN (?, ?)");
    expect(data.belongs_to_load_sqlite).toBe("SELECT id, name, email, age FROM users WHERE id IN (?, ?)");
  }, 15000);
});
