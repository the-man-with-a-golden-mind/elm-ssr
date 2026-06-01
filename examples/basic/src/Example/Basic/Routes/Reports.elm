module Example.Basic.Routes.Reports exposing (action, page)

{-| File-based routing: GET /reports renders the submit form;
POST /reports starts a background `generateReport` job and redirects to
/reports?id=<JobId>. The same GET handles both states — when `?id` is set,
it polls `jobStatus` and renders progress or the finished report.

This demonstrates `Loader.startJob` + `Loader.jobStatus` — the pattern for
work that exceeds a single request budget.
-}

import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Document exposing (Document)
import ElmSsr.Html exposing (Node, a, button, code, form, h1, input, label, li, p, section, span, text, ul)
import ElmSsr.Html.Attributes as Attr
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Route as Route exposing (Request)
import Example.Basic.View.Shared as Shared
import Json.Decode as Decode
import Json.Encode as Encode


type alias Report =
    { month : String
    , rows : List { country : String, total : Int }
    }


page : Request -> Loader (Document Never)
page request =
    case Route.query "id" request of
        Just jobId ->
            Loader.map (statusView jobId) (Loader.jobStatus { jobId = jobId, decoder = reportDecoder })

        Nothing ->
            Loader.succeed submitView


action : Request -> Action (Document Never)
action request =
    let
        month =
            Route.formValue "month" request |> Maybe.withDefault "2026-05"
    in
    Action.fromLoader
        (Loader.startJob
            { kind = "generateReport"
            , payload = Encode.object [ ( "month", Encode.string month ) ]
            }
        )
        |> Action.andThen (\id -> Action.redirect ("/reports?id=" ++ id))


reportDecoder : Decode.Decoder Report
reportDecoder =
    Decode.map2 Report
        (Decode.field "month" Decode.string)
        (Decode.field "rows"
            (Decode.list
                (Decode.map2 (\c t -> { country = c, total = t })
                    (Decode.field "country" Decode.string)
                    (Decode.field "total" Decode.int)
                )
            )
        )


submitView : Document Never
submitView =
    Shared.pageDocument "Reports"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text "Background jobs" ]
            , h1 [] [ text "Generate a monthly report" ]
            , p [] [ text "The action submits a job that takes a few seconds. The page redirects to /reports?id=<id>; that page polls the job status until it's done." ]
            , form [ Attr.method "post", Attr.action "/reports", Attr.class "form" ]
                [ label [ Attr.for "month" ] [ text "Month" ]
                , input
                    [ Attr.id "month"
                    , Attr.name "month"
                    , Attr.type_ "text"
                    , Attr.value "2026-05"
                    , Attr.class "input"
                    ]
                , button [ Attr.type_ "submit", Attr.class "btn btn-primary" ] [ text "Start job" ]
                ]
            ]
        ]


statusView : String -> Loader.JobStatus Report -> Document Never
statusView jobId status =
    Shared.pageDocument "Reports"
        [ section [ Attr.class "panel" ]
            [ span [ Attr.class "eyebrow" ] [ text ("Job " ++ jobId) ]
            , h1 [] [ text (headingFor status) ]
            , statusBody status
            , p [] [ a [ Attr.class "text-link", Attr.href "/reports" ] [ text "Submit another" ] ]
            ]
        ]


headingFor : Loader.JobStatus Report -> String
headingFor status =
    case status of
        Loader.JobQueued ->
            "Queued"

        Loader.JobRunning _ ->
            "Running…"

        Loader.JobDone _ ->
            "Report ready"

        Loader.JobFailed _ ->
            "Job failed"

        Loader.JobMissing ->
            "Unknown job"


statusBody : Loader.JobStatus Report -> Node msg
statusBody status =
    case status of
        Loader.JobQueued ->
            p [] [ text "Waiting for a worker to pick it up. Refresh this page in a second." ]

        Loader.JobRunning { progress } ->
            p []
                [ text "Computing… progress: "
                , code []
                    [ text
                        (case progress of
                            Just value ->
                                Encode.encode 0 value

                            Nothing ->
                                "(no progress reported yet)"
                        )
                    ]
                , text ". Refresh to update."
                ]

        Loader.JobDone report ->
            section []
                [ p [] [ text "Month: ", span [ Attr.class "value" ] [ text report.month ] ]
                , ul [ Attr.class "list" ]
                    (List.map
                        (\row -> li [] [ text (row.country ++ ": "), span [ Attr.class "value" ] [ text (String.fromInt row.total) ] ])
                        report.rows
                    )
                ]

        Loader.JobFailed { reason } ->
            p [] [ text ("Reason: " ++ reason) ]

        Loader.JobMissing ->
            p [] [ text "No record under this id. Records expire after 24 hours by default." ]
