/**
 * incidentNetMerge — reconciling the running voice net between sites.
 *
 * Inside one browser, Net Control re-applies a refused change to the newer
 * net when rebaseCheck() says the two changes don't overlap (different
 * station lines, different net fields). Across a shared incident only whole
 * net states travel, so the same rule is applied to states: each published
 * state carries its own `tag` and the `parentTag` of the state it was made
 * from, every site keeps the last few states it has seen, and an incoming
 * state is reconciled against the local one through their common ancestor:
 *
 *   ignore    our own state coming back
 *   same      different path, same content — just note it
 *   adopt     theirs was made from what we have: take it
 *   merge     both changed, nothing overlaps (rebaseCheck): keep both
 *   conflict  the same station (or field) changed at both sites and theirs
 *             is the later change: take theirs, and tell the operator which
 *             calls, and where (with "your change" to put ours back)
 *   keep      the same conflict, but ours is the later change: keep ours and
 *             publish it again on top of theirs, marked `overrode` (their tag,
 *             the lines) so that site shows "your change" when it arrives. Both sites decide the same
 *             way (later commit time, then tag), so they never swap versions
 *   legacy    no common ancestor known: fall back to revision rules
 *
 * Pure functions; the transport is incidentNetBridge.js.
 */
import { rebaseCheck, changedCalls, changedNetFields } from './netControl.js';

/** Identifies one published net state. */
export const netTag = (data) => (data ? `${data.rev ?? 0}:${data.updatedAt ?? 0}` : '');

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A net without the bookkeeping that differs between copies of the same content. */
function content(net) {
  if (!net) return null;
  const { rev: _r, updatedAt: _u, undo: _d, ...rest } = net;
  return rest;
}

export const sameNetContent = (a, b) => sameValue(content(a), content(b));

const stationOf = (net, call) => (net?.stations || []).find((s) => s.call === call) || null;

/**
 * The order of a merged net's stations, the same at every site: newest
 * check-in first (as Net Control lists them), then callsign. Two sites that
 * merge the same changes therefore hold identical nets at once.
 */
export function orderStations(stations) {
  return [...(stations || [])].sort(
    (a, b) => (b.checkinTime ?? 0) - (a.checkinTime ?? 0) || String(a.call).localeCompare(String(b.call)),
  );
}

/**
 * Apply `mine`'s changes since `base` on top of `theirs`: changed net fields
 * take mine's value; changed station lines are replaced, added or removed.
 * The result is in orderStations() order.
 */
export function mergeNets(base, mine, theirs) {
  const out = { ...theirs };
  for (const f of changedNetFields(base, mine)) out[f] = mine[f];
  const list = [...(theirs.stations || [])];
  for (const call of changedCalls(base, mine)) {
    const m = stationOf(mine, call);
    const at = list.findIndex((s) => s.call === call);
    if (m) {
      if (at >= 0) list[at] = m;
      else list.push(m);
    } else if (at >= 0) {
      list.splice(at, 1);
    }
  }
  out.stations = orderStations(list);
  return out;
}

// ── "Your change" after a conflict ─────────────────────────────────────────
//
// When the other site's version of a station (or net field) wins, our
// version is kept beside the net so the operator can put it back with one
// click instead of retyping it. A record belongs to one net (netId); a
// station that we had removed is kept as `mine: null`.

/** Our side of a conflict: { netId, calls: { CALL: { mine, site, at } }, fields: { f: { mine, site, at } } }. */
export function conflictRecord(local, { calls = [], fields = [] }, site = '', at = Date.now()) {
  const rec = { netId: local?.id || '', calls: {}, fields: {} };
  for (const call of calls) rec.calls[call] = { mine: stationOf(local, call), site, at };
  for (const f of fields) rec.fields[f] = { mine: local?.[f] ?? null, site, at };
  return rec;
}

/** Add a new conflict to what is pending (a different net starts over). */
export function mergeConflictRecords(prev, next) {
  if (!prev || prev.netId !== next.netId) return next;
  return { netId: next.netId, calls: { ...prev.calls, ...next.calls }, fields: { ...prev.fields, ...next.fields } };
}

/** Drop one pending entry ('call' | 'field'). → the record, or null when nothing is left. */
export function removeConflictEntry(rec, kind, key) {
  if (!rec) return null;
  const out = { ...rec, calls: { ...rec.calls }, fields: { ...rec.fields } };
  delete out[kind === 'field' ? 'fields' : 'calls'][key];
  return Object.keys(out.calls).length || Object.keys(out.fields).length ? out : null;
}

