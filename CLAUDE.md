# wunschzettel

A wish list that lives entirely in its link. One static page, `index.html`, no build
step, no backend, no database. Hosted on GitHub Pages from `main` (root), so pushing
to `main` deploys.

## How it works

- The whole list is in the URL fragment: `#d=<code>` shows the list,
  `#bearbeiten&d=<code>` opens the editor with that list, `#neu` (or no hash) opens a
  blank editor.
- `<code>` is a one-letter prefix plus base64url: `z` = deflate-raw
  (CompressionStream) of the JSON, `j` = plain JSON (fallback for old browsers).
- JSON shape, short keys to keep links short:
  `{n: name, t: title (omitted when "Wunschzettel"), o: "geburtstag"|"schlicht"
  (omitted when "weihnachten"), m: message, w: [[title, description, url], ...]}`,
  with trailing empty strings dropped from each wish.
- Old links must keep working: change the format only additively, or bump the prefix
  letter and keep decoding the old ones.
- Descriptions are plain text; `[text](url)` and bare http(s) URLs become links. Text
  is never inserted as HTML.

## Design

"Stilvoll": a paper card on a coloured ground, Pinyon Script for the title only,
EB Garamond for everything else, a thin gold double frame and one ornament rule.
The occasion (`o`) picks the ground colour. Copy is German, sentence case, plain.

## Working

- `devenv up` serves the site on http://127.0.0.1:8000 and opens Chromium.
- Check changes in a real browser (Playwright MCP is headless), desktop and phone
  width, both the list view and the editor.
