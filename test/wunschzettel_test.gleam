import gleam/int
import gleam/string
import gleeunit
import wunschzettel/link
import wunschzettel/zettel.{Geburtstag, Schlicht, Weihnachten, Wish, Zettel}

pub fn main() -> Nil {
  gleeunit.main()
}

fn frederik() {
  Zettel(
    name: "Frederik",
    title: "Wunschzettel",
    occasion: Weihnachten,
    year: 2026,
    message: "Ich freue mich über alles – am meisten über Zeit mit euch.",
    wishes: [
      Wish("Wanderschuhe", "Größe 44, gern in Dunkelgrün", ""),
      Wish("", "", "https://www.thalia.de/shop/home/artikeldetails/A1061023395"),
      Wish(
        "Buch",
        "Siehe [hier](https://example.org/a_(b)) oder https://de.wikipedia.org/wiki/Gleam.",
        "",
      ),
    ],
  )
}

fn lena() {
  Zettel(
    name: "Lena Müller-Ößé",
    title: "Meine Wünsche 🎂",
    occasion: Geburtstag,
    year: 2027,
    message: "Zeile 1\nZeile 2 \"zitiert\" & <b>kein HTML</b>",
    wishes: [
      Wish("Kopfhörer", "", "mediamarkt.de/x"),
      Wish("Tee", "grün\noder schwarz", ""),
    ],
  )
}

pub fn broken_links_fail_test() {
  assert link.decode("") == Error(Nil)
  assert link.decode("k") == Error(Nil)
  assert link.decode("k!!!") == Error(Nil)
  assert link.decode(string.drop_end(link.encode(frederik()), 10)) == Error(Nil)
}

pub fn compact_round_trip_test() {
  let z = frederik()
  let code = link.encode(z)
  assert string.starts_with(code, "k")
  assert link.decode(code) == Ok(z)
  assert link.decode(link.encode(lena())) == Ok(lena())
  assert link.decode(link.encode(zettel.blank())) == Ok(zettel.blank())
}

pub fn compact_drops_empty_wishes_and_separators_test() {
  let z =
    Zettel(..zettel.blank(), name: "A\u{1e}B\u{1f}C", wishes: [
      Wish("", "", ""),
      Wish("x", "", ""),
    ])
  assert link.decode(link.encode(z))
    == Ok(Zettel(..zettel.blank(), name: "ABC", wishes: [Wish("x", "", "")]))
}

pub fn truncated_compact_links_never_decode_to_something_else_test() {
  let code = link.encode(frederik())
  let full = link.decode(code)
  int.range(from: 1, to: string.length(code), with: Nil, run: fn(_, n) {
    let result = link.decode(string.slice(code, 0, n))
    assert result == Error(Nil) || result == full
  })
}

pub fn label_test() {
  assert zettel.label(frederik()) == "frederik-weihnachten-2026"
  assert zettel.label(lena()) == "lena-mueller-oesse-geburtstag-2027"
  assert zettel.label(Zettel(..zettel.blank(), name: "neu", occasion: Schlicht))
    == "von-neu"
  assert zettel.label(Zettel(..zettel.blank(), occasion: Schlicht)) == ""
  assert zettel.label(Zettel(..zettel.blank(), name: "  José  Ñandú "))
    == "jose-nandu-weihnachten"
}

pub fn hashes_test() {
  assert link.view_hash(frederik(), "kX") == "#frederik-weihnachten-2026&d=kX"
  assert link.edit_hash(frederik(), "kX")
    == "#frederik-weihnachten-2026&bearbeiten&d=kX"
  assert link.view_hash(Zettel(..zettel.blank(), occasion: Schlicht), "kX")
    == "#d=kX"
}

pub fn parse_fragment_test() {
  assert link.parse_fragment("frederik-weihnachten-2026&bearbeiten&d=kAB-_")
    == [
      #("frederik-weihnachten-2026", ""),
      #("bearbeiten", ""),
      #("d", "kAB-_"),
    ]
  assert link.parse_fragment("") == []
  assert link.parse_fragment("neu") == [#("neu", "")]
}

pub fn titles_test() {
  assert zettel.page_title(frederik())
    == "Wunschzettel von Frederik, Weihnachten 2026"
  assert zettel.occasion_line(
      Zettel(..zettel.blank(), occasion: Schlicht, year: 2026),
    )
    == "2026"
  assert zettel.page_title(zettel.blank()) == "Wunschzettel, Weihnachten"
}
