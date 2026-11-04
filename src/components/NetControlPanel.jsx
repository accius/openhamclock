/**
 * NetControlPanel — run a voice net on a repeater or simplex frequency
 * (dockable panel `net-control`, also in the EmComm layout's rail).
 *
 *   • Start: pick a net from the Net Schedule or type name / frequency /
 *     net control callsign, and a script template. Running timer and
 *     check-in counter.
 *   • Check-in line: type a callsign (+ optional flag letters) and Enter.
 *     Name/location fill from remembered stations, the logbook, then the
 *     callbook. Re-checks move a station to the top; duplicates are ignored.
 *   • Traffic queue with Next / Passed, logged to the EmComm event log.
 *     Undo of a logged action writes a compensating "withdrawn" entry.
 *   • Named script templates (preamble / closing) with placeholders and a
 *     read-aloud view.
 *   • Close → report (copy text, CSV, print; UTC or UTC + local time),
 *     history of past nets.
 *   • Every change goes through commit(): the running net carries a
 *     revision counter, and other tabs / panels are told through `storage`
 *     events and a BroadcastChannel, so they stay in step and a stale panel
 *     can never overwrite a newer net.
 *
 * All logic lives in utils/netControl.js; this component only wires state,
 * storage and side effects (event log, callbook lookups, downloads).
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FLAG_DEFS,
  parseCheckin,
  createNet,
  checkIn,
  checkOut,
  toggleFlag,
  updateStation,
  removeStation,
  undoLast,
  peekUndo,
  attachEvent,
  withdrawalSummary,
  trafficQueue,
  passTraffic,
  nextTraffic,
  closeNet,
  buildReport,
  reportToText,
  reportToCsv,
  reportToPrintHtml,
  historyToCsv,
  flagsToText,
  formatElapsed,
  formatDuration,
  fmtLocalDateTime,
  fillTemplate,
  scriptContext,
  stationFromLogbook,
  stationFromLookup,
  loadRunningNet,
  readRunningNetRecord,
  commitRunningNet,
  pickNewer,
  rebaseCheck,
  bandPlanRegion,
  parseNetFrequency,
  formatOffset,
  livePeerCount,
  PEER_TTL_MS,
  NET_CONTROL_KEY,
  NET_CONTROL_HISTORY_KEY,
  NET_CONTROL_SCRIPTS_KEY,
  NET_CONTROL_CHANNEL,
  loadHistory,
  saveHistory,
  pushHistory,
  loadScriptTemplates,
  saveScriptTemplates,
  getTemplate,
  addTemplate,
  duplicateTemplate,
  renameTemplate,
  updateTemplate,
  deleteTemplate,
  builtinDefault,
  loadStationCache,
  saveStationCache,
  rememberStation,
  saveRosterSnapshot,
} from '../utils/netControl.js';
import { loadNetSchedule, sortByNextOccurrence } from '../utils/netSchedule.js';
import { formatMemoryFreq } from '../utils/freqMemories.js';
import { recordEvent } from '../utils/emcommEventLog.js';
import {
  NET_REMOTE_CONFLICT_EVENT,
  NET_CONFLICTS_CHANGED_EVENT,
  CONFLICTS_KEY,
  loadNetConflicts,
  dismissNetConflict,
} from '../utils/incidentNetBridge.js';
import { applyMineStation, applyMineField } from '../utils/incidentNetMerge.js';
import { StationConflictChip, NetConflictBar } from './NetConflictChip.jsx';
import { apiFetch } from '../utils/apiFetch.js';
import { callbookAuthHeaders } from '../utils/callbookAuth.js';
import { spellPhonetic } from '../utils/phonetics.js';
import { init as initLogbook, getAll as getLogbookQsos } from '../services/logbookStore.js';

const ACCENT = '#14b8a6';
const REPORT_TIMES_KEY = 'openhamclock_netControlReportTimes';
const HEARTBEAT_MS = 5000;

const inputStyle = {
  padding: '4px 6px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '10px',
  padding: '2px 6px',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
};

const primaryBtn = { ...btnStyle, borderColor: ACCENT, color: ACCENT, fontWeight: 700 };
const dangerBtn = { ...btnStyle, borderColor: '#ef4444', color: '#ef4444' };

const fmtUtcHHMM = (ts) => (ts == null ? '' : new Date(ts).toISOString().substring(11, 16));
const fmtDateTime = (ts, timeZone) => {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(ts).toISOString().substring(0, 16).replace('T', ' ');
  }
};

const baseCallOf = (call) => String(call || '').split('/')[0];

const readLocal = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

const downloadText = (text, filename, type = 'text/csv;charset=utf-8') => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const printHtml = (html) => {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
};

const fileSlug = (s) =>
  String(s || 'net')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'net';

const newInstanceId = () => `ncp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function FlagPill({ def, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        background: active ? def.color : 'transparent',
        color: active ? '#000' : 'var(--text-muted)',
        border: `1px solid ${active ? def.color : 'var(--border-color)'}`,
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: 700,
        padding: '0 4px',
        lineHeight: '14px',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {def.short}
    </button>
  );
}

export default function NetControlPanel({ callsign = '', embedded = false, timeZone = '', location = null }) {
  const { t } = useTranslation();
  const tz = timeZone || undefined;
  // Band-plan region for standard repeater offsets, from the station location
  const region = bandPlanRegion(location);

  // ── State ─────────────────────────────────────────────────────────────
  const [net, setNet] = useState(loadRunningNet);
  const netRef = useRef(net);
  const [history, setHistory] = useState(loadHistory);
  const [scripts, setScripts] = useState(loadScriptTemplates);
  const [view, setView] = useState('roster'); // roster | script | report | history
  const [reportNet, setReportNet] = useState(null); // closed net shown in the report view
  const [reportTimes, setReportTimes] = useState(() =>
    readLocal(REPORT_TIMES_KEY, 'utc') === 'both' ? 'both' : 'utc',
  );
  const [input, setInput] = useState('');
  const [pendingFlags, setPendingFlags] = useState([]);
  const [flash, setFlash] = useState(null); // { text, color }
  const [now, setNow] = useState(() => Date.now());
  const [scriptPart, setScriptPart] = useState('preamble');
  const [scriptDraft, setScriptDraft] = useState(null); // { id, name, preamble, closing } while editing
  const [readAloud, setReadAloud] = useState(false);
  const [startForm, setStartForm] = useState(() => ({
    scheduleId: '',
    name: '',
    frequency: '',
    ncs: callsign || '',
    freqMhz: null,
    mode: '',
    offset: '',
  }));
  const [schedule, setSchedule] = useState(loadNetSchedule);
  const [peers, setPeers] = useState({}); // other Net Control panels: { instanceId: lastSeenMs }
  const inputRef = useRef(null);
  const flashTimer = useRef(null);
  const stationCacheRef = useRef(null);
  const lookupsInFlight = useRef(new Set());
  const channelRef = useRef(null);
  const instanceId = useRef(null);
  if (!instanceId.current) instanceId.current = newInstanceId();
  const running = !!net;

  const showFlash = useCallback((text, color = ACCENT) => {
    setFlash({ text, color });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  const broadcast = useCallback((type) => {
    try {
      channelRef.current?.postMessage({ type, from: instanceId.current });
    } catch {
      /* channel closed */
    }
  }, []);

  /**
   * The single write path for the running net. `change` is the next net
   * (or null to close), or an operation `(net) => next` — preferred, because
   * an operation can be re-applied: when another tab or panel wrote first and
   * the two changes touched different stations (rebaseCheck), the operation
   * runs again on the newer net and is saved without bothering the operator.
   * Only when both changed the same station (or the net was closed or
   * replaced) is the change refused, naming the station. Returns
   * { ok, net, rebased?, calls? }.
   */
  const commit = useCallback(
    (change, { rebase = true } = {}) => {
      const isOp = typeof change === 'function';
      let base = netRef.current;
      let next = isOp ? change(base) : change;
      if (next === base) return { ok: true, net: base };
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = commitRunningNet(base, next);
        netRef.current = res.net;
        setNet(res.net);
        if (!res.conflict) {
          if (res.net) saveRosterSnapshot(res.net, { active: true });
          broadcast('net');
          return { ok: true, net: res.net, rebased: attempt > 0 };
        }
        const check = isOp && rebase ? rebaseCheck(base, next, res.net) : { ok: false, calls: [] };
        if (!check.ok) {
          showFlash(
            check.calls.length
              ? t('netControl.conflictCalls', {
                  defaultValue: '{{calls}} was changed in another tab too — check it and try again',
                  calls: check.calls.join(', '),
                })
              : t('netControl.conflict', { defaultValue: 'Changed in another tab — updated, please try again' }),
            '#f59e0b',
          );
          return { ok: false, net: res.net, calls: check.calls };
        }
        base = res.net;
        next = change(base);
        if (next === base) return { ok: true, net: base, rebased: true };
      }
      showFlash(
        t('netControl.conflict', { defaultValue: 'Changed in another tab — updated, please try again' }),
        '#f59e0b',
      );
      return { ok: false, net: netRef.current };
    },
    [broadcast, showFlash, t],
  );

  // Shared incident: our version of lines another site changed at the same
  // moment ("your change" chips), for one-click "Apply mine".
  const [conflicts, setConflicts] = useState(() => loadNetConflicts());
  useEffect(() => {
    const refresh = () => setConflicts(loadNetConflicts());
    const onStorage = (e) => {
      if (e.key === CONFLICTS_KEY || e.key === null) refresh();
    };
    window.addEventListener(NET_CONFLICTS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(NET_CONFLICTS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Shared incident: the same station was changed at another site at the
  // same moment. Their version was kept; say so, naming the site.
  useEffect(() => {
    const onConflict = (e) => {
      const { calls = [], site = '' } = e.detail || {};
      const where = site || t('netControl.anotherSite', { defaultValue: 'another site' });
      showFlash(
        calls.length
          ? t('netControl.conflictSite', {
              defaultValue: '{{calls}} was changed at {{site}} too — check it and try again',
              calls: calls.join(', '),
              site: where,
            })
          : t('netControl.conflictSiteNet', {
              defaultValue: 'The net was changed at {{site}} too — updated, please check',
              site: where,
            }),
        '#f59e0b',
      );
    };
    window.addEventListener(NET_REMOTE_CONFLICT_EVENT, onConflict);
    return () => window.removeEventListener(NET_REMOTE_CONFLICT_EVENT, onConflict);
  }, [showFlash, t]);

  // "Your change" entries for the running net, and putting one back through
  // the normal commit path (so it rebases and syncs like any other edit).
  const pendingConflicts = conflicts && net && conflicts.netId === net.id ? conflicts : null;
  const applyMine = (kind, key) => {
    const entry = pendingConflicts?.[kind === 'field' ? 'fields' : 'calls']?.[key];
    if (!entry) return;
    const res = commit((n) =>
      kind === 'field' ? applyMineField(n, key, entry.mine) : applyMineStation(n, key, entry.mine),
    );
    if (res.ok) dismissNetConflict(kind, key);
  };

  /** Pick up a newer running net written elsewhere. */
  const syncFromStorage = useCallback(() => {
    const { net: next, changed } = pickNewer(netRef.current, readRunningNetRecord());
    if (!changed) return;
    const closedHere = netRef.current && !next;
    netRef.current = next;
    setNet(next);
    if (closedHere) {
      showFlash(t('netControl.closedElsewhere', { defaultValue: 'The net was closed in another tab' }), '#f59e0b');
    }
  }, [showFlash, t]);

  // ── Effects ───────────────────────────────────────────────────────────
  // Logbook feeds name/location fills; init is idempotent.
  useEffect(() => {
    initLogbook().catch(() => {});
  }, []);

  // Running-net timer
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // The channel effect below runs once per mount; it reaches the current
  // sync function through a ref (re-subscribing on every render would re-send
  // "hello" and ping-pong with the other panels).
  const syncRef = useRef(syncFromStorage);
  syncRef.current = syncFromStorage;

  // Other tabs: storage events. Other panels (this tab too): BroadcastChannel,
  // which also carries the presence hello / ping / bye.
  useEffect(() => {
    const sync = () => syncRef.current();
    const onStorage = (e) => {
      if (e.key === NET_CONTROL_KEY || e.key === null) sync();
      if (e.key === NET_CONTROL_HISTORY_KEY || e.key === null) setHistory(loadHistory());
      if (e.key === NET_CONTROL_SCRIPTS_KEY || e.key === null) setScripts(loadScriptTemplates());
    };
    window.addEventListener('storage', onStorage);
    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(NET_CONTROL_CHANNEL);
      } catch {
        channel = null;
      }
    }
    channelRef.current = channel;
    const me = instanceId.current;
    const seen = (from) => setPeers((p) => ({ ...p, [from]: Date.now() }));
    if (channel) {
      channel.onmessage = (e) => {
        const msg = e.data || {};
        if (!msg.from || msg.from === me) return;
        if (msg.type === 'net') sync();
        else if (msg.type === 'history') setHistory(loadHistory());
        else if (msg.type === 'scripts') setScripts(loadScriptTemplates());
        if (msg.type === 'bye') {
          setPeers((p) => {
            const { [msg.from]: _gone, ...rest } = p;
            return rest;
          });
          return;
        }
        seen(msg.from);
        if (msg.type === 'hello') channel.postMessage({ type: 'ping', from: me });
      };
      channel.postMessage({ type: 'hello', from: me });
    }
    const heartbeat = setInterval(() => {
      try {
        channel?.postMessage({ type: 'ping', from: me });
      } catch {
        /* closed */
      }
      setPeers((p) => {
        const cutoff = Date.now() - PEER_TTL_MS;
        const live = Object.fromEntries(Object.entries(p).filter(([, ts]) => ts > cutoff));
        return Object.keys(live).length === Object.keys(p).length ? p : live;
      });
    }, HEARTBEAT_MS);
    const onUnload = () => {
      try {
        channel?.postMessage({ type: 'bye', from: me });
      } catch {
        /* closed */
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onUnload);
      clearInterval(heartbeat);
      onUnload();
      channel?.close();
      channelRef.current = null;
    };
  }, []);

  // Esc closes the read-aloud view
  useEffect(() => {
    if (!readAloud) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setReadAloud(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readAloud]);

  // Keep the NCS default in step with the station callsign until edited
  useEffect(() => {
    setStartForm((f) => (f.ncs ? f : { ...f, ncs: callsign || '' }));
  }, [callsign]);

  const peerCount = livePeerCount(peers, now);
  const sortedSchedule = useMemo(() => sortByNextOccurrence(schedule), [schedule]);
  const queue = useMemo(() => trafficQueue(net), [net]);
  // The called station only counts while it is still queued (not removed / checked out)
  const calling = net?.calling && queue.some((s) => s.call === net.calling) ? net.calling : null;
  const activeCount = useMemo(() => (net?.stations || []).filter((s) => s.checkoutTime == null).length, [net]);
  const totalCheckins = useMemo(() => (net?.stations || []).reduce((n, s) => n + 1 + (s.recheckCount || 0), 0), [net]);
  const report = useMemo(() => (reportNet ? buildReport(reportNet) : null), [reportNet]);
  const templateId = net?.scriptId || scripts.lastId;
  const template = getTemplate(scripts.templates, templateId);
  const scriptText = useMemo(() => {
    const raw = scriptPart === 'closing' ? template.closing : template.preamble;
    return fillTemplate(raw, scriptContext(net || { name: startForm.name, ncs: startForm.ncs }, now, tz));
  }, [template, scriptPart, net, startForm.name, startForm.ncs, now, tz]);
  const reportOpts = { times: reportTimes, timeZone: tz };
  // How the typed frequency reads: TX frequency and where its offset came from
  const freqPreview = useMemo(
    () => parseNetFrequency(startForm.frequency, { region, offset: startForm.offset }),
    [startForm.frequency, startForm.offset, region],
  );
  const runningFreq = useMemo(
    () => (net ? parseNetFrequency(net.frequency, { region: net.region, offset: net.offset }) : null),
    [net],
  );

  // ── Helpers ───────────────────────────────────────────────────────────
  const getStationCache = () => {
    if (!stationCacheRef.current) stationCacheRef.current = loadStationCache();
    return stationCacheRef.current;
  };

  const remember = (call, info) => {
    const next = rememberStation(getStationCache(), baseCallOf(call), info);
    if (next !== stationCacheRef.current) {
      stationCacheRef.current = next;
      saveStationCache(next);
    }
  };

  /** Instant local fill: previous nets first, then the logbook. */
  const localFill = (call) => {
    const base = baseCallOf(call);
    const cached = getStationCache()[base];
    if (cached && (cached.name || cached.location)) return { name: cached.name, location: cached.location };
    return stationFromLogbook(getLogbookQsos(), base);
  };

  /** Callbook lookup for a station still missing a name (best effort, offline-safe). */
  const lookupCallbook = async (call) => {
    const base = baseCallOf(call);
    if (lookupsInFlight.current.has(base)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    lookupsInFlight.current.add(base);
    try {
      const res = await apiFetch(`/api/callsign/${encodeURIComponent(base)}`, {
        headers: callbookAuthHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res || !res.ok) return;
      const info = stationFromLookup(await res.json());
      if (!info) return;
      commit((n) => {
        const s = n?.stations.find((x) => x.call === call);
        return s ? updateStation(n, call, { name: s.name || info.name, location: s.location || info.location }) : n;
      });
      if (info.name) remember(call, info);
    } catch {
      /* offline / timeout — the row just stays without a name */
    } finally {
      lookupsInFlight.current.delete(base);
    }
  };

  /** Log an event for the action just committed and tie it to that action (for Undo) and the station. */
  const logFor = (type, data) => {
    const ev = recordEvent(type, data);
    if (ev) commit((n) => (n ? attachEvent(n, ev.id, data.callsign || null) : n));
  };

  // ── Templates ─────────────────────────────────────────────────────────
  const persistScripts = (next) => {
    setScripts(next);
    saveScriptTemplates(next);
    broadcast('scripts');
  };

  const chooseTemplate = (id) => {
    commit((n) => (n ? { ...n, scriptId: id } : n));
    persistScripts({ ...scripts, lastId: id });
  };

  const beginEditScript = (tpl = template) =>
    setScriptDraft({ id: tpl.id, name: tpl.name, preamble: tpl.preamble, closing: tpl.closing });

  const saveScriptDraft = () => {
    let list = updateTemplate(scripts.templates, scriptDraft.id, scriptDraft);
    list = renameTemplate(list, scriptDraft.id, scriptDraft.name);
    persistScripts({ templates: list, lastId: scriptDraft.id });
    setScriptDraft(null);
  };

  const newTemplate = () => {
    const res = addTemplate(scripts.templates, {
      name: t('netControl.newScriptName', { defaultValue: 'New script' }),
      preamble: '',
      closing: '',
    });
    persistScripts({ templates: res.templates, lastId: res.id });
    commit((n) => (n ? { ...n, scriptId: res.id } : n));
    beginEditScript(getTemplate(res.templates, res.id));
  };

  const copyTemplate = () => {
    const res = duplicateTemplate(scripts.templates, template.id);
    persistScripts({ templates: res.templates, lastId: res.id });
    commit((n) => (n ? { ...n, scriptId: res.id } : n));
    beginEditScript(getTemplate(res.templates, res.id));
  };

  const removeTemplate = () => {
    if (scripts.templates.length <= 1) return;
    if (
      !window.confirm(
        t('netControl.confirmDeleteScript', { defaultValue: 'Delete the script "{{name}}"?', name: template.name }),
      )
    )
      return;
    const list = deleteTemplate(scripts.templates, template.id);
    persistScripts({ templates: list, lastId: list[0].id });
    commit((n) => (n?.scriptId === template.id ? { ...n, scriptId: list[0].id } : n));
  };

  const resetScriptPart = () => {
    const def = builtinDefault(getTemplate(scripts.templates, scriptDraft?.id));
    if (def) setScriptDraft((d) => ({ ...d, [scriptPart]: def[scriptPart] }));
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const pickSchedule = (id) => {
    const entry = schedule.find((n) => n.id === id);
    if (!entry) {
      setStartForm((f) => ({ ...f, scheduleId: '', freqMhz: null, mode: '' }));
      return;
    }
    const freq = entry.freq_mhz != null ? `${formatMemoryFreq(entry.freq_mhz)} MHz` : '';
    setStartForm((f) => ({
      ...f,
      scheduleId: id,
      name: entry.name,
      frequency: [freq, entry.mode].filter(Boolean).join(' '),
      freqMhz: entry.freq_mhz ?? null,
      mode: entry.mode || '',
    }));
  };

  const startNet = (e) => {
    e?.preventDefault();
    const created = createNet({
      name: startForm.name,
      frequency: startForm.frequency,
      ncs: startForm.ncs || callsign,
      scheduleId: startForm.scheduleId || null,
      scriptId: scripts.lastId,
      // Only trust the schedule's numbers while the typed text is what it filled in
      freqMhz: startForm.scheduleId ? startForm.freqMhz : null,
      mode: startForm.scheduleId ? startForm.mode : '',
      region,
      offset: startForm.offset,
    });
    if (!created) {
      showFlash(t('netControl.needName', { defaultValue: 'Give the net a name first' }), '#ef4444');
      return;
    }
    const res = commit(created);
    if (!res.ok) return;
    setView('roster');
    setReportNet(null);
    recordEvent('net_open', {
      callsign: created.ncs,
      summary: `Opened ${created.name}`,
      details: [created.frequency, created.ncs ? `NCS ${created.ncs}` : ''].filter(Boolean).join(' · '),
      ts: created.startTime,
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitCheckin = () => {
    const cur = netRef.current;
    if (!cur) return;
    const parsed = parseCheckin(input);
    if (!parsed) {
      if (input.trim()) showFlash(t('netControl.notCall', { defaultValue: 'Not a callsign' }), '#ef4444');
      return;
    }
    const fill = localFill(parsed.call) || {};
    const flags = [...new Set([...parsed.flags, ...pendingFlags])];
    const args = {
      call: parsed.call,
      flags,
      note: parsed.note,
      name: fill.name || '',
      location: fill.location || '',
    };
    let res = checkIn(cur, args);
    if (res.result === 'duplicate') {
      setInput('');
      setPendingFlags([]);
      showFlash(
        t('netControl.flashDuplicate', { defaultValue: '{{call}} is already checked in', call: res.station.call }),
        '#f59e0b',
      );
      return;
    }
    // Re-run against a newer net if another tab wrote first (res then describes that run)
    const committed = commit((n) => {
      if (n !== cur) res = checkIn(n, args);
      return res.net;
    });
    if (!committed.ok) return; // input kept so the operator can press Enter again
    const st = res.station;
    setInput('');
    setPendingFlags([]);
    if (res.result === 'new') {
      showFlash(
        t('netControl.flashNew', {
          defaultValue: '✓ {{call}} checked in (#{{n}})',
          call: st.call,
          n: res.net.stations.length,
        }),
      );
    } else if (res.result === 'recheck') {
      showFlash(t('netControl.flashRecheck', { defaultValue: '↻ {{call}} re-checked', call: st.call }));
    } else {
      showFlash(t('netControl.flashReturn', { defaultValue: '↩ {{call}} back in the net', call: st.call }));
    }
    logFor('net_checkin', {
      callsign: st.call,
      summary: `${res.result === 'new' ? 'Checked into' : 'Re-checked into'} ${cur.name} (voice)`,
      details: [flagsToText(st.flags), st.name].filter(Boolean).join(' · '),
    });
    if (fill.name || fill.location) remember(st.call, fill);
    if (!st.name) lookupCallbook(st.call);
  };

  const togglePending = (key) =>
    setPendingFlags((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  /**
   * Undo the last action. Event-log entries it wrote stay in the log (it is
   * a record of what happened) and get a compensating net_withdrawn entry,
   * which the ICS forms skip.
   */
  const doUndo = () => {
    const cur = netRef.current;
    const top = peekUndo(cur);
    if (!top) return;
    const res = commit(undoLast(cur));
    if (!res.ok) return;
    for (const id of top.eventIds || []) {
      recordEvent('net_withdrawn', {
        callsign: top.action?.call || '',
        summary: withdrawalSummary(top.action, cur.name),
        details: 'Undo in Net Control',
        ref: id,
      });
    }
    showFlash(t('netControl.flashUndo', { defaultValue: 'Undone' }), '#f59e0b');
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCheckin();
      return;
    }
    if (e.key === 'Escape') {
      setInput('');
      setPendingFlags([]);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && input === '') {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      // e.code keeps working on macOS, where Alt+letter types a symbol
      const letter = (e.code || '').replace(/^Key/, '');
      const def = FLAG_DEFS.find((f) => f.letter === letter);
      if (def) {
        e.preventDefault();
        togglePending(def.key);
      } else if (letter === 'N') {
        e.preventDefault();
        callNext();
      }
    }
  };

  const doCheckOut = (call) => {
    const cur = netRef.current;
    if (checkOut(cur, call) === cur) return;
    const res = commit((n) => (n ? checkOut(n, call) : n));
    if (!res.ok) return;
    logFor('net_checkout', { callsign: call, summary: `Checked out of ${cur.name} (voice)` });
  };

  const doToggleFlag = (call, key) => {
    commit((n) => (n ? toggleFlag(n, call, key) : n));
  };

  /** Remove a mistyped call — its logged entries are withdrawn (and reinstated by Undo). */
  const doRemove = (call) => {
    const cur = netRef.current;
    const st = cur?.stations.find((s) => s.call === call);
    if (!st) return;
    const res = commit((n) => (n ? removeStation(n, call) : n));
    if (!res.ok) return;
    const withdrawals = [];
    for (const id of st.logIds || []) {
      const ev = recordEvent('net_withdrawn', {
        callsign: call,
        summary: `Removed from ${cur.name} (mistyped call)`,
        details: 'Net Control',
        ref: id,
      });
      if (ev) withdrawals.push(ev.id);
    }
    if (withdrawals.length) commit((n) => withdrawals.reduce((acc, id) => attachEvent(acc, id, call), n));
    showFlash(t('netControl.flashRemoved', { defaultValue: '{{call}} removed — Undo to restore', call }), '#f59e0b');
  };

  const callNext = () => {
    const cur = netRef.current;
    if (!cur) return;
    const res = commit((n) => (n ? nextTraffic(n) : n));
    if (res.ok && !res.net?.calling)
      showFlash(t('netControl.queueEmpty', { defaultValue: 'No traffic waiting' }), '#f59e0b');
  };

  const doPassTraffic = (call) => {
    const cur = netRef.current;
    if (passTraffic(cur, call) === cur) return;
    const res = commit((n) => (n ? passTraffic(n, call) : n));
    if (!res.ok) return;
    const s = res.net.stations.find((x) => x.call === call);
    logFor('net_traffic', {
      callsign: call,
      summary: `Traffic passed on ${cur.name}`,
      details: [s?.name, s?.note].filter(Boolean).join(' · '),
    });
  };

  const doCloseNet = () => {
    const cur = netRef.current;
    if (!cur) return;
    if (
      !window.confirm(
        t('netControl.confirmClose', { defaultValue: 'Close {{name}} and produce the net report?', name: cur.name }),
      )
    )
      return;
    const closed = closeNet(cur);
    const res = commit(null);
    if (!res.ok) return;
    const rep = buildReport(closed);
    const nextHistory = pushHistory(loadHistory(), closed);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    broadcast('history');
    saveRosterSnapshot(closed, { active: false });
    for (const s of closed.stations) if (s.name || s.location) remember(s.call, s);
    recordEvent('net_close', {
      callsign: closed.ncs,
      summary: `Closed ${closed.name}: ${rep.uniqueStations} stations, ${rep.totalCheckins} check-ins, ${rep.trafficCount} traffic`,
      details: `${formatDuration(rep.durationMs)}${closed.frequency ? ` · ${closed.frequency}` : ''}`,
      ts: closed.endTime,
    });
    setReportNet(closed);
    setView('report');
  };

  const setTimesMode = (mode) => {
    setReportTimes(mode);
    writeLocal(REPORT_TIMES_KEY, mode);
  };

  const copyReport = async () => {
    if (!report) return;
    const text = reportToText(report, reportOpts);
    try {
      await navigator.clipboard.writeText(text);
      showFlash(t('netControl.copied', { defaultValue: 'Report copied' }));
    } catch {
      downloadText(text, `${fileSlug(report.name)}-report.txt`, 'text/plain;charset=utf-8');
    }
  };

  const downloadReportCsv = () => {
    if (!report) return;
    const day = new Date(report.startTime).toISOString().substring(0, 10);
    downloadText(reportToCsv(report, { timeZone: tz }), `${fileSlug(report.name)}-${day}.csv`);
  };

  const deleteHistory = (id) => {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    saveHistory(next);
    broadcast('history');
    if (reportNet?.id === id) setReportNet(null);
  };

  const clearAllHistory = () => {
    if (!window.confirm(t('netControl.confirmClearHistory', { defaultValue: 'Delete all past nets?' }))) return;
    setHistory([]);
    saveHistory([]);
    broadcast('history');
  };

  // ── Render pieces ─────────────────────────────────────────────────────
  // In the EmComm rail the height is auto; flex:1 would collapse a scrolling
  // list to nothing there, so lists get a max height instead.
  const grow = embedded ? {} : { flex: 1, minHeight: 0 };

  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setView(id)}
      style={{
        ...btnStyle,
        borderColor: view === id ? ACCENT : 'var(--border-color)',
        color: view === id ? ACCENT : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        marginBottom: '6px',
        fontSize: '11px',
        color: 'var(--accent-primary)',
        fontWeight: 700,
      }}
    >
      {!embedded && <span>🎙️ {t('netControl.title', { defaultValue: 'NET CONTROL' })}</span>}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginLeft: embedded ? 0 : 'auto' }}>
        {tabBtn(
          'roster',
          running
            ? t('netControl.tabNet', { defaultValue: 'Net' })
            : t('netControl.tabStart', { defaultValue: 'Start' }),
        )}
        {tabBtn('script', t('netControl.tabScript', { defaultValue: 'Script' }))}
        {report && tabBtn('report', t('netControl.tabReport', { defaultValue: 'Report' }))}
        {tabBtn(
          'history',
          `${t('netControl.tabHistory', { defaultValue: 'History' })}${history.length ? ` (${history.length})` : ''}`,
        )}
      </div>
    </div>
  );

  const peerNote = peerCount > 0 && (
    <div
      style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '4px' }}
      title={t('netControl.peersTitle', {
        defaultValue: 'Changes made in any of them show up in all of them.',
      })}
    >
      ⧉{' '}
      {t('netControl.peers', {
        defaultValue: 'Also open in another tab or panel ({{count}})',
        count: peerCount,
      })}
    </div>
  );

  const flashLine = flash && (
    <div style={{ color: flash.color, fontSize: '11px', fontWeight: 600, minHeight: '14px', marginTop: '3px' }}>
      {flash.text}
    </div>
  );

  const templateSelect = (
    <select
      style={{ ...inputStyle, width: 'auto', flex: 1 }}
      value={template.id}
      onChange={(e) => chooseTemplate(e.target.value)}
      aria-label={t('netControl.scriptTemplate', { defaultValue: 'Script template' })}
      title={t('netControl.scriptTemplate', { defaultValue: 'Script template' })}
    >
      {scripts.templates.map((tpl) => (
        <option key={tpl.id} value={tpl.id}>
          {tpl.name}
        </option>
      ))}
    </select>
  );

  const renderStart = () => (
    <form onSubmit={startNet} style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '10px' }}>
      {sortedSchedule.length > 0 && (
        <select
          style={inputStyle}
          value={startForm.scheduleId}
          onChange={(e) => pickSchedule(e.target.value)}
          onFocus={() => setSchedule(loadNetSchedule())}
          aria-label={t('netControl.fromSchedule', { defaultValue: 'From Net Schedule' })}
        >
          <option value="">{t('netControl.fromSchedule', { defaultValue: 'From Net Schedule' })}…</option>
          {sortedSchedule.map(({ net: n, next }) => (
            <option key={n.id} value={n.id}>
              {n.name}
              {next?.onNow ? ` — ${t('netControl.onNow', { defaultValue: 'ON NOW' })}` : ''}
            </option>
          ))}
        </select>
      )}
      <input
        style={inputStyle}
        value={startForm.name}
        maxLength={80}
        onChange={(e) => setStartForm((f) => ({ ...f, name: e.target.value }))}
        placeholder={t('netControl.namePlaceholder', { defaultValue: 'Net name (e.g. County ARES Weekly Net)' })}
        aria-label={t('netControl.namePlaceholder', { defaultValue: 'Net name (e.g. County ARES Weekly Net)' })}
      />
      <input
        style={inputStyle}
        value={startForm.frequency}
        maxLength={80}
        onChange={(e) => setStartForm((f) => ({ ...f, frequency: e.target.value }))}
        placeholder={t('netControl.freqPlaceholder', {
          defaultValue: 'Frequency / repeater (e.g. 146.940 − PL 100.0)',
        })}
        aria-label={t('netControl.freqPlaceholder', {
          defaultValue: 'Frequency / repeater (e.g. 146.940 − PL 100.0)',
        })}
      />
      {freqPreview && freqPreview.offsetSource !== 'simplex' && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              color:
                freqPreview.offsetSource === 'unknown' || freqPreview.offsetCheck ? '#f59e0b' : 'var(--text-muted)',
            }}
          >
            {freqPreview.offsetSource === 'unknown'
              ? t('netControl.offsetUnknown', { defaultValue: 'TX offset? — type it here' })
              : t('netControl.offsetPreview', {
                  defaultValue: 'TX {{tx}} ({{offset}} {{source}})',
                  tx: freqPreview.txMhz.toFixed(3),
                  offset: formatOffset(freqPreview.offsetMhz),
                  source:
                    freqPreview.offsetSource === 'standard'
                      ? freqPreview.offsetCheck
                        ? t('netControl.offsetCheck', { defaultValue: 'usual here — check locally' })
                        : t('netControl.offsetStandard', { defaultValue: 'standard' })
                      : freqPreview.offsetSource === 'override'
                        ? t('netControl.offsetOverride', { defaultValue: 'as entered' })
                        : t('netControl.offsetFromText', { defaultValue: 'from the frequency' }),
                })}
          </span>
          <input
            style={{
              ...inputStyle,
              width: '80px',
              ...(freqPreview.offsetSource === 'unknown' ? { borderColor: '#f59e0b' } : {}),
            }}
            value={startForm.offset}
            maxLength={12}
            onChange={(e) => setStartForm((f) => ({ ...f, offset: e.target.value }))}
            placeholder={t('netControl.offsetPlaceholder', { defaultValue: 'offset?' })}
            aria-label={t('netControl.offsetLabel', { defaultValue: 'TX offset (e.g. −0.6, +5, −500k)' })}
            title={t('netControl.offsetLabel', { defaultValue: 'TX offset (e.g. −0.6, +5, −500k)' })}
          />
        </div>
      )}
      <input
        style={{ ...inputStyle, textTransform: 'uppercase' }}
        value={startForm.ncs}
        maxLength={15}
        onChange={(e) => setStartForm((f) => ({ ...f, ncs: e.target.value.toUpperCase() }))}
        placeholder={t('netControl.ncsPlaceholder', { defaultValue: 'Net control callsign' })}
        aria-label={t('netControl.ncsPlaceholder', { defaultValue: 'Net control callsign' })}
      />
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('netControl.script', { defaultValue: 'Script' })}</span>
        {templateSelect}
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="submit" style={{ ...primaryBtn, padding: '4px 12px', fontSize: '11px' }}>
          ▶ {t('netControl.start', { defaultValue: 'Start net' })}
        </button>
        <button type="button" style={btnStyle} onClick={() => setView('script')}>
          {t('netControl.previewScript', { defaultValue: 'Preview script' })}
        </button>
      </div>
      {flashLine}
    </form>
  );

  const renderRunning = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...grow }}>
      {/* Net status */}
      <div
        style={{
          border: `1px solid ${ACCENT}`,
          borderRadius: '4px',
          padding: '5px 7px',
          background: 'var(--bg-tertiary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={net.name}
          >
            {net.name}
          </span>
          <span
            style={{ color: ACCENT, fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 700 }}
            title={t('netControl.elapsed', { defaultValue: 'Time since the net opened' })}
          >
            {formatElapsed(now - net.startTime)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '6px',
            fontSize: '10px',
            color: 'var(--text-muted)',
            marginTop: '2px',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[net.frequency, net.ncs ? `NCS ${net.ncs}` : ''].filter(Boolean).join(' · ')}
            {runningFreq?.offsetSource === 'unknown' && (
              <span
                style={{ color: '#f59e0b', marginLeft: '4px' }}
                title={t('netControl.offsetUnknownTitle', {
                  defaultValue: 'The repeater offset is not known — the ICS 205 asks for the TX frequency',
                })}
              >
                · {t('netControl.offsetPlaceholder', { defaultValue: 'offset?' })}
              </span>
            )}
          </span>
          <span
            style={{ whiteSpace: 'nowrap' }}
            title={t('netControl.counterTitle', { defaultValue: 'Stations in the net / total check-ins' })}
          >
            <b style={{ color: 'var(--text-primary)', fontSize: '12px' }}>{activeCount}</b>{' '}
            {t('netControl.inNet', { defaultValue: 'in' })} · {totalCheckins}{' '}
            {t('netControl.checkins', { defaultValue: 'check-ins' })}
          </span>
        </div>
      </div>

      {/* Check-in line */}
      <div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            ref={inputRef}
            style={{ ...inputStyle, fontSize: '14px', padding: '5px 7px', flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('netControl.checkinPlaceholder', { defaultValue: 'Callsign + Enter  (e.g. W1AW T)' })}
            aria-label={t('netControl.checkinLabel', { defaultValue: 'Check in a station' })}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" style={primaryBtn} onClick={submitCheckin}>
            {t('netControl.checkIn', { defaultValue: 'In' })}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '3px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {FLAG_DEFS.map((def) => (
            <FlagPill
              key={def.key}
              def={def}
              active={pendingFlags.includes(def.key)}
              onClick={() => togglePending(def.key)}
              title={`${t(`netControl.flag.${def.key}`, { defaultValue: def.label })} — ${def.letter} / Alt+${def.letter}`}
            />
          ))}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            style={{ ...btnStyle, opacity: net.undo?.length ? 1 : 0.4 }}
            disabled={!net.undo?.length}
            onClick={doUndo}
            title={t('netControl.undoTitle', {
              defaultValue: 'Undo the last change (Ctrl+Z in an empty check-in box)',
            })}
          >
            ↶ {t('netControl.undo', { defaultValue: 'Undo' })}
          </button>
          <button type="button" style={dangerBtn} onClick={doCloseNet}>
            ■ {t('netControl.close', { defaultValue: 'Close net' })}
          </button>
        </div>
        {flashLine}
      </div>

      {/* Traffic queue */}
      {(queue.length > 0 || calling) && (
        <div style={{ border: '1px solid #ef444466', borderRadius: '4px', padding: '4px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
            <span style={{ color: '#ef4444', fontWeight: 700 }}>
              {t('netControl.trafficQueue', { defaultValue: 'TRAFFIC' })} ({queue.length})
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={{ ...btnStyle, borderColor: '#ef4444', color: '#ef4444' }}
              onClick={callNext}
              title="Alt+N"
            >
              {t('netControl.next', { defaultValue: 'Next' })} ▶
            </button>
          </div>
          {calling && (
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: '16px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {calling}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{spellPhonetic(calling)}</div>
              </div>
              <button type="button" style={primaryBtn} onClick={() => doPassTraffic(calling)}>
                ✓ {t('netControl.passed', { defaultValue: 'Passed' })}
              </button>
            </div>
          )}
          {queue
            .filter((s) => s.call !== calling)
            .map((s, i) => (
              <div
                key={s.call}
                style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', marginTop: '2px' }}
              >
                <span style={{ color: 'var(--text-muted)', width: '14px' }}>{i + 1}.</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {s.call}
                </span>
                <span
                  style={{
                    color: 'var(--text-muted)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.note || s.name}
                </span>
                <button
                  type="button"
                  style={btnStyle}
                  onClick={() => doPassTraffic(s.call)}
                  title={t('netControl.passTitle', { defaultValue: 'Mark traffic passed' })}
                >
                  ✓
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Shared incident: net fields / unlisted stations another site overrode */}
      <NetConflictBar
        pending={pendingConflicts}
        presentCalls={new Set(net.stations.map((s) => s.call))}
        onApply={applyMine}
        onDismiss={dismissNetConflict}
      />

      {/* Roster */}
      <div style={{ overflowY: 'auto', ...grow, maxHeight: embedded ? '360px' : undefined }}>
        {net.stations.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '8px 2px', lineHeight: 1.5 }}>
            {t('netControl.emptyHint', {
              defaultValue:
                'Type a callsign and press Enter. Add flag letters after it — T traffic, M mobile, S short time, R relay, I in-and-out — e.g. "W1AW TM" or "W1AW/M".',
            })}
          </div>
        ) : (
          net.stations.map((s) => {
            const out = s.checkoutTime != null;
            return (
              <div
                key={s.call}
                data-testid="nc-station"
                data-call={s.call}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  gap: '6px',
                  alignItems: 'center',
                  padding: '3px 4px',
                  borderBottom: '1px solid var(--border-color)',
                  opacity: out ? 0.45 : 1,
                  fontSize: '11px',
                }}
              >
                <span
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}
                  title={`UTC · ${fmtLocalDateTime(s.checkinTime, tz)}`}
                >
                  {fmtUtcHHMM(s.checkinTime)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        color: out ? 'var(--text-muted)' : 'var(--text-primary)',
                        textDecoration: out ? 'line-through' : 'none',
                      }}
                    >
                      {s.call}
                    </span>
                    {s.recheckCount > 0 && (
                      <span
                        style={{ color: ACCENT, fontSize: '9px' }}
                        title={t('netControl.rechecks', { defaultValue: 'Re-checks' })}
                      >
                        ↻{s.recheckCount}
                      </span>
                    )}
                    {FLAG_DEFS.filter((d) => s.flags.includes(d.key) || !out).map((def) => (
                      <FlagPill
                        key={def.key}
                        def={def}
                        active={s.flags.includes(def.key)}
                        onClick={out ? undefined : () => doToggleFlag(s.call, def.key)}
                        title={t(`netControl.flag.${def.key}`, { defaultValue: def.label })}
                      />
                    ))}
                    {s.trafficPassed != null && (
                      <span style={{ color: '#22c55e', fontSize: '9px' }}>
                        ✓ {t('netControl.passedShort', { defaultValue: 'passed' })}
                      </span>
                    )}
                  </div>
                  {(s.name || s.location || s.note) && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {[s.name, s.location, s.note].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {pendingConflicts?.calls?.[s.call] && (
                    <StationConflictChip
                      call={s.call}
                      entry={pendingConflicts.calls[s.call]}
                      onApply={() => applyMine('call', s.call)}
                      onDismiss={() => dismissNetConflict('call', s.call)}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {!out && (
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={() => doCheckOut(s.call)}
                      title={t('netControl.checkOutTitle', { defaultValue: 'Check out' })}
                    >
                      {t('netControl.out', { defaultValue: 'Out' })}
                    </button>
                  )}
                  <button
                    type="button"
                    style={{ ...btnStyle, padding: '2px 4px' }}
                    onClick={() => doRemove(s.call)}
                    title={t('netControl.removeTitle', { defaultValue: 'Remove (mistyped call)' })}
                    aria-label={t('netControl.removeTitle', { defaultValue: 'Remove (mistyped call)' })}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const partLabel = (part) =>
    part === 'closing'
      ? t('netControl.closing', { defaultValue: 'Closing' })
      : t('netControl.preamble', { defaultValue: 'Preamble' });

  const renderScript = () => {
    const editing = !!scriptDraft;
    const draftTpl = editing ? getTemplate(scripts.templates, scriptDraft.id) : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...grow }}>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {editing ? (
            <input
              style={{ ...inputStyle, flex: 1, width: 'auto' }}
              value={scriptDraft.name}
              maxLength={60}
              onChange={(e) => setScriptDraft((d) => ({ ...d, name: e.target.value }))}
              aria-label={t('netControl.scriptName', { defaultValue: 'Script name' })}
              placeholder={t('netControl.scriptName', { defaultValue: 'Script name' })}
            />
          ) : (
            templateSelect
          )}
          {['preamble', 'closing'].map((part) => (
            <button
              key={part}
              type="button"
              onClick={() => setScriptPart(part)}
              style={{
                ...btnStyle,
                borderColor: scriptPart === part ? ACCENT : 'var(--border-color)',
                color: scriptPart === part ? ACCENT : 'var(--text-secondary)',
              }}
            >
              {partLabel(part)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {editing ? (
            <>
              {builtinDefault(draftTpl) && (
                <button type="button" style={btnStyle} onClick={resetScriptPart}>
                  {t('netControl.resetDefault', { defaultValue: 'Default' })}
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" style={btnStyle} onClick={() => setScriptDraft(null)}>
                {t('netControl.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button type="button" style={primaryBtn} onClick={saveScriptDraft}>
                {t('netControl.save', { defaultValue: 'Save' })}
              </button>
            </>
          ) : (
            <>
              <button type="button" style={btnStyle} onClick={() => beginEditScript()}>
                {t('netControl.edit', { defaultValue: 'Edit' })}
              </button>
              <button type="button" style={btnStyle} onClick={newTemplate}>
                + {t('netControl.newScript', { defaultValue: 'New' })}
              </button>
              <button type="button" style={btnStyle} onClick={copyTemplate}>
                {t('netControl.copyScript', { defaultValue: 'Copy' })}
              </button>
              <button
                type="button"
                style={{ ...btnStyle, opacity: scripts.templates.length > 1 ? 1 : 0.4 }}
                disabled={scripts.templates.length <= 1}
                onClick={removeTemplate}
              >
                {t('netControl.deleteScript', { defaultValue: 'Delete' })}
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                style={primaryBtn}
                onClick={() => {
                  setNow(Date.now());
                  setReadAloud(true);
                }}
              >
                ⛶ {t('netControl.readAloud', { defaultValue: 'Read aloud' })}
              </button>
            </>
          )}
        </div>
        {editing ? (
          <>
            <textarea
              style={{
                ...inputStyle,
                flex: 1,
                minHeight: '220px',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: '12px',
                lineHeight: 1.5,
              }}
              value={scriptDraft[scriptPart]}
              onChange={(e) => setScriptDraft((d) => ({ ...d, [scriptPart]: e.target.value }))}
              aria-label={t('netControl.scriptLabel', { defaultValue: 'Net script' })}
            />
            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {t('netControl.placeholders', {
                defaultValue: 'Placeholders: {net} {ncs} {freq} {date} {time} {count}',
              })}
            </div>
          </>
        ) : (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--text-primary)',
              overflowY: 'auto',
              ...grow,
              maxHeight: embedded ? '360px' : undefined,
            }}
          >
            {scriptText || (
              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                {t('netControl.emptyScript', { defaultValue: 'This part of the script is empty — Edit to write it.' })}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderReport = () => {
    if (!report) return null;
    const both = reportTimes === 'both';
    const stat = (label, value) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
          {value}
        </span>
      </div>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', ...grow }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '12px' }}>{report.name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {stat(t('netControl.rNcs', { defaultValue: 'Net control' }), report.ncs || '—')}
          {report.frequency && stat(t('netControl.rFreq', { defaultValue: 'Frequency' }), report.frequency)}
          {stat(
            t('netControl.rTimes', { defaultValue: 'Opened – closed (UTC)' }),
            `${fmtUtcHHMM(report.startTime)} – ${fmtUtcHHMM(report.endTime)}`,
          )}
          {both &&
            stat(
              t('netControl.rTimesLocal', { defaultValue: 'Opened – closed (local)' }),
              `${fmtLocalDateTime(report.startTime, tz)} – ${fmtLocalDateTime(report.endTime, tz).slice(11)}`,
            )}
          {stat(t('netControl.rDuration', { defaultValue: 'Duration' }), formatDuration(report.durationMs))}
          {stat(t('netControl.rCheckins', { defaultValue: 'Check-ins' }), report.totalCheckins)}
          {stat(t('netControl.rUnique', { defaultValue: 'Unique stations' }), report.uniqueStations)}
          {stat(
            t('netControl.rTraffic', { defaultValue: 'Traffic (listed / passed)' }),
            `${report.trafficCount} / ${report.trafficPassed}`,
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={primaryBtn} onClick={copyReport}>
            {t('netControl.copyText', { defaultValue: 'Copy text' })}
          </button>
          <button type="button" style={btnStyle} onClick={downloadReportCsv}>
            CSV
          </button>
          <button type="button" style={btnStyle} onClick={() => printHtml(reportToPrintHtml(report, reportOpts))}>
            {t('netControl.print', { defaultValue: 'Print' })}
          </button>
          {!running && (
            <button type="button" style={btnStyle} onClick={() => setView('roster')}>
              {t('netControl.newNet', { defaultValue: 'New net' })}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <select
            style={{ ...inputStyle, width: 'auto', fontSize: '10px', padding: '1px 4px' }}
            value={reportTimes}
            onChange={(e) => setTimesMode(e.target.value)}
            aria-label={t('netControl.reportTimes', { defaultValue: 'Times in the report' })}
            title={t('netControl.reportTimesTitle', {
              defaultValue: 'Times shown in the copied text and the printed report (the CSV always has both)',
            })}
          >
            <option value="utc">{t('netControl.timesUtc', { defaultValue: 'UTC' })}</option>
            <option value="both">{t('netControl.timesBoth', { defaultValue: 'UTC + local' })}</option>
          </select>
        </div>
        {flashLine}
        <div style={{ overflowY: 'auto', ...grow, maxHeight: embedded ? '300px' : undefined }}>
          {report.stations.map((s) => (
            <div
              key={s.call}
              style={{ display: 'flex', gap: '6px', padding: '2px 0', borderBottom: '1px solid var(--border-color)' }}
            >
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                {fmtUtcHHMM(s.checkinTime)}
                {both ? ` ${fmtLocalDateTime(s.checkinTime, tz).slice(11, 16)}` : ''}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  minWidth: '62px',
                }}
              >
                {s.call}
              </span>
              <span style={{ color: ACCENT, fontSize: '10px' }}>{flagsToText(s.flags)}</span>
              <span
                style={{
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {[s.name, s.location].filter(Boolean).join(', ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHistory = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', ...grow }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button
          type="button"
          style={{ ...btnStyle, opacity: history.length ? 1 : 0.4 }}
          disabled={!history.length}
          onClick={() =>
            downloadText(
              historyToCsv(history, { timeZone: tz }),
              `net-history-${new Date().toISOString().substring(0, 10)}.csv`,
            )
          }
        >
          {t('netControl.exportAll', { defaultValue: 'Export all (CSV)' })}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...dangerBtn, opacity: history.length ? 1 : 0.4 }}
          disabled={!history.length}
          onClick={clearAllHistory}
        >
          {t('netControl.clearHistory', { defaultValue: 'Clear' })}
        </button>
      </div>
      <div style={{ overflowY: 'auto', ...grow, maxHeight: embedded ? '360px' : undefined }}>
        {history.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '6px 2px' }}>
            {t('netControl.noHistory', { defaultValue: 'Closed nets appear here.' })}
          </div>
        ) : (
          history.map((h) => (
            <div
              key={h.id}
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
                padding: '3px 2px',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setReportNet(h);
                  setView('report');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  flex: 1,
                  minWidth: 0,
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.name}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {fmtDateTime(h.startTime, tz)} · {h.stations.length}{' '}
                  {t('netControl.stations', { defaultValue: 'stations' })} ·{' '}
                  {formatDuration((h.endTime ?? h.startTime) - h.startTime)}
                </div>
              </button>
              <button
                type="button"
                style={{ ...btnStyle, padding: '2px 4px' }}
                onClick={() => deleteHistory(h.id)}
                aria-label={t('netControl.deleteNet', { defaultValue: 'Delete this net' })}
                title={t('netControl.deleteNet', { defaultValue: 'Delete this net' })}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const body =
    view === 'script'
      ? renderScript()
      : view === 'report' && report
        ? renderReport()
        : view === 'history'
          ? renderHistory()
          : running
            ? renderRunning()
            : renderStart();

  return (
    <div
      className={embedded ? undefined : 'panel'}
      style={{
        padding: embedded ? '6px 8px' : '8px',
        height: embedded ? undefined : '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {header}
      {peerNote}
      {body}
      {readAloud && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('netControl.readAloud', { defaultValue: 'Read aloud' })}
          onClick={() => setReadAloud(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10050,
            background: 'rgba(0,0,0,0.92)',
            color: '#f5f5f5',
            overflowY: 'auto',
            padding: 'clamp(16px, 5vw, 64px)',
            cursor: 'pointer',
          }}
        >
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ color: ACCENT, fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>
              {template.name} · {partLabel(scriptPart)} ·{' '}
              {t('netControl.escToClose', { defaultValue: 'click or Esc to close' })}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'clamp(20px, 2.6vw, 32px)', lineHeight: 1.55 }}>
              {scriptText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { NetControlPanel };
