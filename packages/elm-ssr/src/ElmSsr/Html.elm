module ElmSsr.Html exposing
    ( Node(..)
    , Attribute(..)
    , EventCapture(..)
    , EventValue(..)
    , text
    , a, article, button, code, div, form, h1, h2, h3, header, input, label, li, link, main_, meta, nav, p, section, span, ul
    , element, voidElement
    , mapNode, mapAttribute
    , static, island
    )

{-| The HTML AST and element vocabulary.

Attributes live in [`ElmSsr.Html.Attributes`](./Html/Attributes.elm) and event
handlers in [`ElmSsr.Html.Events`](./Html/Events.elm), mirroring `elm/html`.


# AST

@docs Node, Attribute, EventCapture, EventValue


# Text and elements

@docs text
@docs a, article, button, code, div, form, h1, h2, h3, header, input, label, li, link, main_, meta, nav, p, section, span, ul
@docs element, voidElement


# Mapping

@docs mapNode, mapAttribute


# Islands

@docs static, island

-}


type Node msg
    = Element String (List (Attribute msg)) (List (Node msg))
    | VoidElement String (List (Attribute msg))
    | Text String
    | Keyed String (Node msg)


type Attribute msg
    = Property String String
    | EventHandler String EventCapture (EventValue -> msg)


type EventCapture
    = NoEventData
    | TargetValue


type EventValue
    = NoValue
    | StringValue String


text : String -> Node msg
text =
    Text


mapNode : (a -> b) -> Node a -> Node b
mapNode fn node =
    case node of
        Element tag attributes children ->
            Element tag (List.map (mapAttribute fn) attributes) (List.map (mapNode fn) children)

        VoidElement tag attributes ->
            VoidElement tag (List.map (mapAttribute fn) attributes)

        Text content ->
            Text content

        Keyed key keyedNode ->
            Keyed key (mapNode fn keyedNode)


mapAttribute : (a -> b) -> Attribute a -> Attribute b
mapAttribute fn attribute =
    case attribute of
        Property attributeName attributeValue ->
            Property attributeName attributeValue

        EventHandler eventName capture toMessage ->
            EventHandler eventName capture (\eventValue -> fn (toMessage eventValue))


{-| Drop every event handler from a node tree, producing inert markup usable at
any message type. Used to render an island's initial view into an otherwise
static page; the island's own client runtime replaces that inert subtree when it
mounts.
-}
static : Node a -> Node b
static node =
    case node of
        Element tag attributes children ->
            Element tag (List.filterMap staticAttribute attributes) (List.map static children)

        VoidElement tag attributes ->
            VoidElement tag (List.filterMap staticAttribute attributes)

        Text content ->
            Text content

        Keyed key keyedNode ->
            Keyed key (static keyedNode)


staticAttribute : Attribute a -> Maybe (Attribute b)
staticAttribute attribute =
    case attribute of
        Property attributeName attributeValue ->
            Just (Property attributeName attributeValue)

        EventHandler _ _ _ ->
            Nothing


{-| Wrap a node as an interactive island: an `<elm-ssr-island>` marker carrying
the island name and its encoded props, with the node rendered inert inside it.
The client runtime finds these markers and mounts each island independently.
-}
island : String -> String -> Node a -> Node b
island name encodedProps node =
    Element "elm-ssr-island"
        [ Property "data-elmssr-island" name
        , Property "data-elmssr-props" encodedProps
        ]
        [ static node ]


{-| Build an element with children. -}
element : String -> List (Attribute msg) -> List (Node msg) -> Node msg
element tag attributes children =
    Element tag attributes children


{-| Build a void (childless) element such as `input` or `meta`. -}
voidElement : String -> List (Attribute msg) -> Node msg
voidElement tag attributes =
    VoidElement tag attributes


a : List (Attribute msg) -> List (Node msg) -> Node msg
a =
    element "a"


article : List (Attribute msg) -> List (Node msg) -> Node msg
article =
    element "article"


button : List (Attribute msg) -> List (Node msg) -> Node msg
button =
    element "button"


code : List (Attribute msg) -> List (Node msg) -> Node msg
code =
    element "code"


div : List (Attribute msg) -> List (Node msg) -> Node msg
div =
    element "div"


form : List (Attribute msg) -> List (Node msg) -> Node msg
form =
    element "form"


h1 : List (Attribute msg) -> List (Node msg) -> Node msg
h1 =
    element "h1"


h2 : List (Attribute msg) -> List (Node msg) -> Node msg
h2 =
    element "h2"


h3 : List (Attribute msg) -> List (Node msg) -> Node msg
h3 =
    element "h3"


header : List (Attribute msg) -> List (Node msg) -> Node msg
header =
    element "header"


input : List (Attribute msg) -> Node msg
input =
    voidElement "input"


label : List (Attribute msg) -> List (Node msg) -> Node msg
label =
    element "label"


li : List (Attribute msg) -> List (Node msg) -> Node msg
li =
    element "li"


link : List (Attribute msg) -> Node msg
link =
    voidElement "link"


main_ : List (Attribute msg) -> List (Node msg) -> Node msg
main_ =
    element "main"


meta : List (Attribute msg) -> Node msg
meta =
    voidElement "meta"


nav : List (Attribute msg) -> List (Node msg) -> Node msg
nav =
    element "nav"


p : List (Attribute msg) -> List (Node msg) -> Node msg
p =
    element "p"


section : List (Attribute msg) -> List (Node msg) -> Node msg
section =
    element "section"


span : List (Attribute msg) -> List (Node msg) -> Node msg
span =
    element "span"


ul : List (Attribute msg) -> List (Node msg) -> Node msg
ul =
    element "ul"
