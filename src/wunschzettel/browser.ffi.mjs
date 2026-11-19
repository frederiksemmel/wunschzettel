// The few places the app touches the page outside its own DOM.

export function set_title(title) {
  document.title = title;
}

/** The occasion picks the ground colour through html[data-anlass]. */
export function set_anlass(anlass) {
  document.documentElement.dataset.anlass = anlass;
}

/** Change the fragment without a history entry and without telling the router. */
export function replace_hash(hash) {
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

export function scroll_to_top() {
  window.scrollTo(0, 0);
}

export function focus(id) {
  document.getElementById(id)?.focus();
}

/** The page address without the fragment, for building the link to share. */
export function base_url() {
  return location.origin + location.pathname;
}

export function current_year() {
  return new Date().getFullYear();
}

/** Copy to the clipboard; if the browser refuses, show the link to copy by hand.
 * Calls back with true only when the clipboard write worked. */
export function copy(text, done) {
  // navigator.clipboard is missing outside secure contexts; that rejects too
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(
      () => done(true),
      () => {
        window.prompt("Link zum Kopieren:", text);
        done(false);
      },
    );
}
