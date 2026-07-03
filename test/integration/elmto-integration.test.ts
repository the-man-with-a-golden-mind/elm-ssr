import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const DATABASE_URL = process.env.DATABASE_URL;

const shouldSkip = !DATABASE_URL;
const integration = shouldSkip ? describe.skip : describe;

if (shouldSkip) {
  console.warn("Skipping elmto-integration tests (no DATABASE_URL).");
}

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

integration("Elmto Integration (Real SQLite and PostgreSQL Repo)", () => {
  it("runs Repo queries and mutations E2E against SQLite and PostgreSQL", async () => {
    const root = await mkdtemp(join(tmpdir(), "elm-ssr-elmto-it-"));
    tempRoots.push(root);

    await symlink(
      resolve(process.cwd(), "node_modules"),
      join(root, "node_modules"),
      "dir"
    );

    await symlink(
      resolve(process.cwd(), ".elm-home"),
      join(root, ".elm-home"),
      "dir"
    );

    await writeFile(
      resolve(root, "elm-ssr.config.json"),
      JSON.stringify({ apps: [] }, null, 2),
      "utf8"
    );

    // 1. Scaffold new app
    const scaffoldCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "new", "elmto-it-app", "--root", root],
      { cwd: process.cwd() }
    );
    expect(await scaffoldCmd.exited).toBe(0);

    // 2. Add Elmto Route module
    const routeCode = `module ElmtoItApp.Routes.TestRepo exposing (page, action)

import Json.Decode as Decode
import Json.Encode as Encode
import Dict exposing (Dict)
import ElmSsr.Loader as Loader exposing (Loader)
import ElmSsr.Action as Action exposing (Action)
import ElmSsr.Route as Route exposing (Request)
import ElmSsr.Page as Page
import ElmSsr.Document exposing (Document)
import ElmSsr.Html
import ElmSsr.Html.Attributes
import ElmSsr.Db.Elmto as Elmto
import ElmSsr.Db.Elmto.Changeset as Changeset
import ElmSsr.Db.Elmto.Query as Query
import ElmSsr.Db.Elmto.Compiler as Compiler exposing (Dialect(..))
import ElmSsr.Db.Elmto.Repo as Repo

type alias User =
    { id : Int
    , name : String
    , email : String
    , age : Maybe Int
    }

type alias Post =
    { id : Int
    , userId : Int
    , title : String
    }

type alias Comment =
    { id : Int
    , postId : Int
    , body : String
    }

type alias UserStats =
    { name : String
    , postCount : Int
    , averageAge : Maybe Float
    }

type alias UserPostCount =
    { userId : Int
    , postCount : Int
    }

type alias NamePostCount =
    { name : String
    , postCount : Maybe Int
    }

userDecoder : Decode.Decoder User
userDecoder =
    Decode.map4 User
        (Decode.field "id" Decode.int)
        (Decode.field "name" Decode.string)
        (Decode.field "email" Decode.string)
        (Decode.maybe (Decode.field "age" Decode.int))

userSchema : Elmto.Schema User
userSchema =
    Elmto.schema "elmto_users" userDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "name" .name Elmto.string
        |> Elmto.field "email" .email Elmto.string
        |> Elmto.optionalField "age" .age Elmto.int

postDecoder : Decode.Decoder Post
postDecoder =
    Decode.map3 Post
        (Decode.field "id" Decode.int)
        (Decode.field "user_id" Decode.int)
        (Decode.field "title" Decode.string)

postSchema : Elmto.Schema Post
postSchema =
    Elmto.schema "elmto_posts" postDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "title" .title Elmto.string

commentDecoder : Decode.Decoder Comment
commentDecoder =
    Decode.map3 Comment
        (Decode.field "id" Decode.int)
        (Decode.field "post_id" Decode.int)
        (Decode.field "body" Decode.string)

commentSchema : Elmto.Schema Comment
commentSchema =
    Elmto.schema "elmto_comments" commentDecoder
        |> Elmto.field "id" .id Elmto.int
        |> Elmto.field "post_id" .postId Elmto.int
        |> Elmto.field "body" .body Elmto.string

statsDecoder : Decode.Decoder UserStats
statsDecoder =
    Decode.map3 UserStats
        (Decode.field "name" Decode.string)
        (Decode.field "post_count" Decode.int)
        (Decode.field "average_age" (Decode.nullable Decode.float))

userPostCountDecoder : Decode.Decoder UserPostCount
userPostCountDecoder =
    Decode.map2 UserPostCount
        (Decode.field "user_id" Decode.int)
        (Decode.field "post_count" Decode.int)

namePostCountDecoder : Decode.Decoder NamePostCount
namePostCountDecoder =
    Decode.map2 NamePostCount
        (Decode.field "name" Decode.string)
        (Decode.field "post_count" (Decode.nullable Decode.int))

userPostCountSchema : Elmto.Schema UserPostCount
userPostCountSchema =
    Elmto.schema "user_post_counts" userPostCountDecoder
        |> Elmto.field "user_id" .userId Elmto.int
        |> Elmto.field "post_count" .postCount Elmto.int

idCol = Elmto.column "id" Encode.int
nameCol = Elmto.column "name" Encode.string
ageCol = Elmto.column "age" Encode.int
postIdCol = Elmto.column "id" Encode.int
postUserIdCol = Elmto.column "user_id" Encode.int
postCountCol = Elmto.column "post_count" Encode.int
postTitleCol = Elmto.column "title" Encode.string
commentPostIdCol = Elmto.column "post_id" Encode.int
commentBodyCol = Elmto.column "body" Encode.string

getDialect : Loader Dialect
getDialect =
    Loader.env "DB_DIALECT"
        |> Loader.map (\\maybeVal ->
            case maybeVal of
                Just "postgres" -> PostgreSQL
                _ -> SQLite
        )

encodeUser : User -> Encode.Value
encodeUser u =
    Encode.object
        [ ("id", Encode.int u.id)
        , ("name", Encode.string u.name)
        , ("email", Encode.string u.email)
        , ("age", case u.age of
                    Just a -> Encode.int a
                    Nothing -> Encode.null
          )
        ]

page : Request -> Loader (Document Never)
page req =
    getDialect
        |> Loader.andThen (\\dialect ->
            let
                queryMap = Dict.fromList req.query
                op = Dict.get "op" queryMap |> Maybe.withDefault ""

                summaryQuery =
                    Query.from userSchema
                        |> Query.select
                            [ Query.col nameCol
                            , Query.joinedCount postSchema postUserIdCol |> Query.as_ "post_count"
                            , Query.avg ageCol |> Query.as_ "average_age"
                            ]
                            statsDecoder
                        |> Query.join Query.InnerJoin postSchema idCol postUserIdCol
                        |> Query.whereJoined postSchema (Query.like "%" postTitleCol)
                        |> Query.groupBy [ Query.groupByCol nameCol ]
                        |> Query.having (Query.havingGte 1 (Query.joinedCountOf postSchema postUserIdCol))
                        |> Query.orderBy [ Query.asc nameCol ]

                graphQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.distinct
                        |> Query.joinOn Query.InnerJoin postSchema
                            (Query.onAnd
                                (Query.onEq idCol postUserIdCol)
                                (Query.onRight (Query.like "F%" postTitleCol))
                            )
                        |> Query.joinFrom Query.InnerJoin postSchema commentSchema
                            (Query.onAnd
                                (Query.onEq postIdCol commentPostIdCol)
                                (Query.onRight (Query.isNotNull commentBodyCol))
                            )
                        |> Query.orderBy [ Query.asc nameCol ]

                postsPerUserSubquery =
                    Query.from postSchema
                        |> Query.select
                            [ Query.col postUserIdCol
                            , Query.count postIdCol |> Query.as_ "post_count"
                            ]
                            userPostCountDecoder
                        |> Query.groupBy [ Query.groupByCol postUserIdCol ]

                topPosterCountsQuery =
                    Query.fromSubquery userPostCountSchema postsPerUserSubquery
                        |> Query.where_ (Query.gte 2 postCountCol)
                        |> Query.orderBy [ Query.desc postCountCol ]

                cteCountsQuery =
                    Query.from userPostCountSchema
                        |> Query.withCte userPostCountSchema postsPerUserSubquery
                        |> Query.where_ (Query.gte 2 postCountCol)
                        |> Query.orderBy [ Query.desc postCountCol ]

                joinedCountsQuery =
                    Query.from userSchema
                        |> Query.select
                            [ Query.col nameCol
                            , Query.joinedCol userPostCountSchema postCountCol |> Query.as_ "post_count"
                            ]
                            namePostCountDecoder
                        |> Query.joinSubquery Query.LeftJoin userPostCountSchema postsPerUserSubquery (Query.onEq idCol postUserIdCol)
                        |> Query.orderBy [ Query.asc nameCol ]

                namesWithPostsQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_
                            (Query.existsBy idCol postUserIdCol
                                (Query.from postSchema
                                    |> Query.select [ Query.col postUserIdCol ] (Decode.field "user_id" Decode.int)
                                )
                            )
                        |> Query.orderBy [ Query.asc nameCol ]

                namesWithoutPostsQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_
                            (Query.notExistsBy idCol postUserIdCol
                                (Query.from postSchema
                                    |> Query.select [ Query.col postUserIdCol ] (Decode.field "user_id" Decode.int)
                                )
                            )
                        |> Query.orderBy [ Query.asc nameCol ]

                namesViaInSubqueryQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_ (Query.inSubquery idCol (Query.from postSchema |> Query.select [ Query.col postUserIdCol ] (Decode.field "user_id" Decode.int)))
                        |> Query.orderBy [ Query.asc nameCol ]

                upperNamesQuery =
                    Query.from userSchema
                        |> Query.select [ Query.selectFragment "UPPER(name)" [] "upper_name" ] (Decode.field "upper_name" Decode.string)
                        |> Query.orderBy [ Query.asc nameCol ]

                fragmentNamesQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_ (Query.fragment "name <> ?" [ Encode.string "Frank" ])
                        |> Query.orderBy [ Query.asc nameCol ]

                unionDistinctQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_ (Query.like "A%" nameCol)
                        |> Query.union
                            (Query.from userSchema
                                |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                                |> Query.where_ (Query.like "C%" nameCol)
                            )
                        |> Query.orderBy [ Query.asc nameCol ]

                unionAllQuery =
                    Query.from userSchema
                        |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                        |> Query.where_ (Query.like "A%" nameCol)
                        |> Query.unionAll
                            (Query.from userSchema
                                |> Query.select [ Query.col nameCol ] (Decode.field "name" Decode.string)
                                |> Query.where_ (Query.like "A%" nameCol)
                            )
                        |> Query.orderBy [ Query.asc nameCol ]

                resultPage val =
                    Page.page
                        { title = "Repo Test"
                        , head = []
                        , body = [ ElmSsr.Html.div [ ElmSsr.Html.Attributes.id "result" ] [ ElmSsr.Html.text (Encode.encode 0 val) ] ]
                        }
            in
            if Dict.get "summary" queryMap == Just "1" then
                Repo.all dialect summaryQuery
                    |> Loader.map (\\stats ->
                        resultPage (Encode.list (\\s ->
                            Encode.object
                                [ ("name", Encode.string s.name)
                                , ("postCount", Encode.int s.postCount)
                                , ("averageAge", case s.averageAge of
                                                    Just avg -> Encode.float avg
                                                    Nothing -> Encode.null
                                  )
                                ]
                        ) stats)
                    )

            else if Dict.get "graph" queryMap == Just "1" then
                Repo.all dialect graphQuery
                    |> Loader.map (\\names ->
                        resultPage (Encode.list Encode.string names)
                    )

            else if Dict.get "advanced" queryMap == Just "1" then
                Repo.all dialect topPosterCountsQuery
                    |> Loader.andThen (\\topPosterCounts ->
                        Repo.all dialect cteCountsQuery
                            |> Loader.andThen (\\cteCounts ->
                                Repo.all dialect joinedCountsQuery
                                    |> Loader.andThen (\\joinedCounts ->
                                        Repo.all dialect namesWithPostsQuery
                                            |> Loader.andThen (\\namesWithPosts ->
                                                Repo.all dialect namesWithoutPostsQuery
                                                    |> Loader.andThen (\\namesWithoutPosts ->
                                                        Repo.all dialect namesViaInSubqueryQuery
                                                            |> Loader.andThen (\\namesViaInSubquery ->
                                                                Repo.all dialect upperNamesQuery
                                                                    |> Loader.andThen (\\upperNames ->
                                                                        Repo.all dialect fragmentNamesQuery
                                                                            |> Loader.map (\\fragmentNames ->
                                                                                resultPage
                                                                                    (Encode.object
                                                                                        [ ( "topPosterCounts"
                                                                                          , Encode.list
                                                                                                (\\row ->
                                                                                                    Encode.object
                                                                                                        [ ("userId", Encode.int row.userId)
                                                                                                        , ("postCount", Encode.int row.postCount)
                                                                                                        ]
                                                                                                )
                                                                                                topPosterCounts
                                                                                          )
                                                                                        , ( "cteCounts"
                                                                                          , Encode.list
                                                                                                (\\row ->
                                                                                                    Encode.object
                                                                                                        [ ("userId", Encode.int row.userId)
                                                                                                        , ("postCount", Encode.int row.postCount)
                                                                                                        ]
                                                                                                )
                                                                                                cteCounts
                                                                                          )
                                                                                        , ( "joinedCounts"
                                                                                          , Encode.list
                                                                                                (\\row ->
                                                                                                    Encode.object
                                                                                                        [ ("name", Encode.string row.name)
                                                                                                        , ("postCount"
                                                                                                          , case row.postCount of
                                                                                                                Just value ->
                                                                                                                    Encode.int value

                                                                                                                Nothing ->
                                                                                                                    Encode.null
                                                                                                          )
                                                                                                        ]
                                                                                                )
                                                                                                joinedCounts
                                                                                          )
                                                                                        , ( "namesWithPosts", Encode.list Encode.string namesWithPosts )
                                                                                        , ( "namesWithoutPosts", Encode.list Encode.string namesWithoutPosts )
                                                                                        , ( "namesViaInSubquery", Encode.list Encode.string namesViaInSubquery )
                                                                                        , ( "upperNames", Encode.list Encode.string upperNames )
                                                                                        , ( "fragmentNames", Encode.list Encode.string fragmentNames )
                                                                                        ]
                                                                                    )
                                                                            )
                                                                    )
                                                            )
                                                    )
                                            )
                                    )
                            )
                    )

            else if Dict.get "union" queryMap == Just "1" then
                Repo.all dialect unionDistinctQuery
                    |> Loader.andThen (\\distinctNames ->
                        Repo.all dialect unionAllQuery
                            |> Loader.map (\\allNames ->
                                resultPage
                                    (Encode.object
                                        [ ("distinct", Encode.list Encode.string distinctNames)
                                        , ("all", Encode.list Encode.string allNames)
                                        ]
                                    )
                            )
                    )

            else if op == "get" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0
                in
                Repo.get dialect userSchema idVal
                    |> Loader.map (\\maybeUser ->
                        resultPage (case maybeUser of
                            Just u -> encodeUser u
                            Nothing -> Encode.null
                        )
                    )

            else if op == "getby" then
                let
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                in
                Repo.getBy dialect userSchema (Query.eq nameVal nameCol)
                    |> Loader.map (\\maybeUser ->
                        resultPage (case maybeUser of
                            Just u -> encodeUser u
                            Nothing -> Encode.null
                        )
                    )

            else if op == "count" then
                Repo.count dialect userSchema
                    |> Loader.map (\\n -> resultPage (Encode.int n))

            else if op == "countwhere" then
                let
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                in
                Repo.countWhere dialect userSchema (Query.eq nameVal nameCol)
                    |> Loader.map (\\n -> resultPage (Encode.int n))

            else if op == "exists" then
                let
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                in
                Repo.exists dialect userSchema (Query.eq nameVal nameCol)
                    |> Loader.map (\\b -> resultPage (Encode.bool b))

            else if op == "search" then
                let
                    searchVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                in
                Repo.all dialect
                    (Query.from userSchema
                        |> Query.where_ (Query.ilike ("%" ++ searchVal ++ "%") nameCol)
                        |> Query.orderBy [ Query.asc nameCol ]
                    )
                    |> Loader.map (\\users -> resultPage (Encode.list encodeUser users))

            else if op == "emptyin" then
                Repo.all dialect
                    (Query.from userSchema
                        |> Query.where_ (Query.inList [] idCol)
                        |> Query.orderBy [ Query.asc nameCol ]
                    )
                    |> Loader.map (\\users -> resultPage (Encode.list encodeUser users))

            else if op == "hasmany" then
                Repo.all dialect (Query.from userSchema |> Query.orderBy [ Query.asc nameCol ])
                    |> Loader.andThen (\\users ->
                        Repo.loadHasMany dialect postSchema postUserIdCol .userId users .id
                            |> Loader.map (\\pairs ->
                                resultPage
                                    (Encode.list (\\( u, posts ) ->
                                        Encode.object
                                            [ ("user", Encode.string u.name)
                                            , ("posts", Encode.list (\\p -> Encode.string p.title) posts)
                                            ]
                                    ) pairs)
                            )
                    )

            else if op == "belongsto" then
                Repo.all dialect (Query.from postSchema |> Query.orderBy [ Query.asc postTitleCol ])
                    |> Loader.andThen (\\posts ->
                        Repo.loadBelongsTo dialect userSchema .id .userId posts
                            |> Loader.map (\\pairs ->
                                resultPage
                                    (Encode.list (\\( p, maybeUser ) ->
                                        Encode.object
                                            [ ("post", Encode.string p.title)
                                            , ("user", case maybeUser of
                                                Just u -> Encode.string u.name
                                                Nothing -> Encode.null)
                                            ]
                                    ) pairs)
                            )
                    )

            else if op == "preload" then
                Repo.all dialect (Query.from userSchema |> Query.orderBy [ Query.asc nameCol ])
                    |> Loader.andThen (\\users ->
                        Repo.preloadHasMany dialect postSchema postUserIdCol .userId .id
                            (\\user posts ->
                                Encode.object
                                    [ ("user", Encode.string user.name)
                                    , ("posts", Encode.list (\\post -> Encode.string post.title) posts)
                                    ]
                            )
                            users
                            |> Loader.andThen (\\usersWithPosts ->
                                Repo.all dialect (Query.from postSchema |> Query.orderBy [ Query.asc postTitleCol ])
                                    |> Loader.andThen (\\posts ->
                                        Repo.preloadBelongsTo dialect userSchema .id .userId
                                            (\\post maybeUser ->
                                                Encode.object
                                                    [ ("post", Encode.string post.title)
                                                    , ("user"
                                                      , case maybeUser of
                                                            Just user ->
                                                                Encode.string user.name

                                                            Nothing ->
                                                                Encode.null
                                                      )
                                                    ]
                                            )
                                            posts
                                            |> Loader.map (\\postsWithUsers ->
                                                resultPage
                                                    (Encode.object
                                                        [ ("usersWithPosts", Encode.list identity usersWithPosts)
                                                        , ("postsWithUsers", Encode.list identity postsWithUsers)
                                                        ]
                                                    )
                                            )
                                    )
                            )
                    )

            else
                Repo.all dialect (Query.from userSchema |> Query.orderBy [ Query.asc nameCol ])
                    |> Loader.map (\\users -> resultPage (Encode.list encodeUser users))
        )

action : Request -> Action (Document Never)
action req =
    Action.fromLoader getDialect
        |> Action.andThen (\\dialect ->
            let
                queryMap = Dict.fromList req.query
                op = Dict.get "op" queryMap |> Maybe.withDefault ""
            in
            if op == "insert" then
                let
                    attrs =
                        Dict.fromList
                            [ ("name", Encode.string (Dict.get "name" queryMap |> Maybe.withDefault ""))
                            , ("email", Encode.string (Dict.get "email" queryMap |> Maybe.withDefault ""))
                            , ("age", case Dict.get "age" queryMap of
                                        Just aStr -> case String.toInt aStr of
                                                        Just val -> Encode.int val
                                                        Nothing -> Encode.null
                                        Nothing -> Encode.null
                              )
                            ]

                    changeset =
                        Changeset.cast userSchema attrs
                            |> Changeset.validateRequired [ "name", "email" ]
                in
                Repo.insert dialect userSchema changeset
                    |> Action.andThen (\\result ->
                        case result of
                            Ok user ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("user", Encode.object
                                        [ ("id", Encode.int user.id)
                                        , ("name", Encode.string user.name)
                                        , ("email", Encode.string user.email)
                                        , ("age", case user.age of
                                                    Just a -> Encode.int a
                                                    Nothing -> Encode.null
                                          )
                                        ])
                                    ])

                            Err cs ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool False)
                                    , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                    ])
                    )

            else if op == "update" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                    
                    originalUser =
                        { id = idVal, name = "", email = "", age = Nothing }

                    attrs =
                        Dict.fromList [ ("name", Encode.string nameVal) ]

                    changeset =
                        Changeset.castRecord userSchema originalUser attrs
                in
                Repo.update dialect userSchema changeset
                    |> Action.andThen (\\result ->
                        case result of
                            Ok user ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("user", Encode.object
                                        [ ("id", Encode.int user.id)
                                        , ("name", Encode.string user.name)
                                        , ("email", Encode.string user.email)
                                        , ("age", case user.age of
                                                    Just a -> Encode.int a
                                                    Nothing -> Encode.null
                                          )
                                        ])
                                    ])

                            Err cs ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool False)
                                    , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                    ])
                    )

            else if op == "delete" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0

                    userToDelete =
                        { id = idVal, name = "", email = "", age = Nothing }
                in
                Repo.delete dialect userSchema userToDelete
                    |> Action.andThen (\\result ->
                        case result of
                            Ok _ ->
                                Action.json (Encode.object [ ("ok", Encode.bool True) ])

                            Err err ->
                                Action.json (Encode.object [ ("ok", Encode.bool False), ("error", Encode.string err) ])
                    )

            else if op == "insert_dupe" then
                let
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                    emailVal = Dict.get "email" queryMap |> Maybe.withDefault ""

                    changeset =
                        Changeset.cast userSchema
                            (Dict.fromList
                                [ ("name", Encode.string nameVal)
                                , ("email", Encode.string emailVal)
                                ]
                            )
                in
                Repo.insert dialect userSchema changeset
                    |> Action.andThen (\\result ->
                        case result of
                            Ok user ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("user", encodeUser user)
                                    ])

                            Err cs ->
                                Action.json (Encode.object
                                    [ ("ok", Encode.bool False)
                                    , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                    ])
                    )

            else if op == "insert_unique" then
                let
                    nameVal = Dict.get "name" queryMap |> Maybe.withDefault ""
                    emailVal = Dict.get "email" queryMap |> Maybe.withDefault ""

                    attrs =
                        Dict.fromList
                            [ ("name", Encode.string nameVal)
                            , ("email", Encode.string emailVal)
                            ]

                    changeset =
                        Changeset.cast userSchema attrs
                            |> Changeset.validateRequired [ "name", "email" ]
                in
                Action.fromLoader (Repo.validateUnique dialect userSchema (Elmto.column "email" Encode.string) emailVal changeset)
                    |> Action.andThen (\\cs ->
                        Repo.insert dialect userSchema cs
                            |> Action.andThen (\\result ->
                                case result of
                                    Ok user ->
                                        Action.json (Encode.object
                                            [ ("ok", Encode.bool True)
                                            , ("user", encodeUser user)
                                            ])

                                    Err errCs ->
                                        Action.json (Encode.object
                                            [ ("ok", Encode.bool False)
                                            , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors errCs))
                                            ])
                            )
                    )

            else if op == "txn" then
                let
                    idVal = Dict.get "id" queryMap |> Maybe.andThen String.toInt |> Maybe.withDefault 0
                    title1Val = Dict.get "title1" queryMap |> Maybe.withDefault "TxPost1"
                    title2Val = Dict.get "title2" queryMap |> Maybe.withDefault "TxPost2"

                    insert1 =
                        Compiler.compileInsert dialect postSchema
                            (Changeset.cast postSchema
                                (Dict.fromList
                                    [ ("user_id", Encode.int idVal)
                                    , ("title", Encode.string title1Val)
                                    ]
                                )
                            )

                    insert2 =
                        Compiler.compileInsert dialect postSchema
                            (Changeset.cast postSchema
                                (Dict.fromList
                                    [ ("user_id", Encode.int idVal)
                                    , ("title", Encode.string title2Val)
                                    ]
                                )
                            )

                    steps =
                        List.filterMap identity
                            [ Result.toMaybe insert1
                            , Result.toMaybe insert2
                            ]
                in
                Repo.transaction steps
                    |> Action.map (\\rows ->
                        Encode.object [ ("ok", Encode.bool True), ("rowsAffected", Encode.int rows) ]
                    )
                    |> Action.andThen Action.json

            else if op == "txn_fail" then
                let
                    emailVal =
                        "rollback@example.com"

                    insert1 =
                        Compiler.compileInsert dialect userSchema
                            (Changeset.cast userSchema
                                (Dict.fromList
                                    [ ("name", Encode.string "Rollback One")
                                    , ("email", Encode.string emailVal)
                                    ]
                                )
                            )

                    insert2 =
                        Compiler.compileInsert dialect userSchema
                            (Changeset.cast userSchema
                                (Dict.fromList
                                    [ ("name", Encode.string "Rollback Two")
                                    , ("email", Encode.string emailVal)
                                    ]
                                )
                            )

                    steps =
                        List.filterMap identity
                            [ Result.toMaybe insert1
                            , Result.toMaybe insert2
                            ]
                in
                Repo.transaction steps
                    |> Action.map (\\rows ->
                        Encode.object [ ("ok", Encode.bool True), ("rowsAffected", Encode.int rows) ]
                    )
                    |> Action.andThen Action.json

            else if op == "insertall" then
                let
                    names = [ "Carol", "Dave", "Eve" ]
                    emails = [ "carol@example.com", "dave@example.com", "eve@example.com" ]

                    makeChangeset n e =
                        Changeset.cast userSchema
                            (Dict.fromList [ ("name", Encode.string n), ("email", Encode.string e) ])
                            |> Changeset.validateRequired [ "name", "email" ]

                    changesets =
                        List.map2 makeChangeset names emails
                in
                Repo.insertAll dialect userSchema changesets
                    |> Action.andThen (\\results ->
                        let
                            successes =
                                List.filterMap (\\r -> case r of
                                    Ok u -> Just (encodeUser u)
                                    Err _ -> Nothing
                                ) results
                        in
                        Action.json (Encode.object
                            [ ("ok", Encode.bool True)
                            , ("count", Encode.int (List.length successes))
                            , ("users", Encode.list identity successes)
                            ])
                    )

            else if op == "updateall" then
                let
                    ageVal =
                        Dict.get "age" queryMap
                            |> Maybe.andThen String.toInt
                            |> Maybe.withDefault 50

                    changeset =
                        Changeset.cast userSchema
                            (Dict.fromList [ ("age", Encode.int ageVal) ])
                in
                Repo.updateAll dialect userSchema (Query.isNull ageCol) changeset
                    |> Action.andThen
                        (\\result ->
                            case result of
                                Ok rowsAffected ->
                                    Action.json
                                        (Encode.object
                                            [ ("ok", Encode.bool True)
                                            , ("rowsAffected", Encode.int rowsAffected)
                                            ]
                                        )

                                Err cs ->
                                    Action.json
                                        (Encode.object
                                            [ ("ok", Encode.bool False)
                                            , ("errors", Encode.list (\\(f, m) -> Encode.object [ ("field", Encode.string f), ("message", Encode.string m) ]) (Changeset.errors cs))
                                            ]
                                        )
                        )

            else if op == "deleteall" then
                let
                    ageVal =
                        Dict.get "age" queryMap
                            |> Maybe.andThen String.toInt
                            |> Maybe.withDefault 50
                in
                Repo.deleteAll dialect userSchema (Query.eq ageVal ageCol)
                    |> Action.andThen
                        (\\rowsAffected ->
                            Action.json
                                (Encode.object
                                    [ ("ok", Encode.bool True)
                                    , ("rowsAffected", Encode.int rowsAffected)
                                    ]
                                )
                        )

            else
                Action.fail 400 "Invalid operation"
        )
`;
    await writeFile(resolve(root, "elmto-it-app/src/ElmtoItApp/Routes/TestRepo.elm"), routeCode, "utf8");

    // 3. Write custom database-backed runtime.ts file
    const customRuntime = `import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects } from "elm-ssr/effects";
import type { RouteCatalog } from "elm-ssr/http";
import { islands, bundleSource } from "../generated/elmto-it-app/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/elmto-it-app/app.mjs";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const elmModule = ElmRuntime;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/testrepo",
      methods: ["GET", "POST"],
      description: "Repo Test"
    }
  ],
  assets: [],
  utility: [],
  api: []
};

export const createFlags = ({ request, path }) => {
  const [pathname, search = ""] = path.split("?");
  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: {}
  };
};

export const createTestWorker = (config: { dialect: "sqlite" | "postgres", sqlitePath?: string, pgUrl?: string }) => {
  let sqlHandler;
  let sqlTransactionHandler;
  if (config.dialect === "sqlite") {
    const db = new Database(config.sqlitePath!);
    sqlHandler = ({ sql, params, mode }) => {
      const statement = db.query(sql);
      const args = params as never[];
      if (mode === "run") {
        const info = statement.run(...args);
        return { rowsAffected: Number(info.changes) };
      }
      if (mode === "first") {
        return statement.get(...args) ?? null;
      }
      return statement.all(...args);
    };
    sqlTransactionHandler = (stmts) => {
      const txn = db.transaction(() => {
        let rowsAffected = 0;
        for (const s of stmts) {
          const info = db.query(s.sql).run(...(s.params as never[]));
          rowsAffected += Number(info.changes);
        }
        return { rowsAffected };
      });
      return Promise.resolve(txn());
    };
  } else {
    const sql = new SQL(config.pgUrl!);
    sqlHandler = async ({ sql: query, params, mode }) => {
      const rows = await sql.unsafe(query, params as unknown[]);
      const rowsArray = Array.isArray(rows) ? rows : [...(rows as Iterable<unknown>)];
      if (mode === "run") {
        const count = (rows as { count?: number }).count;
        return { rowsAffected: typeof count === "number" ? count : rowsArray.length };
      }
      if (mode === "first") {
        return rowsArray[0] ?? null;
      }
      return rowsArray;
    };
    sqlTransactionHandler = async (stmts) => {
      let rowsAffected = 0;
      await sql.begin(async (tx) => {
        for (const s of stmts) {
          await tx.unsafe(s.sql, s.params as unknown[]);
          rowsAffected++;
        }
      });
      return { rowsAffected };
    };
  }

  const effects = inMemoryEffects({
    env: { DB_DIALECT: config.dialect },
    sql: sqlHandler,
    sqlTransaction: sqlTransactionHandler
  });

  return createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects
  });
};
`;
    await writeFile(resolve(root, "elmto-it-app/runtime.ts"), customRuntime, "utf8");

    // 4. Compile the scaffolded app
    const buildCmd = Bun.spawn(
      ["bun", "packages/elm-ssr/bin/elm-ssr.mjs", "build", "--root", root],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    const exitCode = await buildCmd.exited;
    if (exitCode !== 0) {
      console.log("IT Build stdout:", await new Response(buildCmd.stdout).text());
      console.error("IT Build stderr:", await new Response(buildCmd.stderr).text());
    }
    expect(exitCode).toBe(0);

    // 5. Load the custom test runtime
    const runtimePath = resolve(root, "elmto-it-app/runtime.ts");
    delete (globalThis as any).Elm;
    const { createTestWorker } = (await import(runtimePath)) as { createTestWorker: any };

    // ==========================================
    // SQLite Dialect Tests
    // ==========================================
    const sqlitePath = join(root, "test.db");
    const localDb = new Database(sqlitePath);
    localDb.run("DROP TABLE IF EXISTS elmto_comments");
    localDb.run("DROP TABLE IF EXISTS elmto_posts");
    localDb.run("DROP TABLE IF EXISTS elmto_users");
    localDb.run("CREATE TABLE elmto_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
    localDb.run("CREATE TABLE elmto_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");
    localDb.run("CREATE TABLE elmto_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES elmto_posts(id) ON DELETE CASCADE, body TEXT NOT NULL)");
    localDb.close();

    const sqliteWorker = createTestWorker({ dialect: "sqlite", sqlitePath });

    // (A) GET initial list (should be empty)
    const getRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes1.status).toBe(200);
    expect(await getResultJson(getRes1)).toEqual([]);

    // (B) POST insert Alice
    const insertRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Alice&email=alice@example.com&age=25", { method: "POST" }));
    expect(insertRes1.status).toBe(200);
    const aliceData = await insertRes1.json();
    expect(aliceData).toEqual({
      ok: true,
      user: { id: 1, name: "Alice", email: "alice@example.com", age: 25 }
    });

    // (C) POST insert Bob (without optional age)
    const insertRes2 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Bob&email=bob@example.com", { method: "POST" }));
    expect(insertRes2.status).toBe(200);
    const bobData = await insertRes2.json();
    expect(bobData).toEqual({
      ok: true,
      user: { id: 2, name: "Bob", email: "bob@example.com", age: null }
    });

    const sqlitePostsDb = new Database(sqlitePath);
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'First')");
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'Second')");
    sqlitePostsDb.run("INSERT INTO elmto_posts (user_id, title) VALUES (2, 'Third')");
    sqlitePostsDb.run("INSERT INTO elmto_comments (post_id, body) VALUES (1, 'hello')");
    sqlitePostsDb.run("INSERT INTO elmto_comments (post_id, body) VALUES (1, 'world')");
    sqlitePostsDb.close();

    // (D) GET updated list (sorted by name ascending: Alice, Bob)
    const getRes2 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes2.status).toBe(200);
    expect(await getResultJson(getRes2)).toEqual([
      { id: 1, name: "Alice", email: "alice@example.com", age: 25 },
      { id: 2, name: "Bob", email: "bob@example.com", age: null }
    ]);

    const summaryRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?summary=1"));
    expect(summaryRes1.status).toBe(200);
    const sqliteSummaryData = await getResultJson(summaryRes1);
    expect(sqliteSummaryData).toEqual([
      { name: "Alice", postCount: 2, averageAge: 25 },
      { name: "Bob", postCount: 1, averageAge: null }
    ]);

    const sqliteParityDb = new Database(sqlitePath);
    const sqliteRawSummary = sqliteParityDb
      .query(
        "SELECT elmto_users.name AS name, COUNT(elmto_posts.user_id) AS postCount, AVG(elmto_users.age) AS averageAge FROM elmto_users INNER JOIN elmto_posts ON elmto_users.id = elmto_posts.user_id WHERE elmto_posts.title LIKE ? GROUP BY elmto_users.name HAVING COUNT(elmto_posts.user_id) >= ? ORDER BY elmto_users.name ASC"
      )
      .all("%", 1)
      .map((row: any) => ({
        name: row.name,
        postCount: Number(row.postCount),
        averageAge: row.averageAge === null ? null : Number(row.averageAge)
      }));
    sqliteParityDb.close();
    expect(sqliteSummaryData).toEqual(sqliteRawSummary);

    const graphRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?graph=1"));
    expect(graphRes1.status).toBe(200);
    const sqliteGraphData = await getResultJson(graphRes1);
    expect(sqliteGraphData).toEqual(["Alice"]);

    const sqliteGraphParityDb = new Database(sqlitePath);
    const sqliteRawGraph = sqliteGraphParityDb
      .query(
        "SELECT DISTINCT elmto_users.name AS name FROM elmto_users INNER JOIN elmto_posts ON (elmto_users.id = elmto_posts.user_id AND elmto_posts.title LIKE ?) INNER JOIN elmto_comments ON (elmto_posts.id = elmto_comments.post_id AND elmto_comments.body IS NOT NULL) ORDER BY elmto_users.name ASC"
      )
      .all("F%")
      .map((row: any) => row.name);
    sqliteGraphParityDb.close();
    expect(sqliteGraphData).toEqual(sqliteRawGraph);

    // (E) POST update Alice to Alicia
    const updateRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=update&id=1&name=Alicia", { method: "POST" }));
    expect(updateRes1.status).toBe(200);
    expect(await updateRes1.json()).toEqual({
      ok: true,
      user: { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    });

    // (F) POST delete Bob
    const deleteRes1 = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=delete&id=2", { method: "POST" }));
    expect(deleteRes1.status).toBe(200);
    expect(await deleteRes1.json()).toEqual({ ok: true });

    // (G) GET final list (sorted by name: Alicia only)
    const getRes3 = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(getRes3.status).toBe(200);
    expect(await getResultJson(getRes3)).toEqual([
      { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    ]);

    // (H) Repo.get by primary key
    const getByIdRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=get&id=1"));
    expect(getByIdRes.status).toBe(200);
    expect(await getResultJson(getByIdRes)).toEqual({ id: 1, name: "Alicia", email: "alice@example.com", age: 25 });

    const getMissingRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=get&id=999"));
    expect(getMissingRes.status).toBe(200);
    expect(await getResultJson(getMissingRes)).toBeNull();

    // (I) Repo.getBy by field value
    const getByNameRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=getby&name=Alicia"));
    expect(getByNameRes.status).toBe(200);
    expect(await getResultJson(getByNameRes)).toEqual({ id: 1, name: "Alicia", email: "alice@example.com", age: 25 });

    // (J) Repo.count / countWhere / exists
    const countRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=count"));
    expect(countRes.status).toBe(200);
    expect(await getResultJson(countRes)).toBe(1);

    const countWhereRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=countwhere&name=Alicia"));
    expect(countWhereRes.status).toBe(200);
    expect(await getResultJson(countWhereRes)).toBe(1);

    const countWhereMissRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=countwhere&name=Nobody"));
    expect(countWhereMissRes.status).toBe(200);
    expect(await getResultJson(countWhereMissRes)).toBe(0);

    const existsTrueRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=exists&name=Alicia"));
    expect(existsTrueRes.status).toBe(200);
    expect(await getResultJson(existsTrueRes)).toBe(true);

    const existsFalseRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=exists&name=Nobody"));
    expect(existsFalseRes.status).toBe(200);
    expect(await getResultJson(existsFalseRes)).toBe(false);

    const searchRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=search&name=lic"));
    expect(searchRes.status).toBe(200);
    expect(await getResultJson(searchRes)).toEqual([
      { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    ]);

    const emptyInRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=emptyin"));
    expect(emptyInRes.status).toBe(200);
    expect(await getResultJson(emptyInRes)).toEqual([]);

    // (K) Repo.validateUnique — insert unique passes, duplicate fails
    const uniqueOkRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert_unique&name=Frank&email=frank@example.com", { method: "POST" }));
    expect(uniqueOkRes.status).toBe(200);
    const uniqueOkData = await uniqueOkRes.json();
    expect(uniqueOkData.ok).toBe(true);
    expect(uniqueOkData.user.name).toBe("Frank");

    const uniqueDupRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert_unique&name=Frank2&email=frank@example.com", { method: "POST" }));
    expect(uniqueDupRes.status).toBe(200);
    const uniqueDupData = await uniqueDupRes.json();
    expect(uniqueDupData.ok).toBe(false);
    expect(uniqueDupData.errors).toContainEqual({ field: "email", message: "has already been taken" });

    // (K2) DB constraint → Err changeset (no pre-check, DB fires UNIQUE)
    const dbDupeRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insert_dupe&name=Dup&email=frank@example.com", { method: "POST" }));
    expect(dbDupeRes.status).toBe(200);
    const dbDupeData = await dbDupeRes.json();
    expect(dbDupeData.ok).toBe(false);
    expect(dbDupeData.errors).toContainEqual({ field: "email", message: "has already been taken" });

    // (L) Repo.insertAll — batch insert
    const insertAllRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=insertall", { method: "POST" }));
    expect(insertAllRes.status).toBe(200);
    const insertAllData = await insertAllRes.json();
    expect(insertAllData.ok).toBe(true);
    expect(insertAllData.count).toBe(3);
    expect(insertAllData.users.map((u: any) => u.name)).toEqual(["Carol", "Dave", "Eve"]);

    // (M) Repo.transaction — atomic two-post insert for user id=1
    const txnRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=txn&id=1&title1=TxA&title2=TxB", { method: "POST" }));
    expect(txnRes.status).toBe(200);
    const txnData = await txnRes.json();
    expect(txnData.ok).toBe(true);
    expect(txnData.rowsAffected).toBe(2);

    const advancedRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?advanced=1"));
    expect(advancedRes.status).toBe(200);
    const sqliteAdvancedData = await getResultJson(advancedRes);
    expect(sqliteAdvancedData).toEqual({
      topPosterCounts: [{ userId: 1, postCount: 4 }],
      cteCounts: [{ userId: 1, postCount: 4 }],
      joinedCounts: [
        { name: "Alicia", postCount: 4 },
        { name: "Carol", postCount: null },
        { name: "Dave", postCount: null },
        { name: "Eve", postCount: null },
        { name: "Frank", postCount: null }
      ],
      namesWithPosts: ["Alicia"],
      namesWithoutPosts: ["Carol", "Dave", "Eve", "Frank"],
      namesViaInSubquery: ["Alicia"],
      upperNames: ["ALICIA", "CAROL", "DAVE", "EVE", "FRANK"],
      fragmentNames: ["Alicia", "Carol", "Dave", "Eve"]
    });

    const sqliteAdvancedParityDb = new Database(sqlitePath);
    const sqliteTopPosterCounts = sqliteAdvancedParityDb
      .query(
        "SELECT user_id AS userId, post_count AS postCount FROM (SELECT elmto_posts.user_id AS user_id, COUNT(elmto_posts.id) AS post_count FROM elmto_posts GROUP BY elmto_posts.user_id) AS user_post_counts WHERE post_count >= ? ORDER BY post_count DESC"
      )
      .all(2)
      .map((row: any) => ({ userId: Number(row.userId), postCount: Number(row.postCount) }));
    const sqliteJoinedCounts = sqliteAdvancedParityDb
      .query(
        "SELECT elmto_users.name AS name, user_post_counts.post_count AS postCount FROM elmto_users LEFT JOIN (SELECT elmto_posts.user_id AS user_id, COUNT(elmto_posts.id) AS post_count FROM elmto_posts GROUP BY elmto_posts.user_id) AS user_post_counts ON elmto_users.id = user_post_counts.user_id ORDER BY elmto_users.name ASC"
      )
      .all()
      .map((row: any) => ({ name: row.name, postCount: row.postCount === null ? null : Number(row.postCount) }));
    const sqliteNamesWithPosts = sqliteAdvancedParityDb
      .query(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE EXISTS (SELECT elmto_posts.user_id FROM elmto_posts WHERE elmto_posts.user_id = elmto_users.id) ORDER BY elmto_users.name ASC"
      )
      .all()
      .map((row: any) => row.name);
    const sqliteNamesWithoutPosts = sqliteAdvancedParityDb
      .query(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE NOT EXISTS (SELECT elmto_posts.user_id FROM elmto_posts WHERE elmto_posts.user_id = elmto_users.id) ORDER BY elmto_users.name ASC"
      )
      .all()
      .map((row: any) => row.name);
    const sqliteNamesViaInSubquery = sqliteAdvancedParityDb
      .query(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE elmto_users.id IN (SELECT elmto_posts.user_id FROM elmto_posts) ORDER BY elmto_users.name ASC"
      )
      .all()
      .map((row: any) => row.name);
    const sqliteUpperNames = sqliteAdvancedParityDb
      .query("SELECT UPPER(name) AS upper_name FROM elmto_users ORDER BY name ASC")
      .all()
      .map((row: any) => row.upper_name);
    const sqliteFragmentNames = sqliteAdvancedParityDb
      .query("SELECT name FROM elmto_users WHERE name <> ? ORDER BY name ASC")
      .all("Frank")
      .map((row: any) => row.name);
    sqliteAdvancedParityDb.close();
    expect(sqliteAdvancedData.topPosterCounts).toEqual(sqliteTopPosterCounts);
    expect(sqliteAdvancedData.cteCounts).toEqual(sqliteTopPosterCounts);
    expect(sqliteAdvancedData.joinedCounts).toEqual(sqliteJoinedCounts);
    expect(sqliteAdvancedData.namesWithPosts).toEqual(sqliteNamesWithPosts);
    expect(sqliteAdvancedData.namesWithoutPosts).toEqual(sqliteNamesWithoutPosts);
    expect(sqliteAdvancedData.namesViaInSubquery).toEqual(sqliteNamesViaInSubquery);
    expect(sqliteAdvancedData.upperNames).toEqual(sqliteUpperNames);
    expect(sqliteAdvancedData.fragmentNames).toEqual(sqliteFragmentNames);

    const txnFailRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=txn_fail&id=1", { method: "POST" }));
    expect(txnFailRes.status).toBeGreaterThanOrEqual(500);
    const sqliteRollbackDb = new Database(sqlitePath);
    const sqliteRollbackCount = sqliteRollbackDb
      .query("SELECT COUNT(*) AS count FROM elmto_users WHERE email = 'rollback@example.com'")
      .get() as { count: number };
    sqliteRollbackDb.close();
    expect(Number(sqliteRollbackCount.count)).toBe(0);

    // (N) Repo.loadHasMany — users with posts
    const hasManyRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=hasmany"));
    expect(hasManyRes.status).toBe(200);
    const hasManyData = await getResultJson(hasManyRes);
    const aliciaEntry = hasManyData.find((e: any) => e.user === "Alicia");
    expect(aliciaEntry).toBeDefined();
    expect(aliciaEntry.posts).toContain("TxA");
    expect(aliciaEntry.posts).toContain("TxB");

    // (O) Repo.loadBelongsTo — posts with their users
    const belongsToRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=belongsto"));
    expect(belongsToRes.status).toBe(200);
    const belongsToData = await getResultJson(belongsToRes);
    const txPost = belongsToData.find((e: any) => e.post === "TxA");
    expect(txPost).toBeDefined();
    expect(txPost.user).toBe("Alicia");

    const preloadRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=preload"));
    expect(preloadRes.status).toBe(200);
    const preloadData = await getResultJson(preloadRes);
    expect(preloadData.usersWithPosts).toEqual(hasManyData);
    expect(preloadData.postsWithUsers).toEqual(belongsToData);

    const sqliteUnionRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?union=1"));
    expect(sqliteUnionRes.status).toBe(200);
    const sqliteUnionData = await getResultJson(sqliteUnionRes);
    const sqliteUnionDb = new Database(sqlitePath);
    const sqliteUnionDistinct = sqliteUnionDb
      .query(
        "SELECT name FROM elmto_users WHERE name LIKE ? UNION SELECT name FROM elmto_users WHERE name LIKE ? ORDER BY name ASC"
      )
      .all("A%", "C%")
      .map((row: any) => row.name);
    const sqliteUnionAll = sqliteUnionDb
      .query(
        "SELECT name FROM elmto_users WHERE name LIKE ? UNION ALL SELECT name FROM elmto_users WHERE name LIKE ? ORDER BY name ASC"
      )
      .all("A%", "A%")
      .map((row: any) => row.name);
    sqliteUnionDb.close();
    expect(sqliteUnionData).toEqual({
      distinct: sqliteUnionDistinct,
      all: sqliteUnionAll
    });

    const updateAllRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=updateall&age=50", { method: "POST" }));
    expect(updateAllRes.status).toBe(200);
    expect(await updateAllRes.json()).toEqual({ ok: true, rowsAffected: 4 });

    const afterUpdateAllRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(afterUpdateAllRes.status).toBe(200);
    expect(await getResultJson(afterUpdateAllRes)).toEqual([
      { id: 1, name: "Alicia", email: "alice@example.com", age: 25 },
      { id: 4, name: "Carol", email: "carol@example.com", age: 50 },
      { id: 5, name: "Dave", email: "dave@example.com", age: 50 },
      { id: 6, name: "Eve", email: "eve@example.com", age: 50 },
      { id: 3, name: "Frank", email: "frank@example.com", age: 50 }
    ]);

    const deleteAllRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo?op=deleteall&age=50", { method: "POST" }));
    expect(deleteAllRes.status).toBe(200);
    expect(await deleteAllRes.json()).toEqual({ ok: true, rowsAffected: 4 });

    const afterDeleteAllRes = await sqliteWorker.fetch(new Request("http://localhost/testrepo"));
    expect(afterDeleteAllRes.status).toBe(200);
    expect(await getResultJson(afterDeleteAllRes)).toEqual([
      { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
    ]);

    // ==========================================
    // PostgreSQL Dialect Tests
    // ==========================================
    if (DATABASE_URL) {
      const pgSql = new SQL(DATABASE_URL);
      await pgSql.unsafe("DROP TABLE IF EXISTS elmto_comments");
      await pgSql.unsafe("DROP TABLE IF EXISTS elmto_posts");
      await pgSql.unsafe("DROP TABLE IF EXISTS elmto_users");
      await pgSql.unsafe("CREATE TABLE elmto_users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)");
      await pgSql.unsafe("CREATE TABLE elmto_posts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES elmto_users(id) ON DELETE CASCADE, title TEXT NOT NULL)");
      await pgSql.unsafe("CREATE TABLE elmto_comments (id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES elmto_posts(id) ON DELETE CASCADE, body TEXT NOT NULL)");
      await pgSql.close();

      const pgWorker = createTestWorker({ dialect: "postgres", pgUrl: DATABASE_URL });

      // (A) GET initial list (should be empty)
      const pgGetRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes1.status).toBe(200);
      expect(await getResultJson(pgGetRes1)).toEqual([]);

      // (B) POST insert Alice
      const pgInsertRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Alice&email=alice@example.com&age=25", { method: "POST" }));
      expect(pgInsertRes1.status).toBe(200);
      const pgAliceData = await pgInsertRes1.json();
      expect(pgAliceData).toEqual({
        ok: true,
        user: { id: 1, name: "Alice", email: "alice@example.com", age: 25 }
      });

      // (C) POST insert Bob
      const pgInsertRes2 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert&name=Bob&email=bob@example.com", { method: "POST" }));
      expect(pgInsertRes2.status).toBe(200);
      const pgBobData = await pgInsertRes2.json();
      expect(pgBobData).toEqual({
        ok: true,
        user: { id: 2, name: "Bob", email: "bob@example.com", age: null }
      });

      const pgPostsSql = new SQL(DATABASE_URL);
      await pgPostsSql.unsafe("INSERT INTO elmto_posts (user_id, title) VALUES (1, 'First'), (1, 'Second'), (2, 'Third')");
      await pgPostsSql.unsafe("INSERT INTO elmto_comments (post_id, body) VALUES (1, 'hello'), (1, 'world')");
      await pgPostsSql.close();

      // (D) GET updated list (sorted by name: Alice, Bob)
      const pgGetRes2 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes2.status).toBe(200);
      expect(await getResultJson(pgGetRes2)).toEqual([
        { id: 1, name: "Alice", email: "alice@example.com", age: 25 },
        { id: 2, name: "Bob", email: "bob@example.com", age: null }
      ]);

      const pgSummaryRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?summary=1"));
      expect(pgSummaryRes1.status).toBe(200);
      const pgSummaryData = await getResultJson(pgSummaryRes1);
      expect(pgSummaryData).toEqual([
        { name: "Alice", postCount: 2, averageAge: 25 },
        { name: "Bob", postCount: 1, averageAge: null }
      ]);

      const pgParitySql = new SQL(DATABASE_URL);
      const pgRawSummaryRows = await pgParitySql.unsafe(
        "SELECT elmto_users.name AS name, COUNT(elmto_posts.user_id) AS \"postCount\", AVG(elmto_users.age) AS \"averageAge\" FROM elmto_users INNER JOIN elmto_posts ON elmto_users.id = elmto_posts.user_id WHERE elmto_posts.title LIKE $1 GROUP BY elmto_users.name HAVING COUNT(elmto_posts.user_id) >= $2 ORDER BY elmto_users.name ASC",
        ["%", 1]
      );
      const pgRawSummary = Array.from(pgRawSummaryRows as Iterable<any>).map((row: any) => ({
        name: row.name,
        postCount: Number(row.postCount),
        averageAge: row.averageAge === null ? null : Number(row.averageAge)
      }));
      await pgParitySql.close();
      expect(pgSummaryData).toEqual(pgRawSummary);

      const pgGraphRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?graph=1"));
      expect(pgGraphRes1.status).toBe(200);
      const pgGraphData = await getResultJson(pgGraphRes1);
      expect(pgGraphData).toEqual(["Alice"]);

      const pgGraphParitySql = new SQL(DATABASE_URL);
      const pgRawGraphRows = await pgGraphParitySql.unsafe(
        "SELECT DISTINCT elmto_users.name AS name FROM elmto_users INNER JOIN elmto_posts ON (elmto_users.id = elmto_posts.user_id AND elmto_posts.title LIKE $1) INNER JOIN elmto_comments ON (elmto_posts.id = elmto_comments.post_id AND elmto_comments.body IS NOT NULL) ORDER BY elmto_users.name ASC",
        ["F%"]
      );
      const pgRawGraph = Array.from(pgRawGraphRows as Iterable<any>).map((row: any) => row.name);
      await pgGraphParitySql.close();
      expect(pgGraphData).toEqual(pgRawGraph);

      // (E) POST update Alice to Alicia
      const pgUpdateRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=update&id=1&name=Alicia", { method: "POST" }));
      expect(pgUpdateRes1.status).toBe(200);
      expect(await pgUpdateRes1.json()).toEqual({
        ok: true,
        user: { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      });

      // (F) POST delete Bob
      const pgDeleteRes1 = await pgWorker.fetch(new Request("http://localhost/testrepo?op=delete&id=2", { method: "POST" }));
      expect(pgDeleteRes1.status).toBe(200);
      expect(await pgDeleteRes1.json()).toEqual({ ok: true });

      // (G) GET final list
      const pgGetRes3 = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgGetRes3.status).toBe(200);
      expect(await getResultJson(pgGetRes3)).toEqual([
        { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      ]);

      // (H) Repo.get by primary key
      const pgGetByIdRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=get&id=1"));
      expect(pgGetByIdRes.status).toBe(200);
      expect(await getResultJson(pgGetByIdRes)).toEqual({ id: 1, name: "Alicia", email: "alice@example.com", age: 25 });

      const pgGetMissingRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=get&id=999"));
      expect(pgGetMissingRes.status).toBe(200);
      expect(await getResultJson(pgGetMissingRes)).toBeNull();

      // (I) Repo.getBy
      const pgGetByNameRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=getby&name=Alicia"));
      expect(pgGetByNameRes.status).toBe(200);
      expect(await getResultJson(pgGetByNameRes)).toEqual({ id: 1, name: "Alicia", email: "alice@example.com", age: 25 });

      // (J) Repo.count / countWhere / exists
      const pgCountRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=count"));
      expect(pgCountRes.status).toBe(200);
      expect(await getResultJson(pgCountRes)).toBe(1);

      const pgCountWhereRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=countwhere&name=Alicia"));
      expect(pgCountWhereRes.status).toBe(200);
      expect(await getResultJson(pgCountWhereRes)).toBe(1);

      const pgExistsTrueRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=exists&name=Alicia"));
      expect(pgExistsTrueRes.status).toBe(200);
      expect(await getResultJson(pgExistsTrueRes)).toBe(true);

      const pgExistsFalseRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=exists&name=Nobody"));
      expect(pgExistsFalseRes.status).toBe(200);
      expect(await getResultJson(pgExistsFalseRes)).toBe(false);

      const pgSearchRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=search&name=LIC"));
      expect(pgSearchRes.status).toBe(200);
      expect(await getResultJson(pgSearchRes)).toEqual([
        { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      ]);

      const pgEmptyInRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=emptyin"));
      expect(pgEmptyInRes.status).toBe(200);
      expect(await getResultJson(pgEmptyInRes)).toEqual([]);

      // (K) Repo.validateUnique
      const pgUniqueOkRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert_unique&name=Frank&email=frank@example.com", { method: "POST" }));
      expect(pgUniqueOkRes.status).toBe(200);
      const pgUniqueOkData = await pgUniqueOkRes.json();
      expect(pgUniqueOkData.ok).toBe(true);
      expect(pgUniqueOkData.user.name).toBe("Frank");

      const pgUniqueDupRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert_unique&name=Frank2&email=frank@example.com", { method: "POST" }));
      expect(pgUniqueDupRes.status).toBe(200);
      const pgUniqueDupData = await pgUniqueDupRes.json();
      expect(pgUniqueDupData.ok).toBe(false);
      expect(pgUniqueDupData.errors).toContainEqual({ field: "email", message: "has already been taken" });

      // (K2) DB constraint → Err changeset
      const pgDbDupeRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insert_dupe&name=Dup&email=frank@example.com", { method: "POST" }));
      expect(pgDbDupeRes.status).toBe(200);
      const pgDbDupeData = await pgDbDupeRes.json();
      expect(pgDbDupeData.ok).toBe(false);
      expect(pgDbDupeData.errors).toContainEqual({ field: "email", message: "has already been taken" });

      // (L) Repo.insertAll
      const pgInsertAllRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=insertall", { method: "POST" }));
      expect(pgInsertAllRes.status).toBe(200);
      const pgInsertAllData = await pgInsertAllRes.json();
      expect(pgInsertAllData.ok).toBe(true);
      expect(pgInsertAllData.count).toBe(3);
      expect(pgInsertAllData.users.map((u: any) => u.name)).toEqual(["Carol", "Dave", "Eve"]);

      // (M) Repo.transaction
      const pgTxnRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=txn&id=1&title1=TxA&title2=TxB", { method: "POST" }));
      expect(pgTxnRes.status).toBe(200);
      const pgTxnData = await pgTxnRes.json();
      expect(pgTxnData.ok).toBe(true);
      expect(pgTxnData.rowsAffected).toBe(2);

      const pgAdvancedRes = await pgWorker.fetch(new Request("http://localhost/testrepo?advanced=1"));
      expect(pgAdvancedRes.status).toBe(200);
      const pgAdvancedData = await getResultJson(pgAdvancedRes);
      expect(pgAdvancedData).toEqual({
        topPosterCounts: [{ userId: 1, postCount: 4 }],
        cteCounts: [{ userId: 1, postCount: 4 }],
        joinedCounts: [
          { name: "Alicia", postCount: 4 },
          { name: "Carol", postCount: null },
          { name: "Dave", postCount: null },
          { name: "Eve", postCount: null },
          { name: "Frank", postCount: null }
        ],
        namesWithPosts: ["Alicia"],
        namesWithoutPosts: ["Carol", "Dave", "Eve", "Frank"],
        namesViaInSubquery: ["Alicia"],
        upperNames: ["ALICIA", "CAROL", "DAVE", "EVE", "FRANK"],
        fragmentNames: ["Alicia", "Carol", "Dave", "Eve"]
      });

      const pgAdvancedParitySql = new SQL(DATABASE_URL);
      const pgTopPosterCountRows = await pgAdvancedParitySql.unsafe(
        "SELECT user_id AS \"userId\", post_count AS \"postCount\" FROM (SELECT elmto_posts.user_id AS user_id, COUNT(elmto_posts.id) AS post_count FROM elmto_posts GROUP BY elmto_posts.user_id) AS user_post_counts WHERE post_count >= $1 ORDER BY post_count DESC",
        [2]
      );
      const pgJoinedCountRows = await pgAdvancedParitySql.unsafe(
        "SELECT elmto_users.name AS name, user_post_counts.post_count AS \"postCount\" FROM elmto_users LEFT JOIN (SELECT elmto_posts.user_id AS user_id, COUNT(elmto_posts.id) AS post_count FROM elmto_posts GROUP BY elmto_posts.user_id) AS user_post_counts ON elmto_users.id = user_post_counts.user_id ORDER BY elmto_users.name ASC"
      );
      const pgNamesWithPostsRows = await pgAdvancedParitySql.unsafe(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE EXISTS (SELECT elmto_posts.user_id FROM elmto_posts WHERE elmto_posts.user_id = elmto_users.id) ORDER BY elmto_users.name ASC"
      );
      const pgNamesWithoutPostsRows = await pgAdvancedParitySql.unsafe(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE NOT EXISTS (SELECT elmto_posts.user_id FROM elmto_posts WHERE elmto_posts.user_id = elmto_users.id) ORDER BY elmto_users.name ASC"
      );
      const pgNamesViaInSubqueryRows = await pgAdvancedParitySql.unsafe(
        "SELECT elmto_users.name AS name FROM elmto_users WHERE elmto_users.id IN (SELECT elmto_posts.user_id FROM elmto_posts) ORDER BY elmto_users.name ASC"
      );
      const pgUpperNameRows = await pgAdvancedParitySql.unsafe(
        "SELECT UPPER(name) AS \"upper_name\" FROM elmto_users ORDER BY name ASC"
      );
      const pgFragmentNameRows = await pgAdvancedParitySql.unsafe(
        "SELECT name FROM elmto_users WHERE name <> $1 ORDER BY name ASC",
        ["Frank"]
      );
      await pgAdvancedParitySql.close();
      const pgTopPosterCounts = Array.from(pgTopPosterCountRows as Iterable<any>).map((row: any) => ({
        userId: Number(row.userId),
        postCount: Number(row.postCount)
      }));
      const pgJoinedCounts = Array.from(pgJoinedCountRows as Iterable<any>).map((row: any) => ({
        name: row.name,
        postCount: row.postCount === null ? null : Number(row.postCount)
      }));
      const pgNamesWithPosts = Array.from(pgNamesWithPostsRows as Iterable<any>).map((row: any) => row.name);
      const pgNamesWithoutPosts = Array.from(pgNamesWithoutPostsRows as Iterable<any>).map((row: any) => row.name);
      const pgNamesViaInSubquery = Array.from(pgNamesViaInSubqueryRows as Iterable<any>).map((row: any) => row.name);
      const pgUpperNames = Array.from(pgUpperNameRows as Iterable<any>).map((row: any) => row.upper_name);
      const pgFragmentNames = Array.from(pgFragmentNameRows as Iterable<any>).map((row: any) => row.name);
      expect(pgAdvancedData.topPosterCounts).toEqual(pgTopPosterCounts);
      expect(pgAdvancedData.cteCounts).toEqual(pgTopPosterCounts);
      expect(pgAdvancedData.joinedCounts).toEqual(pgJoinedCounts);
      expect(pgAdvancedData.namesWithPosts).toEqual(pgNamesWithPosts);
      expect(pgAdvancedData.namesWithoutPosts).toEqual(pgNamesWithoutPosts);
      expect(pgAdvancedData.namesViaInSubquery).toEqual(pgNamesViaInSubquery);
      expect(pgAdvancedData.upperNames).toEqual(pgUpperNames);
      expect(pgAdvancedData.fragmentNames).toEqual(pgFragmentNames);

      const pgTxnFailRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=txn_fail&id=1", { method: "POST" }));
      expect(pgTxnFailRes.status).toBeGreaterThanOrEqual(500);
      const pgRollbackSql = new SQL(DATABASE_URL);
      const pgRollbackRows = await pgRollbackSql.unsafe(
        "SELECT COUNT(*) AS count FROM elmto_users WHERE email = 'rollback@example.com'"
      );
      const pgRollbackRow = Array.from(pgRollbackRows as Iterable<any>)[0] as { count: number | string };
      await pgRollbackSql.close();
      expect(Number(pgRollbackRow.count)).toBe(0);

      // (N) Repo.loadHasMany
      const pgHasManyRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=hasmany"));
      expect(pgHasManyRes.status).toBe(200);
      const pgHasManyData = await getResultJson(pgHasManyRes);
      const pgAliciaEntry = pgHasManyData.find((e: any) => e.user === "Alicia");
      expect(pgAliciaEntry).toBeDefined();
      expect(pgAliciaEntry.posts).toContain("TxA");

      // (O) Repo.loadBelongsTo
      const pgBelongsToRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=belongsto"));
      expect(pgBelongsToRes.status).toBe(200);
      const pgBelongsToData = await getResultJson(pgBelongsToRes);
      const pgTxPost = pgBelongsToData.find((e: any) => e.post === "TxA");
      expect(pgTxPost).toBeDefined();
      expect(pgTxPost.user).toBe("Alicia");

      const pgPreloadRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=preload"));
      expect(pgPreloadRes.status).toBe(200);
      const pgPreloadData = await getResultJson(pgPreloadRes);
      expect(pgPreloadData.usersWithPosts).toEqual(pgHasManyData);
      expect(pgPreloadData.postsWithUsers).toEqual(pgBelongsToData);

      const pgUnionRes = await pgWorker.fetch(new Request("http://localhost/testrepo?union=1"));
      expect(pgUnionRes.status).toBe(200);
      const pgUnionData = await getResultJson(pgUnionRes);
      const pgUnionSql = new SQL(DATABASE_URL);
      const pgUnionDistinctRows = await pgUnionSql.unsafe(
        "SELECT name FROM elmto_users WHERE name LIKE $1 UNION SELECT name FROM elmto_users WHERE name LIKE $2 ORDER BY name ASC",
        ["A%", "C%"]
      );
      const pgUnionAllRows = await pgUnionSql.unsafe(
        "SELECT name FROM elmto_users WHERE name LIKE $1 UNION ALL SELECT name FROM elmto_users WHERE name LIKE $2 ORDER BY name ASC",
        ["A%", "A%"]
      );
      await pgUnionSql.close();
      expect(pgUnionData).toEqual({
        distinct: Array.from(pgUnionDistinctRows as Iterable<any>).map((row: any) => row.name),
        all: Array.from(pgUnionAllRows as Iterable<any>).map((row: any) => row.name)
      });

      const pgUpdateAllRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=updateall&age=50", { method: "POST" }));
      expect(pgUpdateAllRes.status).toBe(200);
      expect(await pgUpdateAllRes.json()).toEqual({ ok: true, rowsAffected: 4 });

      const pgAfterUpdateAllRes = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgAfterUpdateAllRes.status).toBe(200);
      expect(
        (await getResultJson(pgAfterUpdateAllRes)).map((user: any) => ({
          name: user.name,
          email: user.email,
          age: user.age
        }))
      ).toEqual([
        { name: "Alicia", email: "alice@example.com", age: 25 },
        { name: "Carol", email: "carol@example.com", age: 50 },
        { name: "Dave", email: "dave@example.com", age: 50 },
        { name: "Eve", email: "eve@example.com", age: 50 },
        { name: "Frank", email: "frank@example.com", age: 50 }
      ]);

      const pgDeleteAllRes = await pgWorker.fetch(new Request("http://localhost/testrepo?op=deleteall&age=50", { method: "POST" }));
      expect(pgDeleteAllRes.status).toBe(200);
      expect(await pgDeleteAllRes.json()).toEqual({ ok: true, rowsAffected: 4 });

      const pgAfterDeleteAllRes = await pgWorker.fetch(new Request("http://localhost/testrepo"));
      expect(pgAfterDeleteAllRes.status).toBe(200);
      expect(await getResultJson(pgAfterDeleteAllRes)).toEqual([
        { id: 1, name: "Alicia", email: "alice@example.com", age: 25 }
      ]);
    }
  }, 30000);
});

async function getResultJson(response: Response): Promise<any> {
  const html = await response.text();
  const match = html.match(/<div id="result">([\s\S]*?)<\/div>/);
  if (!match) throw new Error("Could not find #result element in HTML output");
  const rawJson = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
  return JSON.parse(rawJson);
}
