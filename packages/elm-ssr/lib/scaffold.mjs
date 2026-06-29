import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readWorkspaceConfig, writeWorkspaceConfig } from "./workspace.mjs";

const toWords = (value) =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const toPascalCase = (value) =>
  toWords(value)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");

const ensureValidName = (name) => {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error("App name must use lowercase letters, numbers, and dashes only.");
  }
};

const ensureAppMissing = (config, name) => {
  if (config.apps.some((app) => app.name === name)) {
    throw new Error(`App "${name}" already exists in elm-ssr.config.json. If you want to recreate it, remove its entry from elm-ssr.config.json first.`);
  }
};

const elmJsonTemplate = ({ http = false } = {}) => ({
  type: "application",
  "source-directories": [".elm-ssr", "src", ".elm-ssr/src"],
  "elm-version": "0.19.1",
  dependencies: {
    direct: {
      "elm/browser": "1.0.2",
      "elm/core": "1.0.5",
      "elm/html": "1.0.0",
      ...(http ? { "elm/http": "2.0.0" } : {}),
      "elm/json": "1.1.3",
      "elm/url": "1.0.0"
    },
    indirect: {
      ...(http ? { "elm/bytes": "1.0.8", "elm/file": "1.0.5" } : {}),
      "elm/time": "1.0.0",
      "elm/virtual-dom": "1.0.3"
    }
  },
  "test-dependencies": {
    direct: {},
    indirect: {}
  }
});

const sharedTemplate = (namespace, auth) => `module ${namespace}.View.Shared exposing (head, layout)

import ElmSsr.Html exposing (Node, a, div, header, main_, nav, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Page as Page


head : List (Node msg)
head =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Page.stylesheet "/styles.css"
    ]


layout : String -> List (Node msg) -> Node msg
layout pageTitle body =
    div [ class "page" ]
        [ header [ class "header" ]
            [ div [ class "header-inner" ]
                [ a [ class "brand", href "/" ]
                    [ span [ class "brand-icon" ] [ text "◆" ]
                    , text "elm-ssr"
                    ]
                , nav [ class "nav" ]
                    [ a [ class "nav-link", href "/" ] [ text "Home" ]
                    , a [ class "nav-link", href "/counter" ] [ text "Counter" ]${auth ? `
                    , a [ class "nav-link", href "/login" ] [ text "Sign in" ]` : ""}
                    ]
                ]
            ]
        , main_ [ class "main" ]
            [ div [ class "container" ] body
            ]
        ]
`;

const indexRouteTemplate = (namespace, auth) => `module ${namespace}.Routes.Index exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, h2, p, section, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Home"
                [ section [ class "hero" ]
                    [ h1 [ class "hero-title" ] [ text "Ship fast." ]
                    , p [ class "hero-subtitle" ]
                        [ text "Type-safe server-side rendering with interactive islands. Runs on Cloudflare Workers and Bun." ]
                    , div [ class "hero-actions" ]
                        [ a [ class "btn btn-primary", href "/counter" ] [ text "Try the counter" ]${auth ? `
                        , a [ class "btn btn-secondary", href "/login" ] [ text "Sign in" ]` : ""}
                        ]
                    ]
                , section [ class "features" ]
                    [ featureCard "⚡" "Edge-first" "Renders in milliseconds at the edge. No cold starts."
                    , featureCard "🦺" "Fully typed" "End-to-end Elm types from DB to HTML. No runtime surprises."
                    , featureCard "🏝️" "Islands" "Add interactivity exactly where you need it. Zero JS elsewhere."
                    ]
                ]
            ]
        }


featureCard : String -> String -> String -> ElmSsr.Html.Node msg
featureCard icon title_ body =
    div [ class "feature-card" ]
        [ span [ class "feature-icon" ] [ text icon ]
        , h2 [ class "feature-title" ] [ text title_ ]
        , p [ class "feature-body" ] [ text body ]
        ]
`;

const counterRouteTemplate = (namespace) => `module ${namespace}.Routes.Counter exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (div, h1, p, text)
import ElmSsr.Html.Attributes exposing (class)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.Islands.Counter as Counter
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Counter | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Counter"
                [ div [ class "page-header" ]
                    [ h1 [] [ text "Interactive Counter" ]
                    , p [ class "page-subtitle" ]
                        [ text "This page is server-rendered. Only the counter widget below is a client-side island — zero JS elsewhere." ]
                    ]
                , div [ class "card" ]
                    [ Counter.embed { start = 0 } ]
                ]
            ]
        }
`;

const counterIslandTemplate = (namespace) => `module ${namespace}.Islands.Counter exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

-- A standard Browser.element island. The page only embeds a marker and props;
-- the browser mounts this module normally using Elm's own runtime.

import ElmSsr.Island as Island
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import Browser
import Html exposing (Html, button, div, span, text)
import Html.Attributes exposing (class, type_)
import Html.Events exposing (onClick)
import Json.Encode as Encode


embed : Flags -> Node msg
embed =
    Island.embed "Counter"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Nothing
        }


type alias Flags =
    { start : Int }


type alias Model =
    { count : Int }


type Msg
    = Increment
    | Decrement


encodeFlags : Flags -> Encode.Value
encodeFlags flags =
    Encode.object [ ( "start", Encode.int flags.start ) ]


fallback : Flags -> List (Node msg)
fallback flags =
    [ SsrHtml.div [ SsrAttributes.class "counter fallback" ]
        [ SsrHtml.span [ SsrAttributes.class "value" ] [ SsrHtml.text (String.fromInt flags.start) ] ]
    ]


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init flags =
    ( { count = flags.start }, Cmd.none )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            ( { model | count = model.count + 1 }, Cmd.none )

        Decrement ->
            ( { model | count = model.count - 1 }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ class "counter" ]
        [ button [ class "btn btn-secondary btn-square", type_ "button", onClick Decrement ] [ text "−" ]
        , span [ class "counter-value" ] [ text (String.fromInt model.count) ]
        , button [ class "btn btn-primary btn-square", type_ "button", onClick Increment ] [ text "+" ]
        ]
`;

