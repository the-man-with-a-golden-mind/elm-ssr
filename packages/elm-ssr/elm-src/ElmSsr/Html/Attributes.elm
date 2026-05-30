module ElmSsr.Html.Attributes exposing
    ( attr
    , class, classList, id, title, style
    , href, target, rel
    , src, height, width, alt
    , type_, value, defaultValue, placeholder, selected, checked, autofocus, disabled, name, readonly, required, multiple
    , method, action, enctype, novalidate, target_
    , for, form
    , max, min, step, cols, rows, wrap
    , spellcheck, download, hreflang, media, ping, shape, coords, usemap, ismap, hreflang_, type__
    , alt_, src_, srcset, usemap_, longdesc
    )

{-| Plain HTML attributes. Mirrors `elm/html`'s `Html.Attributes`.

@docs attr
@docs class, classList, id, title, style
@docs href, target, rel
@docs src, height, width, alt
@docs type_, value, defaultValue, placeholder, selected, checked, autofocus, disabled, name, readonly, required, multiple
@docs method, action, enctype, novalidate, target_
@docs for, form
@docs max, min, step, cols, rows, wrap
@docs spellcheck, download, hreflang, media, ping, shape, coords, usemap, ismap, hreflang_, type__
@docs alt_, src_, srcset, usemap_, longdesc

-}

import ElmSsr.Html exposing (Attribute(..))


{-| Set an arbitrary attribute. -}
attr : String -> String -> Attribute msg
attr attributeName attributeValue =
    Property attributeName attributeValue


class : String -> Attribute msg
class =
    attr "class"


classList : List ( String, Bool ) -> Attribute msg
classList list =
    list
        |> List.filter Tuple.second
        |> List.map Tuple.first
        |> String.join " "
        |> class


id : String -> Attribute msg
id =
    attr "id"


title : String -> Attribute msg
title =
    attr "title"


style : String -> String -> Attribute msg
style key val =
    attr "style" (key ++ ":" ++ val)


href : String -> Attribute msg
href =
    attr "href"


target : String -> Attribute msg
target =
    attr "target"


rel : String -> Attribute msg
rel =
    attr "rel"


src : String -> Attribute msg
src =
    attr "src"


height : Int -> Attribute msg
height amount =
    attr "height" (String.fromInt amount)


width : Int -> Attribute msg
width amount =
    attr "width" (String.fromInt amount)


alt : String -> Attribute msg
alt =
    attr "alt"


type_ : String -> Attribute msg
type_ =
    attr "type"


value : String -> Attribute msg
value =
    attr "value"


defaultValue : String -> Attribute msg
defaultValue =
    attr "defaultValue"


placeholder : String -> Attribute msg
placeholder =
    attr "placeholder"


selected : Bool -> Attribute msg
selected isSelected =
    if isSelected then
        attr "selected" "selected"

    else
        attr "selected" ""


checked : Bool -> Attribute msg
checked isChecked =
    if isChecked then
        attr "checked" "checked"

    else
        attr "checked" ""


autofocus : Bool -> Attribute msg
autofocus isAutofocus =
    if isAutofocus then
        attr "autofocus" "autofocus"

    else
        attr "autofocus" ""


disabled : Bool -> Attribute msg
disabled isDisabled =
    if isDisabled then
        attr "disabled" "disabled"

    else
        attr "disabled" ""


name : String -> Attribute msg
name =
    attr "name"


readonly : Bool -> Attribute msg
readonly isReadonly =
    if isReadonly then
        attr "readonly" "readonly"

    else
        attr "readonly" ""


required : Bool -> Attribute msg
required isRequired =
    if isRequired then
        attr "required" "required"

    else
        attr "required" ""


multiple : Bool -> Attribute msg
multiple isMultiple =
    if isMultiple then
        attr "multiple" "multiple"

    else
        attr "multiple" ""


method : String -> Attribute msg
method =
    attr "method"


action : String -> Attribute msg
action =
    attr "action"


enctype : String -> Attribute msg
enctype =
    attr "enctype"


novalidate : Bool -> Attribute msg
novalidate isNovalidate =
    if isNovalidate then
        attr "novalidate" "novalidate"

    else
        attr "novalidate" ""


target_ : String -> Attribute msg
target_ =
    attr "target"


for : String -> Attribute msg
for =
    attr "for"


form : String -> Attribute msg
form =
    attr "form"


max : String -> Attribute msg
max =
    attr "max"


min : String -> Attribute msg
min =
    attr "min"


step : String -> Attribute msg
step =
    attr "step"


cols : Int -> Attribute msg
cols amount =
    attr "cols" (String.fromInt amount)


rows : Int -> Attribute msg
rows amount =
    attr "rows" (String.fromInt amount)


wrap : String -> Attribute msg
wrap =
    attr "wrap"


spellcheck : Bool -> Attribute msg
spellcheck isSpellcheck =
    if isSpellcheck then
        attr "spellcheck" "true"

    else
        attr "spellcheck" "false"


download : String -> Attribute msg
download =
    attr "download"


hreflang : String -> Attribute msg
hreflang =
    attr "hreflang"


media : String -> Attribute msg
media =
    attr "media"


ping : String -> Attribute msg
ping =
    attr "ping"


shape : String -> Attribute msg
shape =
    attr "shape"


coords : String -> Attribute msg
coords =
    attr "coords"


usemap : String -> Attribute msg
usemap =
    attr "usemap"


ismap : Bool -> Attribute msg
ismap isIsmap =
    if isIsmap then
        attr "ismap" "ismap"

    else
        attr "ismap" ""


hreflang_ : String -> Attribute msg
hreflang_ =
    attr "hreflang"


type__ : String -> Attribute msg
type__ =
    attr "type"


alt_ : String -> Attribute msg
alt_ =
    attr "alt"


src_ : String -> Attribute msg
src_ =
    attr "src"


srcset : String -> Attribute msg
srcset =
    attr "srcset"


usemap_ : String -> Attribute msg
usemap_ =
    attr "usemap"


longdesc : String -> Attribute msg
longdesc =
    attr "longdesc"
