module ElmSsr.Svg exposing
    ( Svg
    , svg, a, circle, clipPath, defs, desc, ellipse, feBlend, feColorMatrix, feComponentTransfer, feComposite, feConvolveMatrix, feDiffuseLighting, feDisplacementMap, feDistantLight, feFlood, feFuncA, feFuncB, feFuncG, feFuncR, feGaussianBlur, feImage, feMerge, feMergeNode, feMorphology, feOffset, fePointLight, feSpecularLighting, feSpotLight, feTile, feTurbulence, filter, foreignObject, g, image, line, linearGradient, marker, mask, metadata, mpath, path, pattern, polygon, polyline, radialGradient, rect, stop, switch, symbol, text, text_, textPath, title, tspan, use, view
    )

{-| SVG elements for ElmSsr. Mirrors `elm/svg`.

@docs Svg
@docs svg, a, circle, clipPath, defs, desc, ellipse, feBlend, feColorMatrix, feComponentTransfer, feComposite, feConvolveMatrix, feDiffuseLighting, feDisplacementMap, feDistantLight, feFlood, feFuncA, feFuncB, feFuncG, feFuncR, feGaussianBlur, feImage, feMerge, feMergeNode, feMorphology, feOffset, fePointLight, feSpecularLighting, feSpotLight, feTile, feTurbulence, filter, foreignObject, g, image, line, linearGradient, marker, mask, metadata, mpath, path, pattern, polygon, polyline, radialGradient, rect, stop, switch, symbol, text, text_, textPath, title, tspan, use, view
-}

import ElmSsr.Html as Html exposing (Attribute, Node)


{-| The SVG node type. -}
type alias Svg msg =
    Node msg


element : String -> List (Attribute msg) -> List (Svg msg) -> Svg msg
element =
    Html.element


svg : List (Attribute msg) -> List (Svg msg) -> Svg msg
svg =
    element "svg"


a : List (Attribute msg) -> List (Svg msg) -> Svg msg
a =
    element "a"


circle : List (Attribute msg) -> List (Svg msg) -> Svg msg
circle =
    element "circle"


clipPath : List (Attribute msg) -> List (Svg msg) -> Svg msg
clipPath =
    element "clipPath"


defs : List (Attribute msg) -> List (Svg msg) -> Svg msg
defs =
    element "defs"


desc : List (Attribute msg) -> List (Svg msg) -> Svg msg
desc =
    element "desc"


ellipse : List (Attribute msg) -> List (Svg msg) -> Svg msg
ellipse =
    element "ellipse"


feBlend : List (Attribute msg) -> List (Svg msg) -> Svg msg
feBlend =
    element "feBlend"


feColorMatrix : List (Attribute msg) -> List (Svg msg) -> Svg msg
feColorMatrix =
    element "feColorMatrix"


feComponentTransfer : List (Attribute msg) -> List (Svg msg) -> Svg msg
feComponentTransfer =
    element "feComponentTransfer"


feComposite : List (Attribute msg) -> List (Svg msg) -> Svg msg
feComposite =
    element "feComposite"


feConvolveMatrix : List (Attribute msg) -> List (Svg msg) -> Svg msg
feConvolveMatrix =
    element "feConvolveMatrix"


feDiffuseLighting : List (Attribute msg) -> List (Svg msg) -> Svg msg
feDiffuseLighting =
    element "feDiffuseLighting"


feDisplacementMap : List (Attribute msg) -> List (Svg msg) -> Svg msg
feDisplacementMap =
    element "feDisplacementMap"


feDistantLight : List (Attribute msg) -> List (Svg msg) -> Svg msg
feDistantLight =
    element "feDistantLight"


feFlood : List (Attribute msg) -> List (Svg msg) -> Svg msg
feFlood =
    element "feFlood"


feFuncA : List (Attribute msg) -> List (Svg msg) -> Svg msg
feFuncA =
    element "feFuncA"


feFuncB : List (Attribute msg) -> List (Svg msg) -> Svg msg
feFuncB =
    element "feFuncB"


feFuncG : List (Attribute msg) -> List (Svg msg) -> Svg msg
feFuncG =
    element "feFuncG"


feFuncR : List (Attribute msg) -> List (Svg msg) -> Svg msg
feFuncR =
    element "feFuncR"


