module ElmSsr.Request.Decode exposing
    ( Decoder, Error
    , required, optional, optionalWithDefault
    , string, int, float, bool
    , validate, custom
    , succeed, fail, map, map2, map3, map4, map5, map6, map7, map8, andThen
    , decodeForm, decodeQuery, decodeParams, decodeRaw
    , email, nonEmpty, minInt, maxInt, minFloat, maxFloat, minLength, maxLength
    , errorFor, hasError, errorsFor
    )

{-| Thin re-exports and request-specific runners over `ElmSsr.Form`.

Prefer `ElmSsr.Form` for new code (it is pure and usable from islands too).
This module is kept for backwards compatibility with existing server forms.
-}

import ElmSsr.Form as Form
import ElmSsr.Route as Route exposing (Request)


type alias Decoder a =
    Form.Decoder a


type alias Error =
    Form.Error


decodeForm : Decoder a -> Request -> Result (List Error) a
decodeForm d request =
    Form.decode d request.formData


decodeQuery : Decoder a -> Request -> Result (List Error) a
decodeQuery d request =
    Form.decode d request.query


decodeParams : Decoder a -> Request -> Result (List Error) a
decodeParams d request =
    Form.decode d request.params


decodeRaw : Decoder a -> List ( String, String ) -> Result (List Error) a
decodeRaw d pairs =
    Form.decode d pairs


required : String -> Form.FieldDecoder b -> Decoder (b -> a) -> Decoder a
required =
    Form.required


optional : String -> Form.FieldDecoder b -> Decoder (Maybe b -> a) -> Decoder a
optional =
    Form.optional


optionalWithDefault : String -> b -> Form.FieldDecoder b -> Decoder (b -> a) -> Decoder a
optionalWithDefault =
    Form.optionalWithDefault


string : Form.FieldDecoder String
string =
    Form.string


int : Form.FieldDecoder Int
int =
    Form.int


float : Form.FieldDecoder Float
float =
    Form.float


bool : Form.FieldDecoder Bool
bool =
    Form.bool


validate : (a -> Result String a) -> Form.FieldDecoder a -> Form.FieldDecoder a
validate =
    Form.validate


custom : (a -> Result String b) -> Form.FieldDecoder a -> Form.FieldDecoder b
custom =
    Form.custom


succeed : a -> Decoder a
succeed =
    Form.succeed


fail : String -> String -> Decoder a
fail =
    Form.fail


map : (a -> b) -> Decoder a -> Decoder b
map =
    Form.map


map2 : (a -> b -> c) -> Decoder a -> Decoder b -> Decoder c
map2 =
    Form.map2


map3 : (a -> b -> c -> d) -> Decoder a -> Decoder b -> Decoder c -> Decoder d
map3 =
    Form.map3


map4 : (a -> b -> c -> d -> e) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e
map4 =
    Form.map4


map5 : (a -> b -> c -> d -> e -> f) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f
map5 =
    Form.map5


map6 : (a -> b -> c -> d -> e -> f -> g) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g
map6 =
    Form.map6


map7 : (a -> b -> c -> d -> e -> f -> g -> h) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g -> Decoder h
map7 =
    Form.map7


map8 : (a -> b -> c -> d -> e -> f -> g -> h -> i) -> Decoder a -> Decoder b -> Decoder c -> Decoder d -> Decoder e -> Decoder f -> Decoder g -> Decoder h -> Decoder i
map8 =
    Form.map8


andThen : (a -> Decoder b) -> Decoder a -> Decoder b
andThen =
    Form.andThen


email : String -> Result String String
email =
    Form.email


nonEmpty : String -> Result String String
nonEmpty =
    Form.nonEmpty


minInt : Int -> Int -> Result String Int
minInt =
    Form.minInt


maxInt : Int -> Int -> Result String Int
maxInt =
    Form.maxInt


minFloat : Float -> Float -> Result String Float
minFloat =
    Form.minFloat


maxFloat : Float -> Float -> Result String Float
maxFloat =
    Form.maxFloat


minLength : Int -> String -> Result String String
minLength =
    Form.minLength


maxLength : Int -> String -> Result String String
maxLength =
    Form.maxLength


errorFor : String -> List Error -> Maybe String
errorFor =
    Form.errorFor


hasError : String -> List Error -> Bool
hasError =
    Form.hasError


errorsFor : String -> List Error -> List String
errorsFor =
    Form.errorsFor
