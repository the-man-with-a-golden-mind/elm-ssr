import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// End-to-end coverage for Repo.loadHasMany and Repo.loadBelongsTo.
//
// The elmto.test.ts verifies that these functions compile the correct SQL strings
// (WHERE fk IN (?, ?)). This test verifies the other half: that the in-Elm
// grouping logic correctly zips query results back into
//   (parent, List child)   — hasMany
//   (child,  Maybe parent) — belongsTo
// using actual rows flowing through the Elm runtime.

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Repo.loadHasMany and Repo.loadBelongsTo (E2E data grouping)", () => {
  it(
    "groups rows correctly and emits (parent, children) / (child, Maybe parent) pairs",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "elm-ssr-assoc-"));
      tempRoots.push(root);

      await symlink(resolve(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
      await symlink(resolve(process.cwd(), ".elm-home"), join(root, ".elm-home"), "dir");

      await writeFile(
        resolve(root, "elm-ssr.config.json"),
        JSON.stringify({ apps: [] }, null, 2),
        "utf8"
      );

      const scaffoldCmd = Bun.spawn(
        ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "assoc-app", "--root", root],
        { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
      );
      expect(await scaffoldCmd.exited).toBe(0);

      // ---------------------------------------------------------------------------
      // Elm route: load users, then use Repo.loadHasMany and Repo.loadBelongsTo
      // to attach their posts.  Returns the grouped data as JSON.
      // ---------------------------------------------------------------------------
      const routeCode = `module AssocApp.Routes.Assoc exposing (page, action)

import Json.Decode as Decode
import Json.Encode as Encode
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Route exposing (Request)
import ElmSsr.Page as Page
import ElmSsr.Document exposing (Document)
import ElmSsr.Html
import ElmSsr.Html.Attributes
import ElmSsr.Db.Elmto as Elmto
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Compiler as Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Repo as Repo

type alias User =
    { id : Int, name : String }

type alias Post =
    { id : Int, userId : Int, title : String }

userDecoder : Decode.Decoder User
userDecoder =
    Decode.map2 User
        (Decode.field "id" Decode.int)
        (Decode.field "name" Decode.string)

postDecoder : Decode.Decoder Post
postDecoder =
    Decode.map3 Post
        (Decode.field "id" Decode.int)
        (Decode.field "user_id" Decode.int)
        (Decode.field "title" Decode.string)

userSchema : Elmto.Schema User
userSchema =
    Elmto.schema "users" userDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "name" .name Elmto.string

postSchema : Elmto.Schema Post
postSchema =
    Elmto.schema "posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

postUserIdCol : Elmto.Column Post Int
postUserIdCol =
    Elmto.column "user_id" Encode.int

page : Request -> Loader (Document Never)
page _ =
    Repo.all SQLite (Query.from userSchema |> Query.orderBy [ Query.asc (Elmto.column "id" Encode.int) ])
        |> Loader.andThen
            (\\users ->
                Repo.loadHasMany SQLite postSchema postUserIdCol .userId users .id
                    |> Loader.andThen
                        (\\usersWithPosts ->
                            Repo.all SQLite (Query.from postSchema |> Query.orderBy [ Query.asc (Elmto.column "id" Encode.int) ])
                                |> Loader.andThen
                                    (\\posts ->
                                        Repo.loadBelongsTo SQLite userSchema .id .userId posts
                                            |> Loader.map
                                                (\\postsWithUsers ->
                                                    let
                                                        encodeHasMany ( user, userPosts ) =
                                                            Encode.object
                                                                [ ( "user", Encode.string user.name )
                                                                , ( "posts", Encode.list (\\p -> Encode.string p.title) userPosts )
                                                                ]

                                                        encodeBelongsTo ( post, maybeUser ) =
                                                            Encode.object
                                                                [ ( "post", Encode.string post.title )
                                                                , ( "author", Maybe.map (\\u -> Encode.string u.name) maybeUser |> Maybe.withDefault Encode.null )
                                                                ]

                                                        result =
                                                            Encode.object
                                                                [ ( "has_many", Encode.list encodeHasMany usersWithPosts )
                                                                , ( "belongs_to", Encode.list encodeBelongsTo postsWithUsers )
                                                                ]
                                                    in
                                                    Page.page
                                                        { title = "Assoc"
                                                        , head = []
                                                        , body =
                                                            [ ElmSsr.Html.div
                                                                [ ElmSsr.Html.Attributes.id "result" ]
                                                                [ ElmSsr.Html.text (Encode.encode 0 result) ]
                                                            ]
                                                        }
                                                )
                                    )
                        )
            )

action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "not allowed"
`;
      await writeFile(
        resolve(root, "assoc-app/src/AssocApp/Routes/Assoc.elm"),
        routeCode,
        "utf8"
      );

      // ---------------------------------------------------------------------------
      // Custom runtime with SQLite + seeded data
      // ---------------------------------------------------------------------------
      const customRuntime = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import type { RouteCatalog } from "elm-ssr/http";
import { islands, bundleSource } from "../generated/assoc-app/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated
import ElmRuntime from "../generated/assoc-app/app.mjs";
import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
db.run("CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL)");

// Two users: Alice has 2 posts, Bob has 1, Carol has 0.
db.run("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Carol')");
db.run("INSERT INTO posts VALUES (1, 1, 'Alice Post 1'), (2, 1, 'Alice Post 2'), (3, 2, 'Bob Post 1')");

// Post 4 has no matching user (orphan — tests the Maybe Nothing case).
db.run("INSERT INTO posts VALUES (4, 99, 'Orphan Post')");

const sql = ({ sql, params, mode }) => {
  const stmt = db.query(sql);
  const args = params;
  if (mode === "run") return { rowsAffected: Number(stmt.run(...args).changes) };
  if (mode === "first") return stmt.get(...args) ?? null;
  return stmt.all(...args);
};

export const routes: RouteCatalog = { pages: [], assets: [], utility: [], api: [] };
export const createFlags = ({ request, path, formData }) => {
  const [pathname] = path.split("?");
  return { method: request?.method ?? "GET", path: pathname, query: {}, formData: formData ?? {} };
};
export const worker = createWorkerApp({
  elmModule: ElmRuntime,
  islands, islandsBundle: bundleSource, stylesheet, routes, createFlags,
  effects: inMemoryEffects({ sql })
});
`;
      await writeFile(resolve(root, "assoc-app/runtime.ts"), customRuntime, "utf8");

      // Build
      const buildCmd = Bun.spawn(
        ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
        { cwd: "/Users/michalmajchrzak/Projects/elmssr", stdout: "pipe", stderr: "pipe" }
      );
      const exitCode = await buildCmd.exited;
      if (exitCode !== 0) {
        console.error("Build stderr:", await new Response(buildCmd.stderr).text());
      }
      expect(exitCode).toBe(0);

      // Run
      const runtimePath = resolve(root, "assoc-app/runtime.ts");
      delete (globalThis as any).Elm;
      const { worker } = (await import(runtimePath)) as { worker: { fetch: (r: Request) => Promise<Response> } };

      const response = await worker.fetch(new Request("http://localhost/assoc"));
      expect(response.status).toBe(200);

      const html = await response.text();
      const match = html.match(/<div id="result">([\s\S]*?)<\/div>/);
      expect(match).not.toBeNull();
      const data = JSON.parse(
        match![1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
      ) as { has_many: Array<{ user: string; posts: string[] }>; belongs_to: Array<{ post: string; author: string | null }> };

      // ---------------------------------------------------------------------------
      // Repo.loadHasMany: groups child posts under each parent user
      // ---------------------------------------------------------------------------
      expect(data.has_many).toHaveLength(3);

      const alice = data.has_many.find((r) => r.user === "Alice")!;
      expect(alice.posts.sort()).toEqual(["Alice Post 1", "Alice Post 2"]);

      const bob = data.has_many.find((r) => r.user === "Bob")!;
      expect(bob.posts).toEqual(["Bob Post 1"]);

      const carol = data.has_many.find((r) => r.user === "Carol")!;
      expect(carol.posts).toEqual([]); // no posts → empty list, not missing

      // ---------------------------------------------------------------------------
      // Repo.loadBelongsTo: matches each child post to its Maybe parent user
      // ---------------------------------------------------------------------------
      const alicePost1 = data.belongs_to.find((r) => r.post === "Alice Post 1")!;
      expect(alicePost1.author).toBe("Alice");

      const alicePost2 = data.belongs_to.find((r) => r.post === "Alice Post 2")!;
      expect(alicePost2.author).toBe("Alice");

      const bobPost = data.belongs_to.find((r) => r.post === "Bob Post 1")!;
      expect(bobPost.author).toBe("Bob");

      // Orphan post: user_id=99 doesn't exist → Maybe Nothing → null in JSON
      const orphan = data.belongs_to.find((r) => r.post === "Orphan Post")!;
      expect(orphan.author).toBeNull();
    },
    30000
  );
});
