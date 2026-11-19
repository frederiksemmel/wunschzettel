# wunschzettel

A wish list that lives entirely in its link. A static page with no backend and no
database, written in Gleam + Lustre, compiled to JavaScript and deployed to GitHub
Pages by `.github/workflows/pages.yml` on every push to `main`.

## How it works

- The whole list is in the URL fragment: `#<label>&d=<code>` shows the list,
  `#<label>&bearbeiten&d=<code>` opens the editor with it, `#neu` (or no fragment)
  opens a blank editor.
- `<label>` is a readable slug of name, occasion and year (`frederik-weihnachten-2026`).
  It is cosmetic: decoding ignores it and the page rewrites it from the data.
- `<code>` is the format letter `k` plus a compact text, deflated against a preset
  dictionary. The format is documented at the top of `src/wunschzettel/link.gleam`; the
  dictionary is in `src/wunschzettel/codec.ffi.mjs`.
- Shared links must keep working: change the format only additively (append fields),
  or add a new prefix letter and keep decoding `k`. The dictionary is frozen for `k`.
- Descriptions are plain text; `[text](url)` and bare http(s) URLs become links. Text
  is never inserted as HTML.

## Code

- `src/wunschzettel.gleam`: the Lustre app (routing, editor, sheet). modem handles link
  clicks and back/forward; the editor's live address-bar updates go through
  `replace_hash` in `browser.ffi.mjs`, because `modem.replace` would re-route on
  every keystroke.
- `src/wunschzettel/*.ffi.mjs`: the browser-only parts (compression via fflate, URL
  parsing, clipboard, and `scenery.ffi.mjs`, the snow and trees canvas).
- `assets/index.html` is the page shell with all CSS. `gleam.toml` sets `no_html`
  because lustre_dev_tools' generated HTML loads the script from `/`, which breaks
  under the `/wunschzettel/` path on Pages.
- Tool versions in `pages.yml` mirror the nixpkgs pin in `devenv.lock`; bump them together.

## Design

"Stilvoll": a paper card on a coloured ground, Pinyon Script for the title only,
EB Garamond for everything else, a thin gold double frame and one ornament rule.
The occasion (`o`) picks the ground colour through `html[data-anlass]`. For
Weihnachten, canvases behind and in front of the card show snow and fir trees that
play along with the mouse, taps, finger drags and scrolling (scrolling is wind). Only a
few large crystals drift in front of the card, so the text stays readable.
Copy is German, sentence case, plain.

## Working

- `devenv up` rebuilds `dist/` on change, serves it on http://127.0.0.1:8000 and opens
  Chromium. `gleam test` runs the link-format tests.
- Check changes in a browser at desktop and phone width, list view and editor. Disable
  the cache in Playwright (CDP `Network.setCacheDisabled`): miniserve lets it keep a
  stale `wunschzettel.js` across rebuilds.
