module ElmSsr.Html.Attributes exposing
    ( attr
    , class, href, id, name, placeholder, rel, type_, value
    )

{-| Plain HTML attributes. Mirrors `elm/html`'s `Html.Attributes`.

@docs attr
@docs class, href, id, name, placeholder, rel, type_, value

-}

import ElmSsr.Html exposing (Attribute(..))


{-| Set an arbitrary attribute. -}
attr : String -> String -> Attribute msg
attr attributeName attributeValue =
    Property attributeName attributeValue


class : String -> Attribute msg
class =
    attr "class"


href : String -> Attribute msg
href =
    attr "href"


id : String -> Attribute msg
id =
    attr "id"


name : String -> Attribute msg
name =
    attr "name"


placeholder : String -> Attribute msg
placeholder =
    attr "placeholder"


rel : String -> Attribute msg
rel =
    attr "rel"


type_ : String -> Attribute msg
type_ =
    attr "type"


value : String -> Attribute msg
value =
    attr "value"
