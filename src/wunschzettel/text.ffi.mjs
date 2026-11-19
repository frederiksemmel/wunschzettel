// Text helpers that need the browser's URL parser or JavaScript regex semantics.
import { Error as GleamError, Ok, toList } from "../gleam.mjs";

function parseSafe(u) {
  u = (u || "").trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
const shortHost = (url) => url.hostname.replace(/^www\./, "");

/** Ok(#(href, host without www.)) for http(s) links, adding https:// when missing. */
export function safe_url(u) {
  const url = parseSafe(u);
  return url ? new Ok([url.href, shortHost(url)]) : new GleamError(undefined);
}

/** Plain text split into segments: #("text", text, "") or #("link", href, label).
 * [text](url) and bare http(s) URLs become links; nothing is ever HTML. */
export function rich_segments(text) {
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/g;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(["text", text.slice(last, m.index), ""]);
    const url = parseSafe(m[2] || m[3]);
    if (url) out.push(["link", url.href, m[1] || shortHost(url)]);
    else out.push(["text", m[0], ""]);
    last = m.index + m[0].length;
  }
  out.push(["text", text.slice(last), ""]);
  return toList(out.filter(([kind, a]) => kind === "link" || a !== ""));
}

const TRACKING =
  /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|_ga$|igshid$|srsltid$|ref$|ref_$|spm$)/i;

/** A pasted shop link without its tracking clutter: Amazon product links become
 * amazon.<tld>/dp/<ASIN>, and utm_*, fbclid, ref and friends are dropped elsewhere.
 * Anything that is not an http(s) link, or needs no change, comes back as it was. */
export function clean_url(u) {
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return u;
  let url;
  try {
    url = new URL(s);
  } catch {
    return u;
  }
  if (/(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)) {
    const m = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?]|$)/i);
    if (m) return url.origin + "/dp/" + m[1];
  }
  const keys = [...url.searchParams.keys()].filter((k) => TRACKING.test(k));
  if (!keys.length) return u;
  for (const k of keys) url.searchParams.delete(k);
  return url.href;
}

/** Compatibility decomposition, so accents can be stripped for the link label. */
export function nfkd(s) {
  return s.normalize("NFKD");
}
