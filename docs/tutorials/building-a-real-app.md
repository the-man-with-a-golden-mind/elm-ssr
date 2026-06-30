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
bun run build
bun run dev
```

Visit http://localhost:8787

You should see the homepage. The app uses SQLite via `bun:sqlite` for local development (injected automatically when `Bun` is detected).

Try the counter island — it works with no client JS on the static pages.

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

**Important**: The `runtime.ts` still uses SQLite for local Bun dev by default. For full Postgres in dev you can:

- Set `DATABASE_URL` and adjust `sqlHandler` in `runtime.ts` to use a Postgres client (e.g. `Bun.sql` or `pg`), or
- Keep SQLite for fast iteration and use Postgres only in CI/staging/prod (recommended for most teams).

For this tutorial we will use Postgres for migrations and schema generation.

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

Secrets come from `env` (injected via `getAuthEnv` for local sqlite or your `DATABASE_URL` setup).

## 8. Build, Run, and Test with Docker Postgres

```bash
# Rebuild after changes
bun run build

# Run with postgres env (you can use a small wrapper or just set env)
DATABASE_URL=postgres://elmssr:elmssr@localhost:5432/elmssr bun run dev
```

To really test like production:

- Keep `docker compose up -d postgres`
- Use the migrate command as shown
- For the actual worker, many people deploy to Cloudflare (D1) or run with Bun + Postgres driver.

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

- Forgetting to run `migrate up` before using auth or generated DB modules.
- Using the old `Db.Dsl` import after regenerating.
- Not providing `BETTER_AUTH_SECRET` (falls back to insecure default).
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

Follow the commands in order. Everything has been verified to work with the current version of elm-ssr + Docker Postgres.