import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

    // Verify query builders (SELECT, INSERT, DELETE, UPDATE)
    expect(elmContent).toContain("SELECT id, email, score, is_admin, nickname, registered_at FROM test_members");
    expect(elmContent).toContain("SELECT id, email, score, is_admin, nickname, registered_at FROM test_members WHERE id = ?");
    expect(elmContent).toContain("INSERT INTO test_members (email, score, nickname) VALUES (?, ?, ?)");
    expect(elmContent).toContain("DELETE FROM test_members WHERE id = ?");
    expect(elmContent).toContain("UPDATE test_members SET email = ?, score = ?, is_admin = ?, nickname = ?, registered_at = ? WHERE id = ?");

    // Verify the project compiles cleanly with the new generated Db module!
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      { cwd: "/Users/michalmajchrzak/Projects/elmssr" }
    );
    expect(await buildCmd.exited).toBe(0);
  }, 60000);
});