const loginIslandTemplate = (namespace) => `port module ${namespace}.Islands.Login exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import Html exposing (Html, button, div, form, h1, input, label, p, span, text)
import Html.Attributes as Attr
import Html.Events exposing (onInput, onSubmit)
import Http
import Json.Encode as Encode


port navigateTo : String -> Cmd msg


embed : Flags -> Node msg
embed =
    Island.embed "Login"
        { encodeFlags = encodeFlags
        , fallback = fallback
        , id = Nothing
        }


type alias Flags =
    {}


type Mode
    = SignIn
    | SignUp


type FormStatus
    = Idle
    | Submitting
    | FormError String


type alias Model =
    { mode : Mode
    , email : String
    , password : String
    , name : String
    , status : FormStatus
    }


type Msg
    = SetMode Mode
    | SetEmail String
    | SetPassword String
    | SetName String
    | Submit
    | GotResponse (Result Int ())


encodeFlags : Flags -> Encode.Value
encodeFlags _ =
    Encode.object []


fallback : Flags -> List (Node msg)
fallback _ =
    [ SsrHtml.div [ SsrAttributes.class "auth-card" ]
        [ SsrHtml.div [ SsrAttributes.class "auth-header" ]
            [ SsrHtml.span [ SsrAttributes.class "auth-logo" ] [ SsrHtml.text "◆" ]
            , SsrHtml.h1 [ SsrAttributes.class "auth-title" ] [ SsrHtml.text "Sign in" ]
            , SsrHtml.p [ SsrAttributes.class "auth-subtitle" ] [ SsrHtml.text "Loading…" ]
            ]
        ]
    ]


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init _ =
    ( { mode = SignIn, email = "", password = "", name = "", status = Idle }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SetMode mode ->
            ( { model | mode = mode, status = Idle }, Cmd.none )

        SetEmail v ->
            ( { model | email = v }, Cmd.none )

        SetPassword v ->
            ( { model | password = v }, Cmd.none )

        SetName v ->
            ( { model | name = v }, Cmd.none )

        Submit ->
            ( { model | status = Submitting }, submit model )

        GotResponse (Ok ()) ->
            ( model, navigateTo "/profile" )

        GotResponse (Err 401) ->
            ( { model | status = FormError "Invalid email or password." }, Cmd.none )

        GotResponse (Err 422) ->
            ( { model | status = FormError "An account with this email already exists." }, Cmd.none )

        GotResponse (Err _) ->
            ( { model | status = FormError "Something went wrong. Please try again." }, Cmd.none )


submit : Model -> Cmd Msg
submit model =
    let
        url =
            case model.mode of
                SignIn ->
                    "/api/auth/sign-in"

                SignUp ->
                    "/api/auth/sign-up"

        body =
            case model.mode of
                SignIn ->
                    Encode.object
                        [ ( "email", Encode.string model.email )
                        , ( "password", Encode.string model.password )
                        ]

                SignUp ->
                    Encode.object
                        [ ( "email", Encode.string model.email )
                        , ( "password", Encode.string model.password )
                        , ( "name", Encode.string model.name )
                        ]
    in
    Http.post
        { url = url
        , body = Http.jsonBody body
        , expect = Http.expectStringResponse GotResponse httpResult
        }


httpResult : Http.Response String -> Result Int ()
httpResult response =
    case response of
        Http.GoodStatus_ _ _ ->
            Ok ()

        Http.BadStatus_ meta _ ->
            Err meta.statusCode

        _ ->
            Err 0


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    div [ Attr.class "auth-card" ]
        [ div [ Attr.class "auth-header" ]
            [ span [ Attr.class "auth-logo" ] [ text "◆" ]
            , h1 [ Attr.class "auth-title" ]
                [ text
                    (case model.mode of
                        SignIn ->
                            "Welcome back"

                        SignUp ->
                            "Create account"
                    )
                ]
            , p [ Attr.class "auth-subtitle" ]
                [ text
                    (case model.mode of
                        SignIn ->
                            "Sign in to your account to continue."

                        SignUp ->
                            "Sign up to get started."
                    )
                ]
            ]
        , div [ Attr.class "auth-tabs" ]
            [ button
                [ Attr.class
                    (if model.mode == SignIn then
                        "auth-tab auth-tab--active"

                     else
                        "auth-tab"
                    )
                , Attr.type_ "button"
                , Html.Events.onClick (SetMode SignIn)
                ]
                [ text "Sign in" ]
            , button
                [ Attr.class
                    (if model.mode == SignUp then
                        "auth-tab auth-tab--active"

                     else
                        "auth-tab"
                    )
                , Attr.type_ "button"
                , Html.Events.onClick (SetMode SignUp)
                ]
                [ text "Sign up" ]
            ]
        , case model.status of
            FormError message ->
                div [ Attr.class "auth-error" ] [ text message ]

            _ ->
                text ""
        , form [ Attr.class "auth-body", onSubmit Submit ]
            ((case model.mode of
                SignUp ->
                    [ div [ Attr.class "field" ]
                        [ label [ Attr.for "name" ] [ text "Name" ]
                        , input
                            [ Attr.id "name"
                            , Attr.type_ "text"
                            , Attr.class "input"
                            , Attr.value model.name
                            , Attr.attribute "autocomplete" "name"
                            , onInput SetName
                            ]
                            []
                        ]
                    ]

                SignIn ->
                    []
             )
                ++ [ div [ Attr.class "field" ]
                        [ label [ Attr.for "email" ] [ text "Email" ]
                        , input
                            [ Attr.id "email"
                            , Attr.type_ "email"
                            , Attr.class "input"
                            , Attr.value model.email
                            , Attr.attribute "autocomplete" "email"
                            , Attr.required True
                            , Attr.autofocus True
                            , onInput SetEmail
                            ]
                            []
                        ]
                   , div [ Attr.class "field" ]
                        [ label [ Attr.for "password" ] [ text "Password" ]
                        , input
                            [ Attr.id "password"
                            , Attr.type_ "password"
                            , Attr.class "input"
                            , Attr.value model.password
                            , Attr.attribute "autocomplete"
                                (case model.mode of
                                    SignIn ->
                                        "current-password"

                                    SignUp ->
                                        "new-password"
                                )
                            , Attr.required True
                            , onInput SetPassword
                            ]
                            []
                        ]
                   , button
                        [ Attr.type_ "submit"
                        , Attr.class "btn btn-primary btn-full"
                        , Attr.disabled (model.status == Submitting)
                        ]
                        [ text
                            (if model.status == Submitting then
                                "Please wait…"

                             else
                                case model.mode of
                                    SignIn ->
                                        "Sign in"

                                    SignUp ->
                                        "Sign up"
                            )
                        ]
                   ]
            )
        , p [ Attr.class "auth-footer" ]
            [ text "Powered by elm-ssr + BetterAuth" ]
        ]
`;

const notFoundRouteTemplate = (namespace) => `module ${namespace}.Routes.NotFound exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.notFound
        { title = "Not Found | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Not Found"
                [ div [ class "error-page" ]
                    [ h1 [ class "error-code" ] [ text "404" ]
                    , p [ class "error-message" ] [ text "This page doesn't exist." ]
                    , a [ class "btn btn-primary", href "/" ] [ text "Go home" ]
                    ]
                ]
            ]
        }
`;

const betterAuthMigrationTemplate = () => `-- BetterAuth requires these 4 tables. Do not rename or remove columns.
-- Generated by elm-ssr. See https://www.better-auth.com/docs/concepts/database
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT NOT NULL PRIMARY KEY,
    "expiresAt" INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
    id TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" INTEGER,
    "refreshTokenExpiresAt" INTEGER,
    scope TEXT,
    password TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT NOT NULL PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" INTEGER NOT NULL,
    "createdAt" INTEGER,
    "updatedAt" INTEGER
);
`;

const auth0MigrationTemplate = () => `-- Local user cache for Auth0 authenticated users.
-- Auth0 is the canonical identity source; this table stores profile data after first login.
CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);
`;


const loginRouteTemplateBetterAuth = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.Islands.Login as LoginIsland
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Sign in"
                [ LoginIsland.embed {} ]
            ]
        }
`;

const loginRouteTemplateAuth0 = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Sign in"
                [ div [ class "auth-page" ]
                    [ div [ class "auth-card" ]
                        [ div [ class "auth-header" ]
                            [ span [ class "auth-logo" ] [ text "◆" ]
                            , h1 [ class "auth-title" ] [ text "Welcome back" ]
                            , p [ class "auth-subtitle" ] [ text "Sign in to your account to continue." ]
                            ]
                        , div [ class "auth-body" ]
                            [ a [ class "btn btn-primary btn-full", href "/api/auth/login" ]
                                [ text "Continue with Auth0" ]
                            ]
                        , p [ class "auth-footer" ]
                            [ text "Powered by Auth0 via elm-ssr" ]
                        ]
                    ]
                ]
            ]
        }
`;

