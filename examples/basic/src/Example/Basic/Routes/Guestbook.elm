module Example.Basic.Routes.Guestbook exposing (action, page)

-- File-based routing: GET /guestbook lists entries (Loader.query); POST inserts
-- one (Action via Loader.execute) then redirects. SQL is backend-neutral — D1 on
-- Cloudflare, SQLite/Postgres locally — the Elm code is identical.

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, button, form, h1, input, li, p, section, span, text, ul)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode
import Json.Encode as Encode


page : Request -> Loader (Document Never)
page _ =
    Loader.map view recentEntries


recentEntries : Loader (List String)
recentEntries =
    Loader.query
        { sql = "SELECT message FROM entries ORDER BY id DESC LIMIT 10"
        , params = []
        , decoder = Decode.field "message" Decode.string
        }


action : Request -> Action (Document Never)
action request =
    case Maybe.map String.trim (Route.formValue "message" request) of
        Just message ->
            if String.isEmpty message then
                Action.fail 422 "Message is required."

            else
                Action.fromLoader (saveAndAudit message)
                    |> Action.andThen (\_ -> Action.redirect "/guestbook")

        Nothing ->
            Action.fail 422 "Message is required."


saveAndAudit : String -> Loader ()
saveAndAudit message =
    Loader.execute
        { sql = "INSERT INTO entries (message) VALUES (?)"
        , params = [ Encode.string message ]
        }
        |> Loader.andThen
            (\_ ->
                -- Fire-and-forget: the audit runs after the response is sent.
                Loader.enqueue
                    { task = "auditEntry"
                    , payload = Encode.object [ ( "message", Encode.string message ) ]
                    }
            )


view : List String -> Document Never
view entries =
    Shared.pageDocument "Guestbook"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "SQL via the effect runner" ]
            , h1 [] [ text "Guestbook" ]
            , p [] [ text "Entries are read with Loader.query; the form inserts with Loader.execute inside an Action. The SQL backend is swappable without touching this code." ]
            , entryForm
            , ul [ Attr.class "list" ] (List.map entryItem entries)
            ]
        ]


entryForm : Node msg
entryForm =
    form [ Attr.class "echo-form", Attr.method "post", Attr.action "/guestbook" ]
        [ input [ Attr.type_ "text", Attr.name "message", Attr.placeholder "Sign the guestbook", Attr.required True ]
        , button [ Attr.type_ "submit", Attr.class "btn btn-primary" ] [ text "Sign" ]
        ]


entryItem : String -> Node msg
entryItem message =
    li [] [ text message ]
