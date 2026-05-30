# @elm-ssr/cli

CLI for [elm-ssr](https://github.com/): scaffold new apps and build them.

## Install

```sh
bun add -d @elm-ssr/cli
```

Then use as `elm-ssr <command>` (or `bun elm-ssr <command>` in a workspace).

## Commands

- **`elm-ssr build`** — scans each configured app's `src/<Namespace>/Routes/` and `Islands/`, generates `.elm-ssr/Main.elm` (the router with file-based routes + dynamic segments) and the islands manifest, syncs `@elm-ssr/elm-ssr` Elm sources into `.elm-ssr/src/ElmSsr/`, and compiles via `elm make` (one combined island bundle exposing `Elm.<App>.Islands.<Name>`).
- **`elm-ssr new <name>`** — scaffold a new app and register it in `elm-ssr.config.json`.
- **`elm-ssr dev`** — `build` then `wrangler dev`.
- **`elm-ssr compress`** — pre-compress generated bundles with gzip.

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
