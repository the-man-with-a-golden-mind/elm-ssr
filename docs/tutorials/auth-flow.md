# Tutorial: Authentication Flow

This tutorial builds a complete login/logout/protected-page flow using
elm-ssr's session middleware. You will learn how to:

1. Wire signed-cookie sessions and CSRF protection into the worker.
2. Build a login form that stores a session payload.
3. Protect a page with `Loader.requireUser`.
4. Protect a POST action with `Action.requireUser`.
5. Implement logout that destroys the session.

The result is the same pattern used by
[examples/basic/src/Example/Basic/Routes/Profile.elm](../../examples/basic/src/Example/Basic/Routes/Profile.elm)
and
[Dashboard.elm](../../examples/basic/src/Example/Basic/Routes/Dashboard.elm).

---

## Step 1: Wire sessions in `runtime.ts`

Sessions require two things: a **secret** (signs the cookie) and a **store**
(persists the session payload server-side, so the cookie only carries an id).

```ts
import { createWorkerApp } from "elm-ssr";
import { memorySessionStore } from "elm-ssr/sessions";
import { inMemoryEffects } from "elm-ssr/effects";

const worker = createWorkerApp({
  // … elmModule, islands, stylesheet, routes, createFlags, effects …

  sessions: {
    secret: process.env.SESSION_SECRET ?? "dev-secret-replace-in-prod",
    store:  memorySessionStore(),   // swap for cacheStore(redisCache(…)) in prod
    // Defaults: HttpOnly, SameSite=Lax, Secure=true, Max-Age=7d, Path=/
    // For local HTTP dev only:
    secure: false
  },

  csrf: true  // POST/PUT/PATCH/DELETE require X-CSRF-Token or _csrf form field
});

export default worker;
```

> In production use a 32-byte random secret and a durable store
> (`cacheStore(redisCache(…))` or a SQL-backed `SessionStore`). See
> [Sessions and CSRF](../sessions.md).

---

## Step 2: The login page — `Routes/Login.elm`

The page reads the current session (to show "already logged in") and the CSRF
token (to embed it in the form). `Loader.map2` runs both effects before render.

```elm
module MyApp.Routes.Login exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (button, form, h1, input, label, p, text)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
import Json.Decode as Decode
import Json.Encode as Encode
import MyApp.View.Shared as Shared


type alias User =
    { username : String }


userDecoder : Decode.Decoder User
userDecoder =
    Decode.map User (Decode.field "username" Decode.string)


page : Request -> Loader (Document Never)
page _ =
    Loader.map2 view
        (Loader.session userDecoder)
        Loader.csrfToken


action : Request -> Action (Document Never)
action request =
    case Route.formValue "username" request of
        Nothing ->
            Action.fail 422 "Username is required"

        Just username ->
            if String.isEmpty (String.trim username) then
                Action.fail 422 "Username cannot be blank"
            else
                Action.fromLoader
                    (Loader.setSession
                        (Encode.object [ ( "username", Encode.string username ) ])
                    )
                    |> Action.andThen (\_ -> Action.redirect "/dashboard")


view : Maybe User -> Maybe String -> Document Never
view maybeUser csrfToken =
    Page.page
        { title = "Sign in"
        , head  = Shared.head
        , body  =
            case maybeUser of
                Just user ->
                    [ h1 [] [ text ("Already signed in as " ++ user.username) ]
                    , p [] [ text "Visit the dashboard or sign out." ]
                    ]

                Nothing ->
                    [ h1 [] [ text "Sign in" ]
                    , loginForm csrfToken
                    ]
        }


loginForm : Maybe String -> ElmSsr.Html.Node msg
loginForm csrfToken =
    form [ Attr.method "post", Attr.action "/login" ]
        (csrfField csrfToken
            ++ [ label []
                    [ text "Username"
                    , input [ Attr.type_ "text", Attr.name "username" ]
                    ]
               , button [ Attr.type_ "submit" ] [ text "Sign in" ]
               ]
        )


csrfField : Maybe String -> List (ElmSsr.Html.Node msg)
csrfField maybeCsrf =
    case maybeCsrf of
        Just token ->
            [ input [ Attr.type_ "hidden", Attr.name "_csrf", Attr.value token ] ]

        Nothing ->
            []
```

> The `_csrf` hidden field is read by `csrfMiddleware` before the action runs.
> Without it, all POST requests return 403.

---

## Step 3: The protected page — `Routes/Dashboard.elm`

`Loader.requireUser` checks the session before any data is fetched. If the
session is absent (or the signed cookie is invalid), the request is redirected
to the login path — no data is loaded, no page is rendered.

