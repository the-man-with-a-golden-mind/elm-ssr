module ElmSsr.Svg.Attributes exposing
    ( attr
    , accentHeight, accumulate, additive, alignmentBaseline, alphabetic, amplitude, arabicForm, ascent, attributeName, attributeType, azimuth, baseFrequency, baseProfile, bbox, begin, bias, by, calcMode, capHeight, class, clipPath, clipPathUnits, clipRule, colorInterpolation, colorInterpolationFilters, colorProfile, colorRendering, contentScriptType, contentStyleType, cursor, cx, cy, d, decode, diffuseConstant, direction, display, divisor, dominantBaseline, dur, dx, dy, edgeMode, elevation, enableBackground, end, exponent, externalResourcesRequired, fill, fillOpacity, fillRule, filter, filterRes, filterUnits, floodColor, floodOpacity, fontFamily, fontSize, fontSizeAdjust, fontStretch, fontStyle, fontVariant, fontWeight, format, from, fx, fy, g1, g2, glyphName, glyphOrientationHorizontal, glyphOrientationVertical, glyphRef, gradientTransform, gradientUnits, hanging, height, horizAdvX, horizOriginX, id, ideographic, imageRendering, in_, in2, intercept, k, k1, k2, k3, k4, kernelMatrix, kernelUnitLength, kerning, keyPoints, keySplines, keyTimes, lang, lengthAdjust, letterSpacing, lightingColor, limitingConeAngle, local, markerEnd, markerHeight, markerMid, markerStart, markerUnits, markerWidth, mask, maskContentUnits, maskUnits, mathematical, max, media, method, min, mode, name, numOctaves, offset, opacity, operator, order, orient, orientation, origin, overflow, overlinePosition, overlineThickness, panose1, pathLength, patternContentUnits, patternTransform, patternUnits, pointerEvents, points, pointsAtX, pointsAtY, pointsAtZ, preserveAlpha, preserveAspectRatio, primitiveUnits, r, radius, refX, refY, renderingOrder, repeatable, repeatCount, repeatDur, restart, result, rotate, rx, ry, scale, seed, shapeRendering, slope, spacing, specularConstant, specularExponent, speed, spreadMethod, startOffset, stdDeviation, stemh, stemv, stitchTiles, stopColor, stopOpacity, strikethroughPosition, strikethroughThickness, string, stroke, strokeDasharray, stop_color, stop_opacity, stroke_dasharray, strokeDashoffset, strokeLinecap, strokeLinejoin, strokeMiterlimit, strokeOpacity, strokeWidth, style, surfaceScale, systemLanguage, tableValues, target, targetX, targetY, textAnchor, textDecoration, textLength, textRendering, title, to, transform, type_, u1, u2, underlinePosition, underlineThickness, unicode, unicodeBidi, unicodeRange, unitsPerEm, vAlphabetic, vHanging, vIdeographic, vMathematical, values, version, vertAdvY, vertOriginX, vertOriginY, viewBox, viewTarget, visibility, width, widths, wordSpacing, writingMode, x, x1, x2, xChannelSelector, xHeight, xlinkActuate, xlinkArcrole, xlinkHref, xlinkRole, xlinkShow, xlinkTitle, xlinkType, xmlBase, xmlLang, xmlSpace, y, y1, y2, yChannelSelector, z, zoomAndPan
    )

