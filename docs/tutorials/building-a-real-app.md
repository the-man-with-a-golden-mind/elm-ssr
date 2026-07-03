# Building a Real App with elm-ssr

This tutorial walks you through creating a production-ready full-stack Elm application using elm-ssr. You'll scaffold a new project, set up a real database with Docker (Postgres), use the modern **Elmto** stack for type-safe data access, add authenticated CRUD with `ElmSsr.Form` + changesets, build, migrate, and test everything end-to-end.

By the end, you'll have:

- A working multi-route app with zero-JS pages + interactive islands
- Session-based auth powered by BetterAuth (or Auth0)
- Type-safe SQL using Elmto (the canonical DB layer)
- Form validation that works on server and client
- Proper error handling for constraint violations and bad input
- A Docker-powered development database

This reflects the current best practices in elm-ssr (as of 2026).

## Prerequisites

- Bun 1.3+
- Docker + Docker Compose (for the Postgres step)
- A code editor with Elm support (optional but recommended)

We will use Docker to run Postgres so the experience matches a real deployment (you can use SQLite locally too).

## 1. Scaffold the Project

The fastest way to start is with the CLI:

```bash
# Create a new standalone app
bunx elm-ssr new real-app --db --auth betterAuth --tailwind

cd real-app
bun install
```

What the flags give you:

- `--db`: Sets up migrations folder + database support in `runtime.ts`
- `--auth betterAuth`: Wires sessions, CSRF (skipping auth routes), Login/Profile pages, and BetterAuth endpoints
- `--tailwind`: Modern styling out of the box

The generator creates:

- `elm.json` + `.elm-ssr/` (ElmSsr modules synced on build)
- `runtime.ts` + `worker.ts`
- Routes: Index, Counter, Login, Profile, NotFound
- Islands: Counter, Login (uses `ElmSsr.Form` for client validation)
- `migrations/` with auth tables + initial schema
- `src/Endpoints/Auth.ts` (BetterAuth + elm-ssr middleware bridge)
- `styles.ts`

## 2. First Build and Run (Local SQLite)

```bash
bun run dev
```

