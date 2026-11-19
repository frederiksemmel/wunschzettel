//// The list as it travels in the URL fragment.
////
//// A code is the prefix letter `k` plus base64url of the compact text (below),
//// deflate-raw with a preset dictionary (see codec.ffi.mjs). A new format gets a new
//// letter, and the decoder keeps reading the old ones.
////
//// Compact text: records separated by U+001E, fields by U+001F, trailing empty fields
//// dropped. The first record is `name, title, occasion, year, message` with title ""
//// for "Wunschzettel", occasion "" | "g" | "s" and year "" when unset; every further
//// record is one wish: `title, description, url`. New fields may only be appended.

import gleam/int
import gleam/list
import gleam/result
import gleam/string
import gleam/uri
import wunschzettel/zettel.{type Zettel, Wish, Zettel}

const record_sep = "\u{1e}"

const field_sep = "\u{1f}"

// ENCODING --------------------------------------------------------------------

pub fn encode(z: Zettel) -> String {
  encode_compact(to_compact(z))
}

pub fn to_compact(z: Zettel) -> String {
  let title = case z.title == zettel.default_title {
    True -> ""
    False -> z.title
  }
  let occasion = case z.occasion {
    zettel.Weihnachten -> ""
    zettel.Geburtstag -> "g"
    zettel.Schlicht -> "s"
  }
  let year = case z.year {
    0 -> ""
    year -> int.to_string(year)
  }
  let head = fields([z.name, title, occasion, year, z.message])
  let wishes =
    z.wishes
    |> list.filter(fn(w) { !zettel.is_empty_wish(w) })
    |> list.map(fn(w) { fields([w.title, w.description, w.url]) })
  string.join([head, ..wishes], record_sep)
}

fn fields(values: List(String)) -> String {
  values
  |> list.map(fn(v) {
    v |> string.replace(record_sep, "") |> string.replace(field_sep, "")
  })
  |> list.reverse
  |> list.drop_while(fn(v) { v == "" })
  |> list.reverse
  |> string.join(field_sep)
}

// DECODING --------------------------------------------------------------------

pub fn decode(code: String) -> Result(Zettel, Nil) {
  decode_compact(code) |> result.map(from_compact)
}

pub fn from_compact(text: String) -> Zettel {
  let assert [head, ..wishes] = string.split(text, record_sep)
  let head = string.split(head, field_sep)
  let field = fn(values, i) {
    values |> list.drop(i) |> list.first |> result.unwrap("")
  }
  Zettel(
    name: field(head, 0),
    title: case field(head, 1) {
      "" -> zettel.default_title
      title -> title
    },
    occasion: case field(head, 2) {
      "g" -> zettel.Geburtstag
      "s" -> zettel.Schlicht
      _ -> zettel.Weihnachten
    },
    year: field(head, 3) |> int.parse |> result.unwrap(0) |> zettel.valid_year,
    message: field(head, 4),
    wishes: list.map(wishes, fn(record) {
      let f = string.split(record, field_sep)
      Wish(title: field(f, 0), description: field(f, 1), url: field(f, 2))
    }),
  )
}

// FRAGMENT --------------------------------------------------------------------

/// `#<label>&d=<code>`
pub fn view_hash(z: Zettel, code: String) -> String {
  "#" <> label_prefix(z) <> "d=" <> code
}

/// `#<label>&bearbeiten&d=<code>`
pub fn edit_hash(z: Zettel, code: String) -> String {
  "#" <> label_prefix(z) <> "bearbeiten&d=" <> code
}

fn label_prefix(z: Zettel) -> String {
  case zettel.label(z) {
    "" -> ""
    label -> label <> "&"
  }
}

/// The fragment read like URLSearchParams: `&`-separated, `key` or `key=value`.
pub fn parse_fragment(fragment: String) -> List(#(String, String)) {
  fragment
  |> string.split("&")
  |> list.filter(fn(part) { part != "" })
  |> list.map(fn(part) {
    let #(key, value) =
      string.split_once(part, "=") |> result.unwrap(#(part, ""))
    #(form_decode(key), form_decode(value))
  })
}

fn form_decode(text: String) -> String {
  let text = string.replace(text, "+", " ")
  uri.percent_decode(text) |> result.unwrap(text)
}

// FFI -------------------------------------------------------------------------

@external(javascript, "./codec.ffi.mjs", "encode_compact")
fn encode_compact(text: String) -> String

@external(javascript, "./codec.ffi.mjs", "decode_compact")
fn decode_compact(code: String) -> Result(String, Nil)