/** Net Control operation: put our version of one station line back (null = remove it). */
export function applyMineStation(net, call, mine) {
  if (!net) return net;
  const rest = (net.stations || []).filter((s) => s.call !== call);
  if (!mine) return { ...net, stations: rest };
  const at = (net.stations || []).findIndex((s) => s.call === call);
  const stations = [...rest];
  stations.splice(at >= 0 ? at : 0, 0, mine);
  return { ...net, stations };
}

/**
 * Net history from two sites that saved at once: start from theirs (the copy
 * the server holds), add the nets ours added since `base` and drop the ones
 * ours deleted since `base`. Keyed by net id; newest first; capped at `max`.
 */
export function mergeHistory(base, mine, theirs, max = 50) {
  const ids = (list) => new Set((list || []).map((n) => n?.id).filter(Boolean));
  const baseIds = ids(base);
  const mineIds = ids(mine);
  const removed = new Set([...baseIds].filter((id) => !mineIds.has(id)));
  const out = new Map();
  for (const n of theirs || []) if (n?.id && !removed.has(n.id)) out.set(n.id, n);
  for (const n of mine || []) if (n?.id && !baseIds.has(n.id) && !out.has(n.id)) out.set(n.id, n);
  const when = (n) => n.endTime ?? n.startTime ?? 0;
  return [...out.values()].sort((a, b) => when(b) - when(a)).slice(0, max);
}

/** Net Control operation: put our value of one net field back. */
export const applyMineField = (net, field, value) => (net ? { ...net, [field]: value } : net);

/**
 * Decide what to do with a net state from another site.
 * @param {object} o
 * @param {string} o.head       tag of the last state this site published or took
 * @param {Map}    o.history    tag → net, states this site has seen
 * @param {object|null} o.local the running net here (live) or null
 * @param {object} o.remote     the received document ({ net, rev, updatedAt, tag, parentTag })
 * @param {object} [o.order]    server receipt order: { local, remote } — the server sequence (docRev)
 *                              of our state (undefined while not yet accepted) and of theirs
 * @returns {{ action: string, net?: object, calls?: string[], fields?: string[] }}
 */
export function reconcileNet({ head, history, local, remote, order = null }) {
  if (!remote) return { action: 'ignore' };
  if (remote.tag && remote.tag === head) return { action: 'ignore' };
  const theirs = remote.net;
  if (!theirs || !local || theirs.id !== local.id || !remote.tag) return { action: 'legacy' };
  if (sameNetContent(local, theirs)) return { action: 'same' };
  if (remote.parentTag && remote.parentTag === head) {
    // Made from ours — but if the other site kept its own change over ours
    // in a conflict, this is our loss, not a plain update.
    if (remote.overrode?.tag === head) {
      return {
        action: 'conflict',
        net: theirs,
        calls: Array.isArray(remote.overrode.calls) ? remote.overrode.calls : [],
        fields: Array.isArray(remote.overrode.fields) ? remote.overrode.fields : [],
      };
    }
    return { action: 'adopt', net: theirs };
  }
  const base = remote.parentTag ? history?.get(remote.parentTag) : null;
  if (!base || base.id !== local.id) return { action: 'legacy' };
  const check = rebaseCheck(base, local, theirs);
  // A line both sites changed to the same thing is not a conflict.
  const calls = check.calls.filter((c) => !sameValue(stationOf(local, c), stationOf(theirs, c)));
  const fields = check.fields;
  if (!calls.length && !fields.length) return { action: 'merge', net: mergeNets(base, local, theirs) };
  return { action: theirsWins(local, remote, order) ? 'conflict' : 'keep', net: theirs, calls, fields };
}

/**
 * Of two conflicting states, the one both sites keep: the one the server
 * received later. Each accepted net state gets a rising server sequence
 * (its docRev); a state of ours the server has not recorded yet will arrive
 * after theirs, so ours is the later one. Clocks do not matter, so a site
 * whose clock runs fast cannot win by it. Only when the remote state has no
 * server sequence (an older server) does the commit time decide, then the tag.
 */
export function theirsWins(local, remote, order = null) {
  const remoteSeq = Number(order?.remote);
  if (Number.isFinite(remoteSeq) && remoteSeq > 0) {
    const localSeq = Number(order?.local);
    if (!Number.isFinite(localSeq) || localSeq <= 0) return false; // ours reaches the server after theirs
    return remoteSeq > localSeq;
  }
  const mine = Number(local?.updatedAt) || 0;
  const theirs = Number(remote?.updatedAt ?? remote?.net?.updatedAt) || 0;
  if (theirs !== mine) return theirs > mine;
  return String(remote?.tag || '') >= netTag({ rev: local?.rev, updatedAt: local?.updatedAt });
}
