module ElmSsr.Html exposing
    ( Node(..)
    , Attribute(..)
    , EventCapture(..)
    , EventValue(..)
    , text
    , a, abbr, address, article, aside, audio, b, bdi, bdo, blockquote, br, button, canvas, caption, cite, code, col, colgroup, data, datalist, dd, del, details, dfn, dialog, div, dl, dt, em, embed, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, i, iframe, img, input, ins, kbd, label, legend, li, link, main_, map, mark, math, menu, meta, meter, nav, noscript, object, ol, optgroup, option, output, p, param, picture, pre, progress, q, rb, rp, rt, rtc, ruby, s, samp, script, section, select, slot, small, source, span, strong, sub, summary, sup, svg, table, tbody, td, template, textarea, tfoot, th, thead, time, title, tr, track, u, ul, var, video, wbr
    , element, voidElement
    , mapNode, mapAttribute
    , static, island, hasIsland, anyIsland
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

@docs static, island, hasIsland, anyIsland

-}


type Node msg
    = Element String (List (Attribute msg)) (List (Node msg))
    | VoidElement String (List (Attribute msg))
    | Text String


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


staticAttribute : Attribute a -> Maybe (Attribute b)
staticAttribute attribute =
    case attribute of
        Property attributeName attributeValue ->
            Just (Property attributeName attributeValue)

        EventHandler _ _ _ ->
            Nothing


{-| Check if a node is an island marker or contains any. -}
hasIsland : Node msg -> Bool
hasIsland node =
    case node of
        Element tag _ children ->
            (tag == "elm-ssr-island") || List.any hasIsland children

        VoidElement _ _ ->
            False

        Text _ ->
            False


{-| Check if any node in a list contains an island marker. -}
anyIsland : List (Node msg) -> Bool
anyIsland =
    List.any hasIsland