{-| SVG attributes for ElmSsr. Mirrors `elm/svg`.

@docs attr
@docs accentHeight, accumulate, additive, alignmentBaseline, alphabetic, amplitude, arabicForm, ascent, attributeName, attributeType, azimuth, baseFrequency, baseProfile, bbox, begin, bias, by, calcMode, capHeight, class, clipPath, clipPathUnits, clipRule, colorInterpolation, colorInterpolationFilters, colorProfile, colorRendering, contentScriptType, contentStyleType, cursor, cx, cy, d, decode, diffuseConstant, direction, display, divisor, dominantBaseline, dur, dx, dy, edgeMode, elevation, enableBackground, end, exponent, externalResourcesRequired, fill, fillOpacity, fillRule, filter, filterRes, filterUnits, floodColor, floodOpacity, fontFamily, fontSize, fontSizeAdjust, fontStretch, fontStyle, fontVariant, fontWeight, format, from, fx, fy, g1, g2, glyphName, glyphOrientationHorizontal, glyphOrientationVertical, glyphRef, gradientTransform, gradientUnits, hanging, height, horizAdvX, horizOriginX, id, ideographic, imageRendering, in_, in2, intercept, k, k1, k2, k3, k4, kernelMatrix, kernelUnitLength, kerning, keyPoints, keySplines, keyTimes, lang, lengthAdjust, letterSpacing, lightingColor, limitingConeAngle, local, markerEnd, markerHeight, markerMid, markerStart, markerUnits, markerWidth, mask, maskContentUnits, maskUnits, mathematical, max, media, method, min, mode, name, numOctaves, offset, opacity, operator, order, orient, orientation, origin, overflow, overlinePosition, overlineThickness, panose1, pathLength, patternContentUnits, patternTransform, patternUnits, pointerEvents, points, pointsAtX, pointsAtY, pointsAtZ, preserveAlpha, preserveAspectRatio, primitiveUnits, r, radius, refX, refY, renderingOrder, repeatable, repeatCount, repeatDur, restart, result, rotate, rx, ry, scale, seed, shapeRendering, slope, spacing, specularConstant, specularExponent, speed, spreadMethod, startOffset, stdDeviation, stemh, stemv, stitchTiles, stopColor, stopOpacity, strikethroughPosition, strikethroughThickness, string, stroke, strokeDasharray, stop_color, stop_opacity, stroke_dasharray, strokeDashoffset, strokeLinecap, strokeLinejoin, strokeMiterlimit, strokeOpacity, strokeWidth, style, surfaceScale, systemLanguage, tableValues, target, targetX, targetY, textAnchor, textDecoration, textLength, textRendering, title, to, transform, type_, u1, u2, underlinePosition, underlineThickness, unicode, unicodeBidi, unicodeRange, unitsPerEm, vAlphabetic, vHanging, vIdeographic, vMathematical, values, version, vertAdvY, vertOriginX, vertOriginY, viewBox, viewTarget, visibility, width, widths, wordSpacing, writingMode, x, x1, x2, xChannelSelector, xHeight, xlinkActuate, xlinkArcrole, xlinkHref, xlinkRole, xlinkShow, xlinkTitle, xlinkType, xmlBase, xmlLang, xmlSpace, y, y1, y2, yChannelSelector, z, zoomAndPan
-}

import ElmSsr.Html exposing (Attribute(..))


{-| Set an arbitrary attribute. -}
attr : String -> String -> Attribute msg
attr =
    Property


accentHeight : String -> Attribute msg
accentHeight =
    attr "accent-height"


accumulate : String -> Attribute msg
accumulate =
    attr "accumulate"


additive : String -> Attribute msg
additive =
    attr "additive"


alignmentBaseline : String -> Attribute msg
alignmentBaseline =
    attr "alignment-baseline"


alphabetic : String -> Attribute msg
alphabetic =
    attr "alphabetic"


amplitude : String -> Attribute msg
amplitude =
    attr "amplitude"


arabicForm : String -> Attribute msg
arabicForm =
    attr "arabic-form"


ascent : String -> Attribute msg
ascent =
    attr "ascent"


attributeName : String -> Attribute msg
attributeName =
    attr "attributeName"


attributeType : String -> Attribute msg
attributeType =
    attr "attributeType"


azimuth : String -> Attribute msg
azimuth =
    attr "azimuth"


baseFrequency : String -> Attribute msg
baseFrequency =
    attr "baseFrequency"


baseProfile : String -> Attribute msg
baseProfile =
    attr "baseProfile"


bbox : String -> Attribute msg
bbox =
    attr "bbox"


begin : String -> Attribute msg
begin =
    attr "begin"


bias : String -> Attribute msg
bias =
    attr "bias"


by : String -> Attribute msg
by =
    attr "by"


calcMode : String -> Attribute msg
calcMode =
    attr "calcMode"


capHeight : String -> Attribute msg
capHeight =
    attr "cap-height"


class : String -> Attribute msg
class =
    attr "class"


clipPath : String -> Attribute msg
clipPath =
    attr "clip-path"


clipPathUnits : String -> Attribute msg
clipPathUnits =
    attr "clipPathUnits"


clipRule : String -> Attribute msg
clipRule =
    attr "clip-rule"


colorInterpolation : String -> Attribute msg
colorInterpolation =
    attr "color-interpolation"


colorInterpolationFilters : String -> Attribute msg
colorInterpolationFilters =
    attr "color-interpolation-filters"


