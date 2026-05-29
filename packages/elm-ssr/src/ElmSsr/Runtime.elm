module ElmSsr.Runtime exposing
    ( Config, Ports
    , State, Msg
    , program
    )

{-| The engine that renders routes.

Every route is a stateless page: the runtime decodes the request, runs the
matched route's loader (pumping its effects through the Worker), and renders the
resulting document. There is no document-level update loop — all interactivity
lives in islands ([`ElmSsr.Island`](./Island.elm)).

Application authors never call this directly; the generated `Main` wires the
ports and the file-based router to [`program`](#program).

@docs Config, Ports
@docs State, Msg
@docs program

-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document as Document exposing (Document)
import ElmSsr.Document.Encode as Encode
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Page as Page
import ElmSsr.Route as Route exposing (Request)
import Json.Decode as Decode
import Json.Encode as Json
import Platform


{-| The ports the generated `Main` connects to the JS runtime. -}
type alias Ports =
    { effectRequest : Json.Value -> Cmd Msg
    , effectResult : (Decode.Value -> Msg) -> Sub Msg
    , rendered : Json.Value -> Cmd Msg
    , start : (Decode.Value -> Msg) -> Sub Msg
    }


{-| The file-based router plus the ports. -}
type alias Config =
    { router : Request -> Loader (Document Never)
    , action : Request -> Action (Document Never)
    , ports : Ports
    }


{-| Runtime state for one request. -}
type State
    = AwaitingStart Request
    | LoadingPage (Decode.Value -> Loader (Document Never))
    | PerformingAction (Decode.Value -> Action (Document Never))
    | Rendered
    | Aborted Int String


{-| Runtime messages. -}
type Msg
    = StartRequested
    | EffectResolved Decode.Value


{-| Build the `Program` for an app's routes. -}
program : Config -> Program Decode.Value State Msg
program config =
    Platform.worker
        { init = init
        , update = update config
        , subscriptions = subscriptions config
        }


init : Decode.Value -> ( State, Cmd Msg )
init flags =
    case Decode.decodeValue Route.decoder flags of
        Ok request ->
            ( AwaitingStart request, Cmd.none )

        Err decodeError ->
            ( Aborted 400 ("Invalid request flags: " ++ Decode.errorToString decodeError), Cmd.none )


update : Config -> Msg -> State -> ( State, Cmd Msg )
update config msg state =
    case msg of
        StartRequested ->
            case state of
                AwaitingStart request ->
                    if Route.method request == "GET" || Route.method request == "HEAD" then
                        advance config (config.router request)

                    else
                        advanceAction config (config.action request)

                Aborted status message ->
                    ( state, renderError config status message )

                _ ->
                    ( state, Cmd.none )

        EffectResolved value ->
            case state of
                LoadingPage continue ->
                    advance config (continue value)

                PerformingAction continue ->
                    advanceAction config (continue value)

                _ ->
                    ( state, Cmd.none )


advance : Config -> Loader (Document Never) -> ( State, Cmd Msg )
advance config loader =
    case Loader.step loader of
        Loader.Resolved document ->
            ( Rendered, render config document )

        Loader.Errored status message ->
            ( Aborted status message, renderError config status message )

        Loader.Await effect continue ->
            ( LoadingPage continue, config.ports.effectRequest (Loader.encodeEffect effect) )


advanceAction : Config -> Action (Document Never) -> ( State, Cmd Msg )
advanceAction config action =
    case Action.step action of
        Action.Resolved document ->
            ( Rendered, render config document )

        Action.Errored status message ->
            ( Aborted status message, renderError config status message )

        Action.Moved url ->
            ( Rendered, config.ports.rendered (Action.encodeStep (always Json.null) (Action.Moved url)) )

        Action.SentJson value ->
            ( Rendered, config.ports.rendered (Action.encodeStep (always Json.null) (Action.SentJson value)) )

        Action.Await effect continue ->
            ( PerformingAction continue, config.ports.effectRequest (Loader.encodeEffect effect) )


render : Config -> Document Never -> Cmd Msg
render config document =
    config.ports.rendered (Action.encodeStep Encode.encode (Action.Resolved (Document.map never document)))


renderError : Config -> Int -> String -> Cmd Msg
renderError config status message =
    config.ports.rendered
        (Json.object
            [ ( "kind", Json.string "errored" )
            , ( "status", Json.int status )
            , ( "message", Json.string message )
            , ( "value", Encode.encode (Document.map never (Page.error status message)) )
            ]
        )


subscriptions : Config -> State -> Sub Msg
subscriptions config _ =
    Sub.batch
        [ config.ports.start (\_ -> StartRequested)
        , config.ports.effectResult EffectResolved
        ]
