/**
 * useSharedIncident — keeps the EmComm layout in step with a shared incident
 * (server/routes/incident.js) while this browser has joined one.
 *
 * Owns the whole sync loop:
 *   - session (id, key, role, site label) persisted in localStorage, resumed
 *     on reload; an invite link (`/#incident=ID&key=KEY`) pre-fills Join
 *   - an EventSource per incident, opened with a one-time ticket (POST
 *     /ticket with the key in a header — the key never goes in a URL): a
 *     snapshot on connect, then live changes; every reconnect fetches a fresh
 *     ticket and resumes from the last seq, and a refused stream falls back to
 *     polling GET ?since= while it retries with backoff
 *   - mirroring what this browser observes (its server's net roster and the
 *     voice net, event log entries recorded after joining, field and shelter
 *     reports) into an outbox that is flushed to POST /sync, debounced; the
 *     outbox persists, survives being offline, and is flushed on reconnect
 *   - shared documents (ICS form drafts, the running net, net history) through
 *     src/utils/incidentDocs.js
 *   - admin actions (edit / delete records, rotate the join key) when this
 *     browser holds the admin key
 *   - merge by stable ids (src/utils/incidentSync.js), so nothing duplicates
 *     however often a record is replayed
 *
 * When no incident is joined it does nothing and the layout keeps its
 * local-only behaviour (localStorage event log, this server's roster).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeEvents, getEvents, recordEvent } from '../utils/emcommEventLog.js';
import {
  SESSION_KEY,
  OUTBOX_KEY,
  CACHE_KEY,
  CLIENT_ID_KEY,
  emptyIncidentState,
  applyIncidentDelta,
  incidentEventList,
  stateForCache,
  diffRosterForPush,
  rosterEntryForPush,
  fieldReportForPush,
  shelterReportForPush,
  eventForPush,
  emptyOutbox,
  queueOutbox,
  outboxBatch,
  outboxSize,
  ackOutbox,
  dropOutboxDocs,
  buildJoinUrl,
  parseJoinUrl,
  normaliseCode,
  makeClientId,
} from '../utils/incidentSync.js';
import * as incidentDocs from '../utils/incidentDocs.js';
import { withOutboxLock } from '../utils/outboxLock.js';

const OUTBOX_ID_KEY = 'openhamclock_incidentOutboxId';
// Set when the join key was changed under this browser: other tabs show the
// same "join again" prompt.
const REJOIN_KEY = 'openhamclock_incidentRejoin';
const FLUSH_DEBOUNCE_MS = 1000;
const FLUSH_BUSY_MS = 3000; // another tab is sending the outbox: check back
const RETRY_MS = [2000, 5000, 10000, 30000, 60000];
const POLL_FALLBACK_MS = 10000;
const CACHE_WRITE_MS = 2000;

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the session still works for this page load */
  }
};