colorProfile : String -> Attribute msg
colorProfile =
    attr "color-profile"


colorRendering : String -> Attribute msg
colorRendering =
    attr "color-rendering"


contentScriptType : String -> Attribute msg
contentScriptType =
    attr "contentScriptType"


contentStyleType : String -> Attribute msg
contentStyleType =
    attr "contentStyleType"


cursor : String -> Attribute msg
cursor =
    attr "cursor"


cx : String -> Attribute msg
cx =
    attr "cx"


cy : String -> Attribute msg
cy =
    attr "cy"


d : String -> Attribute msg
d =
    attr "d"


decode : String -> Attribute msg
decode =
    attr "decode"


diffuseConstant : String -> Attribute msg
diffuseConstant =
    attr "diffuseConstant"


direction : String -> Attribute msg
direction =
    attr "direction"


display : String -> Attribute msg
display =
    attr "display"


divisor : String -> Attribute msg
divisor =
    attr "divisor"


dominantBaseline : String -> Attribute msg
dominantBaseline =
    attr "dominant-baseline"


dur : String -> Attribute msg
dur =
    attr "dur"


dx : String -> Attribute msg
dx =
    attr "dx"


dy : String -> Attribute msg
dy =
    attr "dy"


edgeMode : String -> Attribute msg
edgeMode =
    attr "edgeMode"


elevation : String -> Attribute msg
elevation =
    attr "elevation"


enableBackground : String -> Attribute msg
enableBackground =
    attr "enable-background"


end : String -> Attribute msg
end =
    attr "end"


exponent : String -> Attribute msg
exponent =
    attr "exponent"


externalResourcesRequired : String -> Attribute msg
externalResourcesRequired =
    attr "externalResourcesRequired"


fill : String -> Attribute msg
fill =
    attr "fill"


fillOpacity : String -> Attribute msg
fillOpacity =
    attr "fill-opacity"


fillRule : String -> Attribute msg
fillRule =
    attr "fill-rule"


filter : String -> Attribute msg
filter =
    attr "filter"


filterRes : String -> Attribute msg
filterRes =
    attr "filterRes"


filterUnits : String -> Attribute msg
filterUnits =
    attr "filterUnits"


floodColor : String -> Attribute msg
floodColor =
    attr "flood-color"


floodOpacity : String -> Attribute msg
floodOpacity =
    attr "flood-opacity"


fontFamily : String -> Attribute msg
fontFamily =
    attr "font-family"


fontSize : String -> Attribute msg
fontSize =
    attr "font-size"


fontSizeAdjust : String -> Attribute msg
fontSizeAdjust =
    attr "font-size-adjust"


fontStretch : String -> Attribute msg
fontStretch =
    attr "font-stretch"


fontStyle : String -> Attribute msg
fontStyle =
    attr "font-style"


fontVariant : String -> Attribute msg
fontVariant =
    attr "font-variant"


fontWeight : String -> Attribute msg
fontWeight =
    attr "font-weight"


format : String -> Attribute msg
format =
    attr "format"


from : String -> Attribute msg
from =
    attr "from"


fx : String -> Attribute msg
fx =
    attr "fx"


fy : String -> Attribute msg
fy =
    attr "fy"


g1 : String -> Attribute msg
g1 =
    attr "g1"


g2 : String -> Attribute msg
g2 =
    attr "g2"


glyphName : String -> Attribute msg
glyphName =
    attr "glyph-name"


glyphOrientationHorizontal : String -> Attribute msg
glyphOrientationHorizontal =
    attr "glyph-orientation-horizontal"


glyphOrientationVertical : String -> Attribute msg
glyphOrientationVertical =
    attr "glyph-orientation-vertical"


glyphRef : String -> Attribute msg
glyphRef =
    attr "glyphRef"


gradientTransform : String -> Attribute msg
gradientTransform =
    attr "gradientTransform"


gradientUnits : String -> Attribute msg
gradientUnits =
    attr "gradientUnits"


hanging : String -> Attribute msg
hanging =
    attr "hanging"


height : String -> Attribute msg
height =
    attr "height"


horizAdvX : String -> Attribute msg
horizAdvX =
    attr "horiz-adv-x"


horizOriginX : String -> Attribute msg
horizOriginX =
    attr "horiz-origin-x"


id : String -> Attribute msg
id =
    attr "id"


