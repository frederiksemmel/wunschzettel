// Bytes in the link: base64url and deflate-raw. fflate rather than CompressionStream,
// because CompressionStream cannot use a preset dictionary.
import { deflateSync, inflateSync } from "fflate";
import { Error as GleamError, Ok } from "../gleam.mjs";

/* Preset dictionary for "k" links. FROZEN once links are shared: every "k" link
 * decodes with exactly these bytes. To change it, add a new prefix letter with a new
 * dictionary and keep this one for decoding.
 * Deflate finds earlier matches cheaper when they are close, so the most likely
 * strings come last. */
const DICTIONARY = new TextEncoder().encode(
  [
    "Hörbuch Roman Krimi Thriller Fantasy Sachbuch Kochbuch Bildband Comic Kalender Puzzle ",
    "Gesellschaftsspiel Kartenspiel Brettspiel Spiel für zwei Konsole Videospiel LEGO Playmobil ",
    "Kopfhörer kabellos Lautsprecher Ladegerät Hülle Kamera Uhr Armband Kette Ohrringe Ring ",
    "Parfum Creme Duft Tasche Rucksack Geldbeutel Portemonnaie Regenschirm Sonnenbrille ",
    "Pullover Jacke Mantel Schal Mütze Handschuhe Socken Hose Jeans Hemd Bluse Kleid T-Shirt ",
    "Schuhe Hausschuhe Turnschuhe Sneaker Stiefel Wanderschuhe Laufschuhe Bademantel Schlafanzug ",
    "Pflanze Blumen Topf Vase Kerze Decke Kissen Bettwäsche Handtuch Lampe Bilderrahmen Poster ",
    "Tasse Becher Teller Schüssel Glas Pfanne Messer Kaffee Espresso Tee Wein Gin Whisky ",
    "Schokolade Pralinen Kekse Honig Olivenöl Gewürze Werkzeug Fahrrad Helm Yoga Matte ",
    "Gutschein für Kino Konzert Theater Museum Ausflug Wochenende Reise Massage Kurs Erlebnis ",
    "Abo Spende Zeit gemeinsam zusammen ein Abend mit euch Selbstgemachtes nichts Teures ",
    "S M L XL XXL Grösse Größe schwarz weiß weiss grau blau dunkelblau grün dunkelgrün rot ",
    "braun beige gelb rosa lila Farbe egal welche ungefähr Euro Franken CHF EUR Stück ",
    "am liebsten zum Beispiel so etwas wie vielleicht gern gerne etwas ein eine einen einem ",
    "für von mit oder und aus in ist das die der den dem nicht auch noch sehr neu neue neues ",
    "gutes schönes warm weich klein groß gross lang kurz Ich freue mich über alles, ",
    "Weihnachten Geburtstag Wunschzettel Danke ",
    "https://www.etsy.com/de/listing/ https://www.lego.com/de-de/product/ https://www.tchibo.de/ ",
    "https://www.decathlon.de/p/ https://www.decathlon.ch/de/p/ https://www.manor.ch/de/p/ ",
    "https://www.exlibris.ch/de/buecher-buch/ https://www.orellfuessli.ch/shop/home/artikeldetails/ ",
    "https://www.brack.ch/ https://www.mediamarkt.ch/de/product/ https://www.mediamarkt.de/de/product/ ",
    "https://www.ikea.com/ch/de/p/ https://www.ikea.com/de/de/p/ https://www.otto.de/p/ ",
    "https://www.zalando.ch/ https://www.zalando.de/ https://www.digitec.ch/de/s1/product/ ",
    "https://www.galaxus.ch/de/s1/product/ https://www.galaxus.de/de/s1/product/ ",
    "https://www.thalia.de/shop/home/artikeldetails/ https://de.wikipedia.org/wiki/ ",
    "https://www.amazon.com/dp/ https://www.amazon.de/dp/",
  ].join(""),
);

function toB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** "k" + base64url(deflate-raw(utf8(text), DICTIONARY)) */
export function encode_compact(text) {
  const bytes = new TextEncoder().encode(text);
  return "k" + toB64url(deflateSync(bytes, { level: 9, mem: 12, dictionary: DICTIONARY }));
}

/** The text inside a "k" code; Error for anything else or a cut-off link. */
export function decode_compact(code) {
  try {
    if (code[0] !== "k") return new GleamError(undefined);
    const bytes = fromB64url(code.slice(1));
    // An empty deflate stream inflates to nothing without complaint; it is a cut-off link.
    if (bytes.length === 0) return new GleamError(undefined);
    return new Ok(new TextDecoder().decode(inflateSync(bytes, { dictionary: DICTIONARY })));
  } catch {
    return new GleamError(undefined);
  }
}