const profileRouteTemplate = (namespace) => `module ${namespace}.Routes.Profile exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (a, div, h1, p, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared
import Json.Decode as Decode


type alias UserProfile =
    { email : String
    , name : Maybe String
    , picture : Maybe String
    }


-- Decodes the user nested inside the auth session payload:
--   { user: { email, name, picture, ... }, auth: { ... } }
-- Loader.requireUser redirects to /login when this decoder returns Nothing
-- (session absent, expired, or user field is null / missing).
userDecoder : Decode.Decoder UserProfile
userDecoder =
    Decode.field "user"
        (Decode.map3 UserProfile
            (Decode.field "email" Decode.string)
            (Decode.maybe (Decode.field "name" Decode.string))
            (Decode.maybe (Decode.field "picture" Decode.string))
        )


page : Request -> Loader (Document Never)
page _ =
    Loader.requireUser userDecoder "/login" (\\user ->
        Loader.succeed (view user)
    )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : UserProfile -> Document Never
view user =
    Page.page
        { title = "Profile | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layout "Profile"
                [ div [ class "auth-page" ]
                    [ div [ class "auth-card" ]
                        [ div [ class "auth-header" ]
                            [ span [ class "avatar" ]
                                [ text (String.left 1 (Maybe.withDefault user.email user.name) |> String.toUpper) ]
                            , h1 [ class "auth-title" ]
                                [ text (Maybe.withDefault "Your account" user.name) ]
                            , p [ class "auth-subtitle" ] [ text user.email ]
                            ]
                        , div [ class "auth-body" ]
                            [ a [ class "btn btn-secondary btn-full", href "/api/auth/logout" ]
                                [ text "Sign out" ]
                            ]
                        ]
                    ]
                ]
            ]
        }
`;

// ─── Shared auth contract (included in every provider's Auth.ts) ─────────────
// Single source for the session shape Elm reads and all TS providers write.
const authContractSnippet = `import type { AppContext } from "elm-ssr/http";

// Stable shape that every auth provider normalises its user into.
// Elm reads only this — never raw provider-specific session payloads.
export interface AuthUser {
  id?: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  provider?: string;
}

// The full session payload shape — provider-neutral.
// session.user drives Elm guards; session.auth holds transient OAuth state.
interface AuthSessionData {
  user: AuthUser | null;
  auth?: {
    pendingOAuth?: { provider: string; state: string; returnTo?: string };
  };
}

// Writes the authenticated user into the elm-ssr session.
// sessionMiddleware persists and sets the cookie automatically on response.
export const setAuthUser = (context: AppContext, user: AuthUser): void => {
  const existing = (context.session?.data ?? {}) as Partial<AuthSessionData>;
  context.session!.data = { ...existing, user };
  context.session!.dirty = true;
};

// Destroys the elm-ssr session — sessionMiddleware clears the cookie.
export const clearAuthUser = (context: AppContext): void => {
  context.session!.destroyed = true;
};

// Stores transient OAuth state so the callback can verify it (CSRF protection).
export const setPendingOAuth = (
  context: AppContext,
  provider: string,
  state: string,
  returnTo?: string
): void => {
  const existing = (context.session?.data ?? {}) as Partial<AuthSessionData>;
  context.session!.data = {
    ...existing,
    auth: { pendingOAuth: { provider, state, ...(returnTo ? { returnTo } : {}) } },
  };
  context.session!.dirty = true;
};

// Reads pending OAuth state and verifies it belongs to the expected provider.
export const getPendingOAuth = (
  context: AppContext,
  provider: string
): { state: string; returnTo?: string } | null => {
  const data = (context.session?.data ?? null) as AuthSessionData | null;
  const p = data?.auth?.pendingOAuth;
  if (!p || p.provider !== provider) return null;
  return { state: p.state, returnTo: p.returnTo };
};

// Result of a credential or OAuth operation before writing to the session.
export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; message: string };

// Contract each provider must satisfy.
export interface AuthProvider {
  name: string;
  /** URL path prefixes this provider owns (e.g. ["/api/auth/"]). */
  routes: string[];
  middleware: import("elm-ssr/http").Middleware;
}

// Chains providers: first whose routes match handles the request.
export const composeAuthProviders = (
  providers: AuthProvider[]
): import("elm-ssr/http").Middleware =>
  async (context, next) => {
    for (const provider of providers) {
      if (provider.routes.some((r) => context.url.pathname.startsWith(r))) {
        return provider.middleware(context, next);
      }
    }
    return next(context);
  };
`;

// Provider-only code — added to a full Auth.ts by auth add.
const betterAuthProviderCode = `
import { betterAuth } from "better-auth";

// Singleton per isolate — recreated only when the DB binding changes.
let _auth: ReturnType<typeof betterAuth> | null = null;
let _authDb: any = undefined;

const getAuth = (env: any) => {
  const db = env?.DB;
  if (_auth !== null && _authDb === db) return _auth;
  _auth = betterAuth({
    baseURL: (env?.BETTER_AUTH_URL as string) ?? "http://localhost:8787",
    secret: (env?.BETTER_AUTH_SECRET as string) ?? "change-me-in-production",
    database: db,
    emailAndPassword: { enabled: true },
    // socialProviders: {
    //   github: { clientId: env?.GITHUB_CLIENT_ID, clientSecret: env?.GITHUB_CLIENT_SECRET },
    // },
  });
  _authDb = db;
  return _auth;
};

const callBetterAuth = async (
  auth: ReturnType<typeof getAuth>,
  path: string,
  body: Record<string, string>
): Promise<AuthResult> => {
  const res = await auth.handler(
    new Request(\`http://localhost\${path}\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    return { ok: false, status: res.status, message: err.message ?? "Authentication failed" };
  }
  const data = await res.json() as { user?: { email: string; name?: string | null; image?: string | null } };
  if (!data.user?.email) return { ok: false, status: 500, message: "Unexpected auth response" };
  return {
    ok: true,
    user: { email: data.user.email, name: data.user.name, picture: data.user.image, provider: "better-auth" },
  };
};

// Factory: runtime.ts passes getEnv so Auth.ts stays platform-agnostic.
// getEnv injects bun:sqlite locally; on Cloudflare env.DB is the D1 binding.
export const betterAuthProvider = (
  options: { getEnv?: (env: any) => any } = {}
): AuthProvider => {
  const resolveEnv = options.getEnv ?? ((env: any) => env);
  return {
    name: "better-auth",
    routes: ["/api/auth/"],
    middleware: async (context, next) => {
      const env = resolveEnv(context.env);
      const auth = getAuth(env);
      const session = context.session;
      const { pathname } = context.url;

      if (!pathname.startsWith("/api/auth/")) return next(context);
      if (!session) return Response.json({ ok: false, message: "Session middleware required" }, { status: 500 });

      if (pathname === "/api/auth/sign-in" && context.request.method === "POST") {
        const { email = "", password = "" } = await context.request.json().catch(() => ({})) as Record<string, string>;
        const result = await callBetterAuth(auth, "/api/auth/sign-in/email", { email, password });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/sign-up" && context.request.method === "POST") {
        const { email = "", password = "", name = "" } = await context.request.json().catch(() => ({})) as Record<string, string>;
        const result = await callBetterAuth(auth, "/api/auth/sign-up/email", { email, password, name });
        if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });
        setAuthUser(context, result.user);
        return Response.json({ ok: true });
      }

      if (pathname === "/api/auth/logout") {
        clearAuthUser(context);
        return new Response(null, { status: 302, headers: { location: "/login" } });
      }

      // BetterAuth cloud dashboard (routes not in the npm package).
      if (pathname.startsWith("/api/auth/dash/")) {
        if (pathname === "/api/auth/dash/validate") {
          const challenge = context.url.searchParams.get("challenge");
          return new Response(challenge ?? JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": challenge ? "text/plain" : "application/json" },
          });
        }
        const baseURL = (env?.BETTER_AUTH_URL as string) ?? new URL(context.request.url).origin;
        return Response.json({ ok: true, baseURL });
      }

      // All other /api/auth/* (social providers, BetterAuth built-in routes).
      return auth.handler(context.request);
    },
  };
};
`;

const betterAuthEndpointTemplate = () => authContractSnippet + betterAuthProviderCode;