ideographic : String -> Attribute msg
ideographic =
    attr "ideographic"


imageRendering : String -> Attribute msg
imageRendering =
    attr "image-rendering"


in_ : String -> Attribute msg
in_ =
    attr "in"


in2 : String -> Attribute msg
in2 =
    attr "in2"


intercept : String -> Attribute msg
intercept =
    attr "intercept"


k : String -> Attribute msg
k =
    attr "k"


k1 : String -> Attribute msg
k1 =
    attr "k1"


k2 : String -> Attribute msg
k2 =
    attr "k2"


k3 : String -> Attribute msg
k3 =
    attr "k3"


k4 : String -> Attribute msg
k4 =
    attr "k4"


kernelMatrix : String -> Attribute msg
kernelMatrix =
    attr "kernelMatrix"


kernelUnitLength : String -> Attribute msg
kernelUnitLength =
    attr "kernelUnitLength"


kerning : String -> Attribute msg
kerning =
    attr "kerning"


keyPoints : String -> Attribute msg
keyPoints =
    attr "keyPoints"


keySplines : String -> Attribute msg
keySplines =
    attr "keySplines"


keyTimes : String -> Attribute msg
keyTimes =
    attr "keyTimes"


lang : String -> Attribute msg
lang =
    attr "lang"


lengthAdjust : String -> Attribute msg
lengthAdjust =
    attr "lengthAdjust"


letterSpacing : String -> Attribute msg
letterSpacing =
    attr "letter-spacing"


lightingColor : String -> Attribute msg
lightingColor =
    attr "lighting-color"


limitingConeAngle : String -> Attribute msg
limitingConeAngle =
    attr "limitingConeAngle"


local : String -> Attribute msg
local =
    attr "local"


markerEnd : String -> Attribute msg
markerEnd =
    attr "marker-end"


markerHeight : String -> Attribute msg
markerHeight =
    attr "markerHeight"


markerMid : String -> Attribute msg
markerMid =
    attr "marker-mid"


markerStart : String -> Attribute msg
markerStart =
    attr "marker-start"


markerUnits : String -> Attribute msg
markerUnits =
    attr "markerUnits"


markerWidth : String -> Attribute msg
markerWidth =
    attr "markerWidth"


mask : String -> Attribute msg
mask =
    attr "mask"


maskContentUnits : String -> Attribute msg
maskContentUnits =
    attr "maskContentUnits"


maskUnits : String -> Attribute msg
maskUnits =
    attr "maskUnits"


mathematical : String -> Attribute msg
mathematical =
    attr "mathematical"


max : String -> Attribute msg
max =
    attr "max"


media : String -> Attribute msg
media =
    attr "media"


method : String -> Attribute msg
method =
    attr "method"


min : String -> Attribute msg
min =
    attr "min"


mode : String -> Attribute msg
mode =
    attr "mode"


name : String -> Attribute msg
name =
    attr "name"


numOctaves : String -> Attribute msg
numOctaves =
    attr "numOctaves"


offset : String -> Attribute msg
offset =
    attr "offset"


opacity : String -> Attribute msg
opacity =
    attr "opacity"


operator : String -> Attribute msg
operator =
    attr "operator"


order : String -> Attribute msg
order =
    attr "order"


orient : String -> Attribute msg
orient =
    attr "orient"


orientation : String -> Attribute msg
orientation =
    attr "orientation"


origin : String -> Attribute msg
origin =
    attr "origin"


overflow : String -> Attribute msg
overflow =
    attr "overflow"


overlinePosition : String -> Attribute msg
overlinePosition =
    attr "overline-position"


overlineThickness : String -> Attribute msg
overlineThickness =
    attr "overline-thickness"


panose1 : String -> Attribute msg
panose1 =
    attr "panose-1"


pathLength : String -> Attribute msg
pathLength =
    attr "pathLength"


patternContentUnits : String -> Attribute msg
patternContentUnits =
    attr "patternContentUnits"


patternTransform : String -> Attribute msg
patternTransform =
    attr "patternTransform"


patternUnits : String -> Attribute msg
patternUnits =
    attr "patternUnits"


pointerEvents : String -> Attribute msg
pointerEvents =
    attr "pointer-events"


points : String -> Attribute msg
points =
    attr "points"


pointsAtX : String -> Attribute msg
pointsAtX =
    attr "pointsAtX"