feGaussianBlur : List (Attribute msg) -> List (Svg msg) -> Svg msg
feGaussianBlur =
    element "feGaussianBlur"


feImage : List (Attribute msg) -> List (Svg msg) -> Svg msg
feImage =
    element "feImage"


feMerge : List (Attribute msg) -> List (Svg msg) -> Svg msg
feMerge =
    element "feMerge"


feMergeNode : List (Attribute msg) -> List (Svg msg) -> Svg msg
feMergeNode =
    element "feMergeNode"


feMorphology : List (Attribute msg) -> List (Svg msg) -> Svg msg
feMorphology =
    element "feMorphology"


feOffset : List (Attribute msg) -> List (Svg msg) -> Svg msg
feOffset =
    element "feOffset"


fePointLight : List (Attribute msg) -> List (Svg msg) -> Svg msg
fePointLight =
    element "fePointLight"


feSpecularLighting : List (Attribute msg) -> List (Svg msg) -> Svg msg
feSpecularLighting =
    element "feSpecularLighting"


feSpotLight : List (Attribute msg) -> List (Svg msg) -> Svg msg
feSpotLight =
    element "feSpotLight"


feTile : List (Attribute msg) -> List (Svg msg) -> Svg msg
feTile =
    element "feTile"


feTurbulence : List (Attribute msg) -> List (Svg msg) -> Svg msg
feTurbulence =
    element "feTurbulence"


filter : List (Attribute msg) -> List (Svg msg) -> Svg msg
filter =
    element "filter"


foreignObject : List (Attribute msg) -> List (Svg msg) -> Svg msg
foreignObject =
    element "foreignObject"


g : List (Attribute msg) -> List (Svg msg) -> Svg msg
g =
    element "g"


image : List (Attribute msg) -> List (Svg msg) -> Svg msg
image =
    element "image"


line : List (Attribute msg) -> List (Svg msg) -> Svg msg
line =
    element "line"


linearGradient : List (Attribute msg) -> List (Svg msg) -> Svg msg
linearGradient =
    element "linearGradient"


marker : List (Attribute msg) -> List (Svg msg) -> Svg msg
marker =
    element "marker"


mask : List (Attribute msg) -> List (Svg msg) -> Svg msg
mask =
    element "mask"


metadata : List (Attribute msg) -> List (Svg msg) -> Svg msg
metadata =
    element "metadata"


mpath : List (Attribute msg) -> List (Svg msg) -> Svg msg
mpath =
    element "mpath"


path : List (Attribute msg) -> List (Svg msg) -> Svg msg
path =
    element "path"


pattern : List (Attribute msg) -> List (Svg msg) -> Svg msg
pattern =
    element "pattern"


polygon : List (Attribute msg) -> List (Svg msg) -> Svg msg
polygon =
    element "polygon"


polyline : List (Attribute msg) -> List (Svg msg) -> Svg msg
polyline =
    element "polyline"


radialGradient : List (Attribute msg) -> List (Svg msg) -> Svg msg
radialGradient =
    element "radialGradient"


rect : List (Attribute msg) -> List (Svg msg) -> Svg msg
rect =
    element "rect"


stop : List (Attribute msg) -> List (Svg msg) -> Svg msg
stop =
    element "stop"


switch : List (Attribute msg) -> List (Svg msg) -> Svg msg
switch =
    element "switch"


symbol : List (Attribute msg) -> List (Svg msg) -> Svg msg
symbol =
    element "symbol"


{-| A text node, e.g. the content of a `<text>` element. Mirrors `Svg.text`. -}
text : String -> Svg msg
text =
    Html.text


{-| The `<text>` element. Mirrors `Svg.text_`. -}
text_ : List (Attribute msg) -> List (Svg msg) -> Svg msg
text_ =
    element "text"


textPath : List (Attribute msg) -> List (Svg msg) -> Svg msg
textPath =
    element "textPath"


title : List (Attribute msg) -> List (Svg msg) -> Svg msg
title =
    element "title"


tspan : List (Attribute msg) -> List (Svg msg) -> Svg msg
tspan =
    element "tspan"


use : List (Attribute msg) -> List (Svg msg) -> Svg msg
use =
    element "use"


view : List (Attribute msg) -> List (Svg msg) -> Svg msg
view =
    element "view"
