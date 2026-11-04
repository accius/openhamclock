/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import ClockLayout from './layouts/ClockLayout';
import FocusLayout, { FOCUS_LAYOUT_IDS } from './layouts/FocusLayout.jsx';
import MobileLayout from './layouts/MobileLayout.jsx';
import MobileLayoutSuggestion from './components/MobileLayoutSuggestion.jsx';
import { MOBILE_LAYOUT_ID, readSuggestionDone, markSuggestionDone, PREVIOUS_LAYOUT_KEY } from './utils/mobileLayout.js';
import { firstVisitPlan } from './utils/firstVisit.js';

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
import { useAlarmScheduler } from './hooks/app/useAlarmClock.js';
import { AlarmBanner } from './components/AlarmIndicator.jsx';
import { shiftDisplayTime, resetDisplayTime, HOUR_MS, DAY_MS } from './utils/displayTime.js';
import { useIBPMeasurements } from './hooks/useIBPMeasurements';
import useHamsAtAlerts from './hooks/useHamsAtAlerts';
import { annotateCoVisibility, upcomingAlertFeedItems } from './utils/hamsAtAlerts.js';
import { getAlertSettings, ALERT_SETTINGS_EVENT } from './utils/audioAlerts';
import { useOpportunities } from './hooks/useOpportunities.js';
import { useSatelliteAnnouncements } from './hooks/app/useSatelliteAnnouncements';
import { useCompiledWatchlist } from './hooks/useWatchlists.js';
import { applyWatchlist } from './utils/watchlistSpec.js';
import useSceneRotation from './hooks/app/useSceneRotation';
import useIdleClock from './hooks/app/useIdleClock';
import useAutoSpaceWxLayers from './hooks/app/useAutoSpaceWxLayers';
import WhatsNew from './components/WhatsNew.jsx';
import StarTrekDayModal from './components/StarTrekDayModal.jsx';
import MotdBanner from './components/MotdBanner.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { LogQsoPopupController } from './components/LogQsoPopup.jsx';
import { initCtyLookup } from './utils/ctyLookup.js';
import { getAllLayers } from './plugins/layerRegistry.js';
import ActivateFilterManager from './components/ActivateFilterManager.jsx';
import { useLightningAnnouncements } from './hooks/app/useLightningAnnouncements';
import { HELP_EVENT } from './utils/helpTopics.js';
import { useDXSpotAnnouncements } from './hooks/app/useDXSpotAnnouncements';
import useRemoteControl from './hooks/app/useRemoteControl';
import useDemoMode from './hooks/app/useDemoMode';
import useKioskLock, { KIOSK_UNLOCK_REQUEST_EVENT } from './hooks/app/useKioskLock';
import { isLocked as isKioskLocked } from './utils/kioskLock.js';
import useSessionFlag from './hooks/app/useSessionFlag';
import KioskUnlockDialog from './components/KioskUnlockDialog.jsx';
import { isRemoteEnabled } from './utils/remoteControl.js';
import { useWeatherAlertAnnouncements } from './hooks/app/useWeatherAlertAnnouncements';
import useGpsFollow from './hooks/app/useGpsFollow.js';
import useHardwareIndicators from './hooks/app/useHardwareIndicators.js';
import useLightningGuard, { acknowledgeRelayReport } from './hooks/useLightningGuard.js';
import { LightningGuardBanner } from './components/LightningGuardIndicator.jsx';
import useDisplayBrightness from './hooks/app/useDisplayBrightness.js';
import { extractBaseCall } from './components/CallsignLink.jsx';
import { getBandFromFreq, detectMode, normalizeFrequencyToMHz, getCallsignInfo } from './utils/callsign';
import { getContestReminders, contestReminderId, CONTEST_REMINDERS_EVENT } from './utils/contestReminders.js';
import { parseJoinUrl } from './utils/incidentSync.js';

// Load DXCC entity database on app startup (non-blocking)
initCtyLookup();

