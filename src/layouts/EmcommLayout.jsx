/**
 * EmComm Layout — Emergency Communications operations dashboard
 * Map with range rings + NWS/FEMA overlays, sidebar with structured panels
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { APRS_HISTORY_EVENT } from '../utils/aprsSelect.js';
import { useTranslation } from 'react-i18next';
import { WorldMap, APRSTelemetryPanel, RepeatersPanel } from '../components';
import NbemsPanel from '../components/NbemsPanel.jsx';
import OfflineAreaPacks from '../components/OfflineAreaPacks.jsx';
import { formatAsOf } from '../utils/offlinePackManifest.js';
import { useAPRSTelemetry } from '../hooks/useAPRSTelemetry.js';
import { calculateDistance, formatDistance, maidenheadToLatLon, latLonToMaidenhead } from '../utils/geo.js';
import { esc } from '../utils/escapeHtml.js';
import { apiFetch } from '../utils/apiFetch.js';
import { useAprsShelterReports } from '../hooks/useAprsShelterReports.js';
import { aggregateResourceTokens, mergeShelters } from '../utils/emcommShelters.js';
import { sendAprsMessage, directRigUrl } from '../utils/aprsMessageSend.js';
import AprsBeaconBar from '../components/AprsBeaconBar.jsx';
import { useRigOptional } from '../contexts/RigContext.jsx';
import { useAprsMsgStatus, deliveryLabel } from '../utils/aprsMsgStatus.js';
import { IcsFormsOverlay } from '../components/IcsFormsPanel.jsx';
import NetControlPanel from '../components/NetControlPanel.jsx';
import { getNetControlRoster, mergeRosters, NET_CONTROL_ROSTER_EVENT } from '../utils/netControl.js';
import { useSharedIncident } from '../hooks/useSharedIncident.js';
import EmcommIncidentPanel, { IncidentStatusPill, IncidentAdminButtons } from '../components/EmcommIncidentPanel.jsx';
import {
  mergeDisplayedRoster,
  mergeFieldReports,
  mergeShelterReports,
  messageHistoryFromEvents,
  mergeMessageHistory,
  annotateSharedEvents,
  sharedMsgLabel,
} from '../utils/incidentSync.js';

// Sidebar panel collapse state (#1188). Mode decides what a fresh visit to
// the layout starts with: 'remember' restores each section's last state,
// 'expanded' / 'collapsed' start every section that way. Toggling a section
// always works; it is only persisted in 'remember' mode.
const PANEL_MODE_KEY = 'openhamclock_emcommPanelMode';
const PANEL_STATE_KEY = 'openhamclock_emcommPanels';
const PANEL_MODES = [
  { value: 'remember', label: 'Remember' },
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Collapsed' },
];
const readPanelMode = () => {
  try {
    const v = localStorage.getItem(PANEL_MODE_KEY);
    return PANEL_MODES.some((m) => m.value === v) ? v : 'remember';
  } catch {
    return 'remember';
  }
};
const readPanelStates = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — state stays in memory for this session */
  }
};
/** Resolve a section's collapsed flag: explicit > "all" override > mode default */
const isPanelCollapsed = (states, mode, title) => states[title] ?? states.__all ?? mode === 'collapsed';
const EMCOMM_APRS_SELECT = {
  background: '#1a1f2e',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#888',
  fontSize: '9px',
  padding: '1px 4px',
};
// Sidebar text size (#1232): same steps as the Dockable layout's per-panel
// A−/A+, stored in the same synced openhamclock_panelZoom map under 'emcomm'.
const PANEL_ZOOM_KEY = 'openhamclock_panelZoom';
const TEXT_ZOOM_STEPS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0];
const readTextZoom = () => {
  try {
    const z = Number(JSON.parse(localStorage.getItem(PANEL_ZOOM_KEY) || '{}')?.emcomm);
    return TEXT_ZOOM_STEPS.includes(z) ? z : 1.0;
  } catch {
    return 1.0;
  }
};
const writeTextZoom = (zoom) => {
  try {
    const all = JSON.parse(localStorage.getItem(PANEL_ZOOM_KEY) || '{}') || {};
    if (zoom === 1.0) delete all.emcomm;
    else all.emcomm = zoom;
    localStorage.setItem(PANEL_ZOOM_KEY, JSON.stringify(all));
  } catch {}
};

// Sidebar width (#1233): drag the splitter between map and sidebar. Kept per
// browser (not synced) — the right width depends on that screen.
const SIDEBAR_WIDTH_KEY = 'openhamclock_emcommSidebarWidth';
const SIDEBAR_DEFAULT_W = 380;
const SIDEBAR_MIN_W = 260;
const SIDEBAR_MAX_W = 900;
const MAP_MIN_W = 300; // never squeeze the map below this (6 px splitter on top)
const readSidebarWidth = () => {
  try {
    const w = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    return Number.isFinite(w) ? Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w)) : SIDEBAR_DEFAULT_W;
  } catch {
    return SIDEBAR_DEFAULT_W;
  }
};

const PANEL_TOOL_BTN = {
  background: 'transparent',
  color: '#888',
  border: '1px solid #333',
  borderRadius: '3px',
  fontSize: '10px',
  padding: '1px 6px',
  cursor: 'pointer',
};
import { winlinkModeLabel, winlinkModeColor } from '../utils/winlinkModes.js';
import { useWinlinkReach, REACH_PRIORITY } from '../hooks/useWinlinkReach.js';
import { STATUS_COLORS, STATUS_ORDER, reachColorKey, reachMarkerStyle } from '../utils/winlinkReach.js';
import { reachPopupLine } from '../utils/winlinkReachPopup.js';
import { stationAgeMinutes, formatStationAge } from '../utils/aprsStationAge.js';
import { requestMapFocus } from '../utils/mapFocus.js';
import {
  recordEvent,
  getEvents,
  clearEvents,
  subscribeEvents,
  eventsToCSV,
  buildPrintHtml,
  diffAdded,
  activeEvents,
  EVENT_TYPE_META,
} from '../utils/emcommEventLog.js';
import {
  getAliases,
  setAliases,
  ALIASES_EVENT,
  ALIASES_KEY,
  filterRosterByAliases,
  rosterKey,
  entryAlias,
  messageIsRelevant,
  groupRoster,
  rosterForAddress,
} from '../utils/netAliases.js';
import NetRosterControls from '../components/NetRosterControls.jsx';
import EmcommPanelChooser, { PanelSetSelect } from '../components/EmcommPanelChooser.jsx';
import { readPanelSets, writePanelSets } from '../utils/emcommPanelSets.js';

// Net Roster view (#1240): grouping and the one-address filter, per browser.
const ROSTER_VIEW_KEY = 'openhamclock_emcommRosterView';
const readRosterView = () => {
  try {
    const v = JSON.parse(localStorage.getItem(ROSTER_VIEW_KEY) || '{}') || {};
    return { group: ['none', 'alias', 'net'].includes(v.group) ? v.group : 'none', show: String(v.show || 'all') };
  } catch {
    return { group: 'none', show: 'all' };
  }
};

// APRS symbol codes for emergency-related stations
const EMCOMM_SYMBOLS = new Set([
  '/o', // EOC
  '\\z', // Shelter
  '\\!', // Emergency
  '/+', // Red Cross
  '\\a', // ARES
  '\\y', // Skywarn
  'Eo', // EOC alternate
  'So', // Shelter alternate
]);

const SYMBOL_LABELS = {
  '/o': 'EOC',
  '\\z': 'Shelter',
  '\\!': 'Emergency',
  '/+': 'Red Cross',
  '\\a': 'ARES',
  '\\y': 'Skywarn',
};

// APRS symbol to icon mapping for station type display
const SYMBOL_ICONS = {
  // Emergency / infrastructure
  '/o': '🏛️',
  '\\z': '🏥',
  '\\!': '🚨',
  '/+': '✚',
  '\\a': '📡',
  '\\y': '🌪️',
  Eo: '🏛️',
  So: '🏥',
  // Mobile / portable
  '/>': '🚗',
  '/[': '🧑',
  '/b': '🚲',
  '/R': '🚐',
  '/u': '🚌',
  '/j': '🏎️',
  '/v': '🚐',
  '/k': '🚚',
  '/Y': '⛵',
  '/X': '🚁',
  '/^': '✈️',
  '\\>': '🚗',
  '\\v': '🚐',
  // Fixed stations
  '/-': '🏠',
  '/a': '🏥',
  '/r': '📡',
  '/I': '📻',
  '/&': '◆',
  '\\-': '🏠',
  '\\r': '📡',
  // Weather
  '/_': '🌤️',
  '/W': '🌡️',
  '\\W': '🌡️',
  // Digipeaters / infrastructure
  '/#': '⬡',
  '/D': '🔁',
};

function getStationIcon(symbol) {
  if (!symbol) return '📍';
  return SYMBOL_ICONS[symbol] || '📍';
}

function getStationType(symbol) {
  if (!symbol) return 'unknown';
  const mobile = new Set(['/>', '\\>', '/[', '/b', '/R', '/u', '/j', '/v', '/k', '/Y', '/X', '/^', '\\v']);
  if (mobile.has(symbol)) return 'mobile';
  const fixed = new Set(['/-', '\\-', '/o', '\\z', '/a', '/r', '\\r', '/I', '/#', '/D', 'Eo', 'So']);
  if (fixed.has(symbol)) return 'fixed';
  return 'unknown';
}

const TOKEN_META = {
  Beds: { label: 'Beds', icon: '🛏️', color: '#22d3ee' },
  Water: { label: 'Water', icon: '💧', color: '#3b82f6' },
  Food: { label: 'Food', icon: '🍞', color: '#f59e0b' },
  Power: { label: 'Power', icon: '⚡', color: '#22c55e' },
  Fuel: { label: 'Fuel', icon: '⛽', color: '#ef4444' },
  Med: { label: 'Medical', icon: '🏥', color: '#dc2626' },
  Staff: { label: 'Staff', icon: '👥', color: '#a855f7' },
  Evac: { label: 'Evacuees', icon: '🚶', color: '#f97316' },
  Comms: { label: 'Comms', icon: '📡', color: '#22d3ee' },
  Gen: { label: 'Generator', icon: '🔋', color: '#eab308' },
};

const SEVERITY_COLORS = {
  Extreme: '#dc2626',
  Severe: '#ea580c',
  Moderate: '#d97706',
  Minor: '#ca8a04',
  Unknown: '#6b7280',
};

const SHELTER_STATUS_COLORS = {
  OPEN: '#22c55e',
  CLOSED: '#ef4444',
  FULL: '#f59e0b',
};

const FIELD_REPORTS_DOCS_URL =
  'https://github.com/accius/openhamclock/blob/main/rig-bridge/README.md#winlink-express-csv-ingest-beta';

/** Field reports from the fldigi plugin's flmsg watcher (vs Winlink Express CSV). */
const isNbemsReport = (r) => /^nbems-flmsg/.test(r?.source || '') || /\(NBEMS\)/.test(r?.formType || '');
/** An NBEMS draft or sent form (only forwarded when the plugin's flmsgIncludeLocal is on). */
const isLocalNbems = (r) => r?.source === 'nbems-flmsg-local' || r?.extra?.origin === 'local';

