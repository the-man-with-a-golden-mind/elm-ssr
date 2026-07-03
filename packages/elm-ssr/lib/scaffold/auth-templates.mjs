export const loginIslandTemplate = (namespace) => `port module ${namespace}.Islands.Login exposing
    ( embed
    , Flags, Model, Msg
    , encodeFlags
    , init, main, subscriptions, update, view
    )

-- TIP: For client validation that matches server Actions, use ElmSsr.Form
--   Form.decode decoder [ ("email", model.email), ... ] 
-- See also routes generated with --resource.

import Browser
import ElmSsr.Html as SsrHtml exposing (Node)
import ElmSsr.Html.Attributes as SsrAttributes
import ElmSsr.Island as Island
import ElmSsr.Form as Form
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
    , errors : List Form.Error
    }


loginDecoder : Form.Decoder { email : String, password : String, name : String }
loginDecoder =
    Form.succeed (\\e p n -> { email = e, password = p, name = n })
        |> Form.required "email" (Form.string |> Form.validate Form.email)
        |> Form.required "password" (Form.string |> Form.validate Form.nonEmpty)
        |> Form.optionalWithDefault "name" "" Form.string


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
    ( { mode = SignIn, email = "", password = "", name = "", status = Idle, errors = [] }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SetMode mode ->
            ( { model | mode = mode, status = Idle, errors = [] }, Cmd.none )

        SetEmail v ->
            ( { model | email = v, errors = [] }, Cmd.none )

        SetPassword v ->
            ( { model | password = v, errors = [] }, Cmd.none )

        SetName v ->
            ( { model | name = v, errors = [] }, Cmd.none )

        Submit ->
            let
                pairs =
                    [ ( "email", model.email )
                    , ( "password", model.password )
                    , ( "name", model.name )
                    ]
            in
            case Form.decode loginDecoder pairs of
                Ok _ ->
                    ( { model | status = Submitting, errors = [] }, submit model )

                Err errors ->
                    ( { model | status = Idle, errors = errors }, Cmd.none )

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
                        , fieldError "email" model.errors
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
                        , fieldError "password" model.errors
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


fieldError : String -> List Form.Error -> Html msg
fieldError field errors =
    case Form.errorFor field errors of
        Just message ->
            span [ Attr.class "error-hint" ] [ text message ]

        Nothing ->
            text ""
`;

export const betterAuthMigrationTemplate = () => `-- BetterAuth requires these 4 tables. Do not rename or remove columns.
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

export const auth0MigrationTemplate = () => `-- Local user cache for Auth0 authenticated users.
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


export const loginRouteTemplateBetterAuth = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route exposing (Request)
import ${namespace}.Islands.Login as LoginIsland
import ${namespace}.View.Shared as Shared


page : Request -> Loader (Document Never)
page _ =
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.andThen
            (\\maybeUser ->
                case maybeUser of
                    Just _ ->
                        Loader.redirect "/profile"

                    Nothing ->
                        Loader.succeed view
            )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Sign in"
                Nothing
                [ LoginIsland.embed {} ]
            ]
        }
`;

export const loginRouteTemplateAuth0 = (namespace) => `module ${namespace}.Routes.Login exposing (page, action)

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
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.andThen
            (\\maybeUser ->
                case maybeUser of
                    Just _ ->
                        Loader.redirect "/profile"

                    Nothing ->
                        Loader.succeed view
            )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Document Never
view =
    Page.page
        { title = "Sign in | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Sign in"
                Nothing
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

export const profileRouteTemplate = (namespace) => `module ${namespace}.Routes.Profile exposing (page, action)

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
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.andThen
            (\\maybeUser ->
                case maybeUser of
                    Just user ->
                        Loader.succeed (view user)

                    Nothing ->
                        Loader.redirect "/login"
            )


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Shared.User -> Document Never
view user =
    Page.page
        { title = "Profile | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Profile"
                (Just user)
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

// Minimal glue: imports the real provider from elm-ssr's auth library and
// configures it for this app's env shape. Provider internals (route handling,
// the BetterAuth dash() plugin, session bridging, cookie handling, the Auth0
// OAuth2 exchange) live in packages/elm-ssr/src/auth/*.ts — tested directly
// there, not copy-pasted into every generated app.
export const betterAuthProviderCode = `
import { createBetterAuthProvider } from "elm-ssr/auth/better-auth";

// Local dev: bun:sqlite, so BetterAuth works with no Cloudflare D1 binding (eliminated by esbuild on Workers).
let bunAuthDb: any = undefined;
if (typeof (globalThis as any).Bun !== "undefined") {
  const sqliteModule = "bun" + ":sqlite";
  const { Database } = require(sqliteModule);
  // Same DATABASE_URL convention as runtime.ts's sqlHandler — non-sqlite schemes fail loud below.
  const rawDbUrl = process.env.DATABASE_URL || "";
  if (rawDbUrl && !rawDbUrl.startsWith("sqlite://") && /^[a-z][a-z0-9+.-]*:\\/\\//i.test(rawDbUrl)) {
    throw new Error("[elm-ssr] DATABASE_URL=" + rawDbUrl + " is not a local sqlite target (see runtime.ts).");
  }
  const dbPath = rawDbUrl.startsWith("sqlite://")
    ? rawDbUrl.slice("sqlite://".length)
    : rawDbUrl || (import.meta.dir + "/../../app.db");
  bunAuthDb = new Database(dbPath);
  bunAuthDb.exec("PRAGMA journal_mode = WAL"); // shares the file with runtime.ts's sqlHandler connection
}

export const betterAuthProvider = createBetterAuthProvider({
  baseURL: (env) => (env?.BETTER_AUTH_URL as string) ?? "http://localhost:8787",
  secret: (env) => (env?.BETTER_AUTH_SECRET as string) ?? "change-me-in-production",
  database: (env) => (bunAuthDb && !env?.DB ? bunAuthDb : env?.DB),
  // Set BETTER_AUTH_API_KEY to connect this app at https://dash.better-auth.com. Safe to leave unset.
  apiKey: (env) => env?.BETTER_AUTH_API_KEY as string | undefined,
});
`;

export const betterAuthEndpointTemplate = () => betterAuthProviderCode;

export const auth0ProviderCode = `
import { createAuth0Provider } from "elm-ssr/auth/auth0";

export const auth0Provider = createAuth0Provider({
  domain: (env) => (env?.AUTH0_DOMAIN as string) ?? "",
  clientId: (env) => (env?.AUTH0_CLIENT_ID as string) ?? "",
  clientSecret: (env) => (env?.AUTH0_CLIENT_SECRET as string) ?? "",
  callbackUrl: (env) => (env?.AUTH0_CALLBACK_URL as string) ?? "http://localhost:8787/api/auth/callback",
});
`;

export const auth0EndpointTemplate = () => auth0ProviderCode;