const App = () => {
  const { t } = useTranslation();

  useWavelogSync();

  // Core config/state
  const { config, configLoaded, showDxWeather, classicAnalogClock, handleSaveConfig, serverLocal } = useAppConfig();

  const [showSettings, setShowSettings] = useState(false);
  // One-time offer of the Mobile layout on a phone-sized first visit
  const [mobileSuggest, setMobileSuggest] = useState(false);
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
      if (isKioskLocked()) {
        window.dispatchEvent(new Event(KIOSK_UNLOCK_REQUEST_EVENT));
        return;
      }
      setSettingsDefaultTab('help');
      setShowSettings(true);
    };
    window.addEventListener(HELP_EVENT, onOpenHelp);
    return () => window.removeEventListener(HELP_EVENT, onOpenHelp);
  }, []);

  // First visit: open Settings and pick a layout for touch devices, or offer
  // the Mobile layout — never more than one prompt. "First visit" means no
  // saved layout yet, not a missing key: the theme module writes a
  // theme-only openhamclock_config before this runs (utils/firstVisit.js).
  useEffect(() => {
    if (!configLoaded) return;
    let raw = null;
    try {
      raw = localStorage.getItem('openhamclock_config');
    } catch {
      /* private mode */
    }
    const plan = firstVisitPlan({
      savedConfigRaw: raw,
      callsign: config.callsign,
      layout: config.layout,
      width: window.innerWidth,
      height: window.innerHeight,
      isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      alreadySuggested: readSuggestionDone(localStorage),
    });
    if (plan.markSuggested) markSuggestionDone(localStorage);
    if (plan.openSettings) setShowSettings(true);
    if (plan.layout) handleSaveConfig({ ...config, layout: plan.layout });
    if (plan.suggestMobile) setMobileSuggest(true);
  }, [configLoaded, config.callsign]);

  // Remember the layout before the current one (the Mobile layout's card
  // picker turns its EmComm card on by default for operators coming from
  // the EmComm layout).
  const prevLayoutRef = useRef(config.layout);
  useEffect(() => {
    if (prevLayoutRef.current && prevLayoutRef.current !== config.layout) {
      try {
        localStorage.setItem(PREVIOUS_LAYOUT_KEY, prevLayoutRef.current);
      } catch {
        /* ignore */
      }
    }
    prevLayoutRef.current = config.layout;
  }, [config.layout]);

  // A shared-incident invite link (#incident=…&key=…, e.g. scanned from the
  // Incident panel's QR code) opens the EmComm layout, whose Incident panel
  // picks the invite up and asks to join.
  useEffect(() => {
    if (!configLoaded || config.layout === 'emcomm') return;
    if (parseJoinUrl(window.location.hash)) handleSaveConfig({ ...config, layout: 'emcomm' });
    // Once, when the config has loaded — not again on every config change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded]);

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
      .sort((a, b) => a.key.localeCompare(b.key))
      .concat([
        // Display-time shift (utils/displayTime.js) — see MANUAL "Time shift"
        { key: '[', description: 'Display time −1 hour' },
        { key: ']', description: 'Display time +1 hour' },
        { key: '{', description: 'Display time −1 day' },
        { key: '}', description: 'Display time +1 day' },
        { key: '0', description: 'Display time back to now' },
      ]);
  }, [layerShortcuts, t]);

  // Kiosk lock (Settings → Station → Kiosk lock, or ?lock=1): while locked,
  // Settings, layout changes and the command palette ask for the PIN instead.
  const kiosk = useKioskLock();
  const kioskLockedRef = useRef(kiosk.locked);
  kioskLockedRef.current = kiosk.locked;
  const openSettingsGuarded = useCallback(
    (tabId) => {
      if (kioskLockedRef.current) {
        kiosk.requestUnlock();
        return;
      }
      setSettingsDefaultTab(tabId || null);
      setShowSettings(true);
    },
    [kiosk.requestUnlock], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const setShowSettingsGuarded = useCallback(
    (open) => {
      if (open) openSettingsGuarded(null);
      else setShowSettings(false);
    },
    [openSettingsGuarded],
  );

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
        if (kioskLockedRef.current) {
          kiosk.requestUnlock();
          e.preventDefault();
          return;
        }
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

      // Display-time shift: [ ] = ∓1 h, { } = ∓1 day, 0 = back to now
      const timeStep = { '[': -HOUR_MS, ']': HOUR_MS, '{': -DAY_MS, '}': DAY_MS }[e.key];
      if (timeStep) {
        shiftDisplayTime(timeStep);
        e.preventDefault();
        return;
      }
      if (e.key === '0') {
        resetDisplayTime();
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
  const { dxLocation, dxCallsign, dxLocked, handleToggleDxLock, handleDXChange, setDxLocation, setDxCallsign } =
    useDXLocation(config.defaultDX);

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
    toggleAPRSLabels,
    cycleAprsIconScale,
    toggleMeshCom,
    setSpotLabelMode,
    setSpotLabelMinKm,
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
  // Rig Bridge hardware: GPS follow / rover grid changes, display brightness
  // (overlay or bridge backlight, also switched off by the display schedule).
  const { liveGrid: gpsLiveGrid, gridChanges: gridChangeAlerts } = useGpsFollow(config, handleSaveConfig);
  const { overlayOpacity: brightnessOverlay } = useDisplayBrightness(config, displaySleeping);
  const scale = useResponsiveScale();
  const isLocalInstall = useLocalInstall(serverLocal);

  // Grayscale display (Settings → Display): CSS hook on <html>, rules in styles/main.css.
  useEffect(() => {
    const mode = config.grayscale === 'map' || config.grayscale === 'all' ? config.grayscale : 'off';
    try {
      document.documentElement.setAttribute('data-grayscale', mode);
    } catch {
      /* ignore */
    }
  }, [config.grayscale]);

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
  // Idle clock (Settings → Display): the Clock layout after a quiet period,
  // restored on the first input. Holds scene rotation still while it is up.
  const idleClock = useIdleClock(config, handleSaveConfig, { paused: anyModalOpen });

  // Demo mode (Settings → Display, session-only): a random harmless change
  // every 30 s. Paused while a dialog is open.
  const demoMode = useSessionFlag('demoMode');
  const sceneRotation = useSceneRotation(config, handleSaveConfig, { paused: anyModalOpen || idleClock.active });

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
  // HamClock-style watch lists (utils/watchlistSpec.js): the DX list drives
  // the watchlist alert feed below; the activation list filters POTA/SOTA/
  // WWFF/WWBOTA spots (Only/Not) — Red highlighting lives in the panels.
  const dxWatch = useCompiledWatchlist('dx');
  const activationWatch = useCompiledWatchlist('activations');

  // "UDP spots set DX": with the UDP source active, each newly received spot
  // (after the panel's filters, so "only mine" is honoured) becomes the DX
  // target — HamClock behaviour for N1MM / DXLog / MacLoggerDX feeds. The
  // batch present at startup is skipped so loading never yanks the DX marker.
  const lastUdpDxKeyRef = useRef(null);
  useEffect(() => {
    if (config.dxClusterSource !== 'udp' || !config.udpDxCluster?.setDx) {
      lastUdpDxKeyRef.current = null;
      return;
    }
    const newest = (dxClusterData.spots || [])[0];
    if (!newest) return;
    const key = newest.id || `${newest.call}-${newest.freq}-${newest.spotter}-${newest.timestamp || ''}`;
    if (lastUdpDxKeyRef.current === key) return;
    const first = lastUdpDxKeyRef.current === null;
    lastUdpDxKeyRef.current = key;
    if (first) return;
    if (newest.dxLat != null && newest.dxLon != null) {
      handleDXChange({ lat: newest.dxLat, lon: newest.dxLon, callsign: newest.call ?? null });
    }
  }, [dxClusterData.spots, config.dxClusterSource, config.udpDxCluster?.setDx, handleDXChange]);
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  const swpcAlerts = useSWPCAlerts();
  // Auto space-weather map layer (Settings → Map Layers): aurora / D-RAP on when it matters
  useAutoSpaceWxLayers(!!config.autoSpaceWxLayers);
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
  // Opportunity feed: ranked "worth working now" from cluster + activation
  // spots × logbook needs × P.533 reliability. Shared by the Opportunities
  // panel (via layoutProps) and the audio-alert engine below.
  const opportunities = useOpportunities({
    rawSpots: dxClusterData.rawSpots,
    potaSpots: potaSpots.data,
    sotaSpots: sotaSpots.data,
    wwffSpots: wwffSpots.data,
    wwbotaSpots: wwbotaSpots.data,
    deLocation: config.location,
    openings: bandOpenings.data,
    myZone: myRegion.myZone,
    myContinent: myRegion.myContinent,
    propagationConfig: config.propagation,
    ssn: propagation.data?.solarData?.ssn,
  });
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
    // The DX watch list in Red or Only mode feeds the alert; a Not list hides
    // spots, so it never alerts. Matching uses the full HamClock grammar
    // (bands, sub-bands, NADXCC…, portable-aware prefixes).
    if (!dxWatch.matcher || dxWatch.mode === 'not') return [];
    const hits = [];
    const seen = new Set();
    for (const item of dxClusterData.rawSpots || []) {
      const full = String(item.dxCall || '').toUpperCase();
      if (!full) continue;
      if (!dxWatch.matcher({ call: full, freq: item.freq, grid: item.dxGrid })) continue;
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
  }, [dxClusterData.rawSpots, dxWatch]);

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

  // Alarm clock: rings armed daily/once alarms on real time (utils/alarmClock.js)
  useAlarmScheduler(config.timezone);
  // Measured IBP beacon SNR from a KiwiSDR beacon monitor (Rig Bridge).
  // Configures the page-wide poller; panels subscribe with no arguments.
  const ibpMeasured = useIBPMeasurements({
    enabled: !!config.beaconMonitor?.enabled,
    rigControl: config.rigControl,
    callsign: config.callsign,
  });
  // hams.at alerted passes (Satellite Passes → Alerts). Polled only while
  // the `sat-alerts` audio feed is switched on, so idle browsers cost nothing.
  const [satAlertsOn, setSatAlertsOn] = useState(() => !!getAlertSettings()['sat-alerts']?.enabled);
  useEffect(() => {
    const sync = () => setSatAlertsOn(!!getAlertSettings()['sat-alerts']?.enabled);
    window.addEventListener(ALERT_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(ALERT_SETTINGS_EVENT, sync);
  }, []);
  const hamsAt = useHamsAtAlerts(config.satellite?.hamsAtApiKey || '', { enabled: satAlertsOn });
  const satAlertItems = useMemo(
    () => upcomingAlertFeedItems(annotateCoVisibility(hamsAt.alerts, satellites.data || []), Date.now()),
    [hamsAt.alerts, satellites.data],
  );

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
    'sat-alerts': satAlertItems,
    'band-openings': bandOpenings.alertItems,
    swpc: severeSwpcAlerts,
    'beacon-opening': ibpMeasured.openings,
    'grid-change': gridChangeAlerts,
    opportunity: opportunities.alertItems,
  });
  // Lightning antenna protection (Settings → Alerts → Lightning guard): own
  // strike feed subscription, alerts, and the relay request for the bridge
  const lightningGuard = useLightningGuard({
    location: config.location,
    allUnits: config.allUnits,
    layout: config.layout,
  });
  // Mirror satellite / countdown / lightning-relay state to the bridge's GPIO lines
  useHardwareIndicators({
    satellites: satellites.data,
    rigConfig: config.rigControl,
    lightning: lightningGuard,
    onLightningAck: acknowledgeRelayReport,
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
    // Centre of this viewer's internet APRS area (radius set in the APRS panel)
    location: config.location,
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
    const activationSpot = (spot) => ({ call: spot.call, freq: spot.freq, grid: spot.grid });
    if (!filters?.bands?.length && !filters?.grids?.length && !filters?.modes?.length) {
      return applyWatchlist(spots.data, activationWatch, activationSpot).items;
    }
    const base = (spots.data || []).filter((spot) => {
      if (filters?.bands?.length && !filters.bands.includes(spot.band)) return false;
      if (filters?.modes?.length && !filters.modes.includes(spot.mode)) return false;
      if (filters?.grids?.length) {
        const gridPrefix = spot.grid.substring(0, 2).toUpperCase();
        if (!filters.grids.includes(gridPrefix)) return false;
      }
      return true;
    });
    return applyWatchlist(base, activationWatch, activationSpot).items;
  }

  const filteredPotaSpots = useMemo(() => {
    return ActivateFilter(potaSpots, potaFilters);
  }, [potaSpots.data, potaFilters, activationWatch]);

  const filteredWwffSpots = useMemo(() => {
    return ActivateFilter(wwffSpots, wwffFilters);
  }, [wwffSpots.data, wwffFilters, activationWatch]);

  const filteredSotaSpots = useMemo(() => {
    return ActivateFilter(sotaSpots, sotaFilters);
  }, [sotaSpots.data, sotaFilters, activationWatch]);

  const filteredWwbotaSpots = useMemo(() => {
    return ActivateFilter(wwbotaSpots, wwbotaFilters);
  }, [wwbotaSpots.data, wwbotaFilters, activationWatch]);

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

  useDemoMode({
    active: demoMode && !anyModalOpen,
    config,
    spots: dxClusterData.spots,
    setDxLocation,
    setDxCallsign,
  });

  // Remote-control API + phone remote (docs/API.md#remote-control-api).
  useRemoteControl({
    enabled: configLoaded && isRemoteEnabled(config, isLocalInstall),
    config,
    onSaveConfig: handleSaveConfig,
    dxLocation,
    dxCallsign,
    setDxLocation,
    setDxCallsign,
    satellites: satellites.data,
  });

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
    setShowSettings: setShowSettingsGuarded,
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
    opportunities,
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
    toggleAPRSLabels,
    cycleAprsIconScale,
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
        // The Mobile layout has its own settings button and no sidebar
        paddingLeft: config.layout === MOBILE_LAYOUT_ID ? 0 : sidebarWidth,
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

      {/* Display brightness — translucent overlay when no hardware backlight dims the panel */}
      {!displaySleeping && brightnessOverlay > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: '#000',
            opacity: brightnessOverlay,
            pointerEvents: 'none',
            zIndex: 99998,
            transition: 'opacity 0.4s',
          }}
        />
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
        onSettingsClick={openSettingsGuarded}
        onFullscreenToggle={handleFullscreenToggle}
        isFullscreen={isFullscreen}
        onUpdateClick={handleUpdateClick}
        showUpdateButton={isLocalInstall}
        updateInProgress={updateInProgress}
        breakpoint={config.layout === MOBILE_LAYOUT_ID ? 'mobile' : breakpoint}
        isDockable={config.layout === 'dockable'}
        layoutLocked={layoutLocked || kiosk.locked}
        onToggleLayoutLock={kiosk.locked ? kiosk.requestUnlock : toggleLayoutLock}
        onResetLayout={kiosk.locked ? kiosk.requestUnlock : handleResetLayout}
      />

      <CallsignPopupProvider deLocation={config.location}>
        <RigProvider rigConfig={config.rigControl || { enabled: false, host: 'http://localhost', port: 5555 }}>
          {config.layout === 'emcomm' ? (
            <EmcommLayout {...layoutProps} />
          ) : config.layout === 'contest' ? (
            <ContestLayout {...layoutProps} />
          ) : config.layout === 'eme' ? (
            <EmeLayout {...layoutProps} />
          ) : config.layout === 'clock' ? (
            <ClockLayout {...layoutProps} />
          ) : config.layout === MOBILE_LAYOUT_ID ? (
            <MobileLayout {...layoutProps} />
          ) : FOCUS_LAYOUT_IDS.includes(config.layout) ? (
            <FocusLayout {...layoutProps} focus={config.layout} />
          ) : config.layout === 'dockable' ? (
            <DockableLayout
              key={layoutResetKey}
              {...layoutProps}
              layoutLocked={layoutLocked || kiosk.locked}
              onToggleLayoutLock={kiosk.locked ? kiosk.requestUnlock : toggleLayoutLock}
            />
          ) : config.layout === 'classic' || config.layout === 'tablet' || config.layout === 'compact' ? (
            <ClassicLayout {...layoutProps} />
          ) : (
            <ModernLayout {...layoutProps} />
          )}
          {/* App-level "log from spot" modal — opens only when no LogbookPanel
              is mounted (and never in the contest layout). Inside RigProvider
              so the form's rig prefill works. */}
          <LogQsoPopupController
            layout={config.layout}
            userCallsign={config.callsign}
            myGrid={gpsLiveGrid || deGrid}
            onDXChange={handleDXChange}
            dxLocation={dxLocation}
            dxCallsign={dxCallsign}
          />
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
        onToggleAPRS={toggleAPRS}
        onToggleAPRSLabels={toggleAPRSLabels}
        onSetSpotLabelMode={setSpotLabelMode}
        onSetSpotLabelMinKm={setSpotLabelMinKm}
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
      <AlarmBanner timeZone={config.timezone} />
      <LightningGuardBanner />
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
        onOpenSettings={openSettingsGuarded}
        onToggleFullscreen={handleFullscreenToggle}
        isLocalInstall={isLocalInstall}
      />
      <KioskUnlockDialog open={kiosk.unlockPrompt} onCancel={kiosk.cancelUnlock} onSubmit={kiosk.tryUnlock} />
      <WhatsNew showWhatsNew={config.showWhatsNew} />
      {mobileSuggest && !showSettings && (
        <MobileLayoutSuggestion
          onAccept={() => {
            markSuggestionDone(localStorage);
            setMobileSuggest(false);
            handleSaveConfig({ ...config, layout: MOBILE_LAYOUT_ID });
          }}
          onDismiss={() => {
            markSuggestionDone(localStorage);
            setMobileSuggest(false);
          }}
        />
      )}
      {/* Server admin's message of the day — fixed top bar, dismissible per message id */}
      <MotdBanner />
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
