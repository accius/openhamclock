/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsPanel, DXFilterManager, PSKFilterManager, KeybindingsPanel } from './components';
import SidebarMenu from './components/SidebarMenu.jsx';

import DockableLayout from './layouts/DockableLayout.jsx';
import MatrixRain from './components/MatrixRain.jsx';
import SeasonalEffects from './components/SeasonalEffects.jsx';
import ClassicLayout from './layouts/ClassicLayout.jsx';
import ModernLayout from './layouts/ModernLayout.jsx';
import EmcommLayout from './layouts/EmcommLayout.jsx';
import ContestLayout from './layouts/ContestLayout.jsx';
import EmeLayout from './layouts/EmeLayout.jsx';
import FocusLayout, { FOCUS_LAYOUT_IDS } from './layouts/FocusLayout.jsx';

import { resetActiveLayout } from './store/layoutStore.js';
import { RigProvider } from './contexts/RigContext.jsx';
import { CallsignPopupProvider } from './components/CallsignPopupManager.jsx';

import {
  useSpaceWeather,
  useBandConditions,
  useDXClusterData,
  usePOTASpots,
  useWWFFSpots,
  useSOTASpots,
  useWWBOTASpots,
  useContests,
  useWeather,
  useWeatherAlerts,
  usePropagation,
  useMySpots,
  useDXpeditions,
  useSatellites,
  useSolarIndices,
  usePSKReporter,
  useWSJTX,
  useAPRS,
  useMeshCom,
  useEmcommData,
  useIBP,
  useSWPCAlerts,
  useBandOpenings,
} from './hooks';

import useAppConfig from './hooks/app/useAppConfig';
import useDXLocation from './hooks/app/useDXLocation';
import useMapLayers from './hooks/app/useMapLayers';
import useFilters from './hooks/app/useFilters';
import useSatellitesFilters, { useSatelliteFilterState } from './hooks/app/useSatellitesFilters';
import useTimeState from './hooks/app/useTimeState';
import useFullscreen from './hooks/app/useFullscreen';
import useScreenWakeLock from './hooks/app/useScreenWakeLock';
import useDisplaySchedule from './hooks/app/useDisplaySchedule';
import useResponsiveScale from './hooks/app/useResponsiveScale';
import useLocalInstall from './hooks/app/useLocalInstall';
import useVersionCheck from './hooks/app/useVersionCheck';
import usePresence from './hooks/app/usePresence';
import useWavelogSync from './hooks/app/useWavelogSync.js';
import useAudioAlerts from './hooks/app/useAudioAlerts';
import { useSatelliteAnnouncements } from './hooks/app/useSatelliteAnnouncements';
import useSceneRotation from './hooks/app/useSceneRotation';
import WhatsNew from './components/WhatsNew.jsx';
import StarTrekDayModal from './components/StarTrekDayModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { LogQsoPopupController } from './components/LogQsoPopup.jsx';
import { initCtyLookup } from './utils/ctyLookup.js';
import { getAllLayers } from './plugins/layerRegistry.js';
import ActivateFilterManager from './components/ActivateFilterManager.jsx';
import { useLightningAnnouncements } from './hooks/app/useLightningAnnouncements';
import { HELP_EVENT } from './utils/helpTopics.js';
import { useDXSpotAnnouncements } from './hooks/app/useDXSpotAnnouncements';
import { useWeatherAlertAnnouncements } from './hooks/app/useWeatherAlertAnnouncements';
import { extractBaseCall } from './components/CallsignLink.jsx';
import { getBandFromFreq, detectMode, normalizeFrequencyToMHz, getCallsignInfo } from './utils/callsign';
import { getContestReminders, contestReminderId, CONTEST_REMINDERS_EVENT } from './utils/contestReminders.js';

// Load DXCC entity database on app startup (non-blocking)
initCtyLookup();

