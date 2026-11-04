/**
 * incidentNetBridge — the running voice net and net history over a shared
 * incident.
 *
 * Net Control (src/components/NetControlPanel.jsx) keeps every tab and panel
 * of one browser in step on its own: each write of the running net goes to
 * localStorage with a rising revision (`rev`), other tabs hear it through the
 * `storage` event and other panels through the NET_CONTROL_CHANNEL
 * BroadcastChannel. This bridge extends that to the other stations of a
 * shared incident without touching the panel, through the adapters Net
 * Control exports for exactly this (src/utils/netControl.js):
 *
 *   out  a change on this browser (channel message / storage event)
 *        → serializeNetState(readRunningNetRecord()) → publish('net-running')
 *        → loadHistory() → publish('net-history')
 *   in   a document from the incident → applyRemoteNetState(local, remote),
 *        written back with saveRunningNet and announced on the channel, so
 *        the panels pick it up with their usual revision rules
 *
 * On join the incident's net wins (or, when the incident has no net, a net
 * already running here becomes the shared one), and while joined the
 * history shown is the incident's. This browser's own running net and
 * history are set aside first and put back on leave, so leaving returns
 * Net Control to exactly what it had before.
 */
import {
  serializeNetState,
  applyRemoteNetState,
  readRunningNetRecord,
  loadRunningNet,
  saveRunningNet,
  loadHistory,
  saveHistory,
  saveRosterSnapshot,
  NET_CONTROL_CHANNEL,
  NET_CONTROL_KEY,
  NET_CONTROL_HISTORY_KEY,
} from './netControl.js';
import {
  reconcileNet,
  netTag,
  sameNetContent,
  conflictRecord,
  mergeConflictRecords,
  removeConflictEntry,
  mergeHistory,
} from './incidentNetMerge.js';

export const BRIDGE_ID = 'shared-incident';
export const STASH_KEY = 'openhamclock_netControlBeforeIncident';
/** Stay under the hosted server's 64 KB per-document cap. */
export const NET_DOC_MAX_BYTES = 60 * 1024;

/**
 * Fired on window when another site changed the same station (or net field)
 * at the same time: detail { calls, fields, site }. Net Control shows it.
 */
export const NET_REMOTE_CONFLICT_EVENT = 'ohc-net-control-remote-conflict';
/** Our losing versions after a conflict ("your change" chips): see conflictRecord(). */
export const CONFLICTS_KEY = 'openhamclock_netControlConflicts';
/** Fired on window when the pending "your change" entries change. */
export const NET_CONFLICTS_CHANGED_EVENT = 'ohc-net-control-conflicts';

function saveConflicts(rec) {
  try {
    if (rec) localStorage.setItem(CONFLICTS_KEY, JSON.stringify(rec));
    else localStorage.removeItem(CONFLICTS_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(NET_CONFLICTS_CHANGED_EVENT));
  } catch {
    /* no window */
  }
}

/** Pending "your change" entries for net `netId` (or any net when omitted), or null. */
export function loadNetConflicts(netId) {
  try {
    const rec = JSON.parse(localStorage.getItem(CONFLICTS_KEY) || 'null');
    if (!rec || (netId && rec.netId !== netId)) return null;
    return rec;
  } catch {
    return null;
  }
}

/** Forget one pending entry: kind 'call' | 'field'. */
export function dismissNetConflict(kind, key) {
  saveConflicts(removeConflictEntry(loadNetConflicts(), kind, key));
}
const HISTORY_MAX = 30;

const state = {
  attached: false,
  publish: null,
  origin: null, // { site, call } stamped on what this browser publishes
  known: { net: '', history: '' },
  head: '', // tag of the last net state this site published or took
  seen: new Map(), // tag → net, recent states (common ancestors for merging)
  serverSeq: new Map(), // tag → server sequence (docRev) of an accepted net state
  historyRev: null, // docRev of the history copy this browser last saw
  historyBase: [], // that copy (the base of our next history write)
  channel: null,
  onStorage: null,
};