// Provider-only code — added to a full Auth.ts by auth add.
const auth0ProviderCode = `

interface Auth0Config {
  domain: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const getConfig = (env: any): Auth0Config => ({
  domain: (env?.AUTH0_DOMAIN as string) ?? "",
  clientId: (env?.AUTH0_CLIENT_ID as string) ?? "",
  clientSecret: (env?.AUTH0_CLIENT_SECRET as string) ?? "",
  callbackUrl: (env?.AUTH0_CALLBACK_URL as string) ?? "http://localhost:8787/api/auth/callback",
});

// http for localhost (dev/test), https for real Auth0 domains.
const proto = (domain: string) =>
  domain.startsWith("localhost") || domain.startsWith("127.") ? "http" : "https";

export const auth0Provider = (): AuthProvider => ({
  name: "auth0",
  routes: ["/api/auth/"],
  middleware: async (context, next) => {
    const { pathname } = context.url;
    const config = getConfig(context.env);
    const session = context.session;

    if (!pathname.startsWith("/api/auth/")) return next(context);
    if (!session) return new Response("Session middleware required", { status: 500 });

    // Start OAuth2 flow: generate state, persist under session.auth.pendingOAuth.
    if (pathname === "/api/auth/login") {
      if (!config.domain || !config.clientId) {
        return new Response("Auth0 not configured — set AUTH0_DOMAIN and AUTH0_CLIENT_ID in .dev.vars", { status: 500 });
      }
      const state = crypto.randomUUID();
      setPendingOAuth(context, "auth0", state);
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        scope: "openid profile email",
        state,
      });
      return new Response(null, {
        status: 302,
        headers: { location: \`\${proto(config.domain)}://\${config.domain}/authorize?\${params}\` },
      });
    }

    // Finish OAuth2 flow: validate state, exchange code, fetch user via userinfo.
    if (pathname === "/api/auth/callback") {
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      if (!code || !state) return new Response("Missing code or state", { status: 400 });

      const pending = getPendingOAuth(context, "auth0");
      if (!pending || pending.state !== state) {
        return new Response("Invalid OAuth state — possible CSRF attack", { status: 400 });
      }

      const tokenRes = await fetch(\`\${proto(config.domain)}://\${config.domain}/oauth/token\`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.callbackUrl,
        }),
      });
      if (!tokenRes.ok) return new Response("Token exchange with Auth0 failed", { status: 502 });
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Server-to-server user validation — never trust an unverified JWT payload.
      const userRes = await fetch(\`\${proto(config.domain)}://\${config.domain}/userinfo\`, {
        headers: { authorization: \`Bearer \${access_token}\` },
      });
      if (!userRes.ok) return new Response("Failed to fetch user info from Auth0", { status: 502 });
      const user = await userRes.json() as { email: string; name?: string; picture?: string; sub: string };

      setAuthUser(context, { id: user.sub, email: user.email, name: user.name, picture: user.picture, provider: "auth0" });
      return new Response(null, { status: 302, headers: { location: pending.returnTo ?? "/profile" } });
    }

    if (pathname === "/api/auth/logout") {
      clearAuthUser(context);
      if (config.domain && config.clientId) {
        const params = new URLSearchParams({ client_id: config.clientId, returnTo: new URL(context.request.url).origin });
        return new Response(null, {
          status: 302,
          headers: { location: \`\${proto(config.domain)}://\${config.domain}/oidc/logout?\${params}\` },
        });
      }
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    return next(context);
  },
});
`;

const auth0EndpointTemplate = () => authContractSnippet + auth0ProviderCode;

const runtimeTemplate = (appRoot, db = false, auth = undefined) => {
  // appRoot is a slash-separated path like "my-app" or "apps/my-app".
  // The generated bundles live at <workspaceRoot>/generated/<appRoot>/. From
  // <workspaceRoot>/<appRoot>/runtime.ts, we climb out by one ".." per segment.
  const upToRoot = appRoot === "." ? "." : appRoot.split("/").map(() => "..").join("/");
  const generatedPrefix = `${upToRoot}/generated/${appRoot === "." ? "" : appRoot}`.replace(/\/+$/, "");

  const isBetterAuth = auth === "better-auth";
  const isAuth0 = auth === "auth0";

  const imports = [
    `import { createWorkerApp } from "elm-ssr";`,
    `import { renderApp, type CompiledElmModule } from "elm-ssr/render";`,
    `import type { RouteCatalog } from "elm-ssr/http";`,
    `import { islands, bundleSource } from "${generatedPrefix}/islands-manifest";`,
    `import { stylesheet } from "./styles";`,
    `// @ts-expect-error Generated at build time.`,
    `import ElmRuntime from "${generatedPrefix}/app.mjs";`,
    `import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";`
  ];

  if (isBetterAuth) {
    imports.push(`import { memorySessionStore } from "elm-ssr/sessions";`);
    imports.push(`import { betterAuthProvider, composeAuthProviders } from "./src/Endpoints/Auth";`);
  } else if (isAuth0) {
    imports.push(`import { memorySessionStore } from "elm-ssr/sessions";`);
    imports.push(`import { auth0Provider, composeAuthProviders } from "./src/Endpoints/Auth";`);
  }

  let dbInit = '';
  if (db) {
    dbInit = `
let sqlHandler: any = undefined;
if (typeof Bun !== "undefined") {
  try {
    const sqliteModule = "bun" + ":sqlite";
    const { Database } = require(sqliteModule);
    const db = new Database(import.meta.dir + "/app.db");
    sqlHandler = (query: any) => {
      const statement = db.query(query.sql);
      if (query.mode === "all") {
        return statement.all(...query.params);
      }
      if (query.mode === "first") {
        return statement.get(...query.params) ?? null;
      }
      const info = statement.run(...query.params);
      return { rowsAffected: info.changes };
    };
  } catch (err) {
    console.error("Failed to initialize bun:sqlite:", err);
  }
}
`;
  }

  let routeAuthAdditions = '';
  if (auth) {
    routeAuthAdditions = `
    {
      path: "/login",
      methods: ["GET"],
      description: "User authentication login page."
    },
    {
      path: "/profile",
      methods: ["GET"],
      description: "Authenticated user profile."
    },`;
  }

  // BetterAuth: manually wrap effects with sessionEffects (no elm-ssr session cookie).
  // Auth0 / plain: use the effects callback directly.
  const baseEffectsBody = `(effect, context) => {
    if (context.env) {
      return cloudflareEffects(${db ? '{ dbBinding: "DB" }' : ''})(effect, context);
    }
    return inMemoryEffects({
      env: process.env as any${db ? ',\n      sql: sqlHandler' : ''}
    })(effect, context);
  }`;

  // Both auth providers use elm-ssr sessions as the single source of truth.
  // authMiddleware is always composeAuthProviders([...provider]) — same shape regardless of provider.
  const effectsConfig = auth
    ? `,\n  effects: ${baseEffectsBody},\n  middlewares: [authMiddleware]`
    : `,\n  effects: ${baseEffectsBody}`;

  let sessionsConfig = '';
  let authInit = '';

  if (isBetterAuth) {
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || (env?.BETTER_AUTH_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] }`;
    authInit = `
// Local dev: open bun:sqlite so BetterAuth works without a Cloudflare D1 binding.
// On Cloudflare Workers this block is eliminated by esbuild (typeof Bun is "undefined").
let bunAuthDb: any = undefined;
if (typeof (globalThis as any).Bun !== "undefined") {
  const sqliteModule = "bun" + ":sqlite";
  const { Database } = require(sqliteModule);
  bunAuthDb = new Database(import.meta.dir + "/app.db");
}

// Injects local SQLite as env.DB for Bun dev; on Cloudflare env.DB is the D1 binding.
const getAuthEnv = (env: any): any =>
  bunAuthDb && !env?.DB ? { ...(env ?? {}), DB: bunAuthDb } : env;

export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  betterAuthProvider({ getEnv: getAuthEnv }),
]);
`;
  } else if (isAuth0) {
    sessionsConfig = `,
  sessions: {
    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] }`;
    authInit = `
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  auth0Provider(),
]);
`;
  }

  // Auth routing is handled entirely through elm-ssr's middlewares option —
  // no worker.fetch wrapping needed.

  return `${imports.join("\n")}

