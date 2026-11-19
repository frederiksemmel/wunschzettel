//// Wunschzettel: a wish list that lives entirely in its link.
////
//// Two pages on one URL fragment: the list (`#<label>&d=<code>`) and the editor
//// (`#<label>&bearbeiten&d=<code>`, `#neu` or no fragment). See wunschzettel/link.

import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option
import gleam/result
import gleam/string
import gleam/uri.{type Uri}
import lustre
import lustre/attribute.{attribute, class, id} as a
import lustre/effect.{type Effect}
import lustre/element.{type Element, text}
import lustre/element/html as h
import lustre/element/keyed
import lustre/element/svg
import lustre/event
import modem
import wunschzettel/link
import wunschzettel/zettel.{type Wish, type Zettel, Wish, Zettel}

pub fn main() -> Nil {
  start_scenery()
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
  Nil
}

// MODEL -----------------------------------------------------------------------

type Model {
  Viewing(zettel: Zettel, code: String)
  Editing(form: Form, status: String)
}

/// The editor's fields as typed; `to_zettel` trims and interprets them.
type Form {
  Form(
    name: String,
    /// "" stands for "Wunschzettel"
    title: String,
    occasion: zettel.Occasion,
    year: String,
    message: String,
    rows: List(Row),
    next_id: Int,
  )
}

type Row {
  Row(id: Int, title: String, description: String, url: String)
}

fn init(_: Nil) -> #(Model, Effect(Msg)) {
  let fragment =
    modem.initial_uri()
    |> result.map(fn(uri) { option.unwrap(uri.fragment, "") })
    |> result.unwrap("")
  let #(model, effects) = route(fragment)
  #(model, effect.batch([modem.init(UrlChanged), effects]))
}

/// What the fragment asks for. Without a readable list it is the editor.
fn route(fragment: String) -> #(Model, Effect(Msg)) {
  let params = link.parse_fragment(fragment)
  let has = fn(key) { list.any(params, fn(p) { p.0 == key }) }
  let code = list.key_find(params, "d") |> result.unwrap("")
  let decoded = case code {
    "" -> Error(Nil)
    code -> link.decode(code)
  }
  let editing = has("bearbeiten") || has("neu")
  case decoded {
    Ok(z) if !editing -> #(
      Viewing(z, code),
      effect.batch([
        show(z),
        effect.from(fn(_) { replace_hash(link.view_hash(z, code)) }),
        effect.from(fn(_) { scroll_to_top() }),
      ]),
    )
    _ -> {
      let start = case has("neu") {
        True -> zettel.blank()
        False -> result.unwrap(decoded, zettel.blank())
      }
      let status = case code != "" && decoded == Error(Nil) {
        True -> "Dieser Link ist unvollständig. Hier kannst du neu beginnen."
        False -> ""
      }
      let form = to_form(start)
      #(
        Editing(form, status),
        effect.batch([
          sync(form),
          effect.from(fn(_) { scroll_to_top() }),
        ]),
      )
    }
  }
}

fn to_form(z: Zettel) -> Form {
  let rows = case z.wishes {
    [] -> [Wish("", "", "")]
    wishes -> wishes
  }
  Form(
    name: z.name,
    title: case z.title == zettel.default_title {
      True -> ""
      False -> z.title
    },
    occasion: z.occasion,
    year: int.to_string(case z.year {
      0 -> current_year()
      year -> year
    }),
    message: z.message,
    rows: list.index_map(rows, fn(w, i) {
      Row(id: i, title: w.title, description: w.description, url: w.url)
    }),
    next_id: list.length(rows),
  )
}

fn to_zettel(form: Form) -> Zettel {
  Zettel(
    name: string.trim(form.name),
    title: case string.trim(form.title) {
      "" -> zettel.default_title
      title -> title
    },
    occasion: form.occasion,
    year: form.year
      |> string.trim
      |> int.parse
      |> result.unwrap(0)
      |> zettel.valid_year,
    message: string.trim(form.message),
    wishes: list.map(form.rows, fn(r) {
      Wish(
        title: string.trim(r.title),
        description: string.trim(r.description),
        url: string.trim(r.url),
      )
    }),
  )
}

// UPDATE ----------------------------------------------------------------------

type Msg {
  UrlChanged(Uri)
  NameChanged(String)
  TitleChanged(String)
  OccasionPicked(String)
  YearChanged(String)
  MessageChanged(String)
  WishTitleChanged(id: Int, value: String)
  WishDescriptionChanged(id: Int, value: String)
  WishUrlChanged(id: Int, value: String)
  WishUrlCommitted(id: Int, value: String)
  AddWish
  RemoveWish(id: Int)
  MoveWish(id: Int, by: Int)
  CopyClicked
  Copied(Bool)
  Ignore
}

fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case model, msg {
    _, UrlChanged(uri) -> route(option.unwrap(uri.fragment, ""))
    Viewing(..), _ -> #(model, effect.none())
    Editing(form, status), _ -> edit(form, status, msg)
  }
}

fn edit(form: Form, status: String, msg: Msg) -> #(Model, Effect(Msg)) {
  let changed = fn(form) { #(Editing(form, ""), sync(form)) }
  let rows = fn(f: fn(Row) -> Row, id: Int) {
    list.map(form.rows, fn(r) {
      case r.id == id {
        True -> f(r)
        False -> r
      }
    })
  }
  case msg {
    NameChanged(v) -> changed(Form(..form, name: v))
    TitleChanged(v) -> changed(Form(..form, title: v))
    OccasionPicked(v) ->
      changed(Form(..form, occasion: zettel.occasion_from_id(v)))
    YearChanged(v) -> changed(Form(..form, year: v))
    MessageChanged(v) -> changed(Form(..form, message: v))
    WishTitleChanged(id, v) ->
      changed(Form(..form, rows: rows(fn(r) { Row(..r, title: v) }, id)))
    WishDescriptionChanged(id, v) ->
      changed(Form(..form, rows: rows(fn(r) { Row(..r, description: v) }, id)))
    WishUrlChanged(id, v) ->
      changed(Form(..form, rows: rows(fn(r) { Row(..r, url: v) }, id)))
    WishUrlCommitted(id, v) ->
      case clean_url(v) {
        cleaned if cleaned == v -> #(Editing(form, status), effect.none())
        cleaned ->
          changed(
            Form(..form, rows: rows(fn(r) { Row(..r, url: cleaned) }, id)),
          )
      }

    AddWish -> {
      let row = Row(id: form.next_id, title: "", description: "", url: "")
      let form =
        Form(
          ..form,
          rows: list.append(form.rows, [row]),
          next_id: form.next_id + 1,
        )
      let #(model, effects) = changed(form)
      #(model, effect.batch([effects, focus_after_paint(field_id(row.id, 0))]))
    }

    RemoveWish(id) -> {
      // Focus moves to the next wish, or the previous one when it was the last
      let #(before, rest) = list.split_while(form.rows, fn(r) { r.id != id })
      let after = list.drop(rest, 1)
      let neighbour = case after, list.last(before) {
        [next, ..], _ -> Ok(next)
        [], Ok(previous) -> Ok(previous)
        [], Error(_) -> Error(Nil)
      }
      let #(rows, next_id, focus) = case list.append(before, after), neighbour {
        [], _ -> {
          let row = Row(id: form.next_id, title: "", description: "", url: "")
          #([row], form.next_id + 1, row.id)
        }
        rows, Ok(n) -> #(rows, form.next_id, n.id)
        [first, ..] as rows, Error(_) -> #(rows, form.next_id, first.id)
      }
      let #(model, effects) = changed(Form(..form, rows:, next_id:))
      #(model, effect.batch([effects, focus_after_paint(field_id(focus, 0))]))
    }

    MoveWish(id, by) -> {
      let rows = move(form.rows, id, by)
      let last = list.length(rows) - 1
      let index =
        list.index_map(rows, fn(r, i) { #(r.id, i) })
        |> list.key_find(id)
        |> result.unwrap(0)
      // Keep focus on the button that was pressed while it can still be pressed
      let button = case by < 0 {
        True -> #("up", index > 0)
        False -> #("down", index < last)
      }
      let #(model, effects) = changed(Form(..form, rows:))
      let focus = case button {
        #(name, True) -> focus_after_paint(tool_id(id, name))
        #(_, False) -> effect.none()
      }
      #(model, effect.batch([effects, focus]))
    }

    CopyClicked -> {
      let z = to_zettel(form)
      let share = link.view_hash(z, link.encode(z))
      #(
        Editing(form, ""),
        effect.from(fn(dispatch) {
          copy(base_url() <> share, fn(ok) { dispatch(Copied(ok)) })
        }),
      )
    }
    Copied(True) -> #(Editing(form, "Link kopiert"), effect.none())
    Copied(False) -> #(Editing(form, status), effect.none())

    UrlChanged(_) | Ignore -> #(Editing(form, status), effect.none())
  }
}

