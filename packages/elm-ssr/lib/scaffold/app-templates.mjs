export const elmJsonTemplate = ({ http = false } = {}) => ({
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

export const sharedTemplate = (namespace, auth) => auth ? `module ${namespace}.View.Shared exposing (head, layoutFor, User, sessionDecoder)

import ElmSsr.Html exposing (Node, a, div, header, main_, nav, span, text)
import ElmSsr.Html.Attributes exposing (class, href)
import ElmSsr.Page as Page
import Json.Decode as Decode


head : List (Node msg)
head =
    [ Page.metaCharset "utf-8"
    , Page.metaViewport "width=device-width, initial-scale=1"
    , Page.stylesheet "/styles.css"
    ]


type alias User =
    { email : String
    , name : Maybe String
    }


userDecoder : Decode.Decoder User
userDecoder =
    Decode.map2 User
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "name" Decode.string))


{-| Decodes the session payload's "user" field, if present. Pair with
\`Loader.session Shared.sessionDecoder |> Loader.map (Maybe.andThen identity)\`
to get \`Maybe User\` — outer Maybe is "no session", inner is "session, no user".
-}
sessionDecoder : Decode.Decoder (Maybe User)
sessionDecoder =
    Decode.oneOf
        [ Decode.field "user" (Decode.nullable userDecoder)
        , Decode.succeed Nothing
        ]


{-| Session-aware page chrome — nav shows "Sign in" or the signed-in user. -}
layoutFor : String -> Maybe User -> List (Node msg) -> Node msg
layoutFor pageTitle maybeUser body =
    div [ class "page" ]
        [ header [ class "header" ]
            [ div [ class "header-inner" ]
                [ a [ class "brand", href "/" ]
                    [ span [ class "brand-icon" ] [ text "◆" ]
                    , text "elm-ssr"
                    ]
                , nav [ class "nav" ]
                    [ a [ class "nav-link", href "/" ] [ text "Home" ]
                    , a [ class "nav-link", href "/counter" ] [ text "Counter" ]
                    , case maybeUser of
                        Just user ->
                            a [ class "nav-link", href "/profile" ]
                                [ text (Maybe.withDefault user.email user.name) ]

                        Nothing ->
                            a [ class "nav-link", href "/login" ] [ text "Sign in" ]
                    ]
                ]
            ]
        , main_ [ class "main" ]
            [ div [ class "container" ] body
            ]
        ]
` : `module ${namespace}.View.Shared exposing (head, layout)

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
                    , a [ class "nav-link", href "/counter" ] [ text "Counter" ]
                    ]
                ]
            ]
        , main_ [ class "main" ]
            [ div [ class "container" ] body
            ]
        ]
`;

// Additive block appended to an existing (non-auth) View/Shared.elm by `auth add`.
// Deliberately does NOT touch the existing `layout` function or its call sites —
// existing pages keep compiling unchanged; only newly-added Login/Profile pages
// (and any page the user migrates by hand) use `layoutFor`.
export const sharedAuthAddition = () => `

type alias User =
    { email : String
    , name : Maybe String
    }


userDecoder : Decode.Decoder User
userDecoder =
    Decode.map2 User
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "name" Decode.string))


{-| Decodes the session payload's "user" field, if present. Pair with
\`Loader.session Shared.sessionDecoder |> Loader.map (Maybe.andThen identity)\`
to get \`Maybe User\` — outer Maybe is "no session", inner is "session, no user".
-}
sessionDecoder : Decode.Decoder (Maybe User)
sessionDecoder =
    Decode.oneOf
        [ Decode.field "user" (Decode.nullable userDecoder)
        , Decode.succeed Nothing
        ]


{-| Session-aware page chrome — nav shows "Sign in" or the signed-in user. -}
layoutFor : String -> Maybe User -> List (Node msg) -> Node msg
layoutFor pageTitle maybeUser body =
    div [ class "page" ]
        [ header [ class "header" ]
            [ div [ class "header-inner" ]
                [ a [ class "brand", href "/" ]
                    [ span [ class "brand-icon" ] [ text "◆" ]
                    , text "elm-ssr"
                    ]
                , nav [ class "nav" ]
                    [ a [ class "nav-link", href "/" ] [ text "Home" ]
                    , a [ class "nav-link", href "/counter" ] [ text "Counter" ]
                    , case maybeUser of
                        Just user ->
                            a [ class "nav-link", href "/profile" ]
                                [ text (Maybe.withDefault user.email user.name) ]

                        Nothing ->
                            a [ class "nav-link", href "/login" ] [ text "Sign in" ]
                    ]
                ]
            ]
        , main_ [ class "main" ]
            [ div [ class "container" ] body
            ]
        ]
`;

export const indexRouteTemplate = (namespace, auth) => auth ? `module ${namespace}.Routes.Index exposing (page, action)

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
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.map view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Maybe Shared.User -> Document Never
view maybeUser =
    Page.page
        { title = "elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Home"
                maybeUser
                [ section [ class "hero" ]
                    [ h1 [ class "hero-title" ] [ text "Ship fast." ]
                    , p [ class "hero-subtitle" ]
                        [ text "Type-safe server-side rendering with interactive islands. Runs on Cloudflare Workers and Bun." ]
                    , div [ class "hero-actions" ]
                        ([ a [ class "btn btn-primary", href "/counter" ] [ text "Try the counter" ] ]
                            ++ (case maybeUser of
                                    Just _ ->
                                        [ a [ class "btn btn-secondary", href "/profile" ] [ text "Your profile" ] ]

                                    Nothing ->
                                        [ a [ class "btn btn-secondary", href "/login" ] [ text "Sign in" ] ]
                               )
                        )
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
` : `module ${namespace}.Routes.Index exposing (page, action)

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
                        [ a [ class "btn btn-primary", href "/counter" ] [ text "Try the counter" ] ]
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

export const counterRouteTemplate = (namespace, auth) => auth ? `module ${namespace}.Routes.Counter exposing (page, action)

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
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.map view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Maybe Shared.User -> Document Never
view maybeUser =
    Page.page
        { title = "Counter | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Counter"
                maybeUser
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
` : `module ${namespace}.Routes.Counter exposing (page, action)

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

export const counterIslandTemplate = (namespace) => `module ${namespace}.Islands.Counter exposing
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

export const notFoundRouteTemplate = (namespace, auth) => auth ? `module ${namespace}.Routes.NotFound exposing (page, action)

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
    Loader.session Shared.sessionDecoder
        |> Loader.map (Maybe.andThen identity)
        |> Loader.map view


action : Request -> Action (Document Never)
action _ =
    Action.fail 405 "Method not allowed"


view : Maybe Shared.User -> Document Never
view maybeUser =
    Page.notFound
        { title = "Not Found | elm-ssr"
        , head = Shared.head
        , body =
            [ Shared.layoutFor "Not Found"
                maybeUser
                [ div [ class "error-page" ]
                    [ h1 [ class "error-code" ] [ text "404" ]
                    , p [ class "error-message" ] [ text "This page doesn't exist." ]
                    , a [ class "btn btn-primary", href "/" ] [ text "Go home" ]
                    ]
                ]
            ]
        }
` : `module ${namespace}.Routes.NotFound exposing (page, action)

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