```elm
module MyApp.Routes.Dashboard exposing (action, page)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (h1, p, text)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Json.Decode as Decode
import MyApp.View.Shared as Shared


type alias User =
    { username : String }


userDecoder : Decode.Decoder User
userDecoder =
    Decode.map User (Decode.field "username" Decode.string)


page : Request -> Loader (Document Never)
page _ =
    Loader.requireUser userDecoder "/login" <| \user ->
        Loader.succeed (view user)


action : Request -> Action (Document Never)
action _ =
    -- Action.requireUser fires before the action body: unauthenticated POST
    -- goes to /login; authenticated POST returns 405.
    Action.requireUser userDecoder "/login" <| \_ ->
        Action.fail 405 "Method not allowed"


view : User -> Document Never
view user =
    Page.page
        { title = "Dashboard"
        , head  = Shared.head
        , body  =
            [ h1 [] [ text "Dashboard" ]
            , p [] [ text ("Welcome, " ++ user.username ++ "!") ]
            ]
        }
```

> **Decoder robustness.** `Loader.session userDecoder` returns `Failed 502` if
> the session payload exists but does not match the decoder. Use tolerant
> decoders (`Decode.maybe` for optional fields) or clear the session on schema
> migrations to avoid 502s after a deploy that changes the payload shape.

---

## Step 4: Logout — add to the login page action

Extend the login page's `action` to handle `?op=logout`:

```elm
action : Request -> Action (Document Never)
action request =
    case Route.query "op" request of
        Just "logout" ->
            -- Destroy the session and clear the signed cookie.
            Action.fromLoader Loader.clearSession
                |> Action.andThen (\_ -> Action.redirect "/login")

        _ ->
            -- Normal login flow (from Step 2)
            case Route.formValue "username" request of
                …
```

The logout form on the dashboard:

```elm
form [ Attr.method "post", Attr.action "/login?op=logout" ]
    (csrfField csrfToken
        ++ [ button [ Attr.type_ "submit" ] [ text "Sign out" ] ]
    )
```

---

## Step 5: Reading the CSRF token for the logout form

The dashboard page needs the CSRF token for the logout form. Add it to the
loader alongside the session:

```elm
page : Request -> Loader (Document Never)
page _ =
    Loader.requireUser userDecoder "/login" <| \user ->
        Loader.map (view user) Loader.csrfToken


view : User -> Maybe String -> Document Never
view user csrfToken =
    Page.page
        { title = "Dashboard"
        , head  = Shared.head
        , body  =
            [ h1 [] [ text ("Welcome, " ++ user.username ++ "!") ]
            , logoutForm csrfToken
            ]
        }
```

---

## Complete flow

```
Browser                         Worker
  │                               │
  │  GET /login                   │
  │ ──────────────────────────►  │  Loader.map2 (session + csrfToken)
  │ ◄──────────────────────────  │  → form with hidden _csrf
  │                               │
  │  POST /login  (username + _csrf)
  │ ──────────────────────────►  │  csrfMiddleware validates token
  │                               │  Action: setSession { username }
  │                               │  redirect → /dashboard
  │  302 /dashboard              │
  │ ◄──────────────────────────  │
  │                               │
  │  GET /dashboard               │
  │ ──────────────────────────►  │  requireUser → session OK → view
  │ ◄──────────────────────────  │  200 with dashboard HTML
  │                               │
  │  POST /login?op=logout  (_csrf)
  │ ──────────────────────────►  │  clearSession → redirect /login
  │  302 /login                  │
  │ ◄──────────────────────────  │
```

---

## Production checklist

- [ ] `SESSION_SECRET` is a 32-byte random value, stored as a secret (not in
      source control).
- [ ] `secure: true` (the default) — never set `secure: false` in production.
- [ ] Use a durable session store (`cacheStore(redisCache(…))` or SQL-backed).
- [ ] The `csrf: true` flag is set — all mutation actions require the token.
- [ ] Session decoder uses `Decode.maybe` for any optional fields to survive
      future schema changes without 502s.

## See also

- [Sessions and CSRF](../sessions.md) — full configuration reference, stores, CSRF detail
- [Loaders and Actions](../loaders-and-actions.md) — `Loader.requireUser`, `Action.requireUser`, cookie helpers
- [examples/basic/src/Example/Basic/Routes/Profile.elm](../../examples/basic/src/Example/Basic/Routes/Profile.elm) — reference implementation
- [examples/basic/src/Example/Basic/Routes/Dashboard.elm](../../examples/basic/src/Example/Basic/Routes/Dashboard.elm) — protected page