pointsAtY : String -> Attribute msg
pointsAtY =
    attr "pointsAtY"


pointsAtZ : String -> Attribute msg
pointsAtZ =
    attr "pointsAtZ"


preserveAlpha : String -> Attribute msg
preserveAlpha =
    attr "preserveAlpha"


preserveAspectRatio : String -> Attribute msg
preserveAspectRatio =
    attr "preserveAspectRatio"


primitiveUnits : String -> Attribute msg
primitiveUnits =
    attr "primitiveUnits"


r : String -> Attribute msg
r =
    attr "r"


radius : String -> Attribute msg
radius =
    attr "radius"


refX : String -> Attribute msg
refX =
    attr "refX"


refY : String -> Attribute msg
refY =
    attr "refY"


renderingOrder : String -> Attribute msg
renderingOrder =
    attr "rendering-order"


repeatable : String -> Attribute msg
repeatable =
    attr "repeatable"


repeatCount : String -> Attribute msg
repeatCount =
    attr "repeatCount"


repeatDur : String -> Attribute msg
repeatDur =
    attr "repeatDur"


restart : String -> Attribute msg
restart =
    attr "restart"


result : String -> Attribute msg
result =
    attr "result"


rotate : String -> Attribute msg
rotate =
    attr "rotate"


rx : String -> Attribute msg
rx =
    attr "rx"


ry : String -> Attribute msg
ry =
    attr "ry"


scale : String -> Attribute msg
scale =
    attr "scale"


seed : String -> Attribute msg
seed =
    attr "seed"


shapeRendering : String -> Attribute msg
shapeRendering =
    attr "shape-rendering"


slope : String -> Attribute msg
slope =
    attr "slope"


spacing : String -> Attribute msg
spacing =
    attr "spacing"


specularConstant : String -> Attribute msg
specularConstant =
    attr "specularConstant"


specularExponent : String -> Attribute msg
specularExponent =
    attr "specularExponent"


speed : String -> Attribute msg
speed =
    attr "speed"


spreadMethod : String -> Attribute msg
spreadMethod =
    attr "spreadMethod"


startOffset : String -> Attribute msg
startOffset =
    attr "startOffset"


stdDeviation : String -> Attribute msg
stdDeviation =
    attr "stdDeviation"


stemh : String -> Attribute msg
stemh =
    attr "stemh"


stemv : String -> Attribute msg
stemv =
    attr "stemv"


stitchTiles : String -> Attribute msg
stitchTiles =
    attr "stitchTiles"


stopColor : String -> Attribute msg
stopColor =
    attr "stop-color"


stopOpacity : String -> Attribute msg
stopOpacity =
    attr "stop-opacity"


strikethroughPosition : String -> Attribute msg
strikethroughPosition =
    attr "strikethrough-position"


strikethroughThickness : String -> Attribute msg
strikethroughThickness =
    attr "strikethrough-thickness"


string : String -> Attribute msg
string =
    attr "string"


stroke : String -> Attribute msg
stroke =
    attr "stroke"


strokeDasharray : String -> Attribute msg
strokeDasharray =
    attr "stroke-dasharray"


stop_color : String -> Attribute msg
stop_color =
    attr "stop-color"


stop_opacity : String -> Attribute msg
stop_opacity =
    attr "stop-opacity"


stroke_dasharray : String -> Attribute msg
stroke_dasharray =
    attr "stroke-dasharray"


strokeDashoffset : String -> Attribute msg
strokeDashoffset =
    attr "stroke-dashoffset"


strokeLinecap : String -> Attribute msg
strokeLinecap =
    attr "stroke-linecap"


strokeLinejoin : String -> Attribute msg
strokeLinejoin =
    attr "stroke-linejoin"


strokeMiterlimit : String -> Attribute msg
strokeMiterlimit =
    attr "stroke-miterlimit"


strokeOpacity : String -> Attribute msg
strokeOpacity =
    attr "stroke-opacity"


strokeWidth : String -> Attribute msg
strokeWidth =
    attr "stroke-width"


style : String -> Attribute msg
style =
    attr "style"


surfaceScale : String -> Attribute msg
surfaceScale =
    attr "surfaceScale"


systemLanguage : String -> Attribute msg
systemLanguage =
    attr "systemLanguage"


tableValues : String -> Attribute msg
tableValues =
    attr "tableValues"


target : String -> Attribute msg
target =
    attr "target"