{-| Wrap a node as an interactive island: an `<elm-ssr-island>` marker carrying
the island name and its encoded props, with the node rendered inert inside it.
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


abbr : List (Attribute msg) -> List (Node msg) -> Node msg
abbr =
    element "abbr"


address : List (Attribute msg) -> List (Node msg) -> Node msg
address =
    element "address"


aside : List (Attribute msg) -> List (Node msg) -> Node msg
aside =
    element "aside"


audio : List (Attribute msg) -> List (Node msg) -> Node msg
audio =
    element "audio"


b : List (Attribute msg) -> List (Node msg) -> Node msg
b =
    element "b"


bdi : List (Attribute msg) -> List (Node msg) -> Node msg
bdi =
    element "bdi"


bdo : List (Attribute msg) -> List (Node msg) -> Node msg
bdo =
    element "bdo"


blockquote : List (Attribute msg) -> List (Node msg) -> Node msg
blockquote =
    element "blockquote"


br : List (Attribute msg) -> Node msg
br =
    voidElement "br"


canvas : List (Attribute msg) -> List (Node msg) -> Node msg
canvas =
    element "canvas"


caption : List (Attribute msg) -> List (Node msg) -> Node msg
caption =
    element "caption"


cite : List (Attribute msg) -> List (Node msg) -> Node msg
cite =
    element "cite"


col : List (Attribute msg) -> Node msg
col =
    voidElement "col"


colgroup : List (Attribute msg) -> List (Node msg) -> Node msg
colgroup =
    element "colgroup"


data : List (Attribute msg) -> List (Node msg) -> Node msg
data =
    element "data"


datalist : List (Attribute msg) -> List (Node msg) -> Node msg
datalist =
    element "datalist"


dd : List (Attribute msg) -> List (Node msg) -> Node msg
dd =
    element "dd"


del : List (Attribute msg) -> List (Node msg) -> Node msg
del =
    element "del"


details : List (Attribute msg) -> List (Node msg) -> Node msg
details =
    element "details"


dfn : List (Attribute msg) -> List (Node msg) -> Node msg
dfn =
    element "dfn"


dialog : List (Attribute msg) -> List (Node msg) -> Node msg
dialog =
    element "dialog"


dl : List (Attribute msg) -> List (Node msg) -> Node msg
dl =
    element "dl"


dt : List (Attribute msg) -> List (Node msg) -> Node msg
dt =
    element "dt"


em : List (Attribute msg) -> List (Node msg) -> Node msg
em =
    element "em"


embed : List (Attribute msg) -> Node msg
embed =
    voidElement "embed"


title : List (Attribute msg) -> List (Node msg) -> Node msg
title =
    element "title"


fieldset : List (Attribute msg) -> List (Node msg) -> Node msg
fieldset =
    element "fieldset"


figcaption : List (Attribute msg) -> List (Node msg) -> Node msg
figcaption =
    element "figcaption"


figure : List (Attribute msg) -> List (Node msg) -> Node msg
figure =
    element "figure"


footer : List (Attribute msg) -> List (Node msg) -> Node msg
footer =
    element "footer"


h4 : List (Attribute msg) -> List (Node msg) -> Node msg
h4 =
    element "h4"


h5 : List (Attribute msg) -> List (Node msg) -> Node msg
h5 =
    element "h5"


h6 : List (Attribute msg) -> List (Node msg) -> Node msg
h6 =
    element "h6"


hr : List (Attribute msg) -> Node msg
hr =
    voidElement "hr"


i : List (Attribute msg) -> List (Node msg) -> Node msg
i =
    element "i"


iframe : List (Attribute msg) -> List (Node msg) -> Node msg
iframe =
    element "iframe"


img : List (Attribute msg) -> Node msg
img =
    voidElement "img"


ins : List (Attribute msg) -> List (Node msg) -> Node msg
ins =
    element "ins"


kbd : List (Attribute msg) -> List (Node msg) -> Node msg
kbd =
    element "kbd"


legend : List (Attribute msg) -> List (Node msg) -> Node msg
legend =
    element "legend"


map : List (Attribute msg) -> List (Node msg) -> Node msg
map =
    element "map"


mark : List (Attribute msg) -> List (Node msg) -> Node msg
mark =
    element "mark"


math : List (Attribute msg) -> List (Node msg) -> Node msg
math =
    element "math"


menu : List (Attribute msg) -> List (Node msg) -> Node msg
menu =
    element "menu"


meter : List (Attribute msg) -> List (Node msg) -> Node msg
meter =
    element "meter"


noscript : List (Attribute msg) -> List (Node msg) -> Node msg
noscript =
    element "noscript"


object : List (Attribute msg) -> List (Node msg) -> Node msg
object =
    element "object"


ol : List (Attribute msg) -> List (Node msg) -> Node msg
ol =
    element "ol"


optgroup : List (Attribute msg) -> List (Node msg) -> Node msg
optgroup =
    element "optgroup"


option : List (Attribute msg) -> List (Node msg) -> Node msg
option =
    element "option"


output : List (Attribute msg) -> List (Node msg) -> Node msg
output =
    element "output"


param : List (Attribute msg) -> Node msg
param =
    voidElement "param"


picture : List (Attribute msg) -> List (Node msg) -> Node msg
picture =
    element "picture"


pre : List (Attribute msg) -> List (Node msg) -> Node msg
pre =
    element "pre"


progress : List (Attribute msg) -> List (Node msg) -> Node msg
progress =
    element "progress"


q : List (Attribute msg) -> List (Node msg) -> Node msg
q =
    element "q"


rb : List (Attribute msg) -> List (Node msg) -> Node msg
rb =
    element "rb"


rp : List (Attribute msg) -> List (Node msg) -> Node msg
rp =
    element "rp"


rt : List (Attribute msg) -> List (Node msg) -> Node msg
rt =
    element "rt"


rtc : List (Attribute msg) -> List (Node msg) -> Node msg
rtc =
    element "rtc"


ruby : List (Attribute msg) -> List (Node msg) -> Node msg
ruby =
    element "ruby"


s : List (Attribute msg) -> List (Node msg) -> Node msg
s =
    element "s"


samp : List (Attribute msg) -> List (Node msg) -> Node msg
samp =
    element "samp"


script : List (Attribute msg) -> List (Node msg) -> Node msg
script =
    element "script"


select : List (Attribute msg) -> List (Node msg) -> Node msg
select =
    element "select"


slot : List (Attribute msg) -> List (Node msg) -> Node msg
slot =
    element "slot"


small : List (Attribute msg) -> List (Node msg) -> Node msg
small =
    element "small"


source : List (Attribute msg) -> Node msg
source =
    voidElement "source"


strong : List (Attribute msg) -> List (Node msg) -> Node msg
strong =
    element "strong"


sub : List (Attribute msg) -> List (Node msg) -> Node msg
sub =
    element "sub"


summary : List (Attribute msg) -> List (Node msg) -> Node msg
summary =
    element "summary"


sup : List (Attribute msg) -> List (Node msg) -> Node msg
sup =
    element "sup"


svg : List (Attribute msg) -> List (Node msg) -> Node msg
svg =
    element "svg"


table : List (Attribute msg) -> List (Node msg) -> Node msg
table =
    element "table"


tbody : List (Attribute msg) -> List (Node msg) -> Node msg
tbody =
    element "tbody"


td : List (Attribute msg) -> List (Node msg) -> Node msg
td =
    element "td"


template : List (Attribute msg) -> List (Node msg) -> Node msg
template =
    element "template"


textarea : List (Attribute msg) -> List (Node msg) -> Node msg
textarea =
    element "textarea"


tfoot : List (Attribute msg) -> List (Node msg) -> Node msg
tfoot =
    element "tfoot"


th : List (Attribute msg) -> List (Node msg) -> Node msg
th =
    element "th"


thead : List (Attribute msg) -> List (Node msg) -> Node msg
thead =
    element "thead"


time : List (Attribute msg) -> List (Node msg) -> Node msg
time =
    element "time"


tr : List (Attribute msg) -> List (Node msg) -> Node msg
tr =
    element "tr"


track : List (Attribute msg) -> Node msg
track =
    voidElement "track"


u : List (Attribute msg) -> List (Node msg) -> Node msg
u =
    element "u"


var : List (Attribute msg) -> List (Node msg) -> Node msg
var =
    element "var"


video : List (Attribute msg) -> List (Node msg) -> Node msg
video =
    element "video"


wbr : List (Attribute msg) -> Node msg
wbr =
    voidElement "wbr"
