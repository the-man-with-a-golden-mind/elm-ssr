# @elm-ssr/cli

CLI for [elm-ssr](https://github.com/): scaffold new apps and build them.

## Install

```sh
bun add -d @elm-ssr/cli
```

Then use as `elm-ssr <command>` (or `bun elm-ssr <command>` in a workspace).

## Commands

- **`elm-ssr build`** — scans each configured app's `src/<Namespace>/Routes/` and `Islands/`, generates `.elm-ssr/Main.elm` (the router with file-based routes + dynamic segments) and the islands manifest, syncs the bundled Elm authoring modules (`elm-src/ElmSsr/*`) into the app's `.elm-ssr/src/ElmSsr/`, and compiles via `elm make` (one combined island bundle exposing `Elm.<App>.Islands.<Name>`).
- **`elm-ssr new <name>`** — scaffold a new app and register it in `elm-ssr.config.json`.
- **`elm-ssr dev`** — `build` then `wrangler dev`.
- **`elm-ssr compress`** — pre-compress generated bundles with gzip.
- **`elm-ssr migrate <up|down|status>`** — apply / revert / inspect SQL-file migrations.
  `--db postgres://…`, `sqlite://path`, or a plain SQLite file path; `--dir <path>` (default `./migrations`);
  `--count N` (for `down`, default 1). Reads `DATABASE_URL` if `--db` is omitted.

Configuration lives in `elm-ssr.config.json` at the repo root:

```jsonc
{
  "apps": [
    { "name": "basic", "root": "examples/basic", "module": "Example.Basic" }
  ]
}
```

See the [main README](../../README.md) for end-to-end usage.

## License

MIT