function remember(tag, net) {
  if (!tag || !net) return;
  state.seen.set(tag, net);
  while (state.seen.size > HISTORY_MAX) state.seen.delete(state.seen.keys().next().value);
}

function noteSeq(tag, seq) {
  if (!tag || !Number.isFinite(seq)) return;
  state.serverSeq.set(tag, seq);
  while (state.serverSeq.size > HISTORY_MAX) state.serverSeq.delete(state.serverSeq.keys().next().value);
}

/** The server accepted a net state we published (sync response `docRevs`). */
export function noteNetAccepted(tag, seq) {
  noteSeq(tag, seq);
}

/** The server accepted our history write: it is now at `rev`, with `list` as its content. */
export function noteHistoryAccepted(rev, list) {
  if (!Number.isFinite(rev)) return;
  if (state.historyRev == null || rev >= state.historyRev) {
    state.historyRev = rev;
    state.historyBase = Array.isArray(list) ? list : [];
  }
}

/**
 * Our history write was refused (someone else saved history meanwhile — two
 * sites closing a net at once). Merge by net id against the copy ours was
 * based on — keep their nets, add ours, honour our deletions — and send the
 * merge on top of theirs.
 */
export function historyConflict(mine, current) {
  if (!state.attached || !current) return;
  const merged = fitHistory(mergeHistory(state.historyBase, mine, current.data));
  state.historyRev = current.docRev ?? state.historyRev;
  state.historyBase = Array.isArray(current.data) ? current.data : [];
  saveHistory(merged);
  announce('history');
  state.known.history = '';
  publishHistory();
}

/** Comparison key for a serialized net state (updatedAt of an empty state changes every call). */
const netKey = (d) => JSON.stringify([d?.net ?? null, d?.closedId ?? null, d?.rev ?? 0]);
const historyKey = (list) => JSON.stringify(list || []);

/** Newest first: drop the oldest nets until the history fits one shared document. */
export function fitHistory(list) {
  let out = Array.isArray(list) ? list : [];
  while (out.length && JSON.stringify(out).length > NET_DOC_MAX_BYTES) out = out.slice(0, -1);
  return out;
}

function announce(type) {
  try {
    state.channel?.postMessage({ type, from: BRIDGE_ID });
    // Net Control counts every sender as another open panel; the bridge is
    // not one, so it signs off straight away.
    state.channel?.postMessage({ type: 'bye', from: BRIDGE_ID });
  } catch {
    /* channel closed */
  }
}