const App = () => {
  const { t } = useTranslation();

  useWavelogSync();

  // Core config/state
  const { config, configLoaded, showDxWeather, classicAnalogClock, handleSaveConfig, serverLocal } = useAppConfig();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState(null);
  const [showDXFilters, setShowDXFilters] = useState(false);
  const [showPSKFilters, setShowPSKFilters] = useState(false);
  const [showKeybindings, setShowKeybindings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showPotaFilters, setShowPotaFilters] = useState(false);
  const [showSotaFilters, setShowSotaFilters] = useState(false);
  const [showWwffFilters, setShowWwffFilters] = useState(false);
  const [showWwbotaFilters, setShowWwbotaFilters] = useState(false);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [, setBandColorChangeVersion] = useState(0);
  const [updateInProgress, setUpdateInProgress] = useState(false);

  useEffect(() => {
    const onBandColorsChange = () => {
      setBandColorChangeVersion((v) => v + 1);
    };
    window.addEventListener('openhamclock-band-colors-change', onBandColorsChange);
    return () => window.removeEventListener('openhamclock-band-colors-change', onBandColorsChange);
  }, []);

  // HelpLink buttons anywhere in the app dispatch this event to open
  // Settings → Help (SettingsPanel handles tab switch + anchor scroll).
  useEffect(() => {
    const onOpenHelp = () => {
      setSettingsDefaultTab('help');
      setShowSettings(true);
    };
    window.addEventListener(HELP_EVENT, onOpenHelp);
    return () => window.removeEventListener(HELP_EVENT, onOpenHelp);
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    const hasLocalStorage = localStorage.getItem('openhamclock_config');
    if (!hasLocalStorage && config.callsign === 'N0CALL') {
      setShowSettings(true);

      // Auto-detect mobile/tablet on first visit and set appropriate layout
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= 768;
      const isTabletSize = window.innerWidth > 768 && window.innerWidth <= 1200;

      if (isTouchDevice && isSmallScreen) {
        // Phone → compact layout
        handleSaveConfig({ ...config, layout: 'compact' });
      } else if (isTouchDevice && isTabletSize) {
        // Tablet → tablet layout
        handleSaveConfig({ ...config, layout: 'tablet' });
      }
    }
  }, [configLoaded, config.callsign]);

  // ── Keyboard shortcuts for map layer toggling ──
  // Uses pinned shortcuts from layer metadata when available,
  // falls back to first unique letter from layer name.
  const layerShortcuts = useMemo(() => {
    const layers = getAllLayers();
    const map = {};
    const used = new Set();

    // First pass: assign pinned shortcuts from layer metadata
    for (const layer of layers) {
      if (layer.shortcut) {
        const key = layer.shortcut.toLowerCase();
        if (/^[a-z]$/.test(key) && !used.has(key)) {
          map[key] = layer.id;
          used.add(key);
        }
      }
    }

    // Second pass: auto-assign remaining layers (first unique letter)
    for (const layer of layers) {
      if (map[layer.shortcut?.toLowerCase()] === layer.id) continue; // already pinned
      const name = (layer.name || layer.id || '').toLowerCase();
      for (const char of name) {
        if (/[a-z]/.test(char) && !used.has(char)) {
          map[char] = layer.id;
          used.add(char);
          break;
        }
      }
    }
    return map;
  }, []);

  const keybindingsList = useMemo(() => {
    return Object.entries(layerShortcuts)
      .map(([key, id]) => {
        const layer = getAllLayers().find((l) => l.id === id);
        let name = layer?.name || layer?.id || id;
        if (name?.startsWith('plugins.layers.')) {
          name = t(name, name);
        }
        return { key: key.toUpperCase(), description: `Toggle ${name}` };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [layerShortcuts, t]);

  useEffect(() => {
    const handleKey = (e) => {
      const tag = document.activeElement?.tagName;
      const inFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const modalOpen = showSettings || showDXFilters || showPSKFilters || showKeybindings || showCommandPalette;

      // Ctrl/Cmd+K — command palette. Checked before the modifier early-return
      // below, with the same input-focus/modal suppression as the letter
      // shortcuts. While open, the palette handles its own keys (incl. Esc
      // and Cmd/Ctrl+K to close).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if (inFormField || modalOpen) return;
        setShowCommandPalette(true);
        e.preventDefault();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey || modalOpen || inFormField) return;

      if (e.key === '?') {
        setShowKeybindings((v) => !v);
        e.preventDefault();
        return;
      }

      if (e.key === '/') {
        toggleDeDxMarkers();
        e.preventDefault();
        return;
      }

      const layerId = layerShortcuts[e.key.toLowerCase()];
      if (layerId && window.hamclockLayerControls) {
        const isEnabled = window.hamclockLayerControls.layers?.find((l) => l.id === layerId)?.enabled ?? false;
        window.hamclockLayerControls.toggleLayer(layerId, !isEnabled);
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showSettings, showDXFilters, showPSKFilters, showKeybindings, showCommandPalette, layerShortcuts]);

  const handleResetLayout = useCallback(() => {
    resetActiveLayout();
    setLayoutResetKey((prev) => prev + 1);
  }, []);

  const handleUpdateClick = useCallback(async () => {
    if (updateInProgress) return;
    const confirmed = window.confirm(t('app.update.confirm'));
    if (!confirmed) return;
    setUpdateInProgress(true);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      let payload = {};
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        throw new Error(payload.error || t('app.update.failedToStart'));
      }
      alert(t('app.update.started'));
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* ignore */
        }
      }, 15000);
    } catch (err) {
      setUpdateInProgress(false);
      alert(t('app.update.failed', { error: err.message || t('app.update.unknownError') }));
    }
  }, [updateInProgress, t]);

  // Report presence to active users layer (runs for all configured users)
  usePresence({ callsign: config.callsign, locator: config.locator, sharePresence: config.sharePresence !== false });

  // Location & map state
  const { dxLocation, dxCallsign, dxLocked, handleToggleDxLock, handleDXChange } = useDXLocation(config.defaultDX);

  const {
    mapLayers,
    toggleDeDxMarkers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleDXNews,
    toggleRotatorBearing,
    toggleAPRS,
    toggleMeshCom,
  } = useMapLayers();

  const {
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters,
    mapBandFilter,
    setMapBandFilter,
    potaFilters,
    setPotaFilters,
    sotaFilters,
    setSotaFilters,
    wwffFilters,
    setWwffFilters,
    wwbotaFilters,
    setWwbotaFilters,
  } = useFilters();

  const { isFullscreen, handleFullscreenToggle } = useFullscreen();
  const { displaySleeping } = useDisplaySchedule(config);
  const { wakeLockStatus } = useScreenWakeLock(config, displaySleeping);
  const scale = useResponsiveScale();
  const isLocalInstall = useLocalInstall(serverLocal);

  // Kiosk scene rotation (Settings → Display → Scene rotation). Paused while
  // any app-level modal is open — these existing flags are the cheap signal
  // for "a modal owns the screen" (user interaction is handled inside the
  // hook with a 60 s idle grace).
  const anyModalOpen =
    showSettings ||
    showDXFilters ||
    showPSKFilters ||
    showKeybindings ||
    showCommandPalette ||
    showPotaFilters ||
    showSotaFilters ||
    showWwffFilters ||
    showWwbotaFilters;
  const sceneRotation = useSceneRotation(config, handleSaveConfig, { paused: anyModalOpen });

  // Responsive breakpoint for sidebar/header behavior
  const [breakpoint, setBreakpoint] = useState(() => {
    const w = window.innerWidth;
    return w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  });
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setBreakpoint(w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useVersionCheck();

  // Data hooks
  const spaceWeather = useSpaceWeather();
  const bandConditions = useBandConditions();
  const solarIndices = useSolarIndices();
  const potaSpots = usePOTASpots();
  const wwffSpots = useWWFFSpots();
  const sotaSpots = useSOTASpots();
  const wwbotaSpots = useWWBOTASpots();
  const dxClusterData = useDXClusterData(dxFilters, config);
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  const swpcAlerts = useSWPCAlerts();
  // Band Openings are scoped to this station's CQ zone by default (#1191)
  const myRegion = useMemo(() => {
    const info = getCallsignInfo(config.callsign);
    return { myZone: info?.cqZone ?? null, myContinent: info?.continent ?? null };
  }, [config.callsign]);
  const bandOpenings = useBandOpenings(myRegion);
  // Audio alert only for significant space weather (R2/S2/G2 or higher)
  const severeSwpcAlerts = useMemo(
    () => (swpcAlerts.data || []).filter((a) => (a.scale?.level ?? 0) >= 2),
    [swpcAlerts.data],
  );

  const { announcement: lightningAnnouncement } = useLightningAnnouncements();
  const { announcement: dxSpotAnnouncement } = useDXSpotAnnouncements(dxClusterData.spots);

  const propagation = usePropagation(config.location, dxLocation, config.propagation);
  const mySpots = useMySpots(config.callsign);
  const filterState = useSatelliteFilterState();
  const { satelliteFilters, setSatelliteFilters } = filterState;
  const satellites = useSatellites(config.location, config.satellite, satelliteFilters);
  const { riseAnnouncement, setAnnouncement: satelliteSetAnnouncement } = useSatelliteAnnouncements(satellites.data);

  // ── Alert-feed item sources (Settings → Alerts) ──

  // Watchlist hits: matched against the RAW cluster accumulator, before any
  // panel filters, so a watched call alerts even when the DX panel is
  // filtered elsewhere. Base-call matching (5Z4/OZ6ABL hits "OZ6ABL"), and
  // watchlist entries keep their prefix semantics ("3Y" hits any 3Y call).
  const watchlistHits = useMemo(() => {
    const list = dxFilters?.watchlist;
    if (!list?.length) return [];
    const entries = list.map((w) => String(w).toUpperCase()).filter(Boolean);
    const hits = [];
    const seen = new Set();
    for (const item of dxClusterData.rawSpots || []) {
      const full = String(item.dxCall || '').toUpperCase();
      if (!full) continue;
      const base = extractBaseCall(full);
      if (!entries.some((w) => full.startsWith(w) || base.startsWith(w))) continue;
      const band = getBandFromFreq(item.freq);
      const dedupeKey = `${full}-${band}`;
      if (seen.has(dedupeKey)) continue; // rawSpots is newest-first — keep the newest per call+band
      seen.add(dedupeKey);
      const freqMHz = normalizeFrequencyToMHz(item.freq);
      hits.push({
        call: full,
        freq: freqMHz != null ? String(freqMHz) : String(item.freq ?? ''),
        band,
        mode: item.mode || detectMode(item.comment, item.freq) || '',
      });
    }
    return hits;
  }, [dxClusterData.rawSpots, dxFilters?.watchlist]);

  // Contest-start reminders: strictly opt-in per contest via the 🔔 buttons
  // in ContestPanel — with no reminders set, this feed never alerts. The
  // minute tick re-evaluates the 15-minute window between contest polls.
  const [contestReminders, setContestReminders] = useState(() => getContestReminders());
  useEffect(() => {
    const sync = () => setContestReminders(getContestReminders());
    window.addEventListener(CONTEST_REMINDERS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONTEST_REMINDERS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [contestAlertTick, setContestAlertTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setContestAlertTick((v) => v + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  const contestStartAlerts = useMemo(() => {
    if (!contestReminders.length) return [];
    const now = Date.now();
    return (contests.data || []).filter((c) => {
      if (!contestReminders.includes(contestReminderId(c))) return false;
      const start = Date.parse(c.start || '');
      if (!Number.isFinite(start)) return false;
      const untilStart = start - now;
      return untilStart > 0 && untilStart <= 15 * 60 * 1000;
    });
    // contestAlertTick re-runs the window check once a minute
  }, [contests.data, contestReminders, contestAlertTick]);

  // Satellite passes: tracked satellites whose next pass begins within
  // 5 minutes. satellites.data recomputes every 5 s, so this stays fresh.
  const satPassAlerts = useMemo(() => {
    const now = Date.now();
    const upcoming = [];
    for (const sat of satellites.data || []) {
      const starts = sat.nextPassStartTimes || [];
      for (let i = 0; i < starts.length; i++) {
        const aos = new Date(starts[i]).getTime();
        if (!Number.isFinite(aos)) continue;
        const untilAos = aos - now;
        if (untilAos > 0 && untilAos <= 5 * 60 * 1000) {
          upcoming.push({
            name: sat.name,
            aos,
            maxElevation: sat.nextPassMaxElevations?.[i] ?? null,
          });
        }
      }
    }
    return upcoming;
  }, [satellites.data]);

  // Audio alerts for new items in data feeds
  useAudioAlerts({
    pota: potaSpots.data,
    sota: sotaSpots.data,
    wwff: wwffSpots.data,
    wwbota: wwbotaSpots.data,
    dxcluster: dxClusterData.spots,
    watchlist: watchlistHits,
    dxpeditions: dxpeditions.data?.dxpeditions,
    contests: contests.data,
    'contest-start': contestStartAlerts,
    'sat-pass': satPassAlerts,
    'band-openings': bandOpenings.alertItems,
    swpc: severeSwpcAlerts,
  });
  const localWeather = useWeather(config.location, config.allUnits);
  const dxWeather = useWeather(dxLocation, config.allUnits);
  const localAlerts = useWeatherAlerts(config.location);
  const dxAlerts = useWeatherAlerts(dxLocation);
  // DE alerts only — DX-location alerts aren't an operator-safety concern (#1088)
  const { announcement: weatherAlertAnnouncement } = useWeatherAlertAnnouncements(localAlerts.alerts);
  // User-selectable PSK retention window (issue #991). PSKReporterPanel writes
  // `ohc_psk_age` to localStorage and fires `ohc-psk-age-changed`; we mirror it
  // here so the hook re-runs with the new window and both the map dots and the
  // panel list reflect the user's choice in lockstep.
  const [pskAge, setPskAge] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_psk_age')) || 15;
    } catch {
      return 15;
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        const v = parseInt(localStorage.getItem('ohc_psk_age'));
        if (Number.isFinite(v) && v > 0) setPskAge(v);
      } catch {}
    };
    window.addEventListener('ohc-psk-age-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('ohc-psk-age-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const pskReporter = usePSKReporter(config.callsign, {
    minutes: config.lowMemoryMode ? Math.min(pskAge, 5) : pskAge,
    enabled: pskFilters?.filterMode === 'grid' ? !!config.locator : config.callsign !== 'N0CALL',
    maxSpots: config.lowMemoryMode ? 50 : 500,
    filterMode: pskFilters?.filterMode || 'call',
    gridSquare: config.locator || '',
  });
  const wsjtx = useWSJTX();
  // Only poll the APRS endpoints when APRS can actually be shown: the map
  // layer toggle, the EmComm layout (always draws APRS), or the dockable
  // layout (APRS panel may be docked). Everyone else generates zero traffic.
  const aprsData = useAPRS({
    enabled: mapLayers.showAPRS || config.layout === 'emcomm' || config.layout === 'dockable',
  });
  const ibp = useIBP(config.location?.lat ?? null, config.location?.lon ?? null);
  const meshcomData = useMeshCom();
  const emcommData = useEmcommData({
    location: config.location,
    enabled: config.layout === 'emcomm',
  });

  // ── WSJT-X → DX Target ──
  // When the operator selects a callsign in WSJT-X (setting Std Msgs),
  // the server resolves it to coordinates. Set the DX target automatically
  // so propagation predictions and beam heading update in real time.
  // Respects the DX Lock toggle — if locked, WSJT-X changes are ignored.
  useEffect(() => {
    if (wsjtx.dxTarget?.lat != null && wsjtx.dxTarget?.lon != null) {
      handleDXChange({ lat: wsjtx.dxTarget.lat, lon: wsjtx.dxTarget.lon });
    }
  }, [wsjtx.dxTarget, handleDXChange]);

  // ── N3FJP → DX Target ──
  // The N3FJP Logged QSOs layer emits this on its own channel when the operator
  // types a callsign in the logger, so propagation + beam heading follow the
  // previewed station. handleDXChange honours the DX Lock toggle.
  useEffect(() => {
    const handler = (e) => {
      const { lat, lon } = e.detail || {};
      if (lat != null && lon != null) {
        handleDXChange({ lat, lon });
      }
    };
    window.addEventListener('ohc-n3fjp-dx-target', handler);
    return () => window.removeEventListener('ohc-n3fjp-dx-target', handler);
  }, [handleDXChange]);

  const { filteredSatellites } = useSatellitesFilters(satellites.data, filterState);

  const {
    currentTime,
    uptime,
    use12Hour,
    handleTimeFormatToggle,
    utcTime,
    utcDate,
    localTime,
    localDate,
    deGrid,
    dxGrid,
    deSunTimes,
    dxSunTimes,
    dxTimezone,
    dxSolarFallback,
  } = useTimeState(config.location, dxLocation, config.timezone);

  const filteredPskSpots = useMemo(() => {
    // Apply direction filter: 'tx' = only my transmissions, 'rx' = only what I hear, default = both
    const dir = pskFilters?.direction;
    let allSpots;
    if (dir === 'tx') {
      allSpots = [...(pskReporter.txReports || [])];
    } else if (dir === 'rx') {
      allSpots = [...(pskReporter.rxReports || [])];
    } else {
      allSpots = [...(pskReporter.txReports || []), ...(pskReporter.rxReports || [])];
    }
    if (!pskFilters?.bands?.length && !pskFilters?.grids?.length && !pskFilters?.modes?.length) {
      return allSpots;
    }
    return allSpots.filter((spot) => {
      if (pskFilters?.bands?.length && !pskFilters.bands.includes(spot.band)) return false;
      if (pskFilters?.modes?.length && !pskFilters.modes.includes(spot.mode)) return false;
      if (pskFilters?.grids?.length) {
        const grid = spot.receiverGrid || spot.senderGrid;
        if (!grid) return false;
        const gridPrefix = grid.substring(0, 2).toUpperCase();
        if (!pskFilters.grids.includes(gridPrefix)) return false;
      }
      return true;
    });
  }, [pskReporter.txReports, pskReporter.rxReports, pskFilters]);

  function ActivateFilter(spots, filters) {
    if (!filters?.bands?.length && !filters?.grids?.length && !filters?.modes?.length) {
      return spots.data;
    }
    return spots.data.filter((spot) => {
      if (filters?.bands?.length && !filters.bands.includes(spot.band)) return false;
      if (filters?.modes?.length && !filters.modes.includes(spot.mode)) return false;
      if (filters?.grids?.length) {
        const gridPrefix = spot.grid.substring(0, 2).toUpperCase();
        if (!filters.grids.includes(gridPrefix)) return false;
      }
      return true;
    });
  }

  const filteredPotaSpots = useMemo(() => {
    return ActivateFilter(potaSpots, potaFilters);
  }, [potaSpots.data, potaFilters]);

  const filteredWwffSpots = useMemo(() => {
    return ActivateFilter(wwffSpots, wwffFilters);
  }, [wwffSpots.data, wwffFilters]);

  const filteredSotaSpots = useMemo(() => {
    return ActivateFilter(sotaSpots, sotaFilters);
  }, [sotaSpots.data, sotaFilters]);

  const filteredWwbotaSpots = useMemo(() => {
    return ActivateFilter(wwbotaSpots, wwbotaFilters);
  }, [wwbotaSpots.data, wwbotaFilters]);

  const wsjtxMapSpots = useMemo(() => {
    // Apply same age filter as panel (stored in localStorage)
    let ageMinutes = 30;
    try {
      ageMinutes = parseInt(localStorage.getItem('ohc_wsjtx_age')) || 30;
    } catch {}
    const ageCutoff = Date.now() - ageMinutes * 60 * 1000;

    // Map all decodes with resolved coordinates (CQ, QSO exchanges, prefix estimates)
    // WorldMap deduplicates by callsign, keeping most recent
    return wsjtx.decodes.filter((d) => d.lat != null && d.lon != null && d.timestamp >= ageCutoff);
  }, [wsjtx.decodes]);

  // Map hover
  const [hoveredSpot, setHoveredSpot] = useState(null);

  // Sidebar visibility & layout (used by some layouts)
  const leftSidebarVisible =
    config.panels?.deLocation?.visible !== false ||
    config.panels?.dxLocation?.visible !== false ||
    config.panels?.solar?.visible !== false ||
    config.panels?.propagation?.visible !== false;
  const rightSidebarVisible =
    config.panels?.dxCluster?.visible !== false ||
    config.panels?.pskReporter?.visible !== false ||
    config.panels?.dxpeditions?.visible !== false ||
    config.panels?.pota?.visible !== false ||
    config.panels?.contests?.visible !== false;
  const leftSidebarWidth = leftSidebarVisible ? '270px' : '0px';
  const rightSidebarWidth = rightSidebarVisible ? '300px' : '0px';

  const getGridTemplateColumns = () => {
    if (!leftSidebarVisible && !rightSidebarVisible) return '1fr';
    if (!leftSidebarVisible) return `1fr ${rightSidebarWidth}`;
    if (!rightSidebarVisible) return `${leftSidebarWidth} 1fr`;
    return `${leftSidebarWidth} 1fr ${rightSidebarWidth}`;
  };

  const layoutProps = {
    config,
    t,
    showDxWeather,
    classicAnalogClock,
    currentTime,
    uptime,
    utcTime,
    utcDate,
    localTime,
    localDate,
    use12Hour,
    handleTimeFormatToggle,
    handleFullscreenToggle,
    isFullscreen,
    setShowSettings,
    setShowDXFilters,
    setShowPSKFilters,
    setShowPotaFilters,
    setShowSotaFilters,
    setShowWwffFilters,
    setShowWwbotaFilters,
    handleUpdateClick,
    updateInProgress,
    isLocalInstall,
    deGrid,
    dxGrid,
    dxLocation,
    dxCallsign,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    deSunTimes,
    dxSunTimes,
    dxTimezone,
    dxSolarFallback,
    localWeather,
    dxWeather,
    localAlerts,
    dxAlerts,
    spaceWeather,
    solarIndices,
    bandConditions,
    propagation,
    dxClusterData,
    potaSpots,
    filteredPotaSpots,
    wwffSpots,
    filteredWwffSpots,
    sotaSpots,
    filteredSotaSpots,
    wwbotaSpots,
    filteredWwbotaSpots,
    mySpots,
    dxpeditions,
    contests,
    swpcAlerts,
    satellites,
    pskReporter,
    wsjtx,
    aprsData,
    ibp,
    meshcomData,
    emcommData,
    filteredPskSpots,
    wsjtxMapSpots,
    dxFilters,
    setDxFilters,
    mapBandFilter,
    setMapBandFilter,
    pskFilters,
    setPskFilters,
    potaFilters,
    setPotaFilters,
    sotaFilters,
    setSotaFilters,
    wwffFilters,
    setWwffFilters,
    wwbotaFilters,
    setWwbotaFilters,
    mapLayers,
    toggleDeDxMarkers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleDXNews,
    toggleRotatorBearing,
    toggleAPRS,
    toggleMeshCom,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    leftSidebarVisible,
    rightSidebarVisible,
    getGridTemplateColumns,
    scale,
    keybindingsList,
  };

  // Sidebar width reacts to mode changes (hidden=0, icons=40, pinned=180)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (breakpoint === 'mobile') return 0;
    const savedMode = localStorage.getItem('openhamclock_sidebarMode') || 'icons';
    return savedMode === 'hidden'
      ? 0
      : savedMode === 'pinned'
        ? SidebarMenu.expandedWidth()
        : SidebarMenu.COLLAPSED_WIDTH;
  });

  useEffect(() => {
    const onModeChange = (e) => {
      const m = e.detail?.mode;
      if (m === 'hidden') setSidebarWidth(0);
      else if (m === 'pinned') setSidebarWidth(SidebarMenu.expandedWidth());
      else setSidebarWidth(SidebarMenu.COLLAPSED_WIDTH);
    };
    // The pinned width is theme-dependent (8-bit pixel font needs more room),
    // so a theme switch re-measures it too.
    const onThemeChange = () => {
      const m = localStorage.getItem('openhamclock_sidebarMode') || 'icons';
      if (m === 'pinned') setSidebarWidth(SidebarMenu.expandedWidth());
    };
    window.addEventListener('sidebar-mode-change', onModeChange);
    window.addEventListener('openhamclock-theme-change', onThemeChange);
    return () => {
      window.removeEventListener('sidebar-mode-change', onModeChange);
      window.removeEventListener('openhamclock-theme-change', onThemeChange);
    };
  }, []);

  useEffect(() => {
    if (breakpoint === 'mobile') setSidebarWidth(0);
  }, [breakpoint]);

  // Dockable layout lock state (lifted here so sidebar can control it)
  const [layoutLocked, setLayoutLocked] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_layoutLocked') === 'true';
    } catch {
      return false;
    }
  });

  const toggleLayoutLock = useCallback(() => {
    setLayoutLocked((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('openhamclock_layoutLocked', String(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <main
      id="main-content"
      style={{
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        paddingLeft: sidebarWidth,
        boxSizing: 'border-box',
        transition: 'padding-left 0.2s ease',
      }}
    >
      {/* Matrix theme: digital rain behind the whole UI (skipped on lowMem) */}
      {config.theme === 'matrix' && !config.lowMemoryMode && <MatrixRain />}

      {/* Season themes: snow / petals / fireflies / leaves (skipped on lowMem) */}
      {['winter', 'spring', 'summer', 'fall'].includes(config.theme) && !config.lowMemoryMode && (
        <SeasonalEffects season={config.theme} />
      )}

      {/* Display Schedule — black overlay when in sleep window */}
      {displaySleeping && (
        <div
          onClick={() => {
            // Allow clicking to temporarily dismiss (shows for 30s then re-checks)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#000',
            zIndex: 99999,
            cursor: 'default',
          }}
        />
      )}

      {/* Sidebar Menu */}
      <SidebarMenu
        onSettingsClick={(tabId) => {
          setSettingsDefaultTab(tabId || null);
          setShowSettings(true);
        }}
        onFullscreenToggle={handleFullscreenToggle}
        isFullscreen={isFullscreen}
        onUpdateClick={handleUpdateClick}
        showUpdateButton={isLocalInstall}
        updateInProgress={updateInProgress}
        breakpoint={breakpoint}
        isDockable={config.layout === 'dockable'}
        layoutLocked={layoutLocked}
        onToggleLayoutLock={toggleLayoutLock}
        onResetLayout={handleResetLayout}
      />

      <CallsignPopupProvider deLocation={config.location}>
        <RigProvider rigConfig={config.rigControl || { enabled: false, host: 'http://localhost', port: 5555 }}>
          {config.layout === 'emcomm' ? (
            <EmcommLayout {...layoutProps} />
          ) : config.layout === 'contest' ? (
            <ContestLayout {...layoutProps} />
          ) : config.layout === 'eme' ? (
            <EmeLayout {...layoutProps} />
          ) : FOCUS_LAYOUT_IDS.includes(config.layout) ? (
            <FocusLayout {...layoutProps} focus={config.layout} />
          ) : config.layout === 'dockable' ? (
            <DockableLayout
              key={layoutResetKey}
              {...layoutProps}
              layoutLocked={layoutLocked}
              onToggleLayoutLock={toggleLayoutLock}
            />
          ) : config.layout === 'classic' || config.layout === 'tablet' || config.layout === 'compact' ? (
            <ClassicLayout {...layoutProps} />
          ) : (
            <ModernLayout {...layoutProps} />
          )}
          {/* App-level "log from spot" modal — opens only when no LogbookPanel
              is mounted (and never in the contest layout). Inside RigProvider
              so the form's rig prefill works. */}
          <LogQsoPopupController layout={config.layout} userCallsign={config.callsign} myGrid={deGrid} />
        </RigProvider>
      </CallsignPopupProvider>

      {/* Modals */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => {
          setShowSettings(false);
          setSettingsDefaultTab(null);
        }}
        defaultTab={settingsDefaultTab}
        config={config}
        onSave={handleSaveConfig}
        onResetLayout={handleResetLayout}
        satellites={satellites.data}
        satelliteFilters={satelliteFilters}
        onSatelliteFiltersChange={setSatelliteFilters}
        mapLayers={mapLayers}
        onToggleDeDxMarkers={toggleDeDxMarkers}
        onToggleDXNews={toggleDXNews}
        wakeLockStatus={wakeLockStatus}
        wsjtxSessionId={wsjtx.sessionId}
        isLocalInstall={isLocalInstall}
      />
      <DXFilterManager
        filters={dxFilters}
        onFilterChange={setDxFilters}
        isOpen={showDXFilters}
        onClose={() => setShowDXFilters(false)}
        onClearSpots={dxClusterData.clearSpots}
      />
      <PSKFilterManager
        filters={pskFilters}
        onFilterChange={setPskFilters}
        isOpen={showPSKFilters}
        onClose={() => setShowPSKFilters(false)}
        callsign={config.callsign}
        locator={config.locator}
      />
      <KeybindingsPanel
        isOpen={showKeybindings}
        onClose={() => setShowKeybindings(false)}
        keybindings={keybindingsList}
      />
      <ActivateFilterManager
        name="POTA"
        filters={potaFilters}
        onFilterChange={setPotaFilters}
        isOpen={showPotaFilters}
        onClose={() => setShowPotaFilters(false)}
      />
      <ActivateFilterManager
        name="SOTA"
        filters={sotaFilters}
        onFilterChange={setSotaFilters}
        isOpen={showSotaFilters}
        onClose={() => setShowSotaFilters(false)}
      />
      <ActivateFilterManager
        name="WWFF"
        filters={wwffFilters}
        onFilterChange={setWwffFilters}
        isOpen={showWwffFilters}
        onClose={() => setShowWwffFilters(false)}
      />
      <ActivateFilterManager
        name="WWBOTA"
        filters={wwbotaFilters}
        onFilterChange={setWwbotaFilters}
        isOpen={showWwbotaFilters}
        onClose={() => setShowWwbotaFilters(false)}
      />
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        config={config}
        onSaveConfig={handleSaveConfig}
        onOpenSettings={(tabId) => {
          setSettingsDefaultTab(tabId || null);
          setShowSettings(true);
        }}
        onToggleFullscreen={handleFullscreenToggle}
        isLocalInstall={isLocalInstall}
      />
      <WhatsNew showWhatsNew={config.showWhatsNew} />
      {/* Star Trek Day 2026 (Sept 7-9) — one-shot event notice, ?stday previews */}
      <StarTrekDayModal />
      {/* Scene rotation indicator — unobtrusive dot while rotating, with the
          new layout's name flashed briefly on each switch. */}
      {sceneRotation.active && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            zIndex: 9500,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            pointerEvents: 'none',
          }}
        >
          {sceneRotation.flash && (
            <span
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--accent-cyan)',
                borderRadius: '4px',
                color: 'var(--accent-cyan)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                padding: '2px 8px',
              }}
            >
              {t('station.settings.layout.' + sceneRotation.flash.layout, sceneRotation.flash.layout) +
                (sceneRotation.flash.presetName ? ' — ' + sceneRotation.flash.presetName : '')}
            </span>
          )}
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent-cyan)',
              opacity: 0.55,
              boxShadow: '0 0 6px var(--accent-cyan)',
            }}
          />
        </div>
      )}
      {/* Assertive: satellite rising above horizon is time-critical for a ham operator */}
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" data-testid="satellite-rise-announcer">
        {riseAnnouncement}
      </div>
      {/* Polite: satellite setting is informational */}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="satellite-set-announcer">
        {satelliteSetAnnouncement}
      </div>
      {/* Assertive: lightning proximity is a safety alert — announce immediately */}
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" data-testid="lightning-announcer">
        {lightningAnnouncement}
      </div>
      {/* Polite: new DX spot matching active filters — informational */}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="dx-spot-announcer">
        {dxSpotAnnouncement}
      </div>
      {/* Assertive: severe weather at the DE location — operator may need to secure antennas */}
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" data-testid="weather-alert-announcer">
        {weatherAlertAnnouncement}
      </div>
    </main>
  );
};

export default App;