const elmModule = ElmRuntime as CompiledElmModule;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/",
      methods: ["GET", "HEAD"],
      description: "Stateless starter page rendered from Elm (no client runtime)."
    },
    {
      path: "/counter",
      methods: ["GET", "HEAD"],
      description: "Interactive counter route rendered from Elm."
    },${routeAuthAdditions}
  ],
  assets: [
    {
      path: "/styles.css",
      methods: ["GET", "HEAD"],
      description: "Starter stylesheet."
    },
    {
      path: "/__elm-ssr/islands.js",
      methods: ["GET", "HEAD"],
      description: "Island loader runtime."
    },
    {
      path: "/__elm-ssr/islands-bundle.js",
      methods: ["GET", "HEAD"],
      description: "Shared Browser.element island bundle."
    }
  ],
  utility: [
    {
      path: "/health",
      methods: ["GET", "HEAD"],
      description: "Plain text liveness endpoint."
    }
  ],
  api: [
    {
      path: "/api/health",
      methods: ["GET", "HEAD"],
      description: "JSON health payload."
    },
    {
      path: "/api/routes",
      methods: ["GET", "HEAD"],
      description: "Route registry for the starter app."
    },
    {
      path: "/api/render",
      methods: ["GET", "HEAD"],
      description: "SSR preview endpoint."
    }
  ]
};

export const createFlags = ({ request, path, formData, env }: { request?: Request; url?: URL; path: string; formData?: Record<string, string>; env?: Record<string, unknown> }) => {
  const [pathname, search = ""] = path.split("?");

  const envVars: Record<string, string | number | boolean> = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        envVars[key] = value;
      }
    }
  }

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: formData ?? {},
    env: envVars
  };
};

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }));
${dbInit}${authInit}
export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags${sessionsConfig}${effectsConfig}
});
`;
};

const workerTemplate = () => `import { worker } from "./runtime";

export default worker;
`;

const stylesTemplate = () => `export const stylesheet = \`
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f6f5f3;
  --surface: #ffffff;
  --border: #e5e2dd;
  --text: #1a1a1a;
  --text-muted: #6b6b6b;
  --accent: #1a1a1a;
  --accent-hover: #333;
  --radius: 12px;
  --header-h: 60px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 16px;
  color: var(--text);
  background: var(--bg);
}

body { min-height: 100vh; }

/* ── Layout ────────────────────────────────────────── */
.page { display: flex; flex-direction: column; min-height: 100vh; }

.header {
  height: var(--header-h);
  border-bottom: 1px solid var(--border);
  background: rgba(246, 245, 243, 0.85);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.01em;
}

.brand-icon { font-size: 0.85em; opacity: 0.6; }

.nav { display: flex; align-items: center; gap: 0.25rem; }

.nav-link {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}
.nav-link:hover { background: var(--border); color: var(--text); }

.main { flex: 1; padding: 3rem 1.5rem; }

.container { max-width: 1100px; margin: 0 auto; }

/* ── Typography ────────────────────────────────────── */
h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
p  { line-height: 1.65; color: var(--text-muted); }

/* ── Buttons ────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.55rem 1.1rem;
  border-radius: 8px;
  border: 1.5px solid transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-secondary:hover { background: var(--bg); }

.btn-square { width: 2.5rem; height: 2.5rem; padding: 0; font-size: 1.1rem; }

.btn-full { width: 100%; }

/* ── Cards ──────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

/* ── Hero ────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 5rem 0 4rem;
  max-width: 640px;
  margin: 0 auto;
}

.hero-title {
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  margin-bottom: 1rem;
}

.hero-subtitle {
  font-size: 1.15rem;
  margin-bottom: 2rem;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

/* ── Features ────────────────────────────────────────── */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-top: 4rem;
}

.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

.feature-icon { font-size: 1.5rem; display: block; margin-bottom: 0.75rem; }

.feature-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text);
}

.feature-body { font-size: 0.9rem; }

/* ── Page header ─────────────────────────────────────── */
.page-header { margin-bottom: 2rem; }
.page-header h1 { margin-bottom: 0.5rem; }
.page-subtitle { font-size: 0.95rem; }

/* ── Counter island ──────────────────────────────────── */
.counter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
}

.counter-value {
  text-align: center;
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

/* ── Auth pages ──────────────────────────────────────── */
.auth-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3rem;
}

.auth-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 2.5rem;
  width: 100%;
  max-width: 380px;
}

.auth-header { text-align: center; margin-bottom: 1.5rem; }

.auth-tabs { display: flex; gap: .5rem; margin-bottom: 1.5rem; }

.auth-tab {
  flex: 1; padding: .5rem;
  border: none; border-radius: 8px;
  font: inherit; font-size: .875rem; font-weight: 500;
  cursor: pointer; background: var(--bg); color: var(--text-muted);
  transition: all .12s;
}
.auth-tab--active { background: var(--accent); color: white; }

.auth-error {
  color: #c53030; font-size: .8rem; margin-bottom: 1rem;
  padding: .5rem .75rem;
  background: #fff5f5; border: 1px solid #fed7d7; border-radius: 8px;
}

.auth-logo {
  font-size: 1.5rem;
  display: block;
  margin-bottom: 1rem;
}

.auth-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
.auth-subtitle { font-size: 0.9rem; }

.auth-body { display: flex; flex-direction: column; gap: 0.75rem; }

.auth-footer {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 1.5rem;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

/* ── Error page ──────────────────────────────────────── */
.error-page {
  text-align: center;
  padding: 5rem 0;
}

.error-code {
  font-size: 6rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--border);
  margin-bottom: 0.5rem;
}

.error-message { margin-bottom: 2rem; }

/* ── Forms ───────────────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: 0.35rem; }
.field label, .field span { font-size: 0.875rem; font-weight: 500; }

.input {
  width: 100%;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  padding: 0.6rem 0.9rem;
  font: inherit;
  font-size: 0.9rem;
  background: white;
  color: var(--text);
  transition: border-color 0.12s;
}
.input:focus { outline: none; border-color: var(--accent); }

.error-hint { color: #c53030; font-size: 0.8rem; margin-top: 0.25rem; }
\`;
`;

// ─── auth add / auth list helpers ────────────────────────────────────────────

const PROVIDER_NAMES = { "better-auth": "betterAuth", auth0: "auth0" };

const normaliseProvider = (raw) => {
  if (raw === "betterAuth" || raw === "better-auth") return "better-auth";
  if (raw === "auth0") return "auth0";
  throw new Error(`Unknown auth provider: "${raw}". Supported: betterAuth, auth0`);
};

// Detect which providers are already wired in a runtime.ts file.
const detectProviders = (runtimeContent) => {
  const found = [];
  if (runtimeContent.includes("betterAuthProvider")) found.push("better-auth");
  if (runtimeContent.includes("auth0Provider")) found.push("auth0");
  return found;
};

// Add auth imports after the effects import line.
const addAuthImports = (content, provider) => {
  const providerImport = provider === "better-auth"
    ? `import { betterAuthProvider, composeAuthProviders } from "./src/Endpoints/Auth";`
    : `import { auth0Provider, composeAuthProviders } from "./src/Endpoints/Auth";`;
  const sessionImport = `import { memorySessionStore } from "elm-ssr/sessions";`;
  const toInject = `${sessionImport}\n${providerImport}`;
  const anchor = `import { inMemoryEffects, cloudflareEffects } from "elm-ssr/effects";`;
  if (content.includes(toInject)) return content; // already present
  return content.replace(anchor, `${anchor}\n${toInject}`);
};