function getClientId() {
  let id = null;
  try {
    id = localStorage.getItem(CLIENT_ID_KEY);
  } catch {
    /* ignore */
  }
  if (!id) {
    id = makeClientId();
    try {
      localStorage.setItem(CLIENT_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

async function api(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(`/api/incident${path}`, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Incident-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const goneMessage = (status) =>
  status === 404 ? 'This incident no longer exists on the server' : 'The incident id or join key was not accepted';
const REKEYED_MESSAGE = 'The incident admin changed the join key. Ask them for the new key and join again.';

/**
 * @param {object} opts
 * @param {string} opts.callsign       this station (attribution, presence, creator)
 * @param {Array}  opts.localRoster    this browser's roster (/api/aprs/net + voice net)
 * @param {string} opts.rosterBootId   /api/aprs/net bootId — tells a server restart from a real mass check-out
 * @param {Array}  opts.fieldReports   /api/emcomm/field-reports rows from this server
 * @param {Array}  opts.shelterReports /api/aprs/shelters reports from this server
 */
export function useSharedIncident({
  callsign = '',
  localRoster,
  rosterBootId = null,
  fieldReports,
  shelterReports,
} = {}) {
  const [session, setSession] = useState(() => readJson(SESSION_KEY, null));
  const [state, setState] = useState(() => {
    const s = readJson(SESSION_KEY, null);
    const cached = readJson(CACHE_KEY, null);
    return s && cached && cached.id === s.id && cached.state ? cached.state : emptyIncidentState();
  });
  const [status, setStatus] = useState(() => (readJson(SESSION_KEY, null) ? 'connecting' : 'idle'));
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => outboxSize(readJson(OUTBOX_KEY, null)));
  const [invite, setInvite] = useState(null);
  const [docsReady, setDocsReady] = useState(false);

  const clientId = useMemo(getClientId, []);
  // This tab (clientId is per browser, shared by its tabs).
  const tabId = useMemo(makeClientId, []);
  const outboxRef = useRef(readJson(OUTBOX_KEY, null) || emptyOutbox());
  const outboxIdRef = useRef(readJson(OUTBOX_ID_KEY, null));
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const callsignRef = useRef(callsign);
  stateRef.current = state;
  sessionRef.current = session;
  callsignRef.current = callsign;

  const flushTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const inFlightRef = useRef(false);
  const goneRef = useRef(false);
  const rosterPrevRef = useRef(null);
  const pushedEventsRef = useRef(new Set());
  const pushedReportsRef = useRef(new Set());
  const flushRef = useRef(null);

  // ── Outbox ────────────────────────────────────────────────────────────────
  const saveOutbox = useCallback(() => {
    const size = outboxSize(outboxRef.current);
    writeJson(OUTBOX_KEY, size ? outboxRef.current : null);
    writeJson(OUTBOX_ID_KEY, size ? outboxIdRef.current : null);
    setPending(size);
  }, []);

  const scheduleFlush = useCallback((delay = FLUSH_DEBOUNCE_MS) => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushRef.current?.();
    }, delay);
  }, []);

  /**
   * The outbox is shared by every tab of this browser (localStorage), so it
   * is always read fresh before a change; this tab's copy is only the
   * fallback when storage is unavailable.
   */
  const readSharedOutbox = useCallback(() => {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      return raw ? JSON.parse(raw) : emptyOutbox();
    } catch {
      return outboxRef.current;
    }
  }, []);

  const enqueue = useCallback(
    (items) => {
      outboxIdRef.current = sessionRef.current?.id || outboxIdRef.current;
      outboxRef.current = queueOutbox(readSharedOutbox(), items);
      saveOutbox();
      scheduleFlush();
    },
    [saveOutbox, scheduleFlush, readSharedOutbox],
  );

  const markGone = useCallback((message) => {
    goneRef.current = true;
    setStatus('error');
    setError(message);
  }, []);

  /**
   * The join key changed under an operator: stop syncing but keep the outbox,
   * so rejoining the same incident with the new key sends what was waiting.
   */
  const suspendForRekey = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    goneRef.current = true;
    sessionRef.current = null;
    writeJson(REJOIN_KEY, { id: s.id, site: s.site || '' });
    writeJson(SESSION_KEY, null);
    setSession(null);
    setState(emptyIncidentState());
    setStatus('idle');
    setError(REKEYED_MESSAGE);
    setInvite({ id: s.id, key: '', site: s.site || '' });
  }, []);

  /** Admin: keep the session's copy of the current join key in step with the server. */
  const noteJoinKey = useCallback((joinKey) => {
    const cur = sessionRef.current;
    if (!cur || cur.role !== 'admin' || !joinKey || cur.joinKey === joinKey) return;
    const next = { ...cur, joinKey };
    sessionRef.current = next;
    writeJson(SESSION_KEY, next);
    setSession(next);
  }, []);

  /** One send of the shared outbox. Runs only while this tab holds the outbox lock. */
  const flushOnce = async (s) => {
    // Another tab may have sent (and acked) part of it already.
    outboxRef.current = readSharedOutbox();
    const batch = outboxBatch(outboxRef.current);
    if (!batch) return;
    const res = await api(`/${encodeURIComponent(s.id)}/sync`, {
      method: 'POST',
      key: s.key,
      body: { clientId, call: callsignRef.current, site: s.site || '', ...batch },
    });
    if (sessionRef.current?.id !== s.id) return; // left or switched while in flight
    // What the server took: ack it (re-read — this or another tab may have
    // queued more meanwhile), and base any document queued on top of ours
    // on the revision ours just got.
    const settle = (data) => {
      let next = ackOutbox(readSharedOutbox(), batch);
      for (const [docId, rev] of Object.entries(data?.docRevs || {})) {
        const sent = (batch.docs || []).find((d) => d.id === docId);
        incidentDocs.noteAccepted(docId, rev, sent?.data);
        const queued = next.docs?.[docId];
        if (queued && sent && queued.baseRev === sent.baseRev) {
          next = { ...next, docs: { ...next.docs, [docId]: { ...queued, baseRev: rev } } };
        }
      }
      outboxRef.current = next;
      saveOutbox();
      retryAttemptRef.current = 0;
      if (outboxSize(outboxRef.current)) scheduleFlush();
    };
    if (res.ok) {
      settle(res.data);
    } else if (res.status === 409 && Array.isArray(res.data?.conflicts)) {
      // Everything else in the batch was applied. A document we wrote on top
      // of an older revision was refused: show theirs, keep ours aside.
      settle(res.data);
      for (const c of res.data.conflicts) {
        const sent = (batch.docs || []).find((d) => d.id === c.id);
        let mine = sent?.data;
        const queued = outboxRef.current.docs?.[c.id];
        if (queued) {
          // A newer local copy, made from the same stale base: that is "mine" now.
          mine = queued.data;
          const { [c.id]: _gone, ...rest } = outboxRef.current.docs;
          outboxRef.current = { ...outboxRef.current, docs: rest };
          saveOutbox();
        }
        setState((st) => applyIncidentDelta(st, { docs: [c.current] }));
        incidentDocs.docConflict(c.id, mine, c.current);
      }
    } else if (res.status === 413) {
      // A shared document is too large for this server: keep everything else.
      outboxRef.current = dropOutboxDocs(readSharedOutbox());
      saveOutbox();
      setError(res.data?.error || 'A shared document is too large for this server and was not shared');
      scheduleFlush();
    } else if (res.status === 403 && s.role !== 'admin' && s.keyGen != null) {
      suspendForRekey();
    } else if (res.status === 403 || res.status === 404) {
      markGone(goneMessage(res.status));
    } else {
      throw new Error(res.data?.error || `HTTP ${res.status}`);
    }
  };

  flushRef.current = async () => {
    const s = sessionRef.current;
    if (!s || inFlightRef.current || goneRef.current) return;
    inFlightRef.current = true;
    try {
      // One tab sends at a time (Web Locks, or a localStorage lease where
      // that API is missing). When another tab holds it, it is sending the
      // same outbox; look again shortly in case it stops.
      const ran = await withOutboxLock(() => flushOnce(s), {
        locks: typeof navigator !== 'undefined' ? navigator.locks : undefined,
        storage: typeof localStorage !== 'undefined' ? localStorage : null,
        owner: tabId,
      });
      if (!ran) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => flushRef.current?.(), FLUSH_BUSY_MS);
      }
    } catch {
      // Offline or server busy: keep everything, try again with backoff.
      const delay = RETRY_MS[Math.min(retryAttemptRef.current++, RETRY_MS.length - 1)];
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => flushRef.current?.(), delay);
    } finally {
      inFlightRef.current = false;
    }
  };

  // ── Invite link (#incident=…&key=…) ───────────────────────────────────────
  useEffect(() => {
    const parsed = parseJoinUrl(typeof window !== 'undefined' ? window.location.hash : '');
    if (!parsed) return;
    try {
      // Take the key out of the address bar (and so out of history and screenshots).
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
    if (sessionRef.current?.id !== parsed.id) setInvite(parsed);
  }, []);

  // ── Live stream ───────────────────────────────────────────────────────────
  const sessionId = session?.id || null;
  const sessionKey = session?.key || null;
  useEffect(() => {
    if (!sessionId || !sessionKey) return undefined;
    goneRef.current = false;
    let closed = false;
    let es = null;
    let reconnectTimer = null;
    let attempt = 0;

    const apply = (data) => {
      setState((s) => applyIncidentDelta(s, data));
      if (data?.full || data?.docs) setDocsReady(true);
    };
    const parse = (e) => {
      try {
        return JSON.parse(e.data);
      } catch {
        return null;
      }
    };
    const retryLater = (delay) => {
      if (closed || goneRef.current) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(open, delay);
    };
    const nextDelay = () => RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
    const authFailed = (code) => {
      if (code === 403 && sessionRef.current?.role !== 'admin' && sessionRef.current?.keyGen != null) suspendForRekey();
      else markGone(goneMessage(code));
    };

    const open = async () => {
      if (closed || goneRef.current) return;
      if (typeof EventSource === 'undefined') {
        probe();
        return;
      }
      let ticket;
      try {
        const res = await api(`/${encodeURIComponent(sessionId)}/ticket`, {
          method: 'POST',
          key: sessionKey,
          body: { clientId },
        });
        if (closed) return;
        if (res.status === 403 || res.status === 404) return authFailed(res.status);
        if (!res.ok) return probe();
        ticket = res.data.ticket;
      } catch {
        if (!closed) setStatus('offline');
        return retryLater(nextDelay());
      }
      const qs = new URLSearchParams({ ticket, clientId, since: String(stateRef.current.seq || 0) });
      if (callsignRef.current) qs.set('call', callsignRef.current);
      es = new EventSource(`/api/incident/${encodeURIComponent(sessionId)}/stream?${qs}`);
      es.addEventListener('snapshot', (e) => {
        const d = parse(e);
        if (d) apply(d);
        if (d?.joinKey) noteJoinKey(d.joinKey);
        attempt = 0;
        setStatus('live');
        setError(null);
        flushRef.current?.(); // anything buffered while we were away
      });
      es.addEventListener('change', (e) => {
        const d = parse(e);
        if (d) apply(d);
      });
      es.addEventListener('presence', (e) => {
        const d = parse(e);
        if (d && Number.isFinite(d.participants)) setState((s) => ({ ...s, participants: d.participants }));
      });
      es.addEventListener('rekeyed', (e) => {
        const d = parse(e) || {};
        if (sessionRef.current?.role === 'admin') {
          if (d.joinKey) {
            const next = { ...sessionRef.current, joinKey: d.joinKey, keyGen: d.keyGen };
            sessionRef.current = next;
            writeJson(SESSION_KEY, next);
            setSession(next);
          }
          return;
        }
        es?.close();
        es = null;
        suspendForRekey();
      });
      es.addEventListener('expired', () => {
        markGone('This incident expired on the server');
        es?.close();
      });
      es.onerror = () => {
        if (closed) return;
        // A ticket is single-use, so never let the browser reconnect with the
        // same URL: close, and open again with a fresh ticket.
        es?.close();
        es = null;
        setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting');
        retryLater(nextDelay());
      };
    };

    // The stream was refused or is unavailable: poll once, retry later.
    const probe = async () => {
      let delay = nextDelay();
      try {
        const qs = new URLSearchParams({ since: String(stateRef.current.seq || 0), clientId });
        const res = await api(`/${encodeURIComponent(sessionId)}?${qs}`, { key: sessionKey });
        if (closed) return;
        if (res.status === 403 || res.status === 404) return authFailed(res.status);
        if (res.ok) {
          apply(res.data);
          if (res.data?.joinKey) noteJoinKey(res.data.joinKey);
          setStatus('live');
          setError(null);
          flushRef.current?.();
          delay = Math.min(delay, POLL_FALLBACK_MS); // too many listeners: keep polling
        } else {
          setStatus('connecting');
        }
      } catch {
        if (!closed) setStatus('offline');
      }
      retryLater(delay);
    };

    const onOnline = () => {
      flushRef.current?.();
      if (!es && !closed) {
        clearTimeout(reconnectTimer);
        open();
      }
    };
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    setStatus('connecting');
    open();
    return () => {
      closed = true;
      es?.close();
      clearTimeout(reconnectTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [sessionId, sessionKey, clientId, markGone, suspendForRekey, noteJoinKey]);

  // Other tabs of this browser: joining, leaving, a key change or a rotation
  // there takes effect here too (the session lives in localStorage).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== SESSION_KEY && e.key !== null) return;
      const next = readJson(SESSION_KEY, null);
      const cur = sessionRef.current;
      if (!next) {
        if (!cur) return;
        sessionRef.current = null;
        setSession(null);
        setState(emptyIncidentState());
        setDocsReady(false);
        setStatus('idle');
        outboxRef.current = readJson(OUTBOX_KEY, null) || emptyOutbox();
        setPending(outboxSize(outboxRef.current));
        const rejoin = readJson(REJOIN_KEY, null);
        if (rejoin?.id === cur.id) {
          setError(REKEYED_MESSAGE);
          setInvite({ id: rejoin.id, key: '', site: rejoin.site || '' });
        } else {
          setError(null);
        }
        return;
      }
      if (!cur || cur.id !== next.id || cur.key !== next.key) {
        const cached = readJson(CACHE_KEY, null);
        goneRef.current = false;
        rosterPrevRef.current = null;
        pushedEventsRef.current = new Set();
        pushedReportsRef.current = new Set();
        sessionRef.current = next;
        setSession(next);
        setState(cached?.id === next.id && cached.state ? cached.state : emptyIncidentState());
        setDocsReady(false);
        setStatus('connecting');
        setError(null);
        setInvite(null);
        return;
      }
      if (next.joinKey !== cur.joinKey || next.keyGen !== cur.keyGen || next.site !== cur.site) {
        sessionRef.current = next;
        setSession(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Flush/retry timers die with the component.
  useEffect(
    () => () => {
      clearTimeout(flushTimerRef.current);
      clearTimeout(retryTimerRef.current);
      flushTimerRef.current = null;
    },
    [],
  );

  // Cache the shared picture so a reload with no connection still shows it.
  useEffect(() => {
    if (!sessionId) return undefined;
    const t = setTimeout(() => writeJson(CACHE_KEY, { id: sessionId, state: stateForCache(state) }), CACHE_WRITE_MS);
    return () => clearTimeout(t);
  }, [sessionId, state]);

  // ── Shared documents (ICS drafts, Net Control) ───────────────────────────
  // Attach once the server's copy is known, so a local running net never
  // overwrites the incident's own.
  const publishDoc = useCallback(
    (id, data, extra = {}) => {
      // extra.baseRev: the server revision this copy was made from (conditional write)
      const doc = { id, data, updatedAt: Date.now(), by: callsignRef.current || '', ...extra };
      setState((s) => applyIncidentDelta(s, { docs: [doc] }));
      enqueue({ docs: [doc] });
    },
    [enqueue],
  );
  useEffect(() => {
    if (!sessionId || !docsReady) return undefined;
    incidentDocs.attach({
      docs: stateRef.current.docs,
      publish: publishDoc,
      origin: { site: sessionRef.current?.site || '', call: callsignRef.current || '' },
    });
    return () => incidentDocs.detach();
  }, [sessionId, docsReady, publishDoc]);
  const stateDocs = state.docs;
  useEffect(() => {
    if (sessionId && docsReady) incidentDocs.receive(stateDocs);
  }, [sessionId, docsReady, stateDocs]);

  // ── Mirroring: what this browser sees → the incident ─────────────────────
  // Event log: entries recorded after joining (ts may be older — recordedAt is not).
  useEffect(() => {
    if (!sessionId) return undefined;
    const pushNew = (events) => {
      if (!sessionRef.current) return; // left: later entries stay local
      const joinedAt = sessionRef.current.joinedAt || 0;
      const known = stateRef.current.events || {};
      const fresh = [];
      for (const ev of events || []) {
        if ((ev.recordedAt || 0) < joinedAt || known[ev.id] || pushedEventsRef.current.has(ev.id)) continue;
        pushedEventsRef.current.add(ev.id);
        fresh.push(eventForPush(ev));
      }
      if (fresh.length) enqueue({ events: fresh });
    };
    pushNew(getEvents());
    return subscribeEvents(pushNew);
  }, [sessionId, enqueue]);

  // Roster: check-ins, status changes, check-outs (restart-aware via the boot id).
  useEffect(() => {
    if (!sessionId || !Array.isArray(localRoster)) return;
    const { push, next } = diffRosterForPush(
      rosterPrevRef.current,
      localRoster,
      stateRef.current,
      Date.now(),
      rosterBootId,
    );
    rosterPrevRef.current = next;
    if (push.length) enqueue({ roster: push });
  }, [sessionId, localRoster, rosterBootId, enqueue]);

  // Field and shelter reports from this server.
  useEffect(() => {
    if (!sessionId) return;
    const known = stateRef.current.reports || {};
    const fresh = [
      ...(fieldReports || []).map(fieldReportForPush),
      ...(shelterReports || []).filter((s) => s?.from).map(shelterReportForPush),
    ].filter((r) => !known[r.id] && !pushedReportsRef.current.has(r.id));
    if (!fresh.length) return;
    for (const r of fresh) pushedReportsRef.current.add(r.id);
    enqueue({ reports: fresh });
  }, [sessionId, fieldReports, shelterReports, enqueue]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const adopt = useCallback(
    ({ id, key, role, joinKey = '', site, snapshot }) => {
      if (outboxIdRef.current && outboxIdRef.current !== id) {
        outboxRef.current = emptyOutbox(); // a different incident: drop the other one's buffer
      }
      outboxIdRef.current = id;
      saveOutbox();
      const next = {
        id,
        key,
        role: role === 'admin' ? 'admin' : 'operator',
        joinKey: role === 'admin' ? joinKey : key,
        keyGen: 1,
        site: String(site || '').trim(),
        joinedAt: Date.now(),
      };
      writeJson(SESSION_KEY, next);
      writeJson(REJOIN_KEY, null);
      rosterPrevRef.current = null;
      pushedEventsRef.current = new Set();
      pushedReportsRef.current = new Set();
      goneRef.current = false;
      sessionRef.current = next;
      setSession(next);
      setState(applyIncidentDelta(emptyIncidentState(), { ...snapshot, role: next.role }));
      setDocsReady(true);
      setError(null);
      setInvite(null);
      setStatus('connecting');
      recordEvent('incident_note', {
        callsign: callsignRef.current || '',
        summary: `Joined incident ${snapshot?.board?.name || id}${next.role === 'admin' ? ' as admin' : ''}`,
        details: next.site ? `Site: ${next.site}` : '',
      });
      flushRef.current?.(); // a rejoin after a key change sends what was waiting
    },
    [saveOutbox],
  );

  const create = useCallback(
    async ({ name, ic, netFreq, notes, site } = {}) => {
      const res = await api('', {
        method: 'POST',
        body: { name, ic, netFreq, notes, clientId, call: callsignRef.current },
      });
      if (!res.ok) throw new Error(res.data?.error || `HTTP ${res.status}`);
      adopt({
        id: res.data.id,
        key: res.data.adminKey,
        role: 'admin',
        joinKey: res.data.joinKey,
        site,
        snapshot: res.data.incident,
      });
      return res.data;
    },
    [adopt, clientId],
  );

  const join = useCallback(
    async (rawId, rawKey, site) => {
      const id = normaliseCode(rawId);
      const key = normaliseCode(rawKey);
      if (!id || !key) throw new Error('Enter the incident id and join key');
      const res = await api(`/${encodeURIComponent(id)}/join`, {
        method: 'POST',
        key,
        body: { clientId, call: callsignRef.current },
      });
      if (!res.ok) throw new Error(res.data?.error || `HTTP ${res.status}`);
      adopt({ id, key, role: res.data.role, joinKey: res.data.joinKey || '', site, snapshot: res.data.incident });
      return res.data;
    },
    [adopt, clientId],
  );

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    writeJson(SESSION_KEY, null);
    writeJson(REJOIN_KEY, null);
    writeJson(CACHE_KEY, null);
    outboxRef.current = emptyOutbox();
    outboxIdRef.current = null;
    saveOutbox();
    clearTimeout(flushTimerRef.current);
    clearTimeout(retryTimerRef.current);
    flushTimerRef.current = null;
    rosterPrevRef.current = null;
    setSession(null);
    setState(emptyIncidentState());
    setDocsReady(false);
    setStatus('idle');
    setError(null);
    setInvite(null);
    if (!s) return;
    recordEvent('incident_note', { callsign: callsignRef.current || '', summary: `Left incident ${s.id}` });
    try {
      await api(`/${encodeURIComponent(s.id)}/leave`, { method: 'POST', key: s.key, body: { clientId } });
    } catch {
      /* presence times out on its own */
    }
  }, [clientId, saveOutbox]);

  const updateBoard = useCallback(
    (board) => {
      if (sessionRef.current?.role !== 'admin') return;
      const now = Date.now();
      const next = {
        name: board?.name || '',
        ic: board?.ic || '',
        netFreq: board?.netFreq || '',
        notes: board?.notes || '',
        updatedAt: now,
      };
      setState((s) => ({ ...s, board: { ...(s.board || {}), ...next } }));
      enqueue({ board: next });
      recordEvent('incident_note', {
        callsign: callsignRef.current || '',
        summary: 'Incident board updated',
        details: [next.name, next.ic && `IC ${next.ic}`, next.netFreq && `Net ${next.netFreq}`]
          .filter(Boolean)
          .join(' · '),
      });
    },
    [enqueue],
  );

  /** Manual (voice / in-person) check-in straight into the shared roster. */
  const checkIn = useCallback(
    ({ call, status: opStatus, netName } = {}) => {
      const c = String(call || '')
        .trim()
        .toUpperCase();
      if (!c) return;
      const now = Date.now();
      const entry = rosterEntryForPush(
        {
          call: c,
          netName: netName || stateRef.current.board?.name || '',
          status: String(opStatus || '').trim() || 'Checked in',
          checkinTime: now,
          lastHeard: now,
          source: 'manual',
        },
        now,
      );
      setState((s) => applyIncidentDelta(s, { roster: [entry] }));
      enqueue({ roster: [entry] });
      recordEvent('net_checkin', {
        callsign: c,
        summary: `Checked into ${entry.netName || 'net'}`,
        details: entry.status !== 'Checked in' ? entry.status : '',
        ts: now,
        dedupeKey: `${c}-${now}`,
      });
    },
    [enqueue],
  );

  // `log: false` when the caller records its own event (a roster removal, #1238)
  const checkOut = useCallback(
    (call, known, { log = true } = {}) => {
      const c = String(call || '')
        .trim()
        .toUpperCase();
      if (!c) return;
      const now = Date.now();
      const base = stateRef.current.roster?.[c] || known || { call: c };
      const entry = {
        ...rosterEntryForPush({ ...base, call: c }, now),
        status: 'Checked out',
        checkedOut: true,
      };
      setState((s) => applyIncidentDelta(s, { roster: [entry] }));
      enqueue({ roster: [entry] });
      if (!log) return;
      recordEvent('net_checkout', {
        callsign: c,
        summary: 'Checked out of net',
        dedupeKey: `${c}-${base.checkinTime || now}-out`,
      });
    },
    [enqueue],
  );

  // ── Admin ────────────────────────────────────────────────────────────────
  const adminCall = useCallback(async (path, body) => {
    const s = sessionRef.current;
    if (!s || s.role !== 'admin') throw new Error('This needs the incident’s admin key');
    const res = await api(`/${encodeURIComponent(s.id)}/${path}`, { method: 'POST', key: s.key, body });
    if (!res.ok) throw new Error(res.data?.error || `HTTP ${res.status}`);
    return res.data;
  }, []);

  /** Edit an event or report in place: kind 'event' | 'report', fields to change. */
  const editRecord = useCallback(
    async (kind, id, fields) => {
      const key = kind === 'report' ? 'reports' : 'events';
      await adminCall('admin', { edit: { [key]: [{ ...fields, id }] } });
      const cur = stateRef.current[key]?.[id];
      if (cur) setState((s) => applyIncidentDelta(s, { [key]: [{ ...cur, ...fields, rev: (cur.rev || 0) + 1 }] }));
    },
    [adminCall],
  );

  const deleteRecord = useCallback(
    async (kind, id) => {
      const key = kind === 'report' ? 'reports' : 'events';
      await adminCall('admin', { delete: { [key]: [id] } });
      setState((s) => applyIncidentDelta(s, { deleted: [{ kind: kind === 'report' ? 'report' : 'event', id }] }));
    },
    [adminCall],
  );

  /** New join key; operators are disconnected until they rejoin with it. → the new key */
  const rotateJoinKey = useCallback(async () => {
    const out = await adminCall('rotate', {});
    const next = { ...sessionRef.current, joinKey: out.joinKey, keyGen: out.keyGen };
    sessionRef.current = next;
    writeJson(SESSION_KEY, next);
    setSession(next);
    recordEvent('incident_note', { callsign: callsignRef.current || '', summary: 'Incident join key changed' });
    return out.joinKey;
  }, [adminCall]);

  const stateEvents = state.events;
  const events = useMemo(() => incidentEventList({ events: stateEvents }), [stateEvents]);
  const joinUrl = useMemo(
    () =>
      session?.joinKey && typeof window !== 'undefined'
        ? buildJoinUrl(window.location.origin, session.id, session.joinKey)
        : '',
    [session],
  );

  return {
    joined: !!session,
    session,
    role: session?.role || null,
    isAdmin: session?.role === 'admin',
    status,
    error,
    pending,
    participants: state.participants || 0,
    board: state.board,
    state,
    events,
    joinUrl,
    invite,
    clearInvite: () => setInvite(null),
    create,
    join,
    leave,
    updateBoard,
    checkIn,
    checkOut,
    editRecord,
    deleteRecord,
    rotateJoinKey,
  };
}

export default useSharedIncident;
