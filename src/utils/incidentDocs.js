/**
 * incidentDocs — shared working documents while a shared incident is joined.
 *
 * Three documents travel with an incident (server: `docs`):
 *
 *   ics-drafts    the ICS Forms drafts (src/utils/icsForms.js) — handled here
 *   net-running   the running voice net  ┐ handled by incidentNetBridge.js
 *   net-history   past nets              ┘ through Net Control's own adapters
 *
 * While joined, every station edits the same 309/214/213/205 drafts and sees
 * the same net. Not joined, nothing changes: each panel reads and writes its
 * own localStorage.
 *
 * ICS Forms calls loadDoc / saveDoc in place of loadDrafts / saveDrafts and
 * subscribeDocs to reload when the drafts change underneath it (another
 * station saved, or this browser joined or left). The local copy is
 * untouched while joined, so leaving restores exactly what this browser had.
 *
 * useSharedIncident is the other side: attach() when joined (with a publish
 * function and the incident's documents), receive() whenever documents arrive
 * from the server, detach() on leave. Loops are avoided by remembering the
 * last serialised value per document: a save of what is already there is not
 * published, and a received document equal to what this browser last saw or
 * sent does not notify.
 */
import { loadDrafts, saveDrafts, defaultDrafts, mergeDrafts } from './icsForms.js';
import * as netBridge from './incidentNetBridge.js';
import { newerDoc } from './incidentSync.js';

/** Stay under the hosted server's 64 KB per-document cap. */
export const DOC_MAX_BYTES = 60 * 1024;

/** Documents panels load and save through this module. */
export const DOC_SPECS = {
  'ics-drafts': {
    local: () => loadDrafts(),
    saveLocal: (v) => saveDrafts(v),
    empty: () => defaultDrafts(),
    normalise: (v) => mergeDrafts(v),
  },
};

/** Documents the Net Control bridge owns. */
const NET_DOC_IDS = new Set(['net-running', 'net-history']);

export const DOC_IDS = Object.keys(DOC_SPECS);

const state = {
  attached: false,
  publish: null,
  docs: {}, // id → { data, updatedAt, by }
  known: {}, // id → JSON last seen or sent
  serverRev: {}, // id → the server revision our next write is based on
  conflicts: {}, // id → { mine, theirs, theirsRev, by, at } — a write the server refused
};