function readStash() {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** This browser's running net (or closed-net record) changed: share it. */
export function publishNet(extra = null) {
  if (!state.attached) return;
  const plain = serializeNetState(readRunningNetRecord());
  const key = netKey(plain);
  if (key === state.known.net) return;
  state.known.net = key;
  // tag / parentTag let the other sites find the common ancestor (incidentNetMerge.js).
  const data = {
    ...plain,
    tag: netTag(plain),
    parentTag: state.head || null,
    origin: state.origin || null,
    ...(extra || {}),
  };
  remember(data.tag, data.net);
  state.head = data.tag;
  state.publish?.('net-running', data);
}

/** Write a net state received or merged here, with a revision this browser's panels accept. */
function writeNet(net, rev) {
  const localRev = readRunningNetRecord()?.rev ?? 0;
  saveRunningNet({ ...net, rev: Math.max(rev ?? 0, localRev + 1), undo: [] });
  state.known.net = netKey(serializeNetState(readRunningNetRecord()));
}

/** This browser's net history changed: share it (trimmed to fit). */
export function publishHistory() {
  if (!state.attached) return;
  const list = fitHistory(loadHistory());
  const key = historyKey(list);
  if (key === state.known.history) return;
  state.known.history = key;
  // Conditional, like the ICS drafts: made from the history copy we last saw.
  state.publish?.('net-history', list, Number.isFinite(state.historyRev) ? { baseRev: state.historyRev } : {});
}

/**
 * A running-net document from the incident. `force` (on join) makes the
 * incident's net replace whatever runs here, whatever its revision.
 */
export function receiveNet(data, { force = false, docRev } = {}) {
  if (!state.attached || !data || data.kind !== 'net-control') return false;
  const key = netKey(data);
  if (data?.tag && Number.isFinite(docRev)) noteSeq(data.tag, docRev);
  if (!force && key === state.known.net) return false;
  // A state this site has already dealt with, announced again (a site that
  // kept its change in a conflict re-publishes it; an echo of our own older
  // state): acting on it again could undo what happened since — e.g. an
  // "Apply mine" made after it.
  if (!force && data.tag && state.seen.has(data.tag) && sameNetContent(state.seen.get(data.tag), data.net)) {
    return false;
  }
  if (data.tag) remember(data.tag, data.net);
  const local = loadRunningNet();

  // Both sites may have changed the same net at once: reconcile through the
  // common ancestor the way Net Control rebases a refused change in a tab.
  if (!force) {
    // Who wins a same-station conflict: the state the server received later.
    const order = { local: state.serverSeq.get(state.head), remote: docRev };
    const r = reconcileNet({ head: state.head, history: state.seen, local, remote: data, order });
    if (r.action === 'ignore') return false;
    if (r.action === 'same') {
      state.head = data.tag;
      state.known.net = key;
      return false;
    }
    if (r.action === 'adopt' || r.action === 'conflict') {
      if (r.action === 'conflict') {
        // Keep what we had for those lines, so the operator can put it back.
        const site = data.origin?.site || data.origin?.call || '';
        saveConflicts(mergeConflictRecords(loadNetConflicts(), conflictRecord(local, r, site)));
      }
      writeNet(r.net, data.rev);
      state.head = data.tag;
      announce('net');
      if (r.action === 'conflict') {
        try {
          window.dispatchEvent(
            new CustomEvent(NET_REMOTE_CONFLICT_EVENT, {
              detail: {
                calls: r.calls,
                fields: r.fields,
                site: data.origin?.site || data.origin?.call || '',
              },
            }),
          );
        } catch {
          /* no window */
        }
      }
      return true;
    }
    if (r.action === 'keep') {
      // Same station changed at both sites and ours is the later change:
      // ours stands. Publish it again as the successor of theirs, so the
      // incident (and every other site) ends on ours too.
      state.head = data.tag;
      state.known.net = '';
      // `overrode` tells that site its change lost (and which lines), so it
      // shows "your change" instead of reading this as a plain update.
      publishNet({ overrode: { tag: data.tag, calls: r.calls, fields: r.fields } });
      return false;
    }
    if (r.action === 'merge') {
      writeNet({ ...r.net, updatedAt: Date.now() }, Math.max(data.rev ?? 0, local?.rev ?? 0) + 1);
      state.head = data.tag; // the merged state is made from theirs…
      state.known.net = '';
      publishNet(); // …and goes out with it as its parent
      announce('net');
      return true;
    }
    // 'legacy': no common ancestor known — fall through to revision rules.
  }
  state.known.net = key;
  if (data.tag) state.head = data.tag;
  let next;
  let changed;
  if (force) {
    const localRev = readRunningNetRecord()?.rev ?? 0;
    const rev = Math.max(data.rev ?? 0, localRev + 1);
    if (data.net) {
      next = { ...data.net, rev, undo: [] };
      changed = true;
    } else {
      next = null;
      changed = !!local;
    }
  } else {
    ({ net: next, changed } = applyRemoteNetState(local, data));
  }
  if (!changed) return false;
  if (next) {
    saveRunningNet(next);
  } else {
    if (local) saveRosterSnapshot(local, { active: false });
    const rev = Math.max(data.rev ?? 0, (readRunningNetRecord()?.rev ?? 0) + 1);
    saveRunningNet({ closedId: data.closedId || local?.id || '', rev, updatedAt: data.updatedAt || Date.now() });
  }
  announce('net');
  return true;
}

/** A net-history document from the incident. */
export function receiveHistory(list, { docRev } = {}) {
  if (!state.attached || !Array.isArray(list)) return false;
  if (Number.isFinite(docRev) && (state.historyRev == null || docRev >= state.historyRev)) {
    state.historyRev = docRev;
    state.historyBase = list;
  }
  const clean = list.filter((n) => n && Array.isArray(n.stations));
  const key = historyKey(clean);
  if (key === state.known.history) return false;
  state.known.history = key;
  saveHistory(clean);
  announce('history');
  return true;
}

/**
 * Joined (or resumed after a reload). `docs` are the incident's documents
 * ({ id: { data } }); `publish(id, data)` sends one.
 */
export function attach({ docs = {}, publish, origin = null }) {
  if (state.attached) detachListeners();
  state.origin = origin;
  state.head = '';
  state.seen = new Map();
  state.serverSeq = new Map();
  state.historyRev = null;
  state.historyBase = [];
  // Set this browser's own net aside once — a reload while joined must not
  // overwrite the stash with the incident's copy.
  if (!readStash()) {
    try {
      localStorage.setItem(STASH_KEY, JSON.stringify({ net: readRunningNetRecord(), history: loadHistory() }));
    } catch {
      /* storage full — leaving will keep the incident's copy */
    }
  }
  state.attached = true;
  state.publish = publish;
  state.known = { net: '', history: '' };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      state.channel = new BroadcastChannel(NET_CONTROL_CHANNEL);
      state.channel.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.from === BRIDGE_ID) return;
        if (msg.type === 'net') publishNet();
        else if (msg.type === 'history') publishHistory();
      };
    } catch {
      state.channel = null;
    }
  }
  state.onStorage = (e) => {
    if (e.key === NET_CONTROL_KEY) publishNet();
    else if (e.key === NET_CONTROL_HISTORY_KEY) publishHistory();
  };
  window.addEventListener('storage', state.onStorage);

  const netDoc = docs['net-running']?.data;
  if (netDoc?.net) receiveNet(netDoc, { force: true, docRev: docs['net-running']?.docRev });
  else if (loadRunningNet())
    publishNet(); // the incident has no live net: ours becomes the shared one
  else if (netDoc) state.known.net = netKey(netDoc);

  const histDoc = docs['net-history']?.data;
  if (Array.isArray(histDoc)) receiveHistory(histDoc, { docRev: docs['net-history']?.docRev });
  else {
    state.known.history = historyKey([]);
    saveHistory([]);
    announce('history');
  }
}

