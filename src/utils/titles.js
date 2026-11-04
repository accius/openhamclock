/**
 * Rotating callsign-box titles (HamClock `set_title` parity).
 *
 * Settings → Station → "Callsign box titles" takes up to six titles
 * separated by `;`; the header shows them in turn, ROTATE_MS each. An empty
 * string shows the callsign as usual. The remote `/title` command sets a
 * session-only override through utils/sessionFlags (titleOverride).
 */

export const MAX_TITLES = 6;
export const MAX_TITLE_LENGTH = 60;
export const ROTATE_MS = 10_000;

/** "a; b ;;c" → ['a', 'b', 'c'] (trimmed, empties dropped, capped at six). */
export function parseTitles(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, MAX_TITLE_LENGTH))
    .slice(0, MAX_TITLES);
}

/** Validate a titles string for the settings field. → null | error key suffix */
export function titlesError(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const parts = text.split(';').map((s) => s.trim());
  if (parts.filter(Boolean).length > MAX_TITLES) return 'tooMany';
  if (parts.some((p) => p.length > MAX_TITLE_LENGTH)) return 'tooLong';
  return null;
}

/**
 * Which title to show at time `now` (ms). Titles advance every `periodMs`
 * on a shared clock, so two displays with the same titles stay in step.
 */
export function pickTitle(titles, now = Date.now(), periodMs = ROTATE_MS) {
  if (!Array.isArray(titles) || titles.length === 0) return null;
  const idx = Math.floor(now / periodMs) % titles.length;
  return titles[idx];
}

/**
 * Resolve what the callsign box should display.
 * @param {string} callsign
 * @param {string} configTitles   config.callsignTitles
 * @param {{text?:string|null,fg?:string|null,bg?:string|null}|null} override  session override
 * @param {number} now
 * → { text, fg, bg, isTitle }
 */
export function resolveCallsignBox(callsign, configTitles, override, now = Date.now()) {
  const fg = override?.fg || null;
  const bg = override?.bg || null;
  const list = override && override.text ? parseTitles(override.text) : parseTitles(configTitles);
  const title = pickTitle(list, now);
  if (title) return { text: title, fg, bg, isTitle: true };
  return { text: callsign, fg, bg, isTitle: false };
}
