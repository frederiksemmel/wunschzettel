//// A wish list, and the readable bits derived from it: the label at the front of the
//// link, the occasion line under the name and the page title.

import gleam/int
import gleam/list
import gleam/regexp
import gleam/string

pub const default_title = "Wunschzettel"

pub type Occasion {
  Weihnachten
  Geburtstag
  Schlicht
}

pub type Wish {
  Wish(title: String, description: String, url: String)
}

pub type Zettel {
  Zettel(
    name: String,
    title: String,
    occasion: Occasion,
    /// 0 when unset
    year: Int,
    message: String,
    wishes: List(Wish),
  )
}

pub fn blank() -> Zettel {
  Zettel(
    name: "",
    title: default_title,
    occasion: Weihnachten,
    year: 0,
    message: "",
    wishes: [],
  )
}

/// The value used in the link format and in `html[data-anlass]`.
pub fn occasion_id(occasion: Occasion) -> String {
  case occasion {
    Weihnachten -> "weihnachten"
    Geburtstag -> "geburtstag"
    Schlicht -> "schlicht"
  }
}

/// Unknown values fall back to Weihnachten, like the original page.
pub fn occasion_from_id(id: String) -> Occasion {
  case id {
    "geburtstag" -> Geburtstag
    "schlicht" -> Schlicht
    _ -> Weihnachten
  }
}

/// How the occasion reads on the sheet; "Ohne Anlass" says nothing.
fn occasion_name(occasion: Occasion) -> String {
  case occasion {
    Weihnachten -> "Weihnachten"
    Geburtstag -> "Geburtstag"
    Schlicht -> ""
  }
}

/// Years outside 1900–2999 count as unset.
pub fn valid_year(year: Int) -> Int {
  case year >= 1900 && year <= 2999 {
    True -> year
    False -> 0
  }
}

fn year_text(year: Int) -> String {
  case year {
    0 -> ""
    _ -> int.to_string(year)
  }
}

pub fn is_empty_wish(wish: Wish) -> Bool {
  wish.title == "" && wish.description == "" && wish.url == ""
}

/// "Weihnachten 2026", "Geburtstag", "2026" or "".
pub fn occasion_line(z: Zettel) -> String {
  [occasion_name(z.occasion), year_text(z.year)]
  |> list.filter(fn(part) { part != "" })
  |> string.join(" ")
}

/// "Wunschzettel von Frederik, Weihnachten 2026"
pub fn page_title(z: Zettel) -> String {
  let title = case z.title {
    "" -> default_title
    title -> title
  }
  let von = case z.name {
    "" -> ""
    name -> " von " <> name
  }
  let occasion = case occasion_line(z) {
    "" -> ""
    line -> ", " <> line
  }
  title <> von <> occasion
}

/// Readable label at the front of the link, e.g. "frederik-weihnachten-2026".
/// Decoding ignores it. Never one of the words the fragment uses itself.
pub fn label(z: Zettel) -> String {
  let label =
    [z.name, occasion_name(z.occasion), year_text(z.year)]
    |> list.map(slug_part)
    |> list.filter(fn(part) { part != "" })
    |> string.join("-")
  case label {
    "d" | "neu" | "bearbeiten" -> "von-" <> label
    _ -> label
  }
}

fn slug_part(text: String) -> String {
  let assert Ok(marks) = regexp.from_string("[\\u0300-\\u036f]")
  let assert Ok(other) = regexp.from_string("[^a-z0-9]+")
  let assert Ok(edges) = regexp.from_string("^-+|-+$")
  text
  |> string.lowercase
  |> string.replace("ä", "ae")
  |> string.replace("ö", "oe")
  |> string.replace("ü", "ue")
  |> string.replace("ß", "ss")
  |> nfkd
  |> regexp.replace(marks, _, "")
  |> regexp.replace(other, _, "-")
  |> regexp.replace(edges, _, "")
}

@external(javascript, "./text.ffi.mjs", "nfkd")
fn nfkd(text: String) -> String