// Build the auth init block that goes before createWorkerApp.
const buildAuthInitBlock = (provider, hasDb) => {
  if (provider === "better-auth") {
    return `
// elm-ssr-auth:start
let bunAuthDb: any = undefined;
if (typeof (globalThis as any).Bun !== "undefined") {
  const sqliteModule = "bun" + ":sqlite";
  const { Database } = require(sqliteModule);
  bunAuthDb = new Database(import.meta.dir + "/app.db");
}

const getAuthEnv = (env: any): any =>
  bunAuthDb && !env?.DB ? { ...(env ?? {}), DB: bunAuthDb } : env;

export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  betterAuthProvider({ getEnv: getAuthEnv }),
]);`;
  }
  return `
// elm-ssr-auth:start
export const sessionStore = memorySessionStore();

const authMiddleware = composeAuthProviders([
  auth0Provider(),
]);`;
};

// Injects auth into a runtime.ts that has no auth yet.
const injectAuthIntoRuntime = (content, provider, hasDb) => {
  // Find where the worker export starts (always near end of generated file).
  const workerIdx = content.indexOf("\nexport const worker = createWorkerApp({");
  if (workerIdx === -1) return content;

  const base = content.slice(0, workerIdx);
  const workerBlock = content.slice(workerIdx);

  // Extract the existing effects config from the worker block.
  const effectsMatch = workerBlock.match(/\n  effects: ([\s\S]*?)\n\}\);/);
  const effectsLine = effectsMatch
    ? `  effects: ${effectsMatch[1]}`
    : `  effects: (effect, context) => {\n    if (context.env) {\n      return cloudflareEffects(${hasDb ? '{ dbBinding: "DB" }' : ''})(effect, context);\n    }\n    return inMemoryEffects({ env: process.env as any${hasDb ? ', sql: sqlHandler' : ''} })(effect, context);\n  }`;

  const secretLine = provider === "better-auth"
    ? `    secret: (env) => (env?.SESSION_SECRET as string) || (env?.BETTER_AUTH_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",`
    : `    secret: (env) => (env?.SESSION_SECRET as string) || "change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars",`;

  const newWorker = `\nexport const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags,
  sessions: {
${secretLine}
    store: sessionStore,
    secure: false
  },
  csrf: { skipPaths: ["/api/auth/"] },
  middlewares: [authMiddleware],
${effectsLine}
});
// elm-ssr-auth:end\n`;

  const withImports = addAuthImports(base, provider);
  return withImports + buildAuthInitBlock(provider, hasDb) + newWorker;
};

// Adds a second provider to an already-auth runtime.ts.
const addProviderToRuntime = (content, provider) => {
  const providerCall = provider === "better-auth"
    ? "betterAuthProvider({ getEnv: getAuthEnv })"
    : "auth0Provider()";
  if (content.includes(providerCall.split("(")[0])) return content; // already present
  return content.replace(
    /composeAuthProviders\(\[\n([\s\S]*?)\]\)/,
    (_, inner) => `composeAuthProviders([\n${inner}  ${providerCall},\n])`
  );
};

// Patch or create runtime.ts for a new provider.
const patchRuntimeForAuth = (content, provider, hasDb) => {
  if (content.includes("// elm-ssr-auth:start")) {
    return addProviderToRuntime(content, provider);
  }
  // Provider already present without markers (e.g. scaffolded with --auth) — leave unchanged.
  const providerFn = provider === "better-auth" ? "betterAuthProvider" : "auth0Provider";
  if (content.includes(providerFn)) return content;
  return injectAuthIntoRuntime(content, provider, hasDb);
};

// Adds a provider to Auth.ts (creates full file if missing, appends code otherwise).
const updateAuthTs = (existingContent, provider) => {
  const providerFn = provider === "better-auth" ? "betterAuthProvider" : "auth0Provider";
  if (existingContent.includes(providerFn)) return null; // already present
  const snippet = provider === "better-auth" ? betterAuthProviderCode : auth0ProviderCode;
  // If file already has the contract section, just append provider code.
  if (existingContent.includes("composeAuthProviders")) {
    return existingContent.trimEnd() + "\n" + snippet + "\n";
  }
  // No contract yet — generate full file.
  return provider === "better-auth"
    ? betterAuthEndpointTemplate()
    : auth0EndpointTemplate();
};

// Returns provider-specific env vars to add to .dev.vars / .env.
const missingEnvVars = (existingContent, provider) => {
  const vars = provider === "better-auth"
    ? [
        ['BETTER_AUTH_SECRET', '"change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"'],
        ['BETTER_AUTH_URL', '"http://localhost:8787"'],
      ]
    : [
        ['SESSION_SECRET', '"change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"'],
        ['AUTH0_DOMAIN', '"your-tenant.auth0.com"'],
        ['AUTH0_CLIENT_ID', '"your-client-id"'],
        ['AUTH0_CLIENT_SECRET', '"your-client-secret"'],
        ['AUTH0_CALLBACK_URL', '"http://localhost:8787/api/auth/callback"'],
      ];
  return vars.filter(([key]) => !existingContent.includes(`${key}=`));
};

/**
 * Add an auth provider to an existing elm-ssr app.
 * Idempotent: running it twice has no effect.
 */
export const addAuthProvider = async (rootPath, appConfig, rawProvider) => {
  const provider = normaliseProvider(rawProvider);
  const appRoot = resolve(rootPath, appConfig.root);
  const namespace = appConfig.module;

  // ── Auth.ts ───────────────────────────────────────────────────────────────
  const authTsPath = resolve(appRoot, "src/Endpoints/Auth.ts");
  let authTsContent = "";
  try { authTsContent = await readFile(authTsPath, "utf8"); } catch {}
  const newAuthTs = updateAuthTs(authTsContent, provider);
  if (newAuthTs !== null) {
    await mkdir(dirname(authTsPath), { recursive: true });
    await writeFile(authTsPath, newAuthTs, "utf8");
  }

  // ── runtime.ts ───────────────────────────────────────────────────────────
  const runtimePath = resolve(appRoot, "runtime.ts");
  const runtimeContent = await readFile(runtimePath, "utf8").catch(() => "");
  if (runtimeContent) {
    const hasDb = runtimeContent.includes("let sqlHandler") || runtimeContent.includes("import.meta.dir");
    const patched = patchRuntimeForAuth(runtimeContent, provider, hasDb);
    if (patched !== runtimeContent) {
      await writeFile(runtimePath, patched, "utf8");
    }
  }

  // ── elm.json: add elm/http for BetterAuth (Login island needs Http.post) ──
  if (provider === "better-auth") {
    const elmJsonPath = resolve(appRoot, "elm.json");
    try {
      const elmJson = JSON.parse(await readFile(elmJsonPath, "utf8"));
      if (!elmJson.dependencies.direct["elm/http"]) {
        elmJson.dependencies.direct["elm/http"] = "2.0.0";
        elmJson.dependencies.indirect["elm/bytes"] = elmJson.dependencies.indirect["elm/bytes"] ?? "1.0.8";
        elmJson.dependencies.indirect["elm/file"] = elmJson.dependencies.indirect["elm/file"] ?? "1.0.5";
        await writeFile(elmJsonPath, JSON.stringify(elmJson, null, 2) + "\n", "utf8");
      }
    } catch {}
  }

  // ── Elm pages: create only if missing ────────────────────────────────────
  const loginPath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Routes/Login.elm`);
  try { await stat(loginPath); } catch {
    await mkdir(dirname(loginPath), { recursive: true });
    const content = provider === "better-auth"
      ? loginRouteTemplateBetterAuth(namespace)
      : loginRouteTemplateAuth0(namespace);
    await writeFile(loginPath, content, "utf8");
  }
  const profilePath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Routes/Profile.elm`);
  try { await stat(profilePath); } catch {
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, profileRouteTemplate(namespace), "utf8");
  }
  // Login island for BetterAuth
  if (provider === "better-auth") {
    const islandPath = resolve(appRoot, `src/${namespace.replace(/\./g, "/")}/Islands/Login.elm`);
    try { await stat(islandPath); } catch {
      await mkdir(dirname(islandPath), { recursive: true });
      await writeFile(islandPath, loginIslandTemplate(namespace), "utf8");
    }
  }

  // ── Migration: create only if BetterAuth and no migration exists ──────────
  if (provider === "better-auth") {
    const migDir = resolve(appRoot, "migrations");
    let hasMigration = false;
    try {
      const files = await (await import("node:fs/promises")).readdir(migDir);
      hasMigration = files.some(f => f.endsWith(".sql") && !f.endsWith(".down.sql"));
    } catch {}
    if (!hasMigration) {
      await mkdir(migDir, { recursive: true });
      await writeFile(resolve(migDir, "0001_init.sql"), betterAuthMigrationTemplate(), "utf8");
    }
  }

  // ── package.json: at workspace root (not app dir) ────────────────────────
  if (provider === "better-auth") {
    const pkgPath = resolve(rootPath, "package.json");
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (!pkg.devDependencies?.["better-auth"]) {
        pkg.devDependencies = { ...pkg.devDependencies, "better-auth": "1.6.22" };
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      }
    } catch {}
  }

  // ── .dev.vars (app dir) / .env (workspace root): add missing env vars ─────
  for (const filePath of [resolve(appRoot, ".dev.vars"), resolve(rootPath, ".env")]) {
    let existing = "";
    try { existing = await readFile(filePath, "utf8"); } catch {}
    const missing = missingEnvVars(existing, provider);
    if (missing.length > 0) {
      const toAdd = missing.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
      await writeFile(filePath, (existing ? existing.trimEnd() + "\n" : "") + toAdd, "utf8");
    }
  }

  return { provider, name: PROVIDER_NAMES[provider] };
};

