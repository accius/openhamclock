/**
 * Message-of-the-day helpers (pure): split a plain-text message into text
 * and link segments (no markdown — just bare URLs become clickable), and
 * remember which message id this browser dismissed.
 */

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

export const MOTD_DISMISSED_KEY = 'ohc_motd_dismissed';

/**
 * "see https://x.y/z." → [{ text: 'see ' }, { url: 'https://x.y/z' }, { text: '.' }]
 * Only http/https URLs are linkified; trailing sentence punctuation stays text.
 */
export function linkifyMotd(text) {
  const out = [];
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const start = m.index;
    let url = m[0];
    const trail = url.match(TRAILING_PUNCT);
    if (trail) url = url.slice(0, -trail[0].length);
    if (start > last) out.push({ text: s.slice(last, start) });
    out.push({ url });
    last = start + url.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function getDismissedMotdId() {
  try {
    return localStorage.getItem(MOTD_DISMISSED_KEY) || null;
  } catch {
    return null;
  }
}

export function setDismissedMotdId(id) {
  try {
    if (id) localStorage.setItem(MOTD_DISMISSED_KEY, String(id));
    else localStorage.removeItem(MOTD_DISMISSED_KEY);
  } catch {}
}

/** True when a message should be shown: has text and isn't the dismissed id. */
export function shouldShowMotd(motd, dismissedId = getDismissedMotdId()) {
  if (!motd || typeof motd.text !== 'string' || !motd.text.trim() || !motd.id) return false;
  return motd.id !== dismissedId;
}
