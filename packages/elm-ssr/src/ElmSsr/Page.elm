module ElmSsr.Page exposing
    ( document
    , error
    , metaCharset
    , metaName
    , metaViewport
    , notFound
    , page
    , stylesheet
    , title
    )

import ElmSsr.Document exposing (Document)
import ElmSsr.Html as Html exposing (Node, link, meta, text)
import ElmSsr.Html.Attributes exposing (attr, href, rel)


document :
    { status : Int
    , lang : String
    , head : List (Node msg)
    , body : List (Node msg)
    }
    -> Document msg
document config =
    { status = config.status
    , lang = config.lang
    , hasIslands = Html.anyIsland config.body
    , head = config.head
    , body = config.body
    }


page :
    { title : String
    , head : List (Node msg)
    , body : List (Node msg)
    }
    -> Document msg
page config =
    document
        { status = 200
        , lang = "en"
        , head = title config.title :: config.head
        , body = config.body
        }


notFound :
    { title : String
    , head : List (Node msg)
    , body : List (Node msg)
    }
    -> Document msg
notFound config =
    document
        { status = 404
        , lang = "en"
        , head = title config.title :: config.head
        , body = config.body
        }


title : String -> Node msg
title value =
    Html.Element "title" [] [ text value ]


error : Int -> String -> Document Never
error status message =
    { status = status
    , lang = "en"
    , hasIslands = False
    , head = [ title ("Error " ++ String.fromInt status) ]
    , body =
        [ Html.Element "main"
            []
            [ Html.Element "h1" [] [ text (String.fromInt status) ]
            , Html.Element "p" [] [ text message ]
            ]
        ]
    }


stylesheet : String -> Node msg
stylesheet path =
    link [ rel "stylesheet", href path ]


metaCharset : String -> Node msg
metaCharset charset =
    meta [ attr "charset" charset ]


metaViewport : String -> Node msg
metaViewport content =
    meta [ attr "name" "viewport", attr "content" content ]


metaName : String -> String -> Node msg
metaName name content =
    meta [ attr "name" name, attr "content" content ]