/**
 * List auth providers already wired in an app's runtime.ts.
 */
export const listAuthProviders = async (rootPath, appConfig) => {
  const runtimePath = resolve(rootPath, appConfig.root, "runtime.ts");
  try {
    const content = await readFile(runtimePath, "utf8");
    return detectProviders(content);
  } catch {
    return [];
  }
};

const devVarsContent = (auth) => {
  if (auth === "better-auth") {
    return `GREETING="Hello from your local .dev.vars file!"
BETTER_AUTH_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:8787"
# Uncomment to enable social providers in src/Endpoints/Auth.ts:
# GITHUB_CLIENT_ID="your-github-client-id"
# GITHUB_CLIENT_SECRET="your-github-client-secret"
`;
  }
  if (auth === "auth0") {
    return `GREETING="Hello from your local .dev.vars file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"
AUTH0_CALLBACK_URL="http://localhost:8787/api/auth/callback"
`;
  }
  return `GREETING="Hello from your local .dev.vars file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`;
};

const rootEnvContent = (auth) => {
  if (auth === "better-auth") {
    return `GREETING="Hello from your local .env file!"
BETTER_AUTH_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:8787"
`;
  }
  if (auth === "auth0") {
    return `GREETING="Hello from your local .env file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"
AUTH0_CALLBACK_URL="http://localhost:8787/api/auth/callback"
`;
  }
  return `GREETING="Hello from your local .env file!"
SESSION_SECRET="change-me-to-a-secure-random-hmac-secret-key-that-is-at-least-32-chars"
`;
};

const filesForApp = (name, appRoot, options = {}) => {
  const namespace = toPascalCase(name);
  const db = options.db || !!options.auth;
  const auth = options.auth;
  const tailwind = options.tailwind;

  const files = [
    { path: `${appRoot}/elm.json`, content: JSON.stringify(elmJsonTemplate({ http: auth === "better-auth" }), null, 2) + "\n" },
    { path: `${appRoot}/runtime.ts`, content: runtimeTemplate(appRoot, db, auth) },
    { path: `${appRoot}/worker.ts`, content: workerTemplate() },
    { path: `${appRoot}/styles.ts`, content: stylesTemplate() },
    { path: `${appRoot}/src/${namespace}/View/Shared.elm`, content: sharedTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Index.elm`, content: indexRouteTemplate(namespace, auth) },
    { path: `${appRoot}/src/${namespace}/Routes/Counter.elm`, content: counterRouteTemplate(namespace) },
    { path: `${appRoot}/src/${namespace}/Routes/NotFound.elm`, content: notFoundRouteTemplate(namespace) },
    { path: `${appRoot}/src/${namespace}/Islands/Counter.elm`, content: counterIslandTemplate(namespace) },
    {
      path: `${appRoot}/.dev.vars`,
      content: devVarsContent(auth)
    }
  ];

  if (db) {
    let migrationContent;
    if (auth === "better-auth") {
      migrationContent = betterAuthMigrationTemplate();
    } else if (auth === "auth0") {
      migrationContent = auth0MigrationTemplate();
    } else {
      migrationContent = `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);\n`;
    }
    files.push({
      path: `${appRoot}/migrations/0001_init.sql`,
      content: migrationContent
    });
  }

  if (auth) {
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Login.elm`,
      content: auth === "better-auth"
        ? loginRouteTemplateBetterAuth(namespace)
        : loginRouteTemplateAuth0(namespace)
    });
    files.push({
      path: `${appRoot}/src/${namespace}/Routes/Profile.elm`,
      content: profileRouteTemplate(namespace)
    });
    files.push({
      path: `${appRoot}/src/Endpoints/Auth.ts`,
      content: auth === "better-auth" ? betterAuthEndpointTemplate() : auth0EndpointTemplate()
    });
    if (auth === "better-auth") {
      files.push({
        path: `${appRoot}/src/${namespace}/Islands/Login.elm`,
        content: loginIslandTemplate(namespace)
      });
    }
  }

  if (tailwind) {
    files.push({
      path: `${appRoot}/src/app.css`,
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  h1 { @apply text-3xl font-bold tracking-tight text-gray-900 mb-4; }
  h2 { @apply text-xl font-semibold text-gray-900 mb-3; }
  p  { @apply leading-relaxed text-gray-600 mb-4; }
  a  { @apply text-gray-900 underline underline-offset-2 hover:no-underline; }
}

@layer components {
  .page { @apply flex flex-col min-h-screen; }
  .header { @apply sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-md; }
  .header-inner { @apply max-w-6xl mx-auto px-6 h-16 flex items-center justify-between; }
  .brand { @apply flex items-center gap-2 font-bold text-gray-900 no-underline; }
  .nav { @apply flex items-center gap-1; }
  .nav-link { @apply px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 no-underline hover:bg-gray-100 hover:text-gray-900 transition-colors; }
  .main { @apply flex-1 px-6 py-12; }
  .container { @apply max-w-6xl mx-auto; }
  .card { @apply bg-white border border-gray-200 rounded-xl p-6; }

  .btn { @apply inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium no-underline cursor-pointer transition-colors whitespace-nowrap; }
  .btn-primary { @apply bg-gray-900 text-white border-gray-900 hover:bg-gray-700; }
  .btn-secondary { @apply bg-white text-gray-900 border-gray-200 hover:bg-gray-50; }
  .btn-square { @apply w-10 h-10 p-0 text-lg; }
  .btn-full { @apply w-full; }

  .hero { @apply text-center py-20 max-w-2xl mx-auto; }
  .hero-title { @apply text-6xl font-extrabold tracking-tight mb-4; }
  .hero-subtitle { @apply text-lg text-gray-500 mb-8 max-w-lg mx-auto; }
  .hero-actions { @apply flex gap-3 justify-center flex-wrap; }

  .features { @apply grid gap-4 mt-16; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .feature-card { @apply bg-white border border-gray-200 rounded-xl p-6; }
  .feature-icon { @apply text-2xl block mb-3; }
  .feature-title { @apply text-base font-semibold mb-2; }
  .feature-body { @apply text-sm text-gray-500; }

  .page-header { @apply mb-8; }
  .page-subtitle { @apply text-gray-500 mt-2; }

  .counter { @apply grid items-center gap-4; grid-template-columns: auto 1fr auto; }
  .counter-value { @apply text-center text-5xl font-bold tracking-tight; }

  .auth-page { @apply flex justify-center pt-12; }
  .auth-card { @apply bg-white border border-gray-200 rounded-2xl p-10 w-full max-w-sm; }
  .auth-header { @apply text-center mb-6; }
  .auth-tabs { @apply flex gap-2 mb-6; }
  .auth-tab { @apply flex-1 py-2 border-0 rounded-lg text-sm font-medium cursor-pointer bg-gray-100 text-gray-500 transition-all; }
  .auth-tab--active { @apply bg-gray-900 text-white; }
  .auth-error { @apply text-red-700 text-xs mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg; }
  .auth-logo { @apply text-2xl block mb-4; }
  .auth-title { @apply text-2xl font-bold tracking-tight mb-2; }
  .auth-subtitle { @apply text-sm text-gray-500; }
  .auth-body { @apply flex flex-col gap-3; }
  .auth-footer { @apply text-center text-xs text-gray-400 mt-6; }
  .avatar { @apply inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-900 text-white text-2xl font-bold mb-4; }

  .error-page { @apply text-center py-20; }
  .error-code { @apply text-8xl font-extrabold text-gray-200 mb-2; }
  .error-message { @apply text-gray-500 mb-8; }

  .field { @apply flex flex-col gap-1.5; }
  .input { @apply w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-gray-900 transition-colors; }
  .error-hint { @apply text-red-600 text-xs mt-1; }
}
`
    });
  }

  const configEntry = {
    name,
    root: appRoot,
    module: namespace
  };
  if (tailwind) {
    configEntry.tailwind = true;
  }

  return {
    configEntry,
    files
  };
};

const normalizeAppRoot = (rawRoot, name) => {
  const candidate = (rawRoot ?? name).trim().replace(/^\/+|\/+$/g, "");
  if (candidate.length === 0) {
    throw new Error("App root cannot be empty.");
  }
  if (candidate.includes("..")) {
    throw new Error(`App root must not contain '..': ${candidate}`);
  }
  return candidate;
};

const ensurePackageJson = async (rootPath, appName, options = {}) => {
  const packageJsonPath = resolve(rootPath, "package.json");
  let packageJson = {};
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    packageJson = {
      name: appName,
      version: "0.1.0",
      type: "module",
      scripts: {},
      devDependencies: {}
    };
  }

  packageJson.scripts = {
    build: "elm-ssr build",
    dev: "elm-ssr dev",
    routes: "elm-ssr routes",
    migrate: "elm-ssr migrate",
    ...packageJson.scripts
  };

  const extraDeps = {};
  if (options.auth === "better-auth") {
    extraDeps["better-auth"] = "1.6.22";
  }

  packageJson.devDependencies = {
    "elm-ssr": "latest",
    wrangler: "^4.0.0",
    ...extraDeps,
    ...packageJson.devDependencies
  };

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
};

/**
 * Scaffold a new elm-ssr app under `<rootPath>/<appRoot>/` and register it in
 * elm-ssr.config.json. `appRoot` defaults to the app's `name`; pass an
 * explicit value to place the app under a subdirectory (e.g. "apps/my-app").
 */
export const createAppScaffold = async (rootPath, name, options = {}) => {
  ensureValidName(name);

  let config;
  try {
    config = await readWorkspaceConfig(rootPath);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      config = { apps: [] };
    } else {
      throw err;
    }
  }
  ensureAppMissing(config, name);

  const appRoot = normalizeAppRoot(options.root, name);

  const { configEntry, files } = filesForApp(name, appRoot, options);

  for (const file of files) {
    const filePath = resolve(rootPath, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }

  // Create .env at workspace root if it doesn't exist
  const envPath = resolve(rootPath, ".env");
  let envExists = false;
  try {
    await stat(envPath);
    envExists = true;
  } catch {}

  if (!envExists) {
    await writeFile(envPath, rootEnvContent(options.auth), "utf8");
  }

  await writeWorkspaceConfig(rootPath, {
    ...config,
    apps: [...config.apps, configEntry]
  });

  await ensurePackageJson(rootPath, name, options);

  return configEntry;
};

/** @deprecated Use `createAppScaffold`. */
export const createExampleScaffold = createAppScaffold;

const parseRoutePath = (routePath) => {
  const parts = routePath.split("/").map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid route path: "${routePath}"`);
  }
  
  return parts.map(part => {
    const clean = part.replace(/_+$/, "");
    const underscores = part.slice(clean.length);
    return toPascalCase(clean) + underscores;
  });
};

