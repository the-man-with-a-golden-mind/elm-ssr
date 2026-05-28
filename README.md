# elm-ssr

Elm-first SSR prototype for Cloudflare Workers and Bun.

The current architecture is intentionally strict:
- Routes are server-rendered pages.
- Interactive UI lives in islands.
- An island is a standard Elm `Browser.element`.
- The page runtime never tries to fake full `elm/html` hydration.

That gives a better authoring model for library users: normal Elm inside an island, SSR pages around it, and no custom island virtual DOM to learn.

## Current model

1. A request hits the Worker.
2. The Worker boots the generated Elm route app for that request only.
3. Elm returns a `Document Never`.
4. The serializer emits HTML.
5. If the page contains island markers, the browser loads `/__elm-ssr/islands.js`.
6. That loader mounts each compiled island bundle with `Elm.<Module>.init({ node, flags })`.

Important consequences:
- SSR is real: HTML is produced on the server per request.
- Routes stay stateless and per-request.
- Island state is per browser instance, not shared between users.
- Islands are compatible with normal `Browser.element` packages such as `elm/html`, `Html.Keyed`, `elm/http`, `elm/time`, and `elm/svg`.
- Islands are mounted, not hydrated in the React/Next sense.

## Repo layout

### `packages/elm-ssr`

- [Route.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Route.elm): request shape and route params.
- [Loader.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Loader.elm): server-side data loading description.
- [Document.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Document.elm): SSR document type.
- [Html.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Html.elm): SSR-only HTML tree used by pages and island fallbacks.
- [Page.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Page.elm): document helpers.
- [Island.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Island.elm): embed helper that emits an island marker plus encoded flags.
- [Runtime.elm](/Users/michalmajchrzak/Projects/elmssr/packages/elm-ssr/src/ElmSsr/Runtime.elm): internal route runtime used by generated `Main.elm`.

### `packages/runtime-worker`

- [app.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/app.ts): Worker app factory.
- [request-handler.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/request-handler.ts): pages, API routes, assets, and island bundle serving.
- [render.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/render.ts): Elm boot and SSR capture.
- [serialize.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/serialize.ts): HTML serializer and conditional island loader injection.
- [client-runtime/islands.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/client-runtime/islands.ts): browser-side island loader for `Browser.element` bundles.
- [middleware.ts](/Users/michalmajchrzak/Projects/elmssr/packages/runtime-worker/src/middleware.ts): request ids, timings, logs, error normalization, HEAD handling.

### `examples/basic`

- [Routes/](/Users/michalmajchrzak/Projects/elmssr/examples/basic/src/Example/Basic/Routes): file-based SSR pages.
- [Islands/](/Users/michalmajchrzak/Projects/elmssr/examples/basic/src/Example/Basic/Islands): normal Elm `Browser.element` islands.
- [runtime.ts](/Users/michalmajchrzak/Projects/elmssr/examples/basic/runtime.ts): example Worker assembly.
- [worker.ts](/Users/michalmajchrzak/Projects/elmssr/examples/basic/worker.ts): Wrangler entrypoint.

## Authoring

Routes are file-based. A module under `src/<App>/Routes/` becomes a URL:
- `Index.elm` -> `/`
- `Counter.elm` -> `/counter`
- `Greet/Name_.elm` -> `/greet/:name`
- `NotFound.elm` -> fallback

Every route is a page:

```elm
module Demo.Routes.Status exposing (page)

import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view
```

If a page needs interactivity, it embeds an island marker:

```elm
module Demo.Routes.Counter exposing (page)

import Demo.Islands.Counter as Counter

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed
        (Page.page
            { title = "Counter"
            , head = []
            , body = [ Counter.embed { start = 0 } ]
            }
        )
```

The island itself is normal Elm:

```elm
module Demo.Islands.Counter exposing (embed, main)

import Browser
import ElmSsr.Island as Island
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)
import Json.Encode as Encode

type alias Flags =
    { start : Int }

type alias Model =
    { count : Int }

type Msg
    = Increment

embed =
    Island.embed "Counter"
        { encodeFlags = \flags -> Encode.object [ ( "start", Encode.int flags.start ) ]
        , fallback = \flags -> []
        }

main : Program Flags Model Msg
main =
    Browser.element
        { init = \flags -> ( { count = flags.start }, Cmd.none )
        , update = \msg model -> ( { model | count = model.count + 1 }, Cmd.none )
        , subscriptions = \_ -> Sub.none
        , view = \model -> div [] [ button [ onClick Increment ] [ text "+" ], text (String.fromInt model.count) ]
        }
```

The page author only embeds `Counter.embed`. The build compiles `Demo.Islands.Counter` into a browser bundle and the island loader mounts it automatically.

## Commands

```bash
bun install
bun run build
bun run ssr:build
bun run ssr:new my-example
bun run ssr:routes
bun run check
bun run test
bun run bench
bun run dev
```

What they do:
- `bun run build`: generate `.elm-ssr/Main.elm`, compile route app, compile every island bundle, and write `generated/`.
- `bun run ssr:build`: same build through the CLI entrypoint.
- `bun run ssr:new <name>`: scaffold a new example app and register it in [elm-ssr.config.json](/Users/michalmajchrzak/Projects/elmssr/elm-ssr.config.json).
- `bun run ssr:routes`: print configured app modules.
- `bun run check`: rebuild and run TypeScript typecheck.
- `bun run test`: rebuild and run the Bun test suite.
- `bun run bench`: rebuild and run the benchmark script.
- `bun run dev`: rebuild and start Wrangler dev.

## Example routes

- `GET /`: pure SSR page, no client JS.
- `GET /status`: SSR page backed by a server loader.
- `GET /counter`: SSR page that embeds two Browser.element islands.
- `GET /greet/:name`: SSR page with a dynamic segment.
- `GET /styles.css`
- `GET /health`
- `GET /api/health`
- `GET /api/routes`
- `GET /api/render?path=/counter`
- `GET /__elm-ssr/islands.js`
- `GET /__elm-ssr/islands/Counter.js`
- `GET /__elm-ssr/islands/Tasks.js`

## Tradeoffs

- Pages still use a library-specific SSR HTML tree, not stock `elm/html`.
- Islands use stock Elm browser runtime, not a custom patcher.
- There is no fake “full hydration” story for arbitrary `elm/html` apps.
- The gain is DX: authors write normal `Browser.element` code inside islands and get broad Elm package compatibility.

## Guarantees today

- SSR render is request-scoped.
- Island state is client-scoped and isolated per mounted root.
- Pages without island markers ship no browser runtime.
- `Html.Keyed` works through Elm's own runtime inside islands.
- Worker concerns such as middleware, REST endpoints, and asset serving stay outside the author-facing Elm modules.

Further authoring details live in [docs/route-loader-page.md](/Users/michalmajchrzak/Projects/elmssr/docs/route-loader-page.md) and [docs/rfc-islands.md](/Users/michalmajchrzak/Projects/elmssr/docs/rfc-islands.md).