fn move(rows: List(Row), id: Int, by: Int) -> List(Row) {
  let indexed = list.index_map(rows, fn(r, i) { #(i, r) })
  case list.find(indexed, fn(p) { { p.1 }.id == id }) {
    Error(_) -> rows
    Ok(#(from, row)) -> {
      let to = int.clamp(from + by, 0, list.length(rows) - 1)
      let without = list.filter(rows, fn(r) { r.id != id })
      list.flatten([list.take(without, to), [row], list.drop(without, to)])
    }
  }
}

// EFFECTS ---------------------------------------------------------------------

/// Colour and title for a list being shown.
fn show(z: Zettel) -> Effect(Msg) {
  effect.from(fn(_) {
    set_anlass(zettel.occasion_id(z.occasion))
    set_title(zettel.page_title(z))
  })
}

/// After every edit: colour, title, and the editor's own link in the address bar.
fn sync(form: Form) -> Effect(Msg) {
  let z = to_zettel(form)
  effect.batch([
    show(z),
    effect.from(fn(_) { replace_hash(link.edit_hash(z, link.encode(z))) }),
  ])
}

fn focus_after_paint(element_id: String) -> Effect(Msg) {
  effect.after_paint(fn(_, _) { focus(element_id) })
}

// VIEW ------------------------------------------------------------------------

fn view(model: Model) -> Element(Msg) {
  case model {
    Viewing(z, code) ->
      h.main([id("view"), class("page view")], [
        h.article([class("sheet"), id("view-sheet")], sheet(z)),
        h.nav([class("below")], [
          h.a([a.href(link.edit_hash(z, code)), id("edit-this")], [
            text("Diesen Wunschzettel bearbeiten"),
          ]),
          h.a([a.href("#neu")], [text("Eigenen Wunschzettel schreiben")]),
        ]),
      ])
    Editing(form, status) -> editor(form, status)
  }
}

/// The paper card, shared by the list and the editor's preview.
fn sheet(z: Zettel) -> List(Element(Msg)) {
  let wishes = list.filter(z.wishes, fn(w) { !zettel.is_empty_wish(w) })
  [
    h.header([], [
      h.h1([class("sheet-title")], [text(z.title)]),
      h.p([class("sheet-name")], case z.name {
        "" -> []
        name -> [text("von " <> name)]
      }),
      h.p([class("sheet-occasion")], case zettel.occasion_line(z) {
        "" -> []
        line -> [text(line)]
      }),
    ]),
    ornament(),
    case z.message {
      "" -> element.none()
      message -> h.p([class("sheet-message")], [text(message)])
    },
    case wishes {
      [] -> h.p([class("sheet-empty")], [text("Noch keine Wünsche.")])
      wishes -> h.ul([class("wishes")], list.map(wishes, wish_item))
    },
    ornament(),
  ]
}

fn wish_item(w: Wish) -> Element(Msg) {
  let url = safe_url(w.url)
  let title = case w.title, url {
    "", Ok(#(_, host)) -> host
    title, _ -> title
  }
  h.li([class("wish")], [
    h.h2([class("wish-title")], [text(title)]),
    case w.description {
      "" -> element.none()
      d -> h.p([class("wish-desc")], rich_text(d))
    },
    case url {
      Ok(#(href, host)) ->
        h.p([class("wish-link")], [outbound(href, "ansehen bei " <> host)])
      Error(_) -> element.none()
    },
  ])
}

/// Plain text with [text](url) and bare http(s) links; never HTML.
fn rich_text(text_: String) -> List(Element(Msg)) {
  rich_segments(text_)
  |> list.map(fn(segment) {
    case segment {
      #("link", href, label) -> outbound(href, label)
      #(_, plain, _) -> text(plain)
    }
  })
}

fn outbound(href: String, label: String) -> Element(Msg) {
  h.a([a.href(href), a.target("_blank"), a.rel("noopener noreferrer")], [
    text(label),
  ])
}

fn ornament() -> Element(Msg) {
  let stroke = [
    attribute("stroke", "currentColor"),
    attribute("stroke-width", "1"),
  ]
  let fill = attribute("fill", "currentColor")
  svg.svg(
    [
      class("ornament"),
      attribute("viewBox", "0 0 220 14"),
      attribute("aria-hidden", "true"),
    ],
    [
      svg.line([
        attribute("x1", "0"),
        attribute("y1", "7"),
        attribute("x2", "92"),
        attribute("y2", "7"),
        ..stroke
      ]),
      svg.line([
        attribute("x1", "128"),
        attribute("y1", "7"),
        attribute("x2", "220"),
        attribute("y2", "7"),
        ..stroke
      ]),
      svg.path([
        attribute(
          "d",
          "M110 0l1.6 5.4L117 7l-5.4 1.6L110 14l-1.6-5.4L103 7l5.4-1.6z",
        ),
        fill,
      ]),
      svg.circle([
        attribute("cx", "97"),
        attribute("cy", "7"),
        attribute("r", "1.4"),
        fill,
      ]),
      svg.circle([
        attribute("cx", "123"),
        attribute("cy", "7"),
        attribute("r", "1.4"),
        fill,
      ]),
    ],
  )
}

fn editor(form: Form, status: String) -> Element(Msg) {
  let z = to_zettel(form)
  let share = link.view_hash(z, link.encode(z))
  h.div([id("edit"), class("editor-layout")], [
    h.form(
      [
        class("editor"),
        id("form"),
        a.autocomplete("off"),
        event.on("submit", decode.success(Ignore)) |> event.prevent_default,
      ],
      [
        h.h1([], [text("Wunschzettel schreiben")]),
        h.p([class("intro")], [
          text(
            "Alles, was du hier einträgst, steckt im Link. Nichts wird gespeichert: Wer den Link hat, sieht den Zettel. Um später etwas zu ändern, öffne deinen Link und wähle „Bearbeiten“.",
          ),
        ]),
        h.fieldset([class("group")], [
          h.legend([], [text("Zettel")]),
          field("f-name", [text("Von")], [
            h.input([
              id("f-name"),
              a.name("n"),
              a.placeholder("Dein Name"),
              a.maxlength(80),
              a.value(form.name),
              event.on_input(NameChanged),
            ]),
          ]),
          field("f-title", [text("Überschrift")], [
            h.input([
              id("f-title"),
              a.name("t"),
              a.placeholder("Wunschzettel"),
              a.maxlength(60),
              a.value(form.title),
              event.on_input(TitleChanged),
            ]),
          ]),
          h.div([class("field")], [
            h.label([id("anlass-label")], [text("Anlass")]),
            h.div(
              [
                class("anlass"),
                a.role("radiogroup"),
                a.aria_labelledby("anlass-label"),
              ],
              [
                occasion_choice(form, zettel.Weihnachten, "Weihnachten"),
                occasion_choice(form, zettel.Geburtstag, "Geburtstag"),
                occasion_choice(form, zettel.Schlicht, "Ohne Anlass"),
              ],
            ),
          ]),
          field("f-year", [text("Jahr")], [
            h.input([
              id("f-year"),
              a.name("y"),
              a.type_("number"),
              a.inputmode("numeric"),
              a.min("1900"),
              a.max("2999"),
              a.step("1"),
              a.value(form.year),
              event.on_input(YearChanged),
            ]),
          ]),
          field("f-msg", optional("Ein paar Worte vorweg"), [
            h.textarea(
              [
                id("f-msg"),
                a.name("m"),
                a.rows(2),
                a.placeholder(
                  "Ich freue mich über alles – am meisten über Zeit mit euch.",
                ),
                a.value(form.message),
                event.on_input(MessageChanged),
              ],
              form.message,
            ),
          ]),
        ]),
        h.fieldset([class("group")], [
          h.legend([], [text("Wünsche")]),
          keyed.div(
            [id("wish-list")],
            list.index_map(form.rows, fn(row, i) {
              #(int.to_string(row.id), wish_row(row, i, list.length(form.rows)))
            }),
          ),
          h.button(
            [
              a.type_("button"),
              class("add"),
              id("add-wish"),
              event.on_click(AddWish),
            ],
            [text("Wunsch hinzufügen")],
          ),
        ]),
        h.div([class("actions")], [
          h.button(
            [
              a.type_("button"),
              class("btn"),
              id("copy"),
              event.on_click(CopyClicked),
            ],
            [text("Link kopieren")],
          ),
          h.a([class("btn secondary"), id("open-view"), a.href(share)], [
            text("Ansehen"),
          ]),
          h.span(
            [
              class("status"),
              id("status"),
              a.role("status"),
              a.aria_live("polite"),
            ],
            [text(status)],
          ),
        ]),
      ],
    ),
    h.section([class("preview"), a.aria_label("Vorschau")], [
      h.p([class("preview-label")], [text("So sehen es die anderen")]),
      h.article([class("sheet"), id("preview-sheet")], sheet(z)),
    ]),
  ])
}

fn field(
  for: String,
  label: List(Element(Msg)),
  control: List(Element(Msg)),
) -> Element(Msg) {
  h.div([class("field")], [h.label([a.for(for)], label), ..control])
}

fn optional(label: String) -> List(Element(Msg)) {
  [text(label <> " "), h.span([class("opt")], [text("(optional)")])]
}

fn occasion_choice(
  form: Form,
  occasion: zettel.Occasion,
  label: String,
) -> Element(Msg) {
  h.label([], [
    h.input([
      a.type_("radio"),
      a.name("o"),
      a.value(zettel.occasion_id(occasion)),
      a.checked(form.occasion == occasion),
      event.on_input(OccasionPicked),
    ]),
    h.span([], [text(label)]),
  ])
}

fn wish_row(row: Row, index: Int, count: Int) -> Element(Msg) {
  h.div([class("wish-edit")], [
    h.div([class("wish-edit-head")], [
      h.span([class("wish-no")], [text("Wunsch " <> int.to_string(index + 1))]),
      h.div([class("tools")], [
        h.button(
          [
            a.type_("button"),
            class("tool up"),
            id(tool_id(row.id, "up")),
            a.aria_label("Nach oben"),
            a.disabled(index == 0),
            event.on_click(MoveWish(row.id, -1)),
          ],
          [text("hoch")],
        ),
        h.button(
          [
            a.type_("button"),
            class("tool down"),
            id(tool_id(row.id, "down")),
            a.aria_label("Nach unten"),
            a.disabled(index == count - 1),
            event.on_click(MoveWish(row.id, 1)),
          ],
          [text("runter")],
        ),
        h.button(
          [
            a.type_("button"),
            class("tool remove"),
            event.on_click(RemoveWish(row.id)),
          ],
          [text("entfernen")],
        ),
      ]),
    ]),
    field(field_id(row.id, 0), [text("Was")], [
      h.input([
        class("w-t"),
        id(field_id(row.id, 0)),
        a.placeholder("z. B. Wanderschuhe"),
        a.maxlength(140),
        a.value(row.title),
        event.on_input(WishTitleChanged(row.id, _)),
      ]),
    ]),
    field(field_id(row.id, 1), optional("Beschreibung"), [
      h.textarea(
        [
          class("w-d"),
          id(field_id(row.id, 1)),
          a.rows(2),
          a.placeholder("Größe 44, gern in Dunkelgrün"),
          a.value(row.description),
          event.on_input(WishDescriptionChanged(row.id, _)),
        ],
        row.description,
      ),
    ]),
    field(field_id(row.id, 2), optional("Link"), [
      h.input([
        class("w-u"),
        id(field_id(row.id, 2)),
        a.type_("url"),
        a.inputmode("url"),
        a.placeholder("https://…"),
        a.value(row.url),
        event.on_input(WishUrlChanged(row.id, _)),
        event.on_change(WishUrlCommitted(row.id, _)),
      ]),
    ]),
  ])
}

fn field_id(row: Int, n: Int) -> String {
  "w-" <> int.to_string(row) <> "-" <> int.to_string(n)
}

fn tool_id(row: Int, name: String) -> String {
  "w-" <> int.to_string(row) <> "-" <> name
}

// FFI -------------------------------------------------------------------------

@external(javascript, "./wunschzettel/text.ffi.mjs", "safe_url")
fn safe_url(url: String) -> Result(#(String, String), Nil)

@external(javascript, "./wunschzettel/text.ffi.mjs", "rich_segments")
fn rich_segments(text: String) -> List(#(String, String, String))

@external(javascript, "./wunschzettel/text.ffi.mjs", "clean_url")
fn clean_url(url: String) -> String

/// Snow and trees behind the card for Weihnachten; follows html[data-anlass].
@external(javascript, "./wunschzettel/scenery.ffi.mjs", "start")
fn start_scenery() -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "set_title")
fn set_title(title: String) -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "set_anlass")
fn set_anlass(anlass: String) -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "replace_hash")
fn replace_hash(hash: String) -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "scroll_to_top")
fn scroll_to_top() -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "focus")
fn focus(id: String) -> Nil

@external(javascript, "./wunschzettel/browser.ffi.mjs", "base_url")
fn base_url() -> String

@external(javascript, "./wunschzettel/browser.ffi.mjs", "current_year")
fn current_year() -> Int

@external(javascript, "./wunschzettel/browser.ffi.mjs", "copy")
fn copy(text: String, done: fn(Bool) -> Nil) -> Nil