(`bun run dev` runs `elm-ssr dev`, which builds first, then serves the app —
you don't need a separate `bun run build` before it.)

Visit http://localhost:8787

`elm-ssr dev` runs the app directly under Bun (not wrangler), which is what
lets it use `bun:sqlite` for local development. Watch the terminal: it logs
the DB file it opened and auto-applies any pending `migrations/*.sql` against
it before the server starts listening — a fresh `--auth betterAuth` scaffold
works immediately, no manual migrate step. If anything about the DB is wrong
(bad `DATABASE_URL`, a migration that fails), `dev` refuses to start rather
than silently serving a broken app.

Try the counter island — it works with no client JS on the static pages.
Try `/login` → sign up → `/profile` too — see [Step 7](#7-authentication-flow).

## 3. Set Up a Real Database with Docker (Postgres)

Stop the local dev if running.

Start Postgres using the project's docker-compose (or your own):

```bash
# From the elm-ssr root (or copy docker-compose.yml)
docker compose up -d postgres
```

Wait for it to be healthy, then set your connection string.

Create a `.env` (or use `.dev.vars` for wrangler-style):

```env
DATABASE_URL=postgres://elmssr:elmssr@localhost:5432/elmssr
BETTER_AUTH_SECRET=super-secret-change-this-in-prod-1234567890
BETTER_AUTH_URL=http://localhost:8787
```

## 4. Run Migrations Against Postgres

The CLI migrate tool supports Postgres directly:

```bash
bunx elm-ssr migrate up --db $DATABASE_URL
```

You should see the BetterAuth tables (`user`, `session`, `account`, `verification`) + your app tables applied.

List status:

```bash
bunx elm-ssr migrate status --db $DATABASE_URL
```

To revert:

```bash
bunx elm-ssr migrate down --count 1 --db $DATABASE_URL
```

**Important**: `runtime.ts` and `Auth.ts` only ever open SQLite for local `bun run dev`
— `DATABASE_URL` there is *just a path override* (`DATABASE_URL=sqlite://./other.db`),
not a way to point local dev at Postgres. `bun:sqlite` cannot open a
`postgres://` URL, so setting `DATABASE_URL` to one makes `bun run dev` refuse
to start immediately, with an error explaining why — it will not silently try
and fail in some confusing way. Your two real options:

- Keep SQLite for fast local iteration and use Postgres only for migrations/schema-gen
  here and in CI/staging/prod (recommended for most teams, and what the rest
  of this tutorial does), or
- Replace the generated `sqlHandler` in `runtime.ts` with a real Postgres client
  (`Bun.sql`, `postgresSql` from `elm-ssr/backends`, or `pg`) if you want full
  Postgres in local dev too — a real code change, not an env var. See
  [Backends](../backends.md) and [Deployment](../deployment.md).

For this tutorial we will use Postgres for migrations and schema generation,
and keep local `bun run dev` on SQLite.

## 5. Generate Elmto Database Modules

With tables in Postgres, generate typed Elm modules using the new Elmto-based generator:

```bash
bunx elm-ssr query --db $DATABASE_URL
```

This scans your `migrations/` and creates `src/YourApp/Db/*.elm` files using **Elmto** (the canonical layer):

- `userSchema`, `idCol`, `emailCol`, etc.
- `decoder`
- Compat helpers: `all`, `byId`, `insert`, etc.

**Never import `ElmSsr.Db.Dsl` in new code.** Use:

```elm
import YourApp.Db.Users as Users
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Repo as Repo

usersLoader : Loader (List Users.User)
usersLoader =
    Repo.all PostgreSQL (Query.from Users.userSchema)
```

See [docs/elmto.md](../elmto.md) for the full API (joins, aggregates, changesets, error handling).

## 6. Add a Real Feature: Todos Resource (Form + Elmto + Action)

Scaffold a resource route:

```bash
bunx elm-ssr route todos --resource
```

This creates `Routes/Todos.elm` with:

- Form decoder using `ElmSsr.Form`
- Action that uses `Route.formValue` + `Form.decode`
- `Action.fail 422` on validation error (non-optimistic path)
- Comments guiding you to use `Repo.insert` + `Loader.softExecute`

Update it to use your generated DB module + Elmto:

```elm
import YourApp.Db.Todos as Todos
import ElmSsr.Db.Elmto.Changeset as Changeset
import ElmSsr.Db.Elmto.Repo as Repo

-- In action
case Form.decode todoDecoder pairs of
    Ok { title } ->
        let
            cs =
                Changeset.cast Todos.todoSchema (Dict.fromList [("title", Encode.string title)])
                    |> Changeset.validateRequired ["title"]
        in
        Repo.insert PostgreSQL Todos.todoSchema cs
            |> Action.andThen
                (\result ->
                    case result of
                        Ok _ -> Action.redirect "/todos"
                        Err changeset ->
                            -- surface errors back to the form
                            Action.succeed (viewWithErrors changeset)
                )

    Err _ ->
        Action.fail 422 "Title is required."
```

This pattern gives you excellent error UX:

- Client-side Form validation in the Login island
- Server-side Form + DB constraint errors attached to changesets
- 422 responses for bad input

Rebuild and test the form.

## 7. Authentication Flow

The scaffold already gave you:

- `/login` page + `Islands/Login.elm` (uses Form + posts to `/api/auth/sign-up` etc.)
- `/profile` (protected with `Loader.requireUser`)
- BetterAuth handlers in the middleware layer

Test the flow:

1. Go to `/login`
2. Sign up
3. You should be redirected and able to visit `/profile`
4. Log out

All of this runs through the `authMiddleware` + sessions + CSRF (skipping auth routes).

Secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) come from `env`, resolved per-request
in `Auth.ts`. If you never set `BETTER_AUTH_SECRET`, elm-ssr signs sessions with a
literal placeholder string and logs a one-time warning about it — harmless for this
tutorial, not something to ship.

## 8. Build, Run, and Test with Docker Postgres

```bash
# Rebuild + serve locally (SQLite — see the note in step 3/4 about DATABASE_URL)
bun run dev
```

To really test like production:

- Keep `docker compose up -d postgres`
- Use the migrate command as shown
- For the actual worker, many people deploy to Cloudflare (D1, via `elm-ssr dev --cf`
  locally against a real D1 binding) or run with Bun + a real Postgres driver wired
  into `runtime.ts`'s `sqlHandler` (see step 3/4).

You can test the worker programmatically:

```ts
// In a test file
import { worker } from "./runtime";

const res = await worker.fetch(new Request("http://localhost/todos"));
console.log(await res.text());
```

## 9. Next Steps & Best Practices

- **Use Elmto everywhere** for new features (`query` generator + `Repo` + `Changeset`).
- **Form first** for anything user-submitted.
- **Soft paths** for writes: prefer `Repo.insert` over raw `Loader.execute`.
- Run `elm-ssr query` after adding tables.
- For complex queries, drop to `Loader.query` + your generated decoders.
- Persistent islands + the new navigation events (`elm-ssr-navigation-start` / `end`) for great SPA feel.
- Always test error cases (see `test/` in this repo for inspiration).

## Common Pitfalls

- Forgetting to run `migrate up` before using generated DB modules against Postgres/D1
  (local `bun run dev` auto-applies pending SQLite migrations for you, but Postgres/D1
  migrations are always manual — `elm-ssr migrate up --db $DATABASE_URL`).
- Using the old `Db.Dsl` import after regenerating.
- Not providing `BETTER_AUTH_SECRET` (falls back to a placeholder — elm-ssr now warns
  about this once at runtime instead of staying silent).
- Setting `DATABASE_URL` to a `postgres://` URL and expecting local `bun run dev` to
  use it — it can't (see step 3/4); `dev` will refuse to start and tell you why.
- Trying to use `Secure` cookies on plain http during local dev.

## Summary

You now have a real, full-stack Elm app:

- Pages rendered on the server (zero JS by default)
- Rich islands when you need interactivity
- Type-safe data layer via Elmto
- Production auth
- Proper validation + error handling
- Database that can run in Docker / Postgres / D1

This is the "amazing" experience elm-ssr aims to deliver.

Happy building!

See also:
- [Elmto docs](../elmto.md)
- [Error handling](../error-handling.md)
- [SPA navigation](../spa-navigation.md)
- The reference apps in `examples/`

## Testing the Tutorial Yourself

Follow the commands in order. Steps 1–2 and 7 (scaffold, local `bun run dev`,
auto-migration, sign-up/sign-in/profile/logout) were re-verified end-to-end
against a live scaffolded app for this revision. Steps 3–6 and 8 (Docker
Postgres, Elmto generation, the `--resource` scaffold) describe the intended
flow but were not re-run against a live Postgres container for this revision
— if you hit something that doesn't match, please open an issue rather than
assume it's you.