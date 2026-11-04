/**
 * Which EmComm sidebar panels are shown (#1241), and named sets of them to
 * switch between for the task at hand (net control, shelter operations …).
 *
 * Stored per browser in openhamclock_emcommPanelSets:
 *   { hidden: [panel keys], sets: { name: [hidden panel keys] } }
 * A set records what it hides, so a panel added in a later release shows up
 * in every existing set until someone hides it.
 */

export const PANEL_SETS_KEY = 'openhamclock_emcommPanelSets';

/** Sidebar panels in display order; the key is PanelSection's panelKey || title. */
export const EMCOMM_PANELS = [
  'Incident',
  'Resource Summary',
  'NWS Alerts',
  'Disaster Declarations',
  'Nearby Shelters',
  'Nearby Repeaters',
  'EmComm Stations',
  'APRS Telemetry',
  'Nearby Winlink Gateways',
  'NBEMS',
  'Field Reports',
  'Net Control',
  'Net Roster',
  'Event Log',
  'ICS Forms',
  'Offline Map Area',
];

const only = (keep) => EMCOMM_PANELS.filter((p) => !keep.includes(p));

/** Ready-made sets; they can be overridden by a saved set of the same name. */
export const BUILTIN_SETS = {
  All: [],
  'Net control': only(['Incident', 'Net Control', 'Net Roster', 'EmComm Stations', 'Event Log', 'ICS Forms']),
  'Shelters & resources': only([
    'Incident',
    'Resource Summary',
    'NWS Alerts',
    'Nearby Shelters',
    'Field Reports',
    'Event Log',
  ]),
};

const cleanList = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((k) => typeof k === 'string' && EMCOMM_PANELS.includes(k)))] : [];

export function readPanelSets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PANEL_SETS_KEY) || '{}') || {};
    const sets = {};
    if (raw.sets && typeof raw.sets === 'object') {
      for (const [name, hidden] of Object.entries(raw.sets)) {
        const n = String(name).trim().slice(0, 40);
        if (n) sets[n] = cleanList(hidden);
      }
    }
    return { hidden: cleanList(raw.hidden), sets };
  } catch {
    return { hidden: [], sets: {} };
  }
}

export function writePanelSets(state) {
  const clean = { hidden: cleanList(state?.hidden), sets: {} };
  for (const [name, hidden] of Object.entries(state?.sets || {})) clean.sets[name] = cleanList(hidden);
  try {
    if (!clean.hidden.length && !Object.keys(clean.sets).length) localStorage.removeItem(PANEL_SETS_KEY);
    else localStorage.setItem(PANEL_SETS_KEY, JSON.stringify(clean));
  } catch {}
  return clean;
}

/** Every set the picker offers: built-ins first, then saved ones (saved wins on a name clash). */
export function allSets(state) {
  return { ...BUILTIN_SETS, ...(state?.sets || {}) };
}

/** Name of the set the current choice matches, or '' when it is a custom mix. */
export function activeSetName(state) {
  const key = (list) => [...list].sort().join('|');
  const current = key(cleanList(state?.hidden));
  for (const [name, hidden] of Object.entries(allSets(state))) {
    if (key(cleanList(hidden)) === current) return name;
  }
  return '';
}

/** Toggle one panel's visibility. Never hides the last visible panel. */
export function togglePanel(state, panel) {
  const hidden = cleanList(state?.hidden);
  const next = hidden.includes(panel) ? hidden.filter((p) => p !== panel) : [...hidden, panel];
  if (next.length >= EMCOMM_PANELS.length) return state;
  return { ...state, hidden: next };
}