const EVENT_BTN_STYLE = {
  background: '#1a1f2e',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#ccc',
  fontSize: '10px',
  padding: '3px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

export default function EmcommLayout(props) {
  const {
    config,
    isLocalInstall,
    utcTime,
    utcDate,
    dxLocation,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    mapLayers,
    toggleDXLabels,
    toggleAPRSLabels,
    cycleAprsIconScale,
    toggleSatellites,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    filteredPskSpots,
    wsjtxMapSpots,
    dxClusterData,
    dxFilters,
    mapBandFilter,
    setMapBandFilter,
    aprsData,
    emcommData,
    setShowSettings,
  } = props;

  const { t } = useTranslation();
  const [expandedAlert, setExpandedAlert] = useState(null);
  // Sidebar section collapse state (#1188)
  const [panelMode, setPanelMode] = useState(readPanelMode);
  const [panelStates, setPanelStates] = useState(() => (readPanelMode() === 'remember' ? readPanelStates() : {}));
  const updatePanelStates = useCallback(
    (next) => {
      setPanelStates(next);
      if (panelMode === 'remember') writeStored(PANEL_STATE_KEY, JSON.stringify(next));
    },
    [panelMode],
  );
  const changePanelMode = useCallback((mode) => {
    setPanelMode(mode);
    writeStored(PANEL_MODE_KEY, mode);
    // Apply the new default immediately; 'remember' picks up the saved states
    setPanelStates(mode === 'remember' ? readPanelStates() : {});
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const mainGridRef = useRef(null);
  const clampSidebarWidth = useCallback((w) => {
    const total = mainGridRef.current?.clientWidth || window.innerWidth;
    const max = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, total - MAP_MIN_W - 6));
    return Math.round(Math.max(SIDEBAR_MIN_W, Math.min(max, w)));
  }, []);
  const commitSidebarWidth = useCallback(
    (w) => {
      const next = clampSidebarWidth(w);
      setSidebarWidth(next);
      try {
        if (next === SIDEBAR_DEFAULT_W) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
        else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      } catch {}
    },
    [clampSidebarWidth],
  );
  const startSidebarDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const grid = mainGridRef.current;
      if (!grid) return;
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);
      let latest = sidebarWidth;
      const onMove = (ev) => {
        latest = clampSidebarWidth(grid.getBoundingClientRect().right - ev.clientX);
        setSidebarWidth(latest);
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        document.body.style.cursor = '';
        commitSidebarWidth(latest);
      };
      document.body.style.cursor = 'col-resize';
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [sidebarWidth, clampSidebarWidth, commitSidebarWidth],
  );
  // A width saved on a big screen must not squeeze the map on a smaller one;
  // re-clamp on resize without overwriting the saved preference.
  useEffect(() => {
    const fit = () => setSidebarWidth((w) => clampSidebarWidth(Math.max(w, readSidebarWidth())));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [clampSidebarWidth]);
  // Which panels are shown, and named sets of them (#1241)
  const [panelSets, setPanelSets] = useState(readPanelSets);
  const [panelChooserOpen, setPanelChooserOpen] = useState(false);
  const updatePanelSets = useCallback((next) => setPanelSets(writePanelSets(next)), []);
  const [textZoom, setTextZoom] = useState(readTextZoom);
  const stepTextZoom = useCallback((delta) => {
    setTextZoom((prev) => {
      const idx = TEXT_ZOOM_STEPS.indexOf(prev);
      const next =
        delta === 0
          ? 1.0
          : TEXT_ZOOM_STEPS[Math.max(0, Math.min(TEXT_ZOOM_STEPS.length - 1, (idx < 0 ? 3 : idx) + delta))];
      writeTextZoom(next);
      return next;
    });
  }, []);
  const panels = useMemo(
    () => ({
      zoom: textZoom,
      hiddenFor: (key) => panelSets.hidden.includes(key),
      collapsedFor: (title) => isPanelCollapsed(panelStates, panelMode, title),
      toggle: (title) =>
        updatePanelStates({ ...panelStates, [title]: !isPanelCollapsed(panelStates, panelMode, title) }),
      setAll: (collapsed) => updatePanelStates({ __all: collapsed }),
    }),
    [panelStates, panelMode, updatePanelStates, textZoom, panelSets],
  );
  // APRS source filter: 'all' | 'internet' | 'rf'
  const [aprsSource, setAprsSource] = useState('all');
  // Net operations
  // Everything this server's roster holds, for every net address (#1237)
  const [serverRoster, setNetRoster] = useState([]);
  const [rosterBootId, setRosterBootId] = useState(null);
  // The addresses this station takes check-ins from; the roster, its event
  // log entries and the shared incident only see those (#1237, #1239).
  const [netAliases, setNetAliasesState] = useState(getAliases);
  useEffect(() => {
    const refresh = () => setNetAliasesState(getAliases());
    const onStorage = (e) => {
      if (!e || e.key === ALIASES_KEY) refresh();
    };
    window.addEventListener(ALIASES_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ALIASES_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const changeNetAliases = useCallback((list) => setNetAliasesState(setAliases(list)), []);
  const netRoster = useMemo(() => filterRosterByAliases(serverRoster, netAliases), [serverRoster, netAliases]);
  // Read by the message poll, which keeps one interval across alias edits
  const netAliasesRef = useRef(netAliases);
  netAliasesRef.current = netAliases;
  const myCallRef = useRef(config.callsign);
  myCallRef.current = config.callsign;
  const [rosterView, setRosterView] = useState(readRosterView);
  const updateRosterView = useCallback((patch) => {
    setRosterView((v) => {
      const next = { ...v, ...patch };
      try {
        localStorage.setItem(ROSTER_VIEW_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  // Roster keys net control removed by hand (#1238): their disappearance is
  // logged as a removal, not as a check-out.
  const removedRosterKeysRef = useRef(new Set());
  const rosterAliasSigRef = useRef(null);
  // Voice-net check-ins from the Net Control panel, in the same roster entry
  // shape. Merged into the roster for display and the EmComm-only map filter
  // only — the event-log diff below keeps watching the APRS roster alone,
  // because Net Control records its own check-ins.
  const [voiceRoster, setVoiceRoster] = useState(getNetControlRoster);
  useEffect(() => {
    const refresh = () => setVoiceRoster(getNetControlRoster());
    window.addEventListener(NET_CONTROL_ROSTER_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(NET_CONTROL_ROSTER_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  // This browser's own roster (APRS + voice net). With a shared incident
  // joined it is also what gets mirrored to the incident (see displayRoster).
  const localRoster = useMemo(() => mergeRosters(netRoster, voiceRoster), [netRoster, voiceRoster]);
  // RF-heard APRS shelter reports (kept alongside FEMA data — still works
  // via local TNC when internet infrastructure is down)
  const aprsShelterReports = useAprsShelterReports({ enabled: true });
  // APRS telemetry (sensor dashboards)
  const { telemetry } = useAPRSTelemetry({ enabled: true });
  const [messageTarget, setMessageTarget] = useState(null); // callsign to message
  // Per-station message history (#1216): opened from a roster row (hover or
  // HIST), an EmComm station row, or a map popup's "Messages" link.
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyMsgs, setHistoryMsgs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Opened on purpose (HIST, a map popup's Messages link) rather than by
  // hovering a roster row: then it is pinned in view like the composer (#1242).
  const [historyPinned, setHistoryPinned] = useState(false);
  const historyHoverRef = useRef(null);
  // Map filter (#1215): only recognised EmComm symbols and Net Roster
  // stations. Remembered per browser.
  const [emcommOnly, setEmcommOnly] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_emcommMapEmcommOnly') === '1';
    } catch {
      return false;
    }
  });
  const toggleEmcommOnly = useCallback(() => {
    setEmcommOnly((v) => {
      try {
        localStorage.setItem('openhamclock_emcommMapEmcommOnly', v ? '0' : '1');
      } catch {}
      return !v;
    });
  }, []);
  const [messageText, setMessageText] = useState('');
  // Composer state (#1242, #1243): sending in flight, and the last failure
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const messageInputRef = useRef(null);
  const messageBoxRef = useRef(null);
  const rig = useRigOptional();
  const msgStatus = useAprsMsgStatus(); // live delivery state of what we sent (#1247)
  const rigDirectUrl = directRigUrl(rig);
  // ICS Forms overlay: null (closed) or the form id to open ('309' | '214' | '213' | '205')
  const [icsForm, setIcsForm] = useState(null);
  // Nearby Winlink gateways
  const [winlinkRows, setWinlinkRows] = useState([]);
  const [winlinkServerHasKey, setWinlinkServerHasKey] = useState(true);
  // Predicted HF reachability for the gateway list — the shared runner, so the
  // Winlink panel and map layer reuse the same predictions (never a second run).
  const winlinkReach = useWinlinkReach({
    id: 'emcomm',
    priority: REACH_PRIORITY.emcomm,
    active: true,
    deLocation: config.location,
    propConfig: config.propagation,
    throttleMs: 1000,
  });
  // Field reports — Winlink Express forms ingested via rig-bridge CSV plugin
  const [fieldReports, setFieldReports] = useState([]);
  // Event log — session record for After Action Review
  const [eventLog, setEventLog] = useState(() => getEvents());
  // Previous-snapshot key sets for event-log diffing (null = no snapshot yet)
  const evtPrevRef = useRef({ roster: null, alerts: null, shelters: null, stations: null, fieldReports: null });
  // Bumped when the operator clears the log so the recording effects below
  // re-run against a reset baseline and re-seed the current picture (#1181)
  const [logEpoch, setLogEpoch] = useState(0);
  // Check-in time per roster call, so a check-out event can carry the same
  // dedupe identity in every browser watching this server's roster.
  const rosterCheckinRef = useRef(new Map());
  // Shared incident: while joined, the roster, event log and reports shown
  // here are this browser's own merged with every other joined station's.
  // Not joined → everything below falls back to the local-only data.
  const incident = useSharedIncident({
    callsign: config.callsign,
    localRoster,
    rosterBootId,
    fieldReports,
    shelterReports: aprsShelterReports,
  });
  const incidentJoined = incident.joined;
  const incidentState = incident.state;
  const displayRoster = useMemo(
    () => (incidentJoined ? mergeDisplayedRoster(localRoster, incidentState) : localRoster),
    [incidentJoined, localRoster, incidentState],
  );
  // Net Roster view (#1240): one address only, then grouped
  const rosterShow = netAliases.length > 1 && netAliases.includes(rosterView.show) ? rosterView.show : 'all';
  const shownRoster = useMemo(() => rosterForAddress(displayRoster, rosterShow), [displayRoster, rosterShow]);
  const rosterGroups = useMemo(
    () => groupRoster(shownRoster, rosterView.group, netAliases),
    [shownRoster, rosterView.group, netAliases],
  );
  const displayFieldReports = useMemo(
    () => (incidentJoined ? mergeFieldReports(fieldReports, incidentState) : fieldReports),
    [incidentJoined, fieldReports, incidentState],
  );
  const displayShelterReports = useMemo(
    () => (incidentJoined ? mergeShelterReports(aprsShelterReports, incidentState) : aprsShelterReports),
    [incidentJoined, aprsShelterReports, incidentState],
  );
  // The shared log, each entry marked as this station's own or another site's
  // (message numbers are per station: another site's read "SITE:n").
  const rawIncidentEvents = incident.events;
  const incidentEvents = useMemo(
    () => (incidentJoined ? annotateSharedEvents(rawIncidentEvents, new Set(eventLog.map((e) => e.id))) : []),
    [incidentJoined, rawIncidentEvents, eventLog],
  );
  // Joined: a withdrawal logged at any site hides its entry here too.
  const sharedActiveEvents = useMemo(() => activeEvents(incidentEvents), [incidentEvents]);
  const displayEventLog = incidentJoined ? sharedActiveEvents : eventLog;
  // Admin (holder of the incident's admin key): correct or remove shared records.
  const incidentEditRecord = incident.editRecord;
  const incidentDeleteRecord = incident.deleteRecord;
  const editSharedRecord = useCallback(
    async (kind, id, field, current) => {
      const next = window.prompt(
        t('emcomm.incident.editPrompt', { defaultValue: 'Correct this entry for every station:' }),
        current || '',
      );
      if (next == null || next === current) return;
      try {
        await incidentEditRecord(kind, id, { [field]: next });
      } catch (err) {
        window.alert(err?.message || String(err));
      }
    },
    [incidentEditRecord, t],
  );
  const deleteSharedRecord = useCallback(
    async (kind, id) => {
      if (
        !window.confirm(
          t('emcomm.incident.deleteConfirm', {
            defaultValue: 'Delete this entry from the shared incident for everyone?',
          }),
        )
      )
        return;
      try {
        await incidentDeleteRecord(kind, id);
      } catch (err) {
        window.alert(err?.message || String(err));
      }
    },
    [incidentDeleteRecord, t],
  );
  // High-water mark for received-APRS-message polling (only log traffic from this session on)
  const sessionStartRef = useRef(Date.now());
  const msgSinceRef = useRef(sessionStartRef.current);
  const mapInstanceRef = useRef(null);
  const overlayLayersRef = useRef([]);

  // Fetch the Winlink gateway list once on mount and refresh hourly. The
  // server proxy already caches for 1h so this is essentially free; we use
  // the global list (not /proximity) because the proxy's MaxDistance unit
  // is unreliable — distance filtering happens client-side below.
  useEffect(() => {
    let alive = true;
    const fetchGateways = async () => {
      try {
        const res = await apiFetch('/api/winlink/gateways');
        if (!alive || !res) return;
        if (res.status === 503) {
          setWinlinkServerHasKey(false);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setWinlinkRows(Array.isArray(data.gateways) ? data.gateways : []);
      } catch {}
    };
    fetchGateways();
    const id = setInterval(fetchGateways, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Poll net roster (the boot id tells a server restart from a real roster clear)
  useEffect(() => {
    const fetchRoster = async () => {
      try {
        const res = await fetch('/api/aprs/net');
        if (res.ok) {
          const data = await res.json();
          setNetRoster(data.roster || []);
          setRosterBootId(data.bootId || null);
        }
      } catch (e) {}
    };
    fetchRoster();
    const timer = setInterval(fetchRoster, 10000);
    return () => clearInterval(timer);
  }, []);

  // Poll field reports (Winlink Express CSV and NBEMS flmsg forms via rig-bridge).
  // An flmsg form announced on the bridge stream triggers an early refresh, a
  // moment later so the bridge's POST to the server has landed.
  useEffect(() => {
    const fetchReports = async () => {
      try {
        const res = await apiFetch('/api/emcomm/field-reports', { cache: 'no-store' });
        if (res?.ok) {
          const data = await res.json();
          setFieldReports(Array.isArray(data.reports) ? data.reports : []);
        }
      } catch (e) {}
    };
    fetchReports();
    const timer = setInterval(fetchReports, 30000);
    let soon = null;
    const onPluginData = (e) => {
      if (e?.detail?.event !== 'nbems-form') return;
      clearTimeout(soon);
      soon = setTimeout(fetchReports, 1500);
    };
    window.addEventListener('rig-plugin-data', onPluginData);
    return () => {
      clearInterval(timer);
      clearTimeout(soon);
      window.removeEventListener('rig-plugin-data', onPluginData);
    };
  }, []);

  // Event log: live subscription to the shared session log
  useEffect(() => subscribeEvents(setEventLog), []);

  // Event log: record APRS messages received during this session
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await apiFetch(`/api/aprs/messages?since=${msgSinceRef.current}`, { cache: 'no-store' });
        if (!res?.ok) return;
        const data = await res.json();
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        for (const m of msgs) {
          if (m.timestamp > msgSinceRef.current) msgSinceRef.current = m.timestamp;
          // Only traffic for this station's net addresses, its own callsign and
          // bulletins — not every message between two stations in range (#1237)
          if (!messageIsRelevant(m, netAliasesRef.current, myCallRef.current)) continue;
          recordEvent('aprs_msg_rx', {
            callsign: m.from,
            summary: `${m.type === 'bulletin' ? 'Bulletin' : 'Message'} to ${m.to}`,
            details: m.text || '',
            ts: m.timestamp,
            dedupeKey: `${m.from}-${m.to}-${m.timestamp}`,
          });
        }
      } catch (e) {}
    };
    fetchMessages();
    const timer = setInterval(fetchMessages, 30000);
    return () => clearInterval(timer);
  }, [logEpoch]);

  const { alerts = [], shelters = [], disasters = [], loading, asOf: dataAsOf } = emcommData || {};
  const allAprsStations = aprsData?.stations || [];

  // Stations for the MAP: the hook's filteredStations (watchlist/group rules
  // applied) with this layout's own source select applied on top. The select
  // previously filtered only the EmComm Stations panel list — the map got the
  // unfiltered hook output, so "RF Only" still plotted internet stations
  // (#1175).
  const mapAprsStations = useMemo(() => {
    let base = aprsData?.filteredStations || [];
    if (aprsSource === 'rf') base = base.filter((s) => s.source === 'local-tnc');
    else if (aprsSource === 'internet') base = base.filter((s) => s.source !== 'local-tnc');
    if (!emcommOnly) return base;
    // EmComm-only (#1215): keep recognised EmComm symbols and anyone in the
    // Net Roster. A roster station whose beacon has aged out of the station
    // list but whose position the roster still knows is put back on the map
    // from the roster entry, so checking in never makes a station vanish.
    const rosterKeys = new Set();
    for (const op of displayRoster) {
      if (!op?.call) continue;
      rosterKeys.add(op.call.toUpperCase());
      rosterKeys.add(op.call.toUpperCase().split('-')[0]);
    }
    const kept = base.filter(
      (s) =>
        (s.symbol && EMCOMM_SYMBOLS.has(s.symbol)) ||
        rosterKeys.has(String(s.ssid || '').toUpperCase()) ||
        rosterKeys.has(String(s.call || '').toUpperCase()),
    );
    const present = new Set(kept.map((s) => String(s.ssid || s.call).toUpperCase()));
    for (const op of displayRoster) {
      if (!op?.call || op.lat == null || op.lon == null) continue;
      if (present.has(op.call.toUpperCase())) continue;
      kept.push({
        call: op.call.split('-')[0],
        ssid: op.call,
        lat: op.lat,
        lon: op.lon,
        symbol: '/-',
        comment: `Net ${op.netName || ''}${op.status ? ` · ${op.status}` : ''}`.trim(),
        timestamp: op.lastHeard || op.checkinTime || Date.now(),
        source: op.source === 'local-tnc' ? 'local-tnc' : null,
        fromRoster: true,
      });
    }
    return kept;
  }, [aprsData?.filteredStations, aprsSource, emcommOnly, displayRoster]);

  // Apply APRS source filter
  const aprsStations = useMemo(() => {
    if (aprsSource === 'rf') return allAprsStations.filter((s) => s.source === 'local-tnc');
    if (aprsSource === 'internet') return allAprsStations.filter((s) => s.source !== 'local-tnc');
    return allAprsStations;
  }, [allAprsStations, aprsSource]);

  // Filter APRS stations to emergency symbols
  const emcommStations = useMemo(() => {
    return aprsStations.filter((s) => s.symbol && EMCOMM_SYMBOLS.has(s.symbol));
  }, [aprsStations]);

  // FEMA shelters + RF-heard APRS shelter reports, source-tagged and deduped
  // only when positions are trivially identical
  const mergedShelters = useMemo(
    () => mergeShelters(shelters, displayShelterReports),
    [shelters, displayShelterReports],
  );

  // ── Event log recording — diff-and-append on each data flow update ────────
  // Net roster: check-ins (new calls) and check-outs (calls that disappeared)
  useEffect(() => {
    // Keyed by address + call: one station can be in two groups' nets (#1239).
    // The dedupe keys stay call-based so logs from before this change match.
    // Editing the address list shows or hides whole groups of entries; that
    // is not anyone checking in or out, so start a fresh baseline instead.
    const aliasSig = netAliases.join(',');
    if (rosterAliasSigRef.current !== aliasSig) {
      rosterAliasSigRef.current = aliasSig;
      evtPrevRef.current.roster = null;
    }
    const { added, removed, keys } = diffAdded(evtPrevRef.current.roster, netRoster, rosterKey);
    const multi = netAliases.length > 1;
    for (const op of added) {
      recordEvent('net_checkin', {
        callsign: op.call,
        summary: `Checked into ${op.netName}${multi ? ` (${entryAlias(op)})` : ''}`,
        details: op.status && op.status !== 'Checked in' ? op.status : '',
        ts: op.checkinTime,
        dedupeKey: `${op.call}-${op.checkinTime}`,
      });
    }
    for (const key of removed) {
      const call = key.slice(key.indexOf('|') + 1);
      if (removedRosterKeysRef.current.delete(key)) continue; // logged as a removal
      const checkinTime = rosterCheckinRef.current.get(key);
      recordEvent('net_checkout', {
        callsign: call,
        summary: 'Checked out of net',
        // Two browsers on one server (or a shared incident) log it once.
        ...(checkinTime ? { dedupeKey: `${call}-${checkinTime}-out` } : {}),
      });
    }
    rosterCheckinRef.current = new Map(netRoster.filter((op) => op?.call).map((op) => [rosterKey(op), op.checkinTime]));
    evtPrevRef.current.roster = keys;
  }, [netRoster, netAliases, logEpoch]);

  // NWS alerts: new alert IDs
  useEffect(() => {
    const { added, keys } = diffAdded(evtPrevRef.current.alerts, alerts, (a) => a.id);
    for (const a of added) {
      recordEvent('nws_alert', {
        summary: `${a.severity || 'Unknown'}: ${a.event || 'Alert'}`,
        details: a.headline || '',
        dedupeKey: a.id,
      });
    }
    evtPrevRef.current.alerts = keys;
  }, [alerts, logEpoch]);

  // APRS shelter reports: new reports (keyed by sender + report timestamp)
  useEffect(() => {
    const { added, keys } = diffAdded(
      evtPrevRef.current.shelters,
      aprsShelterReports,
      (s) => `${s.from}-${s.timestamp}`,
    );
    for (const s of added) {
      recordEvent('shelter_report', {
        callsign: s.from,
        summary: 'Shelter report received',
        details: s.text || '',
        ts: s.timestamp,
        dedupeKey: `${s.from}-${s.timestamp}`,
      });
    }
    evtPrevRef.current.shelters = keys;
  }, [aprsShelterReports, logEpoch]);

  // EmComm APRS stations: first-heard (once per station per log lifetime)
  useEffect(() => {
    const { added, keys } = diffAdded(evtPrevRef.current.stations, emcommStations, (s) => s.ssid || s.call);
    for (const s of added) {
      recordEvent('station_heard', {
        callsign: s.ssid || s.call,
        summary: `${SYMBOL_LABELS[s.symbol] || 'EmComm'} station heard${s.source === 'local-tnc' ? ' via RF' : ''}`,
        dedupeKey: s.ssid || s.call,
      });
    }
    evtPrevRef.current.stations = keys;
  }, [emcommStations, logEpoch]);

  // Field reports: new report IDs (row hashes from the CSV ingest)
  useEffect(() => {
    const { added, keys } = diffAdded(evtPrevRef.current.fieldReports, fieldReports, (r) => r.id);
    for (const r of added) {
      recordEvent('field_report', {
        callsign: r.callsign,
        summary: r.formType ? `Field report: ${r.formType}` : 'Field report received',
        details: r.text || '',
        ts: r.timestamp,
        dedupeKey: r.id,
      });
    }
    evtPrevRef.current.fieldReports = keys;
  }, [fieldReports, logEpoch]);

  // Calculate distance from DE for shelters
  const sheltersWithDistance = useMemo(() => {
    if (config.location?.lat == null || config.location?.lon == null) return mergedShelters;
    return mergedShelters
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [mergedShelters, config.location]);

  // Calculate distance for emcomm APRS stations
  const emcommStationsWithDistance = useMemo(() => {
    if (config.location?.lat == null || config.location?.lon == null) return emcommStations;
    return emcommStations
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [emcommStations, config.location]);

  // Aggregate Winlink rows by callsign, decode location from gridsquare,
  // compute distance from operator's QTH, sort nearest-first. ~4800 rows
  // collapse to ~1200 unique gateways — cheap to recompute per change.
  // Used for both the sidebar panel (top 25) and the map overlay (all).
  const winlinkGateways = useMemo(() => {
    if (!winlinkRows.length) return [];
    const haveQth = config.location?.lat != null && config.location?.lon != null;
    const byCall = new Map();
    for (const r of winlinkRows) {
      if (!r.callsign || !r.gridsquare) continue;
      let entry = byCall.get(r.callsign);
      if (!entry) {
        const pos = maidenheadToLatLon(r.gridsquare);
        if (!pos) continue;
        entry = {
          callsign: r.callsign,
          gridsquare: r.gridsquare,
          lat: pos.lat,
          lon: pos.lon,
          distance: haveQth ? calculateDistance(config.location.lat, config.location.lon, pos.lat, pos.lon) : null,
          channels: [],
          hasEmcomm: false,
        };
        byCall.set(r.callsign, entry);
      }
      entry.channels.push({
        frequency: r.frequency,
        mode: r.mode,
        modeLabel: winlinkModeLabel(r.mode),
        serviceCode: r.serviceCode || 'PUBLIC',
        hours: r.hours,
      });
      if ((r.serviceCode || '').toUpperCase().includes('EMCOMM')) entry.hasEmcomm = true;
    }
    const list = [...byCall.values()];
    if (haveQth) list.sort((a, b) => a.distance - b.distance);
    return list;
  }, [winlinkRows, config.location]);

  // Panel order: predicted status first (Good → Marginal → Closed → Off the
  // air → not predicted), nearest first within a status. VHF/UHF gateways
  // rank by line of sight. The map keeps the distance order above.
  const winlinkPanelGateways = useMemo(() => {
    const byCall = winlinkReach.byCall;
    if (!byCall) return winlinkGateways;
    return winlinkGateways
      .map((gw) => ({ ...gw, reach: byCall[gw.callsign] || null }))
      .sort((a, b) => {
        const ka = STATUS_ORDER[reachColorKey(a.reach)] ?? 9;
        const kb = STATUS_ORDER[reachColorKey(b.reach)] ?? 9;
        if (ka !== kb) return ka - kb;
        return (a.distance ?? Infinity) - (b.distance ?? Infinity);
      });
  }, [winlinkGateways, winlinkReach.byCall]);

  // Sort alerts by severity
  const sortedAlerts = useMemo(() => {
    const order = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    return [...alerts].sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
  }, [alerts]);

  // Handle map ready — add range rings and overlays
  const handleMapReady = useCallback((map) => {
    mapInstanceRef.current = map;
  }, []);

  // Manage range rings and alert/shelter overlays
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof window.L === 'undefined') return;
    const L = window.L;

    // Clear previous overlays
    overlayLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {
        /* ignore */
      }
    });
    overlayLayersRef.current = [];

    const de = config.location;
    if (de?.lat == null || de?.lon == null) return;

    // Range rings at 50, 100, 200 km
    [50, 100, 200].forEach((km) => {
      const ring = L.circle([de.lat, de.lon], {
        radius: km * 1000,
        fill: false,
        color: '#666',
        weight: 1,
        dashArray: '8,8',
        interactive: false,
      });
      ring.addTo(map);
      overlayLayersRef.current.push(ring);

      // Label
      const label = L.marker([de.lat + km / 111, de.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span style="color:#888;font-size:10px;white-space:nowrap">${km}km</span>`,
          iconSize: [40, 14],
          iconAnchor: [20, 14],
        }),
        interactive: false,
      });
      label.addTo(map);
      overlayLayersRef.current.push(label);
    });

    // NWS Alert polygons
    alerts.forEach((alert) => {
      if (!alert.geometry?.coordinates) return;
      const color = SEVERITY_COLORS[alert.severity] || '#6b7280';
      try {
        const coords = alert.geometry.type === 'Polygon' ? [alert.geometry.coordinates] : alert.geometry.coordinates;
        coords.forEach((polyCoords) => {
          const latlngs = polyCoords[0].map(([lon, lat]) => [lat, lon]);
          const polygon = L.polygon(latlngs, {
            color,
            fillColor: color,
            fillOpacity: 0.15,
            weight: 2,
          });
          polygon.bindPopup(`<b>${esc(alert.event)}</b><br>${esc(alert.headline || '')}`);
          polygon.addTo(map);
          overlayLayersRef.current.push(polygon);
        });
      } catch (e) {
        /* skip malformed geometry */
      }
    });

    // Shelter markers — FEMA (solid) and APRS-reported (dashed ring) sources
    mergedShelters.forEach((shelter) => {
      if (shelter.lat == null || shelter.lon == null) return;
      const isAprs = shelter.source !== 'fema';
      const color = SHELTER_STATUS_COLORS[shelter.status] || '#6b7280';
      const marker = L.circleMarker([shelter.lat, shelter.lon], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: isAprs ? 0.35 : 0.6,
        weight: 2,
        ...(isAprs ? { dashArray: '3,3' } : {}),
      });
      let pop;
      if (isAprs) {
        const srcLabel = shelter.source === 'aprs-rf' ? 'APRS RF' : 'APRS';
        pop = `<b>🏥 ${esc(shelter.from)}</b> <span style="color:#22c55e;font-size:9px;font-weight:700">${srcLabel}</span><br>
          ${esc(shelter.text || '')}<br>
          Status: ${esc(shelter.status || 'Unknown')}
          ${shelter.evacuationCapacity ? `<br>Capacity: ${shelter.currentPopulation || 0}/${shelter.evacuationCapacity}` : ''}`;
      } else {
        pop = `<b>${esc(shelter.name || 'Shelter')}</b> <span style="color:#888;font-size:9px;font-weight:700">FEMA</span><br>
          ${esc(shelter.address || '')}, ${esc(shelter.city || '')}<br>
          Status: ${esc(shelter.status || 'Unknown')}<br>
          Capacity: ${shelter.currentPopulation || 0}/${shelter.evacuationCapacity || '?'}
          ${shelter.wheelchairAccessible ? ' ♿' : ''}${shelter.petFriendly ? ' 🐾' : ''}`;
        if (shelter.aprsReport) {
          pop += `<br><span style="color:#22c55e;font-size:10px">📡 ${esc(shelter.aprsReport.from)}: ${esc(shelter.aprsReport.text || '')}</span>`;
        }
      }
      marker.bindPopup(pop);
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    // EmComm APRS station markers with token popups
    emcommStationsWithDistance.forEach((station) => {
      if (station.lat == null || station.lon == null) return;
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 6,
        color: '#22d3ee',
        fillColor: '#22d3ee',
        fillOpacity: 0.5,
        weight: 2,
      });
      const stationIcon = getStationIcon(station.symbol);
      const stationType = getStationType(station.symbol);
      const sourceTag = station.source === 'local-tnc' ? ' <span style="color:#22c55e;font-size:10px">RF</span>' : '';
      let popupHtml = `<b style="color:#22d3ee">${stationIcon} ${esc(station.ssid || station.call)}</b>${sourceTag}`;
      popupHtml += `<br><span style="color:#888">${esc(SYMBOL_LABELS[station.symbol] || 'EmComm')} (${stationType})</span>`;
      if (station.tokens && station.tokens.length > 0) {
        popupHtml += '<br><div style="margin-top:4px">';
        station.tokens.forEach((t) => {
          const meta = TOKEN_META[t.key] || { icon: '📦', label: esc(t.key) };
          let val;
          if (t.type === 'capacity') val = `${t.current}/${t.max}`;
          else if (t.type === 'need') val = `<span style="color:#ef4444">${esc(t.value)} NEEDED</span>`;
          else if (t.type === 'critical') val = '<span style="color:#ef4444">CRITICAL</span>';
          else val = esc(t.value);
          popupHtml += `${meta.icon} <b>${esc(meta.label)}:</b> ${val}<br>`;
        });
        popupHtml += '</div>';
        if (station.cleanComment) {
          popupHtml += `<div style="color:#888;margin-top:4px">${esc(station.cleanComment)}</div>`;
        }
      } else if (station.comment) {
        popupHtml += `<br>${esc(station.comment)}`;
      }
      marker.bindPopup(popupHtml);
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    // Field report markers (Winlink Express forms via rig-bridge) — clipboard icon
    displayFieldReports.forEach((r) => {
      if (r.lat == null || r.lon == null) return;
      const marker = L.marker([r.lat, r.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="font-size:16px;line-height:16px;filter:drop-shadow(0 0 2px #000)">📋</div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      });
      const when = r.timestamp ? new Date(r.timestamp).toISOString().replace('T', ' ').substring(0, 16) + 'Z' : '';
      marker.bindPopup(
        `<b style="color:#f472b6">📋 ${esc(r.callsign || 'Unknown')}</b> ` +
          `<span style="color:#888;font-size:9px;font-weight:700">${isNbemsReport(r) ? 'NBEMS' : 'WINLINK'}</span><br>` +
          `${esc(r.formType || 'Field Report')}<br>` +
          (r.text ? `<span style="color:#aaa">${esc(r.text.substring(0, 200))}</span><br>` : '') +
          `<span style="color:#888;font-size:10px">${when}</span>`,
      );
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    return () => {
      overlayLayersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {
          /* ignore */
        }
      });
      overlayLayersRef.current = [];
    };
  }, [config.location, alerts, mergedShelters, emcommStationsWithDistance, displayFieldReports]);

  // Winlink gateway markers — their own layer set so reachability updates
  // (throttled to 1/s while predictions stream in) redraw only these, not the
  // alert/shelter/station overlays. Coloured like the Winlink Gateways map
  // layer: predicted status when the shared runner has results (grey, faded
  // dots for gateways it did not predict), mode family otherwise. The
  // EMCOMM red ring and the nearest-25 emphasis are kept.
  const winlinkLayersRef = useRef([]);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof window.L === 'undefined') return undefined;
    const L = window.L;
    const byCall = winlinkReach.byCall;
    const units = config.allUnits?.dist || 'imperial';

    winlinkGateways.forEach((gw, idx) => {
      const channelsByFreq = gw.channels.slice().sort((a, b) => a.frequency - b.frequency);
      const modeColor = winlinkModeColor(channelsByFreq[0]?.mode);
      const isNearby = idx < 25;
      const style = reachMarkerStyle(byCall, gw.callsign, { opacity: 1, modeColor });
      const radius = byCall ? (style.dim ? 3 : isNearby ? 6 : 5) : isNearby ? 5 : 3;
      const fillOpacity = byCall ? (style.dim ? 0.35 : 0.8) : isNearby ? 0.7 : 0.45;
      const marker = L.circleMarker([gw.lat, gw.lon], {
        radius,
        color: gw.hasEmcomm ? '#ef4444' : style.fillColor,
        fillColor: style.fillColor,
        fillOpacity,
        weight: gw.hasEmcomm ? 2 : 1,
      });
      const channelRows = channelsByFreq
        .slice(0, 6)
        .map(
          (c) =>
            `<tr><td style="padding:1px 6px 1px 0;color:#aaa">${(c.frequency / 1e6).toFixed(3)}</td>` +
            `<td style="padding:1px 6px 1px 0;color:${winlinkModeColor(c.mode)};font-weight:600">${esc(c.modeLabel)}</td>` +
            `<td style="padding:1px 0;color:#888;font-size:9px">${esc(c.serviceCode)}</td></tr>`,
        )
        .join('');
      const moreCount = channelsByFreq.length - 6;
      const distanceLine =
        gw.distance != null ? `<br><span style="color:#888">${formatDistance(gw.distance, units)} away</span>` : '';
      const reachHtml = byCall ? reachPopupLine(byCall[gw.callsign], t) : '';
      const popupHtml = `
        <div style="font-family:var(--font-mono);font-size:11px;min-width:180px">
          <b style="color:#3b82f6">📬 ${esc(gw.callsign)}</b>
          ${gw.hasEmcomm ? ' <span style="color:#ef4444;font-size:9px;font-weight:700">EMCOMM</span>' : ''}
          <br><span style="color:#888;font-size:10px">Grid ${esc(gw.gridsquare)}</span>${distanceLine}
          ${reachHtml ? `<div style="margin-top:4px">${reachHtml}</div>` : ''}
          <table style="border-collapse:collapse;font-size:10px;margin-top:4px">${channelRows}</table>
          ${moreCount > 0 ? `<div style="color:#666;font-size:9px;margin-top:3px">+${moreCount} more channel${moreCount === 1 ? '' : 's'}</div>` : ''}
        </div>`;
      marker.bindPopup(popupHtml);
      marker.addTo(map);
      winlinkLayersRef.current.push(marker);
    });

    return () => {
      winlinkLayersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {
          /* ignore */
        }
      });
      winlinkLayersRef.current = [];
    };
  }, [winlinkGateways, winlinkReach.byCall, config.allUnits?.dist, t]);

  // Click shelter to pan map
  // Bring a panel row's target (shelter, station, gateway, roster op, field
  // report) into view: always pans, zooms to 10, pulses the target (#1182).
  // Rows without a position (roster ops never heard on APRS) are a no-op.
  const openHistory = useCallback(
    async (call, { reveal = false } = {}) => {
      const key = String(call || '').trim();
      if (!key) return;
      setHistoryTarget(key);
      // A hover never unpins a list someone opened on purpose
      if (reveal) setHistoryPinned(true);
      setHistoryLoading(true);
      try {
        const res = await apiFetch(`/api/aprs/messages/history?call=${encodeURIComponent(key)}`, {
          cache: 'no-store',
        });
        const data = res?.ok ? await res.json() : { messages: [] };
        const server = Array.isArray(data.messages) ? data.messages : [];
        // Messages we sent before the server started keeping its own side
        // live only in the Event Log; merge those that the server lacks.
        const upper = key.toUpperCase();
        const base = upper.split('-')[0];
        const fromLog = (eventLog || [])
          .filter((ev) => ev.type === 'aprs_msg_sent' && typeof ev.summary === 'string')
          .map((ev) => ({
            ev,
            to: ev.summary
              .replace(/^Message to\s+/i, '')
              .trim()
              .toUpperCase(),
          }))
          .filter(({ to }) => to === upper || to.split('-')[0] === base)
          .map(({ ev, to }) => ({
            from: ev.callsign,
            to,
            text: ev.details || '',
            timestamp: ev.ts,
            direction: 'sent',
            source: 'log',
          }));
        const seen = new Set(server.map((m) => `${m.direction}|${m.text}|${Math.round((m.timestamp || 0) / 60000)}`));
        const merged = [...server];
        for (const m of fromLog) {
          const k = `sent|${m.text}|${Math.round((m.timestamp || 0) / 60000)}`;
          if (!seen.has(k)) merged.push(m);
        }
        merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        // Joined to a shared incident: messages other sites sent or received too.
        const shared = incidentJoined ? messageHistoryFromEvents(sharedActiveEvents, key) : [];
        setHistoryMsgs(shared.length ? mergeMessageHistory(merged, shared) : merged);
      } catch {
        setHistoryMsgs([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [eventLog, incidentJoined, sharedActiveEvents],
  );
  // Remove a roster entry by hand, e.g. a check-in to the wrong net (#1238).
  // The Event Log gets a "Removed from Roster" entry (with the reason, if
  // given) instead of a check-out, so the record shows the correction.
  const incidentCheckOut = incident.checkOut;
  const removeRosterEntry = useCallback(
    async (op) => {
      const alias = entryAlias(op);
      const reason = window.prompt(
        `Remove ${op.call} (${op.netName || 'no net name'}, sent to ${op.address || alias}) from the Net Roster?\n\n` +
          'The removal is recorded in the Event Log. Reason (optional), e.g. "wrong net name":',
        '',
      );
      if (reason == null) return;
      const key = rosterKey(op);
      const onServer = netRoster.some((e) => rosterKey(e) === key);
      if (onServer) {
        removedRosterKeysRef.current.add(key);
        let ok = false;
        try {
          const res = await fetch('/api/aprs/net/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callsign: op.call, alias: op.address || alias }),
          });
          ok = res.ok;
        } catch {}
        if (!ok) {
          removedRosterKeysRef.current.delete(key);
          window.alert(`Could not remove ${op.call}: the server did not answer. Try again.`);
          return;
        }
        const address = String(op.address || alias).toUpperCase();
        setNetRoster((prev) =>
          prev.filter(
            (e) =>
              !(
                String(e.call).toUpperCase() === String(op.call).toUpperCase() &&
                String(e.alias || 'EMCOMM').toUpperCase() === address
              ),
          ),
        );
      }
      if (incidentJoined) incidentCheckOut(op.call, op, { log: false });
      const by = String(config.callsign || '').toUpperCase();
      recordEvent('net_removed', {
        callsign: op.call,
        summary: `Removed from the ${op.netName ? `${op.netName} ` : ''}roster (${alias})${by && by !== 'N0CALL' ? ` by ${by}` : ''}`,
        details: String(reason).trim(),
        dedupeKey: `${op.call}-${op.checkinTime || ''}-removed`,
      });
    },
    [netRoster, incidentJoined, incidentCheckOut, config.callsign],
  );
  const scheduleHistoryHover = useCallback(
    (call) => {
      clearTimeout(historyHoverRef.current);
      historyHoverRef.current = setTimeout(() => openHistory(call), 450);
    },
    [openHistory],
  );

  // "Messages ↗" in an APRS map popup → open that station's history (#1216).
  // Declared after openHistory: the deps array is evaluated during render,
  // so placing it earlier threw "Cannot access 'openHistory' before
  // initialization" and crashed the whole EmComm layout (#1223).
  useEffect(() => {
    const onReq = (e) => {
      if (e?.detail?.call) openHistory(e.detail.call, { reveal: true });
    };
    window.addEventListener(APRS_HISTORY_EVENT, onReq);
    return () => window.removeEventListener(APRS_HISTORY_EVENT, onReq);
  }, [openHistory]);
  const cancelHistoryHover = useCallback(() => clearTimeout(historyHoverRef.current), []);

  const panToTarget = useCallback((item) => {
    if (item?.lat == null || item?.lon == null) return;
    requestMapFocus({ lat: item.lat, lon: item.lon, zoom: 10, force: true });
  }, []);

  // Send an APRS message to the current target (shared by Enter key + button)
  // and record it in the event log.
  // Waits for the TNC's answer (#1243): a failed send used to be logged as
  // sent and the composer closed, so nothing on screen said it never left.
  const sendMessageToTarget = useCallback(async () => {
    const text = messageText.trim();
    if (!text || !messageTarget || messageSending) return;
    setMessageSending(true);
    setMessageError('');
    const r = await sendAprsMessage({ to: messageTarget, message: text, rigUrl: rigDirectUrl });
    setMessageSending(false);
    if (!r.ok) {
      setMessageError(r.error || 'Not sent');
      return;
    }
    recordEvent('aprs_msg_sent', {
      callsign: config.callsign || 'N0CALL',
      summary: `Message to ${messageTarget}`,
      details: text,
    });
    // The open list for this station shows the new message and its delivery state
    if (historyTarget && historyTarget.toUpperCase() === messageTarget.toUpperCase()) {
      setTimeout(() => openHistory(historyTarget), 300);
    }
    setMessageText('');
    setMessageTarget(null);
  }, [messageText, messageTarget, messageSending, rigDirectUrl, config.callsign, historyTarget, openHistory]);
  // Opening the composer (any MSG button) brings it into view and puts the
  // cursor in the message line (#1242).
  useEffect(() => {
    setMessageError('');
    if (!messageTarget) return;
    const id = requestAnimationFrame(() => {
      messageBoxRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [messageTarget]);

  // ── Event log export handlers ─────────────────────────────────────────────
  const exportEventLogCsv = useCallback(() => {
    const csv = eventsToCSV(incidentJoined ? incident.events : getEvents());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emcomm-event-log-${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [incidentJoined, incident.events]);

  const printEventLog = useCallback(() => {
    const loc = config.location;
    const grid = loc?.lat != null && loc?.lon != null ? latLonToMaidenhead({ lat: loc.lat, lon: loc.lon }) : '';
    const html = buildPrintHtml({
      events: incidentJoined ? incident.events : getEvents(),
      callsign: config.callsign,
      location: loc,
      grid,
    });
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }, [config.callsign, config.location, incidentJoined, incident.events]);

  const clearEventLog = useCallback(() => {
    if (
      !window.confirm(
        'Clear the entire EmComm event log? This cannot be undone. Station message numbers keep counting — reset them under ICS Forms → 309.',
      )
    )
      return;
    clearEvents();
    // Two earlier behaviours were both wrong. Leaving the diff snapshots
    // alone meant nothing could log again until a brand-new station appeared
    // (#1181, "the log looks dead"). Resetting them to *empty* sets (the first
    // fix) re-logged the whole current board the instant Clear was pressed,
    // so the log looked like it never cleared (#1211). Null snapshots take the
    // middle road: the next effect pass re-baselines on what is on the board
    // now without reporting any of it, and only activity after this moment
    // is recorded — which is what "clear it between operations" means.
    evtPrevRef.current = { roster: null, alerts: null, shelters: null, stations: null, fieldReports: null };
    msgSinceRef.current = Date.now();
    setLogEpoch((n) => n + 1);
  }, []);

  // Time until expiry helper
  const expiresIn = useCallback((expiresStr) => {
    if (!expiresStr) return '';
    const diff = new Date(expiresStr) - new Date();
    if (diff <= 0) return 'Expired';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }, []);

  // Incident type icon
  const incidentIcon = useCallback((type) => {
    const icons = {
      Hurricane: '🌀',
      Tornado: '🌪️',
      Flood: '🌊',
      Fire: '🔥',
      'Severe Storm': '⛈️',
      Earthquake: '🏚️',
      'Snow/Ice': '❄️',
    };
    return icons[type] || '⚠️';
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '44px 1fr',
        background: '#0a0a0a',
        fontFamily: 'var(--font-mono)',
        overflow: 'hidden',
        color: '#ccc',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: '#111',
          borderBottom: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{ color: '#f59e0b', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => setShowSettings(true)}
          >
            {config.callsign || 'N0CALL'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px', letterSpacing: '2px' }}>
            EMERGENCY COMMUNICATIONS
          </span>
          <span
            style={{
              color: '#888',
              fontSize: '9px',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '1px 4px',
              marginLeft: '4px',
            }}
          >
            BETA
          </span>
          {loading && <span style={{ color: '#888', fontSize: '11px', marginLeft: '8px' }}>Loading...</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
          {/* utcTime already carries seconds (HH:MM:SS); a second ticker used to
              be appended, printing "00:13:47:47", and the date was missing (#1217) */}
          <span style={{ color: '#888', marginRight: '8px', fontSize: '12px' }}>{utcDate}</span>
          <span style={{ color: '#fff', fontWeight: 600 }}>{utcTime}</span>
          <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>UTC</span>
        </div>
      </div>

      {/* MAIN: MAP + SIDEBAR */}
      <div
        ref={mainGridRef}
        style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) 6px ${sidebarWidth}px`, overflow: 'hidden' }}
      >
        {/* MAP */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <WorldMap
            config={config}
            isLocalInstall={isLocalInstall}
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            potaSpots={[]}
            sotaSpots={[]}
            wwbotaSpots={[]}
            mySpots={[]}
            dxPaths={[]}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={[]}
            pskReporterSpots={[]}
            showDeDxMarkers={mapLayers?.showDeDxMarkers ?? true}
            showDXPaths={false}
            showDXLabels={false}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={false}
            showSOTA={false}
            showWWBOTA={false}
            showSatellites={false}
            showPSKReporter={false}
            showPSKPaths={false}
            wsjtxSpots={[]}
            showWSJTX={false}
            showDXNews={false}
            showAPRS={true}
            aprsStations={mapAprsStations}
            aprsWatchlistCalls={aprsData?.allWatchlistCalls}
            showAPRSLabels={mapLayers?.showAPRSLabels ?? false}
            aprsIconScale={mapLayers?.aprsIconScale ?? 1}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onMapReady={handleMapReady}
          />
        </div>

        {/* SPLITTER — drag to resize the sidebar, arrows step it, double-click resets (#1233) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN_W}
          aria-valuemax={SIDEBAR_MAX_W}
          tabIndex={0}
          title="Drag to resize the sidebar · double-click to reset"
          onPointerDown={startSidebarDrag}
          onDoubleClick={() => commitSidebarWidth(SIDEBAR_DEFAULT_W)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              commitSidebarWidth(sidebarWidth + (e.key === 'ArrowLeft' ? 20 : -20));
            }
          }}
          style={{
            cursor: 'col-resize',
            touchAction: 'none',
            background: '#1a1a1a',
            borderLeft: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '2px', height: '32px', borderRadius: '1px', background: '#444' }} />
        </div>

        {/* SIDEBAR */}
        <div
          style={{
            background: '#111',
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Panel state toolbar (#1188), pinned to the top of the rail so it
              stays in reach as panels expand below it (#1255). Sticky stops
              at the rail's 8px padding, so it pulls up over that strip to
              keep scrolled panels from showing above it. */}
          <div
            style={{
              position: 'sticky',
              top: '-8px',
              zIndex: 5,
              flexShrink: 0,
              margin: '-8px 0 0',
              background: '#111',
              boxShadow: '0 6px 8px -6px rgba(0,0,0,0.6)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '4px 6px',
              padding: '10px 4px 4px',
              fontSize: '10px',
              color: '#888',
            }}
          >
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>Panels</span>
            <select
              value={panelMode}
              onChange={(e) => changePanelMode(e.target.value)}
              title="What the sidebar panels look like when you open Emcomm mode"
              style={{
                background: '#1a1a1a',
                color: '#ccc',
                border: '1px solid #333',
                borderRadius: '3px',
                fontSize: '10px',
                padding: '1px 4px',
              }}
            >
              {PANEL_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <PanelSetSelect state={panelSets} onChange={updatePanelSets} />
            <button
              type="button"
              onClick={() => setPanelChooserOpen((v) => !v)}
              aria-expanded={panelChooserOpen}
              title="Choose which panels the sidebar shows, and save sets of them"
              style={{
                ...PANEL_TOOL_BTN,
                ...(panelChooserOpen ? { color: '#22d3ee', borderColor: '#22d3ee' } : {}),
              }}
            >
              Choose
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => stepTextZoom(-1)}
              disabled={textZoom <= TEXT_ZOOM_STEPS[0]}
              title="Decrease panel text size"
              style={{ ...PANEL_TOOL_BTN, fontWeight: 700, opacity: textZoom <= TEXT_ZOOM_STEPS[0] ? 0.3 : 1 }}
            >
              A−
            </button>
            {textZoom !== 1.0 && (
              <button
                type="button"
                onClick={() => stepTextZoom(0)}
                title="Reset panel text size"
                style={{ ...PANEL_TOOL_BTN, color: 'var(--accent-amber)' }}
              >
                {Math.round(textZoom * 100)}%
              </button>
            )}
            <button
              type="button"
              onClick={() => stepTextZoom(1)}
              disabled={textZoom >= TEXT_ZOOM_STEPS[TEXT_ZOOM_STEPS.length - 1]}
              title="Increase panel text size"
              style={{
                ...PANEL_TOOL_BTN,
                fontWeight: 700,
                opacity: textZoom >= TEXT_ZOOM_STEPS[TEXT_ZOOM_STEPS.length - 1] ? 0.3 : 1,
              }}
            >
              A+
            </button>
            <button type="button" onClick={() => panels.setAll(false)} style={PANEL_TOOL_BTN}>
              Expand all
            </button>
            <button type="button" onClick={() => panels.setAll(true)} style={PANEL_TOOL_BTN}>
              Collapse all
            </button>
          </div>
          {panelChooserOpen && (
            <EmcommPanelChooser
              state={panelSets}
              onChange={updatePanelSets}
              onClose={() => setPanelChooserOpen(false)}
            />
          )}

          {/* Shared incident — create / join / leave, board, invite, manual check-in */}
          <PanelSection
            title="Incident"
            count={incidentJoined ? incident.participants : 0}
            color="#38bdf8"
            extra={<IncidentStatusPill status={incident.status} />}
            panels={panels}
          >
            <EmcommIncidentPanel incident={incident} callsign={config.callsign} />
          </PanelSection>

          {/* Resource Summary Dashboard */}
          <ResourceSummary stations={emcommStationsWithDistance} panels={panels} />

          {/* NWS Alerts Panel */}
          <PanelSection
            title="NWS Alerts"
            count={sortedAlerts.length}
            color="#dc2626"
            panels={panels}
            extra={dataAsOf?.alerts ? <OfflineAsOf t={t} ts={dataAsOf.alerts} /> : null}
          >
            {sortedAlerts.length === 0 ? (
              <EmptyState text="No active alerts for your area" />
            ) : (
              sortedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    padding: '6px 8px',
                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity] || '#888'}`,
                    background: expandedAlert === alert.id ? '#1a1a1a' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: '4px',
                  }}
                  onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: SEVERITY_COLORS[alert.severity], fontWeight: 600, fontSize: '12px' }}>
                      {alert.event}
                    </span>
                    <span style={{ color: '#888', fontSize: '10px' }}>{expiresIn(alert.expires)}</span>
                  </div>
                  <div style={{ color: '#aaa', fontSize: '11px', marginTop: '2px' }}>{alert.headline}</div>
                  {expandedAlert === alert.id && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#999', lineHeight: '1.4' }}>
                      {alert.description && (
                        <div style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
                          {alert.description.substring(0, 500)}
                          {alert.description.length > 500 ? '...' : ''}
                        </div>
                      )}
                      {alert.instruction && (
                        <div style={{ color: '#f59e0b', fontStyle: 'italic' }}>
                          {alert.instruction.substring(0, 300)}
                        </div>
                      )}
                      <div style={{ color: '#666', marginTop: '4px' }}>{alert.areaDesc}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </PanelSection>

          {/* Disaster Declarations Panel */}
          <PanelSection
            title="Disaster Declarations"
            count={disasters.length}
            color="#f59e0b"
            panels={panels}
            extra={dataAsOf?.disasters ? <OfflineAsOf t={t} ts={dataAsOf.disasters} /> : null}
          >
            {disasters.length === 0 ? (
              <EmptyState text="No recent disaster declarations" />
            ) : (
              <>
                {disasters.map((d) => {
                  const kind =
                    d.declarationType === 'DR'
                      ? 'Major disaster'
                      : d.declarationType === 'EM'
                        ? 'Emergency'
                        : d.declarationType === 'FM'
                          ? 'Fire management'
                          : d.declarationType;
                  const areas = Array.isArray(d.areas) ? d.areas : [];
                  const shownAreas = areas.slice(0, 4).join(', ');
                  const moreAreas = areas.length > 4 ? ` +${areas.length - 4} more` : '';
                  const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
                  return (
                    <div
                      key={d.id || d.disasterNumber}
                      style={{
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '11px',
                        marginBottom: '2px',
                      }}
                    >
                      <span style={{ fontSize: '14px' }}>{incidentIcon(d.incidentType)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#ddd' }}>
                          {d.declarationTitle}
                          {d.url && (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open this declaration on fema.gov"
                              style={{ color: '#f59e0b', marginLeft: '6px', fontSize: '10px', textDecoration: 'none' }}
                            >
                              FEMA ↗
                            </a>
                          )}
                        </div>
                        <div style={{ color: '#888', fontSize: '10px' }}>
                          {d.incidentType} — {kind}
                          {d.disasterNumber ? ` · ${d.declarationType || 'DR'}-${d.disasterNumber}` : ''}
                        </div>
                        <div style={{ color: '#888', fontSize: '10px' }}>
                          Declared {day(d.declarationDate)}
                          {d.incidentBeginDate
                            ? ` · Incident ${day(d.incidentBeginDate)}${d.incidentEndDate ? ` – ${day(d.incidentEndDate)}` : ' – ongoing'}`
                            : ''}
                        </div>
                        {areas.length > 0 && (
                          <div style={{ color: '#aaa', fontSize: '10px' }} title={areas.join(', ')}>
                            {shownAreas}
                            {moreAreas}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ color: '#666', fontSize: '9px', padding: '2px 8px 4px' }}>
                  Source: FEMA OpenFEMA disaster declarations{emcommData?.state ? ` for ${emcommData.state}` : ''}, last
                  30 days, grouped per declaration.
                </div>
              </>
            )}
          </PanelSection>

          {/* Shelters Panel */}
          <PanelSection
            title="Nearby Shelters"
            count={sheltersWithDistance.length}
            color="#22c55e"
            panels={panels}
            extra={dataAsOf?.shelters ? <OfflineAsOf t={t} ts={dataAsOf.shelters} /> : null}
          >
            {sheltersWithDistance.length === 0 ? (
              <EmptyState text="No open shelters nearby" />
            ) : (
              sheltersWithDistance.map((s) => {
                const isAprs = s.source !== 'fema';
                return (
                  <div
                    key={s.id}
                    style={{
                      padding: '4px 8px',
                      cursor: s.lat != null ? 'pointer' : 'default',
                      marginBottom: '3px',
                      borderRadius: '3px',
                      borderLeft: isAprs ? '2px solid #22c55e' : '2px solid transparent',
                    }}
                    onClick={() => panToTarget(s)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, overflow: 'hidden' }}
                      >
                        <span
                          style={{
                            color: '#ddd',
                            fontSize: '12px',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.name || 'Unnamed Shelter'}
                        </span>
                        <SourceBadge source={s.source} />
                      </span>
                      <span
                        title={
                          isAprs
                            ? 'Status read from the words in the report (open / closed / full) — not a control'
                            : 'Shelter status reported by FEMA'
                        }
                        style={{
                          color: SHELTER_STATUS_COLORS[s.status] || '#888',
                          fontSize: '10px',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {s.status || '?'}
                      </span>
                    </div>
                    {isAprs && s.text && (
                      <div style={{ color: '#aaa', fontSize: '10px', marginTop: '2px' }}>{s.text}</div>
                    )}
                    {isAprs && s.tokens && s.tokens.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                        {s.tokens.map((tk, i) => (
                          <TokenPill key={`${tk.key}-${i}`} token={tk} />
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '2px',
                      }}
                    >
                      <span style={{ color: '#888', fontSize: '10px' }}>
                        {s.distance != null ? formatDistance(s.distance, config.allUnits?.dist || 'imperial') : ''}{' '}
                        {s.wheelchairAccessible ? '♿' : ''} {s.petFriendly ? '🐾' : ''}
                        {isAprs && s.timestamp
                          ? `${Math.max(0, Math.floor((Date.now() - s.timestamp) / 60000))}m ago`
                          : ''}
                      </span>
                      <CapacityBar current={s.currentPopulation} max={s.evacuationCapacity} />
                    </div>
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* Nearby Repeaters — live from the directory, last-known from an
              offline area pack when the internet is down */}
          <PanelSection title="Nearby Repeaters" color="#38bdf8" panels={panels}>
            <div style={{ height: '230px' }}>
              <RepeatersPanel config={config} />
            </div>
          </PanelSection>

          {/* EmComm Stations Panel (APRS) */}
          <PanelSection
            title="EmComm Stations"
            panels={panels}
            count={emcommStationsWithDistance.length}
            color="#22d3ee"
            extra={
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                <select value={aprsSource} onChange={(e) => setAprsSource(e.target.value)} style={EMCOMM_APRS_SELECT}>
                  <option value="all">All Sources</option>
                  <option value="rf">RF Only</option>
                  <option value="internet">Internet Only</option>
                </select>
                {/* Dwell + clear (#1190) — how long heard stations linger, and a flush */}
                <select
                  value={aprsData?.dwellMinutes ?? 60}
                  onChange={(e) => aprsData?.setDwellMinutes?.(Number(e.target.value))}
                  title="How long a station stays on the map after it was last heard"
                  style={EMCOMM_APRS_SELECT}
                >
                  {(aprsData?.dwellOptions ?? [60]).map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => aprsData?.clearStations?.()}
                  title="Remove every APRS station from the map and list until new beacons arrive"
                  style={{ ...EMCOMM_APRS_SELECT, cursor: 'pointer' }}
                >
                  Clear
                </button>
                {/* Callsign tags beside the APRS symbols on the map (#1209) */}
                <button
                  type="button"
                  onClick={() => toggleAPRSLabels?.()}
                  aria-pressed={!!mapLayers?.showAPRSLabels}
                  title={mapLayers?.showAPRSLabels ? 'Hide APRS callsigns on map' : 'Show APRS callsigns on map'}
                  style={{
                    ...EMCOMM_APRS_SELECT,
                    cursor: 'pointer',
                    fontWeight: 700,
                    ...(mapLayers?.showAPRSLabels ? { color: '#ffaa00', borderColor: '#ffaa00' } : {}),
                  }}
                >
                  Aa
                </button>
                <button
                  type="button"
                  onClick={() => cycleAprsIconScale?.()}
                  title="APRS icon and tag size on the map — click to cycle"
                  style={{
                    ...EMCOMM_APRS_SELECT,
                    cursor: 'pointer',
                    fontWeight: 700,
                    ...((mapLayers?.aprsIconScale ?? 1) !== 1 ? { color: '#22d3ee', borderColor: '#22d3ee' } : {}),
                  }}
                >
                  {mapLayers?.aprsIconScale ?? 1}×
                </button>
                <button
                  type="button"
                  onClick={toggleEmcommOnly}
                  aria-pressed={emcommOnly}
                  title="Map shows only EmComm-symbol stations and Net Roster members (roster members stay visible from their last known position)"
                  style={{
                    ...EMCOMM_APRS_SELECT,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    ...(emcommOnly ? { color: '#a855f7', borderColor: '#a855f7' } : {}),
                  }}
                >
                  EmComm only
                </button>
              </span>
            }
          >
            {/* Our own position beacons through the Rig Bridge TNC (#1262) */}
            <AprsBeaconBar
              rigUrl={rigDirectUrl}
              apiToken={config.rigControl?.apiToken || ''}
              location={config.location}
            />
            {emcommStationsWithDistance.length === 0 ? (
              <EmptyState text="No emergency APRS stations heard" />
            ) : (
              emcommStationsWithDistance.map((s) => {
                // RF stations from the rig-bridge stream carry only a timestamp, no
                // precomputed age — reading s.age directly rendered "NaNh ago" (#1180)
                const ageStr = formatStationAge(stationAgeMinutes(s), { suffix: ' ago' });
                const hasTokens = s.tokens && s.tokens.length > 0;
                return (
                  <div
                    key={s.call}
                    onClick={() => panToTarget(s)}
                    title="Show on map"
                    style={{
                      padding: hasTokens ? '6px 8px' : '4px 8px',
                      fontSize: '11px',
                      marginBottom: hasTokens ? '4px' : '2px',
                      borderLeft: hasTokens ? '2px solid #22d3ee' : 'none',
                      background: hasTokens ? '#0d1117' : 'transparent',
                      borderRadius: hasTokens ? '4px' : '0',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1f2e')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = hasTokens ? '#0d1117' : 'transparent')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ marginRight: '4px' }}>{getStationIcon(s.symbol)}</span>
                        <span style={{ color: '#22d3ee', fontWeight: 600 }}>{s.ssid || s.call}</span>
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                          {SYMBOL_LABELS[s.symbol] || 'EmComm'}
                        </span>
                        {s.source === 'local-tnc' && (
                          <span style={{ color: '#22c55e', marginLeft: '4px', fontSize: '9px', fontWeight: 700 }}>
                            RF
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#888', fontSize: '10px', textAlign: 'right' }}>
                        {s.distance != null && (
                          <span>{formatDistance(s.distance, config.allUnits?.dist || 'imperial')} </span>
                        )}
                        <span>{ageStr}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openHistory(s.ssid || s.call, { reveal: true });
                          }}
                          title="Messages exchanged with this station, newest first"
                          style={{
                            background: 'none',
                            border: '1px solid #333',
                            borderRadius: '3px',
                            color: '#888',
                            fontSize: '9px',
                            padding: '1px 4px',
                            cursor: 'pointer',
                            marginLeft: '6px',
                          }}
                        >
                          HIST
                        </button>
                      </div>
                    </div>
                    {hasTokens && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                        {s.tokens.map((t, i) => (
                          <TokenPill key={`${t.key}-${i}`} token={t} />
                        ))}
                      </div>
                    )}
                    {hasTokens && s.cleanComment && (
                      <div style={{ color: '#888', fontSize: '10px', marginTop: '3px' }}>{s.cleanComment}</div>
                    )}
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* APRS Telemetry Panel — sensor dashboards from telemetry-beaconing stations */}
          <PanelSection title="APRS Telemetry" count={telemetry.length} color="#10b981" panels={panels}>
            <APRSTelemetryPanel telemetry={telemetry} variant="emcomm" />
          </PanelSection>

          {/* Winlink Gateways Panel */}
          <PanelSection title="Nearby Winlink Gateways" count={winlinkGateways.length} color="#3b82f6" panels={panels}>
            {!winlinkServerHasKey ? (
              <EmptyState text="Winlink API not configured on server" />
            ) : winlinkGateways.length === 0 ? (
              <EmptyState text={winlinkRows.length ? 'No gateways within range' : 'Loading gateways…'} />
            ) : (
              winlinkPanelGateways.slice(0, 25).map((gw) => {
                // Show up to 3 channels closest to the operator (sorted by freq);
                // the rest are summarized as "+N more". Avoids tall rows when a
                // single gateway publishes 9+ channels.
                const sorted = gw.channels.slice().sort((a, b) => a.frequency - b.frequency);
                const top = sorted.slice(0, 3);
                const more = sorted.length - top.length;
                return (
                  <div
                    key={gw.callsign}
                    onClick={() => panToTarget(gw)}
                    title="Show on map"
                    style={{
                      padding: '5px 8px',
                      fontSize: '11px',
                      marginBottom: '3px',
                      borderLeft: gw.hasEmcomm ? '2px solid #ef4444' : '2px solid #3b82f6',
                      background: '#0d1117',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1f2e')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#0d1117')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: '#3b82f6', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {gw.callsign}
                        </span>
                        {gw.hasEmcomm && (
                          <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '9px', fontWeight: 700 }}>
                            EMCOMM
                          </span>
                        )}
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>{gw.gridsquare}</span>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {gw.reach && <EmcommReachChip entry={gw.reach} t={t} />}
                        <span style={{ color: '#888', fontSize: '10px' }}>
                          {formatDistance(gw.distance, config.allUnits?.dist || 'imperial')}
                        </span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                      {top.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '2px',
                            background: '#1a1f2e',
                            color: winlinkModeColor(c.mode),
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {(c.frequency / 1e6).toFixed(3)} {c.modeLabel}
                        </span>
                      ))}
                      {more > 0 && (
                        <span style={{ fontSize: '9px', color: '#666', alignSelf: 'center' }}>+{more} more</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* NBEMS — fldigi status / RX / send and ICS-213 via the rig-bridge fldigi plugin */}
          <PanelSection
            title={t('emcomm.panel.nbems', { defaultValue: 'NBEMS' })}
            panelKey="NBEMS"
            color="#38bdf8"
            panels={panels}
            bodyMaxHeight="none"
          >
            <NbemsPanel apiToken={config.rigControl?.apiToken || ''} />
          </PanelSection>

          {/* Field Reports Panel — Winlink Express CSV ingest and NBEMS flmsg forms via rig-bridge */}
          <PanelSection title="Field Reports" count={displayFieldReports.length} color="#f472b6" panels={panels}>
            {displayFieldReports.length === 0 ? (
              <div style={{ padding: '12px 8px', color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
                {t('emcomm.fieldReports.empty', {
                  defaultValue:
                    'No field reports received. Rig Bridge forwards Winlink Express form exports (winlink-express-csv plugin) and flmsg forms such as ICS-213 received through fldigi (fldigi + flmsg plugin).',
                })}{' '}
                <a href={FIELD_REPORTS_DOCS_URL} target="_blank" rel="noreferrer" style={{ color: '#f472b6' }}>
                  {t('emcomm.fieldReports.setupGuide', { defaultValue: 'Setup guide' })}
                </a>
              </div>
            ) : (
              displayFieldReports.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '5px 8px',
                    fontSize: '11px',
                    marginBottom: '3px',
                    borderLeft: '2px solid #f472b6',
                    background: '#0d1117',
                    borderRadius: '4px',
                    cursor: r.lat != null && r.lon != null ? 'pointer' : 'default',
                  }}
                  onClick={() => panToTarget(r)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#f472b6', fontWeight: 600 }}>{r.callsign || 'Unknown'}</span>
                      <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                        {r.formType || 'Field Report'}
                      </span>
                      <span
                        style={{
                          marginLeft: '6px',
                          fontSize: '8px',
                          fontWeight: 700,
                          padding: '0 4px',
                          borderRadius: '2px',
                          border: `1px solid ${isNbemsReport(r) ? '#38bdf8' : '#3b82f6'}`,
                          color: isNbemsReport(r) ? '#38bdf8' : '#3b82f6',
                        }}
                      >
                        {isNbemsReport(r) ? 'NBEMS' : 'WINLINK'}
                      </span>
                      {isLocalNbems(r) && (
                        <span
                          title={t('emcomm.fieldReports.localTitle', {
                            defaultValue: 'A draft or sent form from this station’s flmsg, not received traffic',
                          })}
                          style={{ marginLeft: '4px', fontSize: '8px', fontWeight: 700, color: '#888' }}
                        >
                          {t('emcomm.fieldReports.local', { defaultValue: 'LOCAL' })}
                        </span>
                      )}
                      {r?.extra?.origin === 'unknown' && (
                        <span
                          title={t('emcomm.fieldReports.originUnknownTitle', {
                            defaultValue:
                              'Saved in flmsg after being sent by a station; with no callsign set, Rig Bridge cannot tell whether that was you',
                          })}
                          style={{ marginLeft: '4px', fontSize: '8px', fontWeight: 700, color: '#f59e0b' }}
                        >
                          {t('emcomm.fieldReports.originUnknown', { defaultValue: 'ORIGIN?' })}
                        </span>
                      )}
                    </div>
                    <span style={{ color: '#888', fontSize: '10px', flexShrink: 0 }}>
                      {r.age < 1 ? 'now' : r.age < 60 ? `${r.age}m ago` : `${Math.floor(r.age / 60)}h ago`}
                    </span>
                    {incident.isAdmin && incidentState.reports?.[r.fromIncident ? r.id : `field-${r.id}`] && (
                      <IncidentAdminButtons
                        onEdit={() =>
                          editSharedRecord('report', r.fromIncident ? r.id : `field-${r.id}`, 'text', r.text)
                        }
                        onDelete={() => deleteSharedRecord('report', r.fromIncident ? r.id : `field-${r.id}`)}
                      />
                    )}
                  </div>
                  {r.text && (
                    <div style={{ color: '#aaa', fontSize: '10px', marginTop: '2px' }}>
                      {r.text.length > 120 ? `${r.text.substring(0, 120)}…` : r.text}
                    </div>
                  )}
                  <div style={{ color: '#666', fontSize: '9px', marginTop: '2px' }}>
                    {r.lat != null && r.lon != null ? `📋 ${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}` : 'No position'}
                  </div>
                </div>
              ))
            )}
          </PanelSection>

          {/* Net Control — running a voice net (check-ins, traffic, script, report) */}
          <PanelSection
            title="Net Control"
            count={voiceRoster?.active ? voiceRoster.roster.length : 0}
            color="#14b8a6"
            panels={panels}
            bodyMaxHeight="none"
          >
            <NetControlPanel
              callsign={config.callsign}
              timeZone={config.timezone}
              location={config.location}
              embedded
            />
          </PanelSection>

          {/* Net Operations Panel */}
          <PanelSection title="Net Roster" count={shownRoster.length} color="#a855f7" panels={panels}>
            <NetRosterControls
              aliases={netAliases}
              onAliasesChange={changeNetAliases}
              group={rosterView.group}
              onGroupChange={(group) => updateRosterView({ group })}
              show={rosterShow}
              onShowChange={(show) => updateRosterView({ show })}
            />
            {shownRoster.length === 0 ? (
              <EmptyState
                text={`No operators checked in. Send 'CQ NETNAME status' to ${rosterShow === 'all' ? netAliases[0] : rosterShow} via APRS to check in.`}
              />
            ) : (
              rosterGroups.flatMap((g) => [
                ...(g.label
                  ? [
                      <div
                        key={`group-${g.key}`}
                        data-testid="roster-group"
                        style={{
                          color: '#a855f7',
                          fontSize: '10px',
                          fontWeight: 700,
                          letterSpacing: '0.5px',
                          padding: '4px 4px 2px',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{g.label}</span>
                        <span style={{ color: '#666' }}>{g.entries.length}</span>
                      </div>,
                    ]
                  : []),
                ...g.entries.map((op) => {
                  const ageStr = op.age < 1 ? 'now' : op.age < 60 ? `${op.age}m` : `${Math.floor(op.age / 60)}h`;
                  const hasPos = op.lat != null && op.lon != null;
                  return (
                    <div
                      key={rosterKey(op)}
                      data-testid="roster-row"
                      data-call={op.call}
                      onClick={hasPos ? () => panToTarget(op) : undefined}
                      onMouseEnter={() => scheduleHistoryHover(op.call)}
                      onMouseLeave={cancelHistoryHover}
                      title={hasPos ? 'Show on map' : 'No APRS position heard for this station'}
                      style={{
                        padding: '5px 8px',
                        fontSize: '11px',
                        borderLeft: `2px solid ${op.stale ? '#f59e0b' : '#22c55e'}`,
                        background: '#0d1117',
                        borderRadius: '4px',
                        marginBottom: '3px',
                        cursor: hasPos ? 'pointer' : 'default',
                      }}
                      onMouseEnter={hasPos ? (e) => (e.currentTarget.style.background = '#1a1f2e') : undefined}
                      onMouseLeave={hasPos ? (e) => (e.currentTarget.style.background = '#0d1117') : undefined}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ color: op.stale ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{op.call}</span>
                          <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                            {op.source === 'net-control' ? '🎙️ ' : ''}
                            {op.netName}
                          </span>
                          {netAliases.length > 1 && rosterView.group !== 'alias' && op.source !== 'net-control' && (
                            <span
                              title={`Checked in to ${op.address || entryAlias(op)}`}
                              style={{ color: '#a855f7', marginLeft: '6px', fontSize: '9px' }}
                            >
                              →{entryAlias(op)}
                            </span>
                          )}
                          {incidentJoined && op.site && (
                            <span style={{ color: '#38bdf8', marginLeft: '6px', fontSize: '9px' }}>@{op.site}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={{ color: '#888', fontSize: '10px' }}>{ageStr}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMessageTarget(op.call);
                            }}
                            style={{
                              background: 'none',
                              border: '1px solid #333',
                              borderRadius: '3px',
                              color: '#888',
                              fontSize: '9px',
                              padding: '1px 4px',
                              cursor: 'pointer',
                            }}
                          >
                            MSG
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openHistory(op.call, { reveal: true });
                            }}
                            title="Messages exchanged with this station, newest first"
                            style={{
                              background: 'none',
                              border: '1px solid #333',
                              borderRadius: '3px',
                              color: historyTarget === op.call ? '#22d3ee' : '#888',
                              fontSize: '9px',
                              padding: '1px 4px',
                              cursor: 'pointer',
                            }}
                          >
                            HIST
                          </button>
                          {incidentJoined && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                incident.checkOut(op.call, op);
                              }}
                              title={t('emcomm.incident.outTitle', {
                                defaultValue: 'Check this operator out of the shared net',
                              })}
                              style={{
                                background: 'none',
                                border: '1px solid #f59e0b55',
                                borderRadius: '3px',
                                color: '#f59e0b',
                                fontSize: '9px',
                                padding: '1px 4px',
                                cursor: 'pointer',
                              }}
                            >
                              {t('emcomm.incident.out', { defaultValue: 'OUT' })}
                            </button>
                          )}
                          {op.source !== 'net-control' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRosterEntry(op);
                              }}
                              aria-label={`Remove ${op.call} from the roster`}
                              title="Remove from the roster (e.g. wrong net name) — recorded in the Event Log"
                              style={{
                                background: 'none',
                                border: '1px solid #ef444455',
                                borderRadius: '3px',
                                color: '#ef4444',
                                fontSize: '9px',
                                padding: '1px 4px',
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      {op.status && op.status !== 'Checked in' && (
                        <div style={{ color: '#aaa', fontSize: '10px', marginTop: '2px' }}>{op.status}</div>
                      )}
                      {op.tokens && op.tokens.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                          {op.tokens.map((tk, i) => (
                            <TokenPill key={`${tk.key}-${i}`} token={tk} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }),
              ])
            )}
          </PanelSection>

          {/* Event Log Panel — session record for After Action Review */}
          <PanelSection title="Event Log" count={displayEventLog.length} color="#eab308" panels={panels}>
            <div style={{ display: 'flex', gap: '6px', padding: '4px 8px 6px', alignItems: 'center' }}>
              <button
                onClick={exportEventLogCsv}
                disabled={displayEventLog.length === 0}
                style={{ ...EVENT_BTN_STYLE, opacity: displayEventLog.length === 0 ? 0.4 : 1 }}
                title="Download the full event log as CSV"
              >
                CSV
              </button>
              <button
                onClick={printEventLog}
                disabled={displayEventLog.length === 0}
                style={{ ...EVENT_BTN_STYLE, opacity: displayEventLog.length === 0 ? 0.4 : 1 }}
                title="Open a print-friendly After Action Report (print to PDF from the dialog)"
              >
                Print / PDF
              </button>
              <button
                onClick={clearEventLog}
                disabled={incidentJoined || displayEventLog.length === 0}
                style={{
                  ...EVENT_BTN_STYLE,
                  marginLeft: 'auto',
                  color: '#ef4444',
                  border: '1px solid #ef444455',
                  opacity: incidentJoined || displayEventLog.length === 0 ? 0.4 : 1,
                }}
                title={
                  incidentJoined
                    ? t('emcomm.incident.clearDisabled', {
                        defaultValue:
                          "The shared incident log can't be cleared. Leave the incident to manage this browser's own log.",
                      })
                    : 'Clear the event log'
                }
              >
                Clear
              </button>
            </div>
            {displayEventLog.length === 0 ? (
              <EmptyState text="No events yet — check-ins, alerts, messages, and reports are logged automatically for After Action Review." />
            ) : (
              displayEventLog
                .slice(-50)
                .reverse()
                .map((ev) => (
                  <div
                    key={ev.id}
                    data-testid="event-row"
                    style={{
                      padding: '3px 8px',
                      fontSize: '10px',
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ color: '#666', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      {new Date(ev.ts).toISOString().substring(11, 16)}z
                    </span>
                    <span
                      style={{
                        color: EVENT_TYPE_META[ev.type]?.color || '#888',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {EVENT_TYPE_META[ev.type]?.label || ev.type}
                    </span>
                    <span
                      style={{ color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={ev.details || ev.summary}
                    >
                      {ev.callsign ? <span style={{ color: '#ddd' }}>{ev.callsign} — </span> : null}
                      {ev.summary}
                      {incidentJoined && ev.site ? <span style={{ color: '#38bdf8' }}> @{ev.site}</span> : null}
                      {incidentJoined && sharedMsgLabel(ev) ? (
                        <span style={{ color: '#666', fontFamily: 'var(--font-mono)' }}> #{sharedMsgLabel(ev)}</span>
                      ) : null}
                    </span>
                    {incident.isAdmin && incidentState.events?.[ev.id] && (
                      <IncidentAdminButtons
                        onEdit={() => editSharedRecord('event', ev.id, 'summary', ev.summary)}
                        onDelete={() => deleteSharedRecord('event', ev.id)}
                      />
                    )}
                  </div>
                ))
            )}
          </PanelSection>

          {/* ICS Forms — 309/214/213/205 paperwork built from the event log, roster and channel lists */}
          <PanelSection title="ICS Forms" color="#eab308" panels={panels}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', padding: '4px 8px 6px' }}>
              {[
                ['309', t('icsForms.rail.309', { defaultValue: '309 Comm Log' })],
                ['214', t('icsForms.rail.214', { defaultValue: '214 Activity Log' })],
                ['213', t('icsForms.rail.213', { defaultValue: '213 General Message' })],
                ['205', t('icsForms.rail.205', { defaultValue: '205 Radio Plan' })],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setIcsForm(id)}
                  style={{ ...EVENT_BTN_STYLE, textAlign: 'left', padding: '5px 8px' }}
                >
                  📋 {label}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Offline map area: basemap tiles + alerts/shelters/repeaters
              snapshot so the map and panels still work without internet */}
          <PanelSection title="Offline Map Area" color="#fbbf24" panels={panels}>
            <div style={{ padding: '4px 8px' }}>
              <OfflineAreaPacks deLocation={config.location} compact />
            </div>
          </PanelSection>

          {/* Message history + composer, pinned together at the bottom of the
              visible rail when opened on purpose so neither opens below
              every panel (#1242). A hover-opened history stays in place. */}
          <div
            data-testid="message-dock"
            style={{
              // The A−/A+ text size covers the message list and box too (#1232)
              ...(textZoom !== 1 ? { zoom: textZoom } : {}),
              ...(messageTarget || (historyTarget && historyPinned)
                ? {
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 5,
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#111',
                    boxShadow: '0 -6px 16px rgba(0,0,0,0.6)',
                    flexShrink: 0,
                  }
                : { flexShrink: 0 }),
            }}
          >
            {historyTarget && (
              <div
                data-testid="message-history"
                style={{
                  background: '#111620',
                  border: '1px solid #2a3040',
                  borderRadius: '6px',
                  padding: '10px',
                  marginTop: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ color: '#22d3ee', fontWeight: 600, fontSize: '12px' }}>
                    Messages with {historyTarget}
                    {!historyLoading && (
                      <span style={{ color: '#888', fontWeight: 400, marginLeft: '6px', fontSize: '10px' }}>
                        {historyMsgs.length} · newest first
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setMessageTarget(historyTarget)}
                      title="Reply to this station"
                      style={{
                        background: 'none',
                        border: '1px solid #333',
                        borderRadius: '3px',
                        color: '#888',
                        fontSize: '9px',
                        padding: '1px 4px',
                        cursor: 'pointer',
                      }}
                    >
                      MSG
                    </button>
                    <button
                      onClick={() => {
                        setHistoryTarget(null);
                        setHistoryPinned(false);
                      }}
                      style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {historyLoading ? (
                  <div style={{ color: '#888', fontSize: '10px' }}>Loading…</div>
                ) : historyMsgs.length === 0 ? (
                  <div style={{ color: '#888', fontSize: '10px' }}>
                    No messages with this station since the server started.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: '220px',
                      overflow: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    {historyMsgs.map((m, i) => {
                      const sent = m.direction === 'sent';
                      const when = m.timestamp
                        ? new Date(m.timestamp).toISOString().slice(5, 16).replace('T', ' ')
                        : '';
                      return (
                        <div
                          key={`${m.timestamp}-${i}`}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '64px 14px 1fr',
                            gap: '6px',
                            fontSize: '10px',
                            alignItems: 'baseline',
                            borderLeft: `2px solid ${sent ? '#22d3ee' : '#22c55e'}`,
                            paddingLeft: '6px',
                          }}
                          title={`${sent ? 'Sent to' : 'Received from'} ${sent ? m.to : m.from}${m.msgId ? ` · id ${m.msgId}` : ''}`}
                        >
                          <span style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{when}Z</span>
                          <span style={{ color: sent ? '#22d3ee' : '#22c55e' }}>{sent ? '→' : '←'}</span>
                          <span style={{ color: '#ddd', wordBreak: 'break-word' }}>
                            <span style={{ color: '#aaa', marginRight: '4px' }}>{sent ? m.to : m.from}</span>
                            {m.text}
                            {sent &&
                              (() => {
                                const d = deliveryLabel(m, msgStatus(m.msgId));
                                return d ? (
                                  <span
                                    data-testid="delivery"
                                    title={d.title}
                                    style={{ color: d.color, marginLeft: '6px', whiteSpace: 'nowrap' }}
                                  >
                                    {d.text}
                                  </span>
                                ) : null;
                              })()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {messageTarget && (
              <div
                ref={messageBoxRef}
                data-testid="aprs-composer"
                style={{
                  background: '#111620',
                  border: '1px solid #22d3ee',
                  borderRadius: '6px',
                  padding: '10px',
                  marginTop: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ color: '#22d3ee', fontWeight: 600, fontSize: '12px' }}>
                    Message to {messageTarget}
                  </span>
                  <button
                    onClick={() => {
                      setMessageTarget(null);
                      setMessageText('');
                    }}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    ref={messageInputRef}
                    type="text"
                    aria-label={`Message to ${messageTarget}`}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value.slice(0, 67))}
                    placeholder="Type message (67 char max)"
                    maxLength={67}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: '#0a0e14',
                      border: '1px solid #2a3040',
                      borderRadius: '4px',
                      color: '#c4c9d4',
                      fontSize: '12px',
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendMessageToTarget();
                      if (e.key === 'Escape') {
                        setMessageTarget(null);
                        setMessageText('');
                      }
                    }}
                  />
                  <button
                    onClick={sendMessageToTarget}
                    disabled={messageSending || !messageText.trim()}
                    style={{
                      opacity: messageSending || !messageText.trim() ? 0.5 : 1,
                      padding: '6px 12px',
                      background: '#22d3ee',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#000',
                      fontWeight: 600,
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {messageSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {messageError && (
                  <div role="alert" style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px' }}>
                    Not sent: {messageError}
                  </div>
                )}
                <div style={{ fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  {messageText.length}/67 chars — sent via APRS{' '}
                  {rigDirectUrl ? `through Rig Bridge at ${rigDirectUrl}` : '(requires local TNC)'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {icsForm && (
        <IcsFormsOverlay
          config={config}
          initialForm={icsForm}
          onClose={() => setIcsForm(null)}
          sharedEvents={incidentJoined ? incidentEvents : undefined}
        />
      )}
    </div>
  );
}

/** Shelter data source badge — FEMA vs APRS (RF-heard) */
function SourceBadge({ source }) {
  const label = source === 'fema' ? 'FEMA' : source === 'aprs-rf' ? 'APRS RF' : 'APRS';
  const color = source === 'fema' ? '#888' : '#22c55e';
  return (
    <span
      title={source === 'fema' ? 'FEMA National Shelter System' : 'Shelter report heard via APRS'}
      style={{
        fontSize: '8px',
        fontWeight: 700,
        padding: '0 4px',
        borderRadius: '2px',
        border: `1px solid ${color}66`,
        color,
        flexShrink: 0,
        letterSpacing: '0.5px',
      }}
    >
      {label}
    </span>
  );
}

/** Token pill badge */
function TokenPill({ token }) {
  // Label always shown: an icon alone left "100" and "12/20" ambiguous (#1236)
  const meta = TOKEN_META[token.key] || { icon: '📦', color: '#888', label: token.key };
  let display;
  if (token.type === 'capacity') display = `${token.current}/${token.max}`;
  else if (token.type === 'need') display = `${token.value}`;
  else if (token.type === 'critical') display = '!';
  else if (token.type === 'status') display = token.value;
  else display = String(token.value);

  const bg = token.type === 'critical' ? '#dc2626' : token.type === 'need' ? '#991b1b' : `${meta.color}22`;
  const fg = token.type === 'critical' || token.type === 'need' ? '#fff' : meta.color;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        background: bg,
        color: fg,
        fontSize: '10px',
        fontWeight: 600,
        padding: '1px 5px',
        borderRadius: '4px',
        border: `1px solid ${meta.color}44`,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.icon} {meta.label} {display}
    </span>
  );
}

/** Resource summary dashboard — aggregates tokens from all emcomm stations */
function ResourceSummary({ stations, panels }) {
  const aggregated = useMemo(() => aggregateResourceTokens(stations), [stations]);

  if (aggregated.length === 0) return null;

  return (
    <PanelSection title="Resource Summary" count={aggregated.length} color="#f59e0b" panels={panels}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 6px' }}>
        {aggregated.map((agg) => {
          const meta = TOKEN_META[agg.key] || { icon: '📦', color: '#888', label: agg.key };
          return (
            <div
              key={agg.key}
              style={{
                background: '#1a1a1a',
                borderRadius: '6px',
                padding: '6px 10px',
                minWidth: '100px',
                flex: '1 1 calc(50% - 6px)',
                border: `1px solid ${meta.color}33`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px' }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontSize: '11px', fontWeight: 600 }}>{meta.label}</span>
              </div>
              {agg.capacity.length > 0 &&
                (() => {
                  const totalCurrent = agg.capacity.reduce((s, c) => s + c.current, 0);
                  const totalMax = agg.capacity.reduce((s, c) => s + c.max, 0);
                  const pct = totalMax > 0 ? Math.round((totalCurrent / totalMax) * 100) : 0;
                  const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
                  return (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '10px',
                          color: '#aaa',
                          marginBottom: '2px',
                        }}
                      >
                        <span>
                          {totalCurrent}/{totalMax}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '5px',
                          background: '#333',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '3px' }} />
                      </div>
                    </div>
                  );
                })()}
              {agg.needs < 0 && (
                <div style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>{agg.needs} NEEDED</div>
              )}
              {agg.quantities > 0 && <div style={{ color: '#aaa', fontSize: '11px' }}>{agg.quantities} units</div>}
              {(agg.statuses.ok > 0 || agg.statuses.critical > 0) && (
                <div style={{ fontSize: '10px', display: 'flex', gap: '6px' }}>
                  {agg.statuses.ok > 0 && <span style={{ color: '#22c55e' }}>{agg.statuses.ok} OK</span>}
                  {agg.statuses.critical > 0 && <span style={{ color: '#ef4444' }}>{agg.statuses.critical} CRIT</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}

/** Collapsible panel section wrapper */
/**
 * Collapsible sidebar section. The collapsed state is remembered under
 * `panelKey` — a fixed, untranslated name — falling back to `title`, so a
 * translated title does not lose the setting when the language changes.
 */
function PanelSection({ title, panelKey, count, color, extra, panels, bodyMaxHeight = '250px', children }) {
  const key = panelKey || title;
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = panels ? panels.collapsedFor(key) : localCollapsed;
  const setCollapsed = panels ? () => panels.toggle(key) : setLocalCollapsed;
  if (panels?.hiddenFor?.(key)) return null; // switched off in Choose panels (#1241)
  return (
    // flexShrink 0: the rail is a scrolling flex column; without it, once the
    // panels outgrow the rail every section is squashed and its content clipped.
    <div
      style={{
        background: '#0d0d0d',
        borderRadius: '6px',
        overflow: 'hidden',
        flexShrink: 0,
        ...(panels?.zoom && panels.zoom !== 1 ? { zoom: panels.zoom } : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #222',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {/* wraps + minWidth 0: on a narrow rail the header tools (APRS "EmComm
            only" etc.) were pushed past the edge and clipped (#1231) */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', minWidth: 0 }}>
          <span style={{ color: '#888', fontSize: '10px' }}>{collapsed ? '▶' : '▼'}</span>
          <span
            style={{
              color: color || '#ccc',
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {title}
          </span>
          {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
        </div>
        {count > 0 && (
          <span
            style={{
              background: color || '#888',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '8px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
      </div>
      {!collapsed && <div style={{ padding: '4px 2px', maxHeight: bodyMaxHeight, overflowY: 'auto' }}>{children}</div>}
    </div>
  );
}

/** Capacity bar for shelters */
function CapacityBar({ current, max }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round(((current || 0) / max) * 100));
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div
        style={{
          width: '40px',
          height: '6px',
          background: '#333',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ color: '#888', fontSize: '9px' }}>
        {current || 0}/{max}
      </span>
    </div>
  );
}

/** "Offline · as of 14:32Z" tag for a panel showing last-known data */
function OfflineAsOf({ t, ts }) {
  return (
    <span
      title={t('offlinePacks.asOfTitle', {
        defaultValue: 'No connection — showing the last-known data saved at {{time}}',
        time: formatAsOf(ts),
      })}
      style={{ color: '#fbbf24', fontSize: '9px', fontWeight: 400, letterSpacing: 0 }}
    >
      {t('offlinePacks.asOfOffline', { defaultValue: 'Offline — as of {{time}}', time: formatAsOf(ts) })}
    </span>
  );
}

/** Empty state placeholder */
function EmptyState({ text }) {
  return (
    <div style={{ padding: '12px 8px', color: '#555', fontSize: '11px', textAlign: 'center', fontStyle: 'italic' }}>
      {text}
    </div>
  );
}

/** Same status chip as the Winlink panel's Reachable view. */
function EmcommReachChip({ entry, t }) {
  const key = reachColorKey(entry);
  let label;
  if (entry.status === 'offair') label = t('winlinkReach.status.offair', { defaultValue: 'Off the air' });
  else if (entry.kind === 'packet') {
    label = {
      los: t('winlinkReach.los.short.los', { defaultValue: 'LOS' }),
      extended: t('winlinkReach.los.short.extended', { defaultValue: 'LOS?' }),
      beyond: t('winlinkReach.los.short.beyond', { defaultValue: 'No LOS' }),
    }[entry.los];
  } else {
    label = {
      good: t('winlinkReach.status.good', { defaultValue: 'Good' }),
      marginal: t('winlinkReach.status.marginal', { defaultValue: 'Marginal' }),
      closed: t('winlinkReach.status.closed', { defaultValue: 'Closed' }),
    }[entry.status];
  }
  if (!label) return null;
  const title =
    entry.kind === 'hf' && Number.isFinite(entry.reliability)
      ? `${entry.reliability}%${entry.band ? ` · ${entry.band}` : ''}${entry.modeLabel ? ` · ${entry.modeLabel}` : ''}`
      : undefined;
  return (
    <span
      title={title}
      data-status={key}
      style={{
        fontSize: '9px',
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: '3px',
        background: STATUS_COLORS[key],
        color: key === 'offair' ? '#fff' : '#000',
      }}
    >
      {label}
    </span>
  );
}
