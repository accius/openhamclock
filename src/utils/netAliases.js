/**
 * Net Roster addresses (#1237, #1239).
 *
 * Stations check in by sending `CQ <net> <status>` (and out with
 * `U <net>`) as an APRS message. The address they send it to used to be
 * fixed at EMCOMM, so every group in RF or APRS-IS range saw every other
 * group's check-ins. The server now records the address on each roster
 * entry; this module holds the addresses this station listens on and
 * filters, groups and labels the roster by them.
 *
 * Stored per browser in openhamclock_emcommAliases (synced to the server
 * like other settings). Default: ["EMCOMM"].
 */

export const ALIASES_KEY = 'openhamclock_emcommAliases';
export const ALIASES_EVENT = 'ohc:emcomm-aliases';
export const DEFAULT_ALIAS = 'EMCOMM';
export const MAX_ALIASES = 8;

// An APRS message addressee is up to nine characters. A callsign with SSID
// (W8ROC, W8ROC-10) or a tactical alias (EMCOMM, OHARES) both fit.
const ALIAS_RE = /^[A-Z0-9]{1,6}(-[A-Z0-9]{1,2})?$|^[A-Z0-9]{1,9}$/;

/** Normalised alias, or null when it cannot be an APRS addressee. */
export function normalizeAlias(raw) {
  const a = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!a || !ALIAS_RE.test(a) || !/[A-Z]/.test(a)) return null;
  if (a.startsWith('BLN')) return null; // bulletins, not a net address
  return a;
}

/**
 * Parse a typed list ("W8ROC, EMCOMM OHARES") into unique valid aliases.
 * Returns { aliases, invalid } so the editor can say what it dropped.
 */
export function parseAliasList(text) {
  const aliases = [];
  const invalid = [];
  for (const part of String(text ?? '').split(/[\s,;]+/)) {
    if (!part) continue;
    const a = normalizeAlias(part);
    if (!a) invalid.push(part);
    else if (!aliases.includes(a)) aliases.push(a);
  }
  return { aliases: aliases.slice(0, MAX_ALIASES), invalid };
}

/** The stored aliases, never empty (falls back to EMCOMM). */
export function getAliases() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALIASES_KEY) || 'null');
    if (Array.isArray(parsed)) {
      const list = parseAliasList(parsed.join(' ')).aliases;
      if (list.length) return list;
    }
  } catch {}
  return [DEFAULT_ALIAS];
}

/** Save aliases (an empty list restores the default) and tell listeners. */
export function setAliases(list) {
  const clean = parseAliasList((list || []).join(' ')).aliases;
  try {
    if (!clean.length || (clean.length === 1 && clean[0] === DEFAULT_ALIAS)) localStorage.removeItem(ALIASES_KEY);
    else localStorage.setItem(ALIASES_KEY, JSON.stringify(clean));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(ALIASES_EVENT));
  } catch {}
  return clean.length ? clean : [DEFAULT_ALIAS];
}

/**
 * The address a roster entry was checked in to. Entries from servers older
 * than this change, manual check-ins and voice-net entries carry none and
 * count as EMCOMM, which is what they meant before.
 */
export function entryAlias(op) {
  return normalizeAlias(op?.alias) || DEFAULT_ALIAS;
}

/**
 * Does a message addressee belong to `alias`? Exact match, except that
 * EMCOMM keeps its old meaning of any address starting with EMCOMM
 * (EMCOMM-1, EMCOMMOH …).
 */
export function addresseeMatches(addressee, alias) {
  const to = String(addressee ?? '')
    .trim()
    .toUpperCase();
  if (!to || !alias) return false;
  if (to === alias) return true;
  return alias === DEFAULT_ALIAS && to.startsWith(DEFAULT_ALIAS);
}

/** The alias in `aliases` that `addressee` belongs to, or null. */
export function aliasForAddressee(addressee, aliases) {
  for (const a of aliases || []) if (addresseeMatches(addressee, a)) return a;
  return null;
}

/**
 * Roster entries addressed to one of `aliases`, each tagged with the
 * matching alias. Voice-net and incident entries (no alias) pass when
 * EMCOMM is listened on, or when they were synced from another site
 * (the incident is already the shared scope).
 */
export function filterRosterByAliases(roster, aliases) {
  const list = aliases && aliases.length ? aliases : [DEFAULT_ALIAS];
  const out = [];
  for (const op of roster || []) {
    if (!op) continue;
    if (!op.alias) {
      if (op.fromIncident || op.source === 'net-control' || list.includes(DEFAULT_ALIAS)) {
        out.push({ ...op, alias: op.alias || (list.includes(DEFAULT_ALIAS) ? DEFAULT_ALIAS : list[0]) });
      }
      continue;
    }
    const match = aliasForAddressee(op.alias, list);
    // `address` keeps what the station actually sent to (EMCOMM-1 under EMCOMM)
    if (match) out.push({ ...op, alias: match, address: op.address || op.alias });
  }
  return out;
}

/** Stable identity of a roster entry: the same call can be in two groups' nets. */
export function rosterKey(op) {
  return `${entryAlias(op)}|${String(op?.call || '').toUpperCase()}`;
}

/**
 * Is an APRS message relevant to this station? Traffic to one of its
 * aliases, to or from its own callsign (any SSID), and bulletins. Messages
 * between two other stations in range are not.
 */
export function messageIsRelevant(msg, aliases, myCall) {
  if (!msg) return false;
  if (msg.type === 'bulletin') return true;
  if (aliasForAddressee(msg.to, aliases)) return true;
  const base = (c) =>
    String(c ?? '')
      .trim()
      .toUpperCase()
      .split('-')[0];
  const me = base(myCall);
  if (!me || me === 'N0CALL') return false;
  return base(msg.to) === me || base(msg.from) === me;
}

/**
 * Group roster entries for display (#1240).
 * mode 'none' → one group; 'alias' → by address; 'net' → by net name.
 * Returns [{ key, label, entries }] in a stable order: groups follow the
 * alias list (alias mode) or are alphabetical (net mode); entries keep the
 * order they came in.
 */
const VOICE_GROUP = '\u0000voice';

/**
 * Entries for one address's roster (#1240, Ask 4). The station's own voice
 * net (Net Control) stays visible whichever address is picked.
 */
export function rosterForAddress(roster, alias) {
  if (!alias || alias === 'all') return roster || [];
  return (roster || []).filter((op) => op.source === 'net-control' || entryAlias(op) === alias);
}

export function groupRoster(roster, mode, aliases = []) {
  const entries = roster || [];
  if (mode !== 'alias' && mode !== 'net') return [{ key: 'all', label: '', entries }];
  const groups = new Map();
  for (const op of entries) {
    // Voice-net check-ins (Net Control) have no APRS address: their own group
    const key =
      mode === 'alias'
        ? op.source === 'net-control'
          ? VOICE_GROUP
          : entryAlias(op)
        : String(op.netName || '').toUpperCase() || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(op);
  }
  let keys = [...groups.keys()];
  if (mode === 'alias') {
    const order = (k) => {
      const i = aliases.indexOf(k);
      return i < 0 ? aliases.length : i;
    };
    keys.sort((a, b) => (a === VOICE_GROUP) - (b === VOICE_GROUP) || order(a) - order(b) || a.localeCompare(b));
  } else {
    keys.sort((a, b) => (a === '—') - (b === '—') || a.localeCompare(b));
  }
  const label = (k) => (k === '—' ? 'No net name' : k === VOICE_GROUP ? 'Voice net' : k);
  return keys.map((k) => ({ key: k, label: label(k), entries: groups.get(k) }));
}
