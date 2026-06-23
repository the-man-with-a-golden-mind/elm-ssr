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
import ElmSsr.Db.Dsl as Db
import Example.Basic.View.Shared as Shared
import Example.Basic.Db.Entries as Entries
import Json.Decode as Decode
import Json.Encode as Encode


page : Request -> Loader (Document Never)
page request =
    Loader.map (view (Route.query "q" request)) (recentEntries (Route.query "q" request))


recentEntries : Maybe String -> Loader (List Entries.Entry)
recentEntries maybeQ =
    let
        baseQuery =
            Db.select Entries.table [ Db.col Entries.id, Db.col Entries.message, Db.col Entries.createdAt ] Entries.decoder
                |> Db.limit 10
    in
    case maybeQ of
        Just q ->
            if String.isEmpty (String.trim q) then
                Db.toLoader baseQuery

            else
                baseQuery
                    |> Db.where_ (Entries.message |> Db.like ("%" ++ q ++ "%"))
                    |> Db.toLoader

        Nothing ->
            Db.toLoader baseQuery


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
    Entries.insert { message = message }
        |> Loader.andThen
            (\_ ->
                -- Fire-and-forget: the audit runs after the response is sent.
                Loader.enqueue
                    { task = "auditEntry"
                    , payload = Encode.object [ ( "message", Encode.string message ) ]
                    }
            )


view : Maybe String -> List Entries.Entry -> Document Never
view maybeQ entries =
    Shared.pageDocument "Guestbook"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "SQL via the effect runner" ]
            , h1 [] [ text "Guestbook" ]
            , p [] [ text "Entries are read with Loader.query; the form inserts with Loader.execute inside an Action. The SQL backend is swappable without touching this code." ]
            , searchForm maybeQ
            , entryForm
            , ul [ Attr.class "list" ] (List.map entryItem entries)
            ]
        ]


searchForm : Maybe String -> Node msg
searchForm maybeQ =
    form [ Attr.class "echo-form", Attr.method "get", Attr.action "/guestbook", Attr.style "margin-bottom" "12px" ]
        [ input [ Attr.type_ "text", Attr.name "q", Attr.placeholder "Search entries...", Attr.value (Maybe.withDefault "" maybeQ) ]
        , button [ Attr.type_ "submit", Attr.class "btn btn-secondary" ] [ text "Search" ]
        ]


entryForm : Node msg
entryForm =
    form [ Attr.class "echo-form", Attr.method "post", Attr.action "/guestbook" ]
        [ input [ Attr.type_ "text", Attr.name "message", Attr.placeholder "Sign the guestbook", Attr.required True ]
        , button [ Attr.type_ "submit", Attr.class "btn btn-primary" ] [ text "Sign" ]
        ]


entryItem : Entries.Entry -> Node msg
entryItem entry =
    li []
        [ span [ Attr.class "value" ] [ text entry.message ]
        , span [ Attr.class "muted", Attr.style "font-size" "0.85em", Attr.style "margin-left" "8px" ] [ text ("(" ++ entry.createdAt ++ ")") ]
        ]