targetX : String -> Attribute msg
targetX =
    attr "targetX"


targetY : String -> Attribute msg
targetY =
    attr "targetY"


textAnchor : String -> Attribute msg
textAnchor =
    attr "text-anchor"


textDecoration : String -> Attribute msg
textDecoration =
    attr "text-decoration"


textLength : String -> Attribute msg
textLength =
    attr "textLength"


textRendering : String -> Attribute msg
textRendering =
    attr "text-rendering"


title : String -> Attribute msg
title =
    attr "title"


to : String -> Attribute msg
to =
    attr "to"


transform : String -> Attribute msg
transform =
    attr "transform"


type_ : String -> Attribute msg
type_ =
    attr "type"


u1 : String -> Attribute msg
u1 =
    attr "u1"


u2 : String -> Attribute msg
u2 =
    attr "u2"


underlinePosition : String -> Attribute msg
underlinePosition =
    attr "underline-position"


underlineThickness : String -> Attribute msg
underlineThickness =
    attr "underline-thickness"


unicode : String -> Attribute msg
unicode =
    attr "unicode"


unicodeBidi : String -> Attribute msg
unicodeBidi =
    attr "unicode-bidi"


unicodeRange : String -> Attribute msg
unicodeRange =
    attr "unicode-range"


unitsPerEm : String -> Attribute msg
unitsPerEm =
    attr "units-per-em"


vAlphabetic : String -> Attribute msg
vAlphabetic =
    attr "v-alphabetic"


vHanging : String -> Attribute msg
vHanging =
    attr "v-hanging"


vIdeographic : String -> Attribute msg
vIdeographic =
    attr "v-ideographic"


vMathematical : String -> Attribute msg
vMathematical =
    attr "v-mathematical"


values : String -> Attribute msg
values =
    attr "values"


version : String -> Attribute msg
version =
    attr "version"


vertAdvY : String -> Attribute msg
vertAdvY =
    attr "vert-adv-y"


vertOriginX : String -> Attribute msg
vertOriginX =
    attr "vert-origin-x"


vertOriginY : String -> Attribute msg
vertOriginY =
    attr "vert-origin-y"


viewBox : String -> Attribute msg
viewBox =
    attr "viewBox"


viewTarget : String -> Attribute msg
viewTarget =
    attr "viewTarget"


visibility : String -> Attribute msg
visibility =
    attr "visibility"


width : String -> Attribute msg
width =
    attr "width"


widths : String -> Attribute msg
widths =
    attr "widths"


wordSpacing : String -> Attribute msg
wordSpacing =
    attr "word-spacing"


writingMode : String -> Attribute msg
writingMode =
    attr "writing-mode"


x : String -> Attribute msg
x =
    attr "x"


x1 : String -> Attribute msg
x1 =
    attr "x1"


x2 : String -> Attribute msg
x2 =
    attr "x2"


xChannelSelector : String -> Attribute msg
xChannelSelector =
    attr "xChannelSelector"


xHeight : String -> Attribute msg
xHeight =
    attr "x-height"


xlinkActuate : String -> Attribute msg
xlinkActuate =
    attr "xlink:actuate"


xlinkArcrole : String -> Attribute msg
xlinkArcrole =
    attr "xlink:arcrole"


xlinkHref : String -> Attribute msg
xlinkHref =
    attr "xlink:href"


xlinkRole : String -> Attribute msg
xlinkRole =
    attr "xlink:role"


xlinkShow : String -> Attribute msg
xlinkShow =
    attr "xlink:show"


xlinkTitle : String -> Attribute msg
xlinkTitle =
    attr "xlink:title"


xlinkType : String -> Attribute msg
xlinkType =
    attr "xlink:type"


xmlBase : String -> Attribute msg
xmlBase =
    attr "xml:base"


xmlLang : String -> Attribute msg
xmlLang =
    attr "xml:lang"


xmlSpace : String -> Attribute msg
xmlSpace =
    attr "xml:space"


y : String -> Attribute msg
y =
    attr "y"


y1 : String -> Attribute msg
y1 =
    attr "y1"


y2 : String -> Attribute msg
y2 =
    attr "y2"


yChannelSelector : String -> Attribute msg
yChannelSelector =
    attr "yChannelSelector"


z : String -> Attribute msg
z =
    attr "z"


zoomAndPan : String -> Attribute msg
zoomAndPan =
    attr "zoomAndPan"