function detachListeners() {
  if (state.onStorage) window.removeEventListener('storage', state.onStorage);
  try {
    state.channel?.close();
  } catch {
    /* ignore */
  }
  state.channel = null;
  state.onStorage = null;
}

/** Left the incident: put this browser's own running net and history back. */
export function detach() {
  if (!state.attached) return;
  const stash = readStash();
  if (!stash) {
    // Another tab of this browser left first and already put our own net back.
    detachListeners();
    state.attached = false;
    state.publish = null;
    state.known = { net: '', history: '' };
    return;
  }
  const current = loadRunningNet();
  const rev = (readRunningNetRecord()?.rev ?? 0) + 1;
  const now = Date.now();
  const mine = stash?.net && Array.isArray(stash.net.stations) && stash.net.name ? stash.net : null;
  if (mine) {
    if (current && current.id !== mine.id) saveRosterSnapshot(current, { active: false });
    saveRunningNet({ ...mine, rev, updatedAt: now });
    saveRosterSnapshot(mine, { active: true });
  } else if (current) {
    saveRosterSnapshot(current, { active: false });
    saveRunningNet({ closedId: current.id, rev, updatedAt: now });
  }
  saveHistory(Array.isArray(stash?.history) ? stash.history : []);
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    /* ignore */
  }
  saveConflicts(null);
  announce('net');
  announce('history');
  detachListeners();
  state.attached = false;
  state.publish = null;
  state.known = { net: '', history: '' };
}

export const isAttached = () => state.attached;

/** Test helper. */
export function _resetForTests() {
  detachListeners();
  state.attached = false;
  state.publish = null;
  state.origin = null;
  state.known = { net: '', history: '' };
  state.head = '';
  state.seen = new Map();
  state.serverSeq = new Map();
  state.historyRev = null;
  state.historyBase = [];
}
