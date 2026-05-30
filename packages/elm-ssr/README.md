# @elm-ssr/elm-ssr

The authoring Elm modules for [elm-ssr](https://github.com/) apps.

This npm package ships **Elm source** (under `src/ElmSsr/`); it is *not* a JS
package you call. The `@elm-ssr/cli` build syncs the Elm sources into each
app's `.elm-ssr/src/ElmSsr/` directory at build time, so the app's `elm.json`
can list `".elm-ssr/src"` as a source directory.

## Modules

- **`ElmSsr.Route`** — `Request`, segments, query, formValue, decoder.
- **`ElmSsr.Loader`** — describe what an SSR page needs:
  - `succeed`/`fail`/`map`/`map2`/`andThen`
  - effects: `fetchJson`, `cacheGet`/`cachePut`, `query`/`queryOne`/`execute`, `env`, `getCookie`, `enqueue`
- **`ElmSsr.Action`** — describe a non-GET response (forms, mutations):
  - `succeed`/`fail`/`redirect`/`json` + `map`/`andThen` + `fromLoader` (lift any Loader to run its effects inside an action).
- **`ElmSsr.Html` / `Html.Attributes` / `Html.Events`** — the page-side document AST (SSR-only; islands use stock `elm/html`).
- **`ElmSsr.Svg` / `Svg.Attributes`** — page-side, server-rendered SVG.
- **`ElmSsr.Island`** — `embed name { encodeFlags, fallback, id }`: pages drop a marker for a standard `Browser.element` island.
- **`ElmSsr.Island.Shared`** — `broadcast`/`listen` cross-island event bus.

## Authoring shape

- Routes live in `src/<App>/Routes/` (file-based; `Index.elm` → `/`, `NotFound.elm` is the fallback, names ending in `_` are dynamic segments).
- Islands live in `src/<App>/Islands/`. Each island is a normal `Browser.element` with stock `elm/html`. Its module also exposes a one-line `embed = Island.embed "<Name>" { encodeFlags, fallback, id }` consumed by pages.

See the [main README](../../README.md) and the example apps for end-to-end usage.

## License

MIT