export const createRouteScaffold = async (rootPath, appConfig, routePath, options = {}) => {
  const parts = parseRoutePath(routePath);
  const namespace = appConfig.module;
  
  if (options.isWs || options.isSse) {
    const endpointName = parts.join("");
    const fileSubpath = `src/Endpoints/${parts.join("/")}.ts`;
    const filePath = resolve(rootPath, appConfig.root, fileSubpath);
    
    let content = "";
    let type = "";
    let instructions = "";
    
    if (options.isWs) {
      type = "WebSocket";
      content = `export const handleWebSocket = (request: Request): Response => {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();
  server.addEventListener("message", (event) => {
    console.log("WS received:", event.data);
    server.send(JSON.stringify({ echo: event.data, time: new Date().toISOString() }));
  });

  server.addEventListener("close", () => {
    console.log("WS connection closed");
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
};
`;
      instructions = `1. Import this handler in your worker entrypoint (${appConfig.root}/worker.ts or runtime.ts):
   import { handleWebSocket } from "./src/Endpoints/${parts.join("/")}";

2. Intercept the request in your fetch handler:
   if (url.pathname === "/${routePath}") {
     return handleWebSocket(request);
   }`;
    } else {
      type = "Server-Sent Events (SSE)";
      content = `import { createSseStream } from "elm-ssr/sse";

export const handleSse = (request: Request): Response => {
  return createSseStream(request, async (send, signal) => {
    let count = 0;
    while (!signal.aborted && count < 100) {
      count += 1;
      send(JSON.stringify({ event: "tick", count, time: new Date().toISOString() }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
};
`;
      instructions = `1. Import this handler in your worker entrypoint (${appConfig.root}/worker.ts or runtime.ts):
   import { handleSse } from "./src/Endpoints/${parts.join("/")}";

2. Intercept the request in your fetch handler:
   if (url.pathname === "/${routePath}") {
     return handleSse(request);
   }`;
    }
    
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    
    return { type, path: fileSubpath, instructions };
  } else {
    const moduleName = parts.join(".");
    const fileSubpath = `src/${namespace.split(".").join("/")}/Routes/${parts.join("/")}.elm`;
    const filePath = resolve(rootPath, appConfig.root, fileSubpath);
    
    let content = "";
    let type = "";
    
    if (options.isApi) {
      type = "Elm JSON API";
      content = `module ${namespace}.Routes.${moduleName} exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route exposing (Request)
import Json.Encode as Encode

page : Request -> Loader (Document Never)
page _ =
    Loader.fail 405 "GET not allowed on this API route"

action : Request -> Action (Document Never)
action request =
    -- Process request and return JSON response
    Action.json <|
        Encode.object
            [ ( "ok", Encode.bool True )
            , ( "message", Encode.string "Hello from ${routePath} API route!" )
            ]
`;
    } else {
      type = "Elm Page";
      content = `module ${namespace}.Routes.${moduleName} exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (div, text)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.View.Shared as Shared

page : Request -> Loader (Document Never)
page _ =
    Loader.succeed view

action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"

view : Document Never
view =
    Page.page
        { title = "${parts[parts.length - 1]}"
        , head = Shared.head
        , body = [ div [] [ text "Hello from ${routePath}!" ] ]
        }
`;
    }
    
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    
    return { type, path: fileSubpath };
  }
};