/** Refused writes survive a reload, so the operator can still put theirs/ours right. */
export const DOC_CONFLICTS_KEY = 'openhamclock_incidentDocConflicts';
const saveConflicts = () => {
  try {
    if (Object.keys(state.conflicts).length) localStorage.setItem(DOC_CONFLICTS_KEY, JSON.stringify(state.conflicts));
    else localStorage.removeItem(DOC_CONFLICTS_KEY);
  } catch {
    /* storage unavailable: the conflict lives for this page load */
  }
};
const loadConflicts = () => {
  try {
    return JSON.parse(localStorage.getItem(DOC_CONFLICTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const listeners = new Set();

const notify = (id, reason) => {
  for (const fn of listeners) {
    try {
      fn(id, reason);
    } catch {
      /* a panel's handler must not break the others */
    }
  }
};

/** Is this browser sharing documents through an incident right now? */
export const isSharing = () => state.attached;

/** The current value of a document: the incident's while joined, the panel's own otherwise. */
export function loadDoc(id) {
  const spec = DOC_SPECS[id];
  if (!spec) throw new Error(`Unknown shared document ${id}`);
  if (!state.attached) return spec.local();
  const doc = state.docs[id];
  if (!doc) return spec.empty();
  return spec.normalise ? spec.normalise(doc.data) : doc.data;
}

/**
 * Save a document. Not joined: the panel's own storage. Joined: published to
 * the incident (unless unchanged). → false when it is too large to share.
 */
export function saveDoc(id, value) {
  const spec = DOC_SPECS[id];
  if (!spec) throw new Error(`Unknown shared document ${id}`);
  if (!state.attached) {
    spec.saveLocal(value);
    return true;
  }
  const json = JSON.stringify(value ?? null);
  if (json.length > DOC_MAX_BYTES) return false;
  if (state.known[id] === json) return true;
  state.known[id] = json;
  state.docs[id] = { data: JSON.parse(json), updatedAt: Date.now() };
  // Conditional write: made from the revision this browser last saw. If
  // someone else saved since, the server refuses it (409) instead of letting
  // an old copy overwrite newer edits — see docConflict().
  const baseRev = state.serverRev[id];
  state.publish?.(id, value ?? null, Number.isFinite(baseRev) ? { baseRev } : {});
  return true;
}

/** The server took our write of `id`; it is now at revision `rev`. */
export function noteAccepted(id, rev, sentData) {
  if (id === 'net-running') return netBridge.noteNetAccepted(sentData?.tag, rev); // its server order
  if (id === 'net-history') return netBridge.noteHistoryAccepted(rev, sentData);
  if (!DOC_SPECS[id] || !Number.isFinite(rev)) return;
  state.serverRev[id] = Math.max(state.serverRev[id] ?? 0, rev);
}

/**
 * The server refused our write of `id`: someone saved a newer revision
 * (`current`) since our copy was made. Theirs is what everyone sees now;
 * ours is kept here so the operator can look at the difference and put it
 * back (applyMineDoc) or drop it (dismissDocConflict).
 */
export function docConflict(id, mine, current) {
  // Net history is a list of closed nets: merged by net id and sent again, no prompt.
  if (id === 'net-history') return netBridge.historyConflict(mine, current);
  if (!DOC_SPECS[id] || !current) return;
  state.conflicts[id] = {
    mine,
    theirs: current.data ?? null,
    theirsRev: current.docRev ?? null,
    by: current.by || '',
    at: Date.now(),
  };
  saveConflicts();
  notify(id, 'conflict');
}

/** A refused write waiting for the operator, or null. */
export const getDocConflict = (id) => state.conflicts[id] || null;

/** Put our refused copy back, on top of theirs (a write made from their revision). */
export function applyMineDoc(id) {
  const c = state.conflicts[id];
  if (!c) return false;
  if (Number.isFinite(c.theirsRev)) state.serverRev[id] = Math.max(state.serverRev[id] ?? 0, c.theirsRev);
  delete state.conflicts[id];
  saveConflicts();
  const ok = saveDoc(id, c.mine);
  notify(id, 'remote'); // the panel shows ours again
  return ok;
}

/** Keep theirs: forget our refused copy. */
export function dismissDocConflict(id) {
  if (!state.conflicts[id]) return;
  delete state.conflicts[id];
  saveConflicts();
  notify(id, 'conflict');
}

/**
 * Differences between two copies of a document, as { path, mine, theirs }
 * for each leaf that differs (e.g. "ics214.rows.2.text"), at most `limit`.
 */
export function diffDocs(mine, theirs, limit = 50) {
  const out = [];
  const walk = (a, b, path) => {
    if (out.length >= limit) return;
    const isObj = (v) => v && typeof v === 'object';
    if (isObj(a) && isObj(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ path, mine: a ?? null, theirs: b ?? null });
  };
  walk(mine, theirs, '');
  return out;
}

/**
 * Listen for document changes: fn(id, reason) — 'remote' (someone else's
 * copy arrived), 'mode' (joined / left) or 'conflict' (our write was refused,
 * or that refusal was dealt with). → unsubscribe
 */
export function subscribeDocs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The incident side (useSharedIncident). `docs` is the incident's documents
 * ({ id: { data, updatedAt } }); `publish(id, data)` sends one.
 */
export function attach({ docs = {}, publish, origin = null }) {
  state.attached = true;
  state.publish = publish;
  state.docs = {};
  state.known = {};
  state.serverRev = {};
  state.conflicts = loadConflicts();
  for (const [id, doc] of Object.entries(docs || {})) {
    if (!DOC_SPECS[id] || !doc) continue;
    state.docs[id] = doc;
    state.known[id] = JSON.stringify(doc.data ?? null);
    if (Number.isFinite(doc.docRev)) state.serverRev[id] = doc.docRev;
  }
  for (const id of DOC_IDS) notify(id, 'mode');
  netBridge.attach({ docs: docs || {}, publish, origin });
}

/** Documents from the server (snapshot or change). Notifies only real changes. */
export function receive(docs) {
  if (!state.attached) return;
  for (const doc of Array.isArray(docs) ? docs : Object.values(docs || {})) {
    if (!doc?.id) continue;
    if (NET_DOC_IDS.has(doc.id)) {
      if (doc.id === 'net-running') netBridge.receiveNet(doc.data, { docRev: doc.docRev });
      else netBridge.receiveHistory(doc.data, { docRev: doc.docRev });
      continue;
    }
    if (!DOC_SPECS[doc.id]) continue;
    if (Number.isFinite(doc.docRev)) state.serverRev[doc.id] = Math.max(state.serverRev[doc.id] ?? 0, doc.docRev);
    const cur = state.docs[doc.id];
    if (!newerDoc(cur, doc)) continue;
    const json = JSON.stringify(doc.data ?? null);
    state.docs[doc.id] = doc;
    if (state.known[doc.id] === json) continue; // our own echo, or no change
    state.known[doc.id] = json;
    notify(doc.id, 'remote');
  }
}

/** Left the incident: panels go back to their own storage. */
export function detach() {
  if (!state.attached) return;
  state.attached = false;
  state.publish = null;
  state.docs = {};
  state.known = {};
  state.serverRev = {};
  state.conflicts = {};
  saveConflicts();
  for (const id of DOC_IDS) notify(id, 'mode');
  netBridge.detach();
}

/** Test helper. */
export function _resetForTests() {
  state.attached = false;
  state.publish = null;
  state.docs = {};
  state.known = {};
  state.serverRev = {};
  state.conflicts = {};
  listeners.clear();
  netBridge._resetForTests();
}
