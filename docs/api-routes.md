# API Routes

Routes under `/api/` serve JSON rather than HTML. The runtime detects the
`/api/` prefix and adjusts error responses accordingly — 5xx bodies are JSON
`{ "error": "internal_error", "requestId": "…" }` instead of plain text.

## Returning JSON from an action

`Action.json` sends a JSON body with status 200 and `Content-Type:
application/json`. Use it for any endpoint an island POSTs to:

```elm
module Example.Basic.Routes.Api.Trello.Move exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Json.Encode as Encode


page : Request -> Loader (Document Never)
page _ =
    Loader.fail 405 "GET not allowed on this API endpoint"


action : Request -> Action (Document Never)
action request =
    case ( Route.formValue "cardId" request, Route.formValue "columnId" request ) of
        ( Just cardIdStr, Just colIdStr ) ->
            case ( String.toInt cardIdStr, String.toInt colIdStr ) of
                ( Just cardId, Just colId ) ->
                    Action.fromLoader
                        (Loader.execute
                            { sql = "UPDATE cards SET column_id = ? WHERE id = ?"
                            , params = [ Encode.int colId, Encode.int cardId ]
                            }
                        )
                        |> Action.andThen
                            (\_ -> Action.json (Encode.object [ ( "ok", Encode.bool True ) ]))

                _ ->
                    Action.fail 400 "cardId and columnId must be integers"

        _ ->
            Action.fail 400 "Missing cardId or columnId"
```

> **Body parsing.** The runtime pre-parses both `application/x-www-form-urlencoded`
> and flat JSON bodies into `formData`. Both are read with `Route.formValue`.
> JSON integer values must be sent as strings (`"42"` not `42`) because the
> Elm decoder expects strings. See [Routing § JSON body](routing.md#reading-form-and-json-body-data).

## Calling an API route from an island

Use stock `elm/http`:

```elm
import Http
import Json.Encode as Encode


MoveCard cardId newColId ->
    ( { model | cards = moveLocally cardId newColId model.cards }
    , Http.post
        { url = "/api/trello/move"
        , body =
            Http.jsonBody <|
                Encode.object
                    [ ( "cardId",   Encode.string (String.fromInt cardId) )
                    , ( "columnId", Encode.string (String.fromInt newColId) )
                    ]
        , expect = Http.expectWhatever MoveCardResponse
        }
    )
```

## Returning data the island can decode

When the endpoint creates a resource, return it so the island can add it to
its model without refetching:

```elm
-- Server action:
action request =
    Action.fromLoader (TrelloCards.insert { columnId = colId, title = title })
        |> Action.andThen (\_ -> Action.fromLoader fetchNewCard)
        |> Action.andThen (\card -> Action.json (encodeCard card))


-- Island:
Http.post
    { url = "/api/trello/card"
    , body = Http.jsonBody payload
    , expect = Http.expectJson SaveCardResponse cardDecoder
    }
```

## Returning JSON from a page loader

API routes can also respond to GET with JSON from the `page` loader — just
use `Action.fail 405` for the action and return your payload from the loader.
But there is no `Loader.json`; the only way to return JSON on a GET is to
call `Action.json` from inside an action, or use a WebSocket / SSE endpoint
for server push.

For purely data GET endpoints, prefer SSE (streaming) or have the island
call a POST endpoint with an empty body.

## CSRF on API routes

If you have `csrf: true` in `createWorkerApp`, POST/PUT/PATCH/DELETE routes
require either:
- A `X-CSRF-Token` header, or
- A `_csrf` form field.

The simplest island pattern is to embed the CSRF token in page flags when the
page renders, then attach it as a header on every fetch:

```elm
-- Page (server): embed the token in island flags
page req =
    Loader.map2 view
        (Loader.csrfToken)
        (loadBoard req)


-- Island: include it on every mutation request
Http.request
    { method  = "POST"
    , headers = [ Http.header "X-CSRF-Token" model.csrfToken ]
    , url     = "/api/trello/move"
    , body    = Http.jsonBody payload
    , expect  = Http.expectWhatever MoveCardResponse
    , timeout = Nothing
    , tracker = Nothing
    }
```

Paths under `/webhooks/` can be exempted with `csrf: { skipPaths: ["/webhooks/"] }`.
See [Sessions and CSRF](sessions.md) for the full configuration.

## Error response format

| Scenario | Body |
|---|---|
| `Action.fail 400 "msg"` | `400 Bad Request` with `msg` as plain text; for `/api/` routes the runtime wraps it as JSON: `{ "error": "msg" }` |
| `Loader.fail 502 "msg"` | Same — JSON for `/api/`, plain text for page routes |
| Uncaught exception | `{ "error": "internal_error", "requestId": "…" }` |

## File location

API routes live under `Routes/Api/` by convention, mapping to `/api/`:

```
Routes/
  Api/
    Trello/
      Move.elm      →  POST /api/trello/move
      Card.elm      →  POST /api/trello/card
    Users/
      Create.elm    →  POST /api/users/create
```

Scaffold with `elm-ssr route api/trello/move --api`.

## See also

- [Routing](routing.md) — how file paths map to URLs, how JSON bodies are parsed
- [Loaders and Actions](loaders-and-actions.md) — `Action.json`, `Action.fail`, `Action.fromLoader`
- [Tutorials: Trello Board](tutorials/trello-board.md) — end-to-end API route + island example
