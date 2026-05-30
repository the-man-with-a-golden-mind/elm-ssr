import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { resolve } from "node:path";
import {
  listMigrations,
  revertMigrations,
  runMigrations
} from "../src/migrations.ts";

const USAGE = `\
elm-ssr migrate <up|down|status> [options]

Subcommands
  up                  Apply pending *.sql migrations (alphabetical order).
  down                Revert the most-recently-applied migration (uses <name>.down.sql).
  status              Print applied (with timestamps) and pending migrations.

Options
  --dir <path>        Migration directory (default: ./migrations)
  --db  <conn>        postgres://… URL, sqlite://path, or a plain SQLite file path.
                      If omitted, reads DATABASE_URL from the environment.
  --count <n>         How many to revert with 'down' (default 1)
  --table <name>      Tracking table name (default __elm_ssr_migrations)
`;

const findFlag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const sqliteAdapter = (path) => {
  const db = new Database(path);
  return {
    adapter: {
      exec: async (sql) => {
        db.exec(sql);
      },
      list: async (sql) => db.query(sql).all()
    },
    close: async () => {
      db.close();
    },
    label: `sqlite:${path}`
  };
};

const postgresAdapter = (url) => {
  const sql = new SQL(url);
  return {
    adapter: {
      exec: async (text) => {
        await sql.unsafe(text);
      },
      list: async (text) => {
        const rows = await sql.unsafe(text);
        return Array.isArray(rows) ? rows : [...(rows ?? [])];
      },
      runInTransaction: async (fn) => {
        await sql.begin(fn);
      }
    },
    close: async () => {
      await sql.close();
    },
    label: `postgres ${new URL(url).host}${new URL(url).pathname}`
  };
};

const buildAdapter = (dbArg) => {
  const target = dbArg ?? process.env.DATABASE_URL;
  if (!target) {
    throw new Error(
      "Missing --db (or DATABASE_URL). Examples:\n" +
        "  --db ./app.db\n" +
        "  --db sqlite://./app.db\n" +
        "  --db postgres://user:pass@localhost:5432/db"
    );
  }
  if (target.startsWith("postgres://") || target.startsWith("postgresql://")) {
    return postgresAdapter(target);
  }
  if (target.startsWith("sqlite://")) {
    return sqliteAdapter(target.slice("sqlite://".length));
  }
  return sqliteAdapter(target);
};

export const migrate = async (args) => {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (!["up", "down", "status"].includes(sub)) {
    process.stderr.write(`Unknown 'migrate' subcommand: ${sub}\n\n${USAGE}`);
    process.exit(1);
  }

  const dir = resolve(process.cwd(), findFlag(args, "--dir") ?? "migrations");
  const dbArg = findFlag(args, "--db");
  const tableName = findFlag(args, "--table");
  const countArg = findFlag(args, "--count");
  const count = countArg !== undefined ? Number.parseInt(countArg, 10) : undefined;

  const { adapter, close, label } = buildAdapter(dbArg);
  console.log(`elm-ssr migrate ${sub}  dir=${dir}  db=${label}`);

  try {
    if (sub === "up") {
      const result = await runMigrations(adapter, { dir, tableName });
      if (result.applied.length === 0) {
        console.log(`Nothing to apply (${result.skipped.length} already applied).`);
      } else {
        console.log(`Applied ${result.applied.length}:`);
        for (const file of result.applied) {
          console.log(`  + ${file}`);
        }
        if (result.skipped.length > 0) {
          console.log(`Skipped ${result.skipped.length} already-applied.`);
        }
      }
    } else if (sub === "down") {
      const result = await revertMigrations(adapter, { dir, tableName, count });
      if (result.reverted.length === 0) {
        console.log("Nothing to revert.");
      } else {
        console.log(`Reverted ${result.reverted.length}:`);
        for (const file of result.reverted) {
          console.log(`  - ${file}`);
        }
      }
    } else {
      const status = await listMigrations(adapter, { dir, tableName });
      console.log(`Applied (${status.applied.length}):`);
      for (const entry of status.applied) {
        console.log(`  [x] ${entry.name}  (${entry.appliedAt})`);
      }
      console.log(`Pending (${status.pending.length}):`);
      for (const file of status.pending) {
        console.log(`  [ ] ${file}`);
      }
    }
  } finally {
    await close();
  }
};
