/**
 * DockableApp - Dockable panel layout wrapper for OpenHamClock
 * Provides resizable, draggable panels while maintaining the original styling
 */
import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';

// Components
import {
  Header,
  WorldMap,
  DXClusterPanel,
  POTAPanel,
  WWFFPanel,
  SOTAPanel,
  WWBOTAPanel,
  ContestPanel,
  SolarPanel,
  PropagationPanel,
  BandHealthPanel,
  BandActivityHeatmap,
  RotatorPanel,
  DXpeditionPanel,
  PSKReporterPanel,
  PSKReporterBandActivityPanel,
  APRSPanel,
  APRSTelemetryPanel,
  MapDataListView,
  MeshComPanel,
  WeatherPanel,
  AmbientPanel,
  AnalogClockPanel,
  RigControlPanel,
  OnAirPanel,
  IDTimerPanel,
  ImagePanel,
  KeybindingsPanel,
  DXLocalTime,
  DigitalModesPanel,
  DecoderPanel,
  WinlinkPanel,
  WorldClockPanel,
  StopwatchPanel,
  SunMoonPanel,
  SatellitePassesPanel,
  RBNMySignalPanel,
  SpaceWxTrendsPanel,
  WSPRMySpotsPanel,
  AMSATStatusPanel,
  RepeatersPanel,
  POTAActivatorPanel,
  AircraftNearbyPanel,
  IBPPanel,
  SWPCAlertsPanel,
  MeteorShowerPanel,
  RoverPanel,
  EnvSensorsPanel,
  FrequencyMemoriesPanel,
  NetSchedulePanel,
  NetControlPanel,
  CallsignSearchPanel,
  DXNewsPanel,
  SolarCyclePanel,
  LogStatsPanel,
  SkedPlannerPanel,
  IonosondePanel,
  PropVerifyPanel,
  GraylinePlannerPanel,
  EmePlannerPanel,
  SatPlannerPanel,
  OpportunityPanel,
  SolarOutlookPanel,
  BenchmarkPanel,
  NOAAScalesPanel,
  DstPanel,
  EclipsePanel,
  PlanetsPanel,
  SpaceLaunchesPanel,
  TropicalPanel,
  FireWeatherPanel,
  MarinePanel,
  WindyPanel,
  WefaxPanel,
  HamAlertPanel,
  BalloonsPanel,
  IcsFormsPanel,
} from './components';
import MeshtasticPanel from './components/MeshtasticPanel.jsx';
import LogbookPanel from './components/LogbookPanel.jsx';
import AwardsPanel from './components/AwardsPanel.jsx';
import ClusterConsolePanel from './components/ClusterConsolePanel.jsx';

import {
  getActiveLayout,
  getActivePresetId,
  resetActiveLayout,
  saveLayoutForPreset,
  createPreset,
  PRESETS_CHANGED_EVENT,
} from './store/layoutStore.js';
import { getPanelPluginById } from './plugins/panelRegistry.js';
import { buildPanelDefs } from './panelDefs.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { DockableLayoutProvider } from './contexts';
import { useRig } from './contexts/RigContext.jsx';
import { calculateBearing, calculateDistance, formatDistance } from './utils/geo.js';
import { findDXPathForSpot } from './utils/dxClusterSpotMatcher';
import { requestMapFocus } from './utils/mapFocus.js';
import { DXGridInput } from './components/DXGridInput.jsx';
import { DXCallsignInput } from './components/DXCallsignInput.jsx';
import { DXFavorites } from './components/DXFavorites.jsx';
import DXCCSelect from './components/DXCCSelect.jsx';
import HelpLink from './components/HelpLink.jsx';
import { PanelIcon } from './components/Icons.jsx';
import { panelHelpTopic } from './utils/helpTopics.js';
import './styles/flexlayout-openhamclock.css';
import useMapLayers from './hooks/app/useMapLayers';
import { useMapTextData } from './hooks/useMapTextData.js';
import useRotator from './hooks/useRotator';
import useRigBridgeRotator from './hooks/useRigBridgeRotator';
import useDopplerTuning from './hooks/useDopplerTuning';
import useRotatorAutoTrack from './hooks/useRotatorAutoTrack';
import { useSatAutomation, setSatAutomationLive, setRotatorMode } from './utils/satAutomationStore.js';
import { useGps } from './hooks/useGps.js';
import { useNOAAScales } from './hooks/useNOAAScales.js';
import { useDst } from './hooks/useDst.js';
import { useHamAlert } from './hooks/useHamAlert.js';
import useAudioAlerts from './hooks/app/useAudioAlerts';
import { formatBearing, useBearingMode } from './utils/bearing.js';
import { useCallsignPopup } from './components/CallsignPopupManager.jsx';

// Icons
const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const DockableApp = ({
  // Config & state from parent
  config,
  t,
  currentTime,

  // Location data
  deGrid,
  dxGrid,
  dxLocation,
  dxCallsign,
  deSunTimes,
  dxSunTimes,
  handleDXChange,
  dxLocked,
  handleToggleDxLock,

  // Weather
  localWeather,
  dxWeather,
  localAlerts,
  dxAlerts,
  showDxWeather,

  // Space weather & solar
  spaceWeather,
  solarIndices,
  bandConditions,
  propagation,

  // Spots & data
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
  filteredSatellites,
  pskReporter,
  wsjtx,
  aprsData,
  ibp,
  meshcomData,
  filteredPskSpots,
  wsjtxMapSpots,
  // Opportunity feed (useOpportunities in App.jsx — shared with the alert engine)
  opportunities,

  // Filters
  dxFilters,
  setDxFilters,
  mapBandFilter,
  setMapBandFilter,
  pskFilters,
  setShowDXFilters,
  setShowPSKFilters,
  potaFilters,
  setShowPotaFilters,
  sotaFilters,
  setShowSotaFilters,
  wwffFilters,
  setShowWwffFilters,
  wwbotaFilters,
  setShowWwbotaFilters,

  // Map layers
  mapLayers,
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
  toggleAPRS,
  toggleAPRSLabels,
  cycleAprsIconScale,
  toggleMeshCom,
  toggleRotatorBearing,
  hoveredSpot,
  setHoveredSpot,

  // Time & UI
  utcTime,
  utcDate,
  localTime,
  localDate,
  use12Hour,
  handleTimeFormatToggle,
  setShowSettings,
  handleFullscreenToggle,
  isFullscreen,
  dxTimezone,
  dxSolarFallback,

  // Update
  handleUpdateClick,
  updateInProgress,
  isLocalInstall,
  keybindingsList,

  // Layout lock (from parent — sidebar controls it)
  layoutLocked: layoutLockedProp,
  onToggleLayoutLock,
}) => {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(() => Model.fromJson(getActiveLayout()));
  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [targetTabSetId, setTargetTabSetId] = useState(null);
  const saveTimeoutRef = useRef(null);
  // Which named layout preset the current model belongs to — pending debounced
  // saves are flushed to THIS id before a switch loads another preset's model.
  const activePresetIdRef = useRef(getActivePresetId());
  const modelRef = useRef(model);
  modelRef.current = model;

  // Layout lock — controlled by parent (sidebar), fall back to local state if no prop
  const [localLayoutLocked, setLocalLayoutLocked] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_layoutLocked') === 'true';
    } catch {
      return false;
    }
  });
  const layoutLocked = layoutLockedProp !== undefined ? layoutLockedProp : localLayoutLocked;
  const toggleLayoutLock =
    onToggleLayoutLock ||
    (() => {
      setLocalLayoutLocked((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('openhamclock_layoutLocked', String(next));
        } catch {}
        return next;
      });
    });
  const handleResetLayout = useCallback(() => {
    if (confirm('Reset panel layout to default? This will undo any customizations.')) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const defaultLayout = resetActiveLayout();
      setModel(Model.fromJson(defaultLayout));
    }
  }, []);
  const [showDxccSelect, setShowDxccSelect] = useState(false);
  const { showPopup } = useCallsignPopup();
  const callsignInfoRef = useRef(null);

  // ── Tabset auto-rotation (persistent per tabset) ──
  const [tabsetRotation, setTabsetRotation] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('openhamclock_tabsetRotation') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_tabsetRotation', JSON.stringify(tabsetRotation));
    } catch {}
  }, [tabsetRotation]);

  const rotationTimers = useRef({});
  useEffect(() => {
    Object.values(rotationTimers.current).forEach(clearInterval);
    rotationTimers.current = {};

    Object.entries(tabsetRotation).forEach(([tabsetId, cfg]) => {
      if (!cfg?.enabled || !cfg?.interval || !model) return;
      rotationTimers.current[tabsetId] = setInterval(() => {
        try {
          const tabset = model.getNodeById(tabsetId);
          if (!tabset) return;
          const children = tabset.getChildren?.() || [];
          if (children.length < 2) return;
          const selected = tabset.getSelectedNode?.();
          const currentIdx = children.findIndex((c) => c === selected);
          const nextIdx = (currentIdx + 1) % children.length;
          model.doAction(Actions.selectTab(children[nextIdx].getId()));
        } catch {}
      }, cfg.interval * 1000);
    });

    return () => {
      Object.values(rotationTimers.current).forEach(clearInterval);
      rotationTimers.current = {};
    };
  }, [tabsetRotation, model]);

  const toggleTabsetRotation = useCallback((tabsetId) => {
    setTabsetRotation((prev) => ({
      ...prev,
      [tabsetId]: {
        enabled: !prev[tabsetId]?.enabled,
        interval: prev[tabsetId]?.interval || 15,
      },
    }));
  }, []);

  const setTabsetInterval = useCallback((tabsetId, secs) => {
    setTabsetRotation((prev) => ({
      ...prev,
      [tabsetId]: { ...prev[tabsetId], interval: parseInt(secs, 10) },
    }));
  }, []);

  // Lightning / aircraft / aurora / Winlink data broadcast out of the map
  // plugins for the text view panel (#1002 v2).
  const mapTextData = useMapTextData();

  // NOAA R/S/G scales (NOAA Scales panel + Space Wx Alerts header) and Kyoto
  // Dst (Dst panel) — fetched once here, server-cached, shared by every tab.
  const noaaScales = useNOAAScales();
  const dst = useDst();

  // Fallback: if parent did not provide map-layer toggles (seen with rotator),
  // use the internal hook so the map buttons still work.
  const internalMap = useMapLayers();

  const useInternalMapLayers =
    typeof toggleRotatorBearing !== 'function' ||
    typeof toggleDXPaths !== 'function' ||
    typeof toggleDXLabels !== 'function' ||
    typeof toggleSatellites !== 'function';

  const mapLayersEff = useInternalMapLayers ? internalMap.mapLayers : mapLayers;
  const toggleDXPathsEff = useInternalMapLayers ? internalMap.toggleDXPaths : toggleDXPaths;
  const toggleDXLabelsEff = useInternalMapLayers ? internalMap.toggleDXLabels : toggleDXLabels;
  const togglePOTAEff = useInternalMapLayers ? internalMap.togglePOTA : togglePOTA;
  const togglePOTALabelsEff = useInternalMapLayers ? internalMap.togglePOTALabels : togglePOTALabels;
  const toggleWWFFEff = useInternalMapLayers ? internalMap.toggleWWFF : toggleWWFF;
  const toggleWWFFLabelsEff = useInternalMapLayers ? internalMap.toggleWWFFLabels : toggleWWFFLabels;
  const toggleSOTAEff = useInternalMapLayers ? internalMap.toggleSOTA : toggleSOTA;
  const toggleSOTALabelsEff = useInternalMapLayers ? internalMap.toggleSOTALabels : toggleSOTALabels;
  const toggleWWBOTAEff = useInternalMapLayers ? internalMap.toggleWWBOTA : toggleWWBOTA;
  const toggleWWBOTALabelsEff = useInternalMapLayers ? internalMap.toggleWWBOTALabels : toggleWWBOTALabels;
  const toggleSatellitesEff = useInternalMapLayers ? internalMap.toggleSatellites : toggleSatellites;
  const togglePSKReporterEff = useInternalMapLayers ? internalMap.togglePSKReporter : togglePSKReporter;
  const togglePSKPathsEff = useInternalMapLayers ? internalMap.togglePSKPaths : togglePSKPaths;
  const toggleWSJTXEff = useInternalMapLayers ? internalMap.toggleWSJTX : toggleWSJTX;
  const toggleRotatorBearingEff = useInternalMapLayers ? internalMap.toggleRotatorBearing : toggleRotatorBearing;
  const toggleAPRSEff = useInternalMapLayers ? internalMap.toggleAPRS : toggleAPRS;
  const toggleAPRSLabelsEff = useInternalMapLayers ? internalMap.toggleAPRSLabels : toggleAPRSLabels;
  const cycleAprsIconScaleEff = useInternalMapLayers ? internalMap.cycleAprsIconScale : cycleAprsIconScale;
  const toggleMeshComEff = useInternalMapLayers ? internalMap.toggleMeshCom : toggleMeshCom;

  // Per-panel zoom levels (persisted)
  const [panelZoom, setPanelZoom] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_panelZoom');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_panelZoom', JSON.stringify(panelZoom));
    } catch {}
  }, [panelZoom]);

  const ZOOM_STEPS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0];
  const adjustZoom = useCallback((component, delta) => {
    setPanelZoom((prev) => {
      const current = prev[component] || 1.0;
      const currentIdx = ZOOM_STEPS.findIndex((s) => s >= current - 0.01);
      const newIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (currentIdx >= 0 ? currentIdx : 3) + delta));
      const newZoom = ZOOM_STEPS[newIdx];
      if (newZoom === 1.0) {
        const { [component]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [component]: newZoom };
    });
  }, []);

  // Rig Control Hook
  const { tuneTo, enabled } = useRig();

  // Rover mode: with Settings → Station → Follow GPS = follow, QSOs are
  // stamped with the live GPS grid (MY_GRIDSQUARE) rather than the saved one.
  const { fix: gpsFix } = useGps();
  const liveGrid = config.gpsFollow === 'follow' && gpsFix?.grid6 ? gpsFix.grid6 : null;
  // HamAlert feed (Rig Bridge plugin stream and/or self-hosted server feed)
  // plus its audio/notification alert feed. Lives here rather than App.jsx
  // so the panel works with props the factory already has.
  const rigBridgeUrl =
    config.rigControl?.enabled && config.rigControl?.host
      ? `${config.rigControl.host}:${config.rigControl.port || 5555}`
      : null;
  const hamAlert = useHamAlert({ rigBridgeUrl });
  useAudioAlerts({ hamalert: hamAlert.alerts });
  // True vs magnetic bearings (Settings → Station) for the DX panel readouts
  const bearingMode = useBearingMode();

  // Unified Spot Click Handler (Tune + Set DX)
  // Reachable Winlink gateways: clicking one sets it as DX and brings it into
  // view, same as a spot click. Tuning is handled inside the panel, which
  // knows the channel's dial frequency and rig mode.
  const handleSelectWinlinkGateway = useCallback(
    (gw) => {
      if (!gw || gw.lat == null || gw.lon == null) return;
      handleDXChange({ lat: gw.lat, lon: gw.lon, callsign: gw.callsign ?? null });
      requestMapFocus({ lat: gw.lat, lon: gw.lon });
    },
    [handleDXChange],
  );

  const handleSpotClick = useCallback(
    (spot) => {
      if (!spot) return;

      // 1. Tune Rig if frequency is available and rig control is enabled.
      // tuneTo picks dialFrequency (WSJT-X) over freq/freqMHz and remembers
      // the spot's call for the Logbook's +QSO.
      if (enabled && (spot.freq || spot.freqMHz || spot.dialFrequency)) {
        tuneTo(spot);
      }

      // 2. Set DX Location if location data is available
      // For DX Cluster spots, we need to find the path data which contains coordinates
      // For POTA/SOTA, the spot object itself has lat/lon
      // 3. Bring the target into view: the map pans only when the target is
      // off-screen and drops a pulse ring on it either way (#1182). Runs even
      // with DX locked — the marker stays put, but the eye still gets a cue.
      if (spot.lat != null && spot.lon != null) {
        handleDXChange({ lat: spot.lat, lon: spot.lon, callsign: spot.call ?? null });
        requestMapFocus({ lat: spot.lat, lon: spot.lon });
      } else if (spot.call) {
        // Try to find in DX Cluster paths
        const path = findDXPathForSpot(dxClusterData.paths || [], spot);
        if (path && path.dxLat != null && path.dxLon != null) {
          handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? null });
          requestMapFocus({ lat: path.dxLat, lon: path.dxLon });
        }
      }
    },
    [tuneTo, enabled, handleDXChange, dxClusterData.paths],
  );

  const resetZoom = useCallback((component) => {
    setPanelZoom((prev) => {
      const { [component]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Block layout-altering actions when locked
  const handleAction = useCallback(
    (action) => {
      if (layoutLocked) {
        const blockedTypes = [
          'FlexLayout_MoveNode',
          'FlexLayout_AdjustSplit',
          'FlexLayout_DeleteTab',
          'FlexLayout_MaximizeToggle',
          'FlexLayout_AdjustBorderSplit',
        ];
        if (blockedTypes.includes(action.type)) return undefined;
      }
      return action;
    },
    [layoutLocked],
  );

  // Handle model changes with debounced save (into the active preset — the
  // Default preset persists under the legacy openhamclock_dockLayout key)
  const handleModelChange = useCallback((newModel) => {
    setModel(newModel);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const presetId = activePresetIdRef.current;
    saveTimeoutRef.current = setTimeout(() => {
      saveLayoutForPreset(presetId, newModel.toJson());
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Flush any pending debounced save into the preset the model belongs to.
  const flushPendingSave = useCallback(() => {
    if (!saveTimeoutRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    try {
      saveLayoutForPreset(activePresetIdRef.current, modelRef.current.toJson());
    } catch {}
  }, []);

  // Named layout presets — react to activation changes made anywhere (sidebar
  // preset control, command palette, scene rotation): flush edits into the
  // preset we're leaving, then load the newly active preset's model.
  useEffect(() => {
    const onPresetsChanged = () => {
      const activeId = getActivePresetId();
      if (activeId === activePresetIdRef.current) return;
      flushPendingSave();
      activePresetIdRef.current = activeId;
      setModel(Model.fromJson(getActiveLayout()));
    };
    // "Duplicate current…" — needs the live (possibly unsaved) model, which
    // only this component has, so the preset control dispatches an event.
    const onDuplicate = (e) => {
      const name = e.detail?.name;
      if (!name) return;
      flushPendingSave();
      const preset = createPreset(name, modelRef.current.toJson());
      // createPreset activates the copy; its model is identical to the live
      // one, so just adopt the new id without reloading the model.
      if (preset) activePresetIdRef.current = preset.id;
    };
    window.addEventListener(PRESETS_CHANGED_EVENT, onPresetsChanged);
    window.addEventListener('openhamclock:dock-preset-duplicate', onDuplicate);
    return () => {
      window.removeEventListener(PRESETS_CHANGED_EVENT, onPresetsChanged);
      window.removeEventListener('openhamclock:dock-preset-duplicate', onDuplicate);
    };
  }, [flushPendingSave]);

  // Panel definitions (shared with the command palette — see src/panelDefs.js)
  const panelDefs = useMemo(() => buildPanelDefs({ isLocalInstall }), [isLocalInstall]);

  // Add panel
  const handleAddPanel = useCallback(
    (panelId) => {
      if (!targetTabSetId || !panelDefs[panelId]) return;
      model.doAction(
        Actions.addNode(
          { type: 'tab', name: panelDefs[panelId].name, component: panelId, id: `${panelId}-${Date.now()}` },
          targetTabSetId,
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
      setShowPanelPicker(false);
    },
    [model, targetTabSetId, panelDefs],
  );

  // Command palette → open a panel. The palette lives at app level with no
  // access to the flexlayout model, so it dispatches this event. If the panel
  // is already docked we focus its tab; otherwise it is added to the active
  // tabset (or the first one found). Adding respects the layout lock; focusing
  // an existing tab is always allowed (it doesn't alter the layout).
  useEffect(() => {
    const onAddPanel = (e) => {
      const panelId = e.detail?.panelId;
      if (!panelId || !panelDefs[panelId]) return;

      let existingTabId = null;
      const findTab = (n) => {
        if (existingTabId) return;
        if (n.getType?.() === 'tab' && n.getComponent?.() === panelId) {
          existingTabId = n.getId();
          return;
        }
        (n.getChildren?.() || []).forEach(findTab);
      };
      findTab(model.getRoot());
      if (existingTabId) {
        model.doAction(Actions.selectTab(existingTabId));
        return;
      }

      if (layoutLocked) return;
      let tabset = model.getActiveTabset?.() || null;
      if (!tabset) {
        const findTabset = (n) => {
          if (tabset) return;
          if (n.getType?.() === 'tabset') {
            tabset = n;
            return;
          }
          (n.getChildren?.() || []).forEach(findTabset);
        };
        findTabset(model.getRoot());
      }
      if (!tabset) return;
      model.doAction(
        Actions.addNode(
          { type: 'tab', name: panelDefs[panelId].name, component: panelId, id: `${panelId}-${Date.now()}` },
          tabset.getId(),
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
    };
    window.addEventListener('openhamclock:add-panel', onAddPanel);
    return () => window.removeEventListener('openhamclock:add-panel', onAddPanel);
  }, [model, panelDefs, layoutLocked]);

  // Remote control → close a panel (`/api/control/panels {remove:[…]}`).
  // Deletes every tab rendering that panel id; respects the layout lock.
  useEffect(() => {
    const onRemovePanel = (e) => {
      const panelId = e.detail?.panelId;
      if (!panelId || layoutLocked) return;
      const tabIds = [];
      const walk = (n) => {
        if (n.getType?.() === 'tab' && n.getComponent?.() === panelId) tabIds.push(n.getId());
        (n.getChildren?.() || []).forEach(walk);
      };
      walk(model.getRoot());
      tabIds.forEach((id) => model.doAction(Actions.deleteTab(id)));
    };
    window.addEventListener('openhamclock:remove-panel', onRemovePanel);
    return () => window.removeEventListener('openhamclock:remove-panel', onRemovePanel);
  }, [model, layoutLocked]);

  // Render DE Location panel content
  const renderDELocation = (nodeId) => (
    <div className="panel" style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>
        📍 DE - YOUR LOCATION
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700' }}>{deGrid}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
          {config.location.lat.toFixed(4)}°, {config.location.lon.toFixed(4)}°
        </div>
        <div style={{ marginTop: '8px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
          <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{deSunTimes.local.sunrise}</span>
          {deSunTimes.local.sunset !== '' && (
            <>
              <span style={{ color: 'var(--text-secondary)' }}> → </span>
              <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>
                {deSunTimes.local?.sunset ?? deSunTimes.sunset}
              </span>
              <span style={{ color: 'var(--text-secondary) ' }}> {config.timezone}</span>
            </>
          )}
        </div>
      </div>

      <WeatherPanel weatherData={localWeather} allUnits={config.allUnits} nodeId={nodeId} alerts={localAlerts} />
    </div>
  );

  // Render DX Location panel
  const renderDXLocation = (nodeId) => {
    const spBearing = Math.round(
      calculateBearing(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon),
    );
    const lpBearing = (spBearing + 180) % 360;
    const distanceKm = calculateDistance(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon);

    return (
      <div className="panel" style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700' }}>🎯 DX - TARGET</div>
          {handleToggleDxLock && (
            <button
              onClick={handleToggleDxLock}
              title={dxLocked ? 'Unlock DX position (allow map clicks)' : 'Lock DX position (prevent map clicks)'}
              style={{
                background: dxLocked ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                color: dxLocked ? '#000' : 'var(--text-secondary)',
                border: '1px solid ' + (dxLocked ? 'var(--accent-amber)' : 'var(--border-color)'),
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              {dxLocked ? '🔒' : '🔓'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <DXGridInput
                  dxGrid={dxGrid}
                  onDXChange={handleDXChange}
                  dxLocked={dxLocked}
                  style={{
                    color: 'var(--accent-amber)',
                    fontSize: '22px',
                    fontWeight: '700',
                    flex: '0 0 auto',
                  }}
                />
                <DXCallsignInput
                  dxCallsign={dxCallsign}
                  onDXChange={handleDXChange}
                  dxLocked={dxLocked}
                  style={{
                    color: 'var(--accent-amber)',
                    fontSize: '22px',
                    fontWeight: '900',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <DXFavorites dxLocation={dxLocation} dxGrid={dxGrid} onDXChange={handleDXChange} dxLocked={dxLocked} />
                <button
                  type="button"
                  onClick={() => setShowDxccSelect((prev) => !prev)}
                  title={t('app.dxLocation.dxccToggleTitle')}
                  aria-label={t('app.dxLocation.dxccToggleTitle')}
                  style={{
                    background: showDxccSelect ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    color: showDxccSelect ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    flex: '0 0 auto',
                  }}
                >
                  DXCC
                </button>
                <span ref={callsignInfoRef} style={{ flex: '0 0 auto' }}>
                  <button
                    onClick={() => dxCallsign && showPopup(dxCallsign, callsignInfoRef.current)}
                    title={
                      dxCallsign
                        ? t('app.dxLocation.callsignLookupTitle', { callsign: dxCallsign })
                        : t('app.dxLocation.callsignLookupEmptyTitle')
                    }
                    aria-label={t('app.dxLocation.callsignLookupAriaLabel')}
                    aria-disabled={!dxCallsign}
                    disabled={!dxCallsign}
                    style={{
                      background: dxCallsign ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                      color: dxCallsign ? 'var(--text-secondary)' : 'var(--text-muted)',
                      border: '1px solid ' + (dxCallsign ? 'var(--border-color)' : 'transparent'),
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: dxCallsign ? 'pointer' : 'not-allowed',
                      opacity: dxCallsign ? 1 : 0.5,
                      lineHeight: 1,
                      flex: '0 0 auto',
                    }}
                  >
                    i
                  </button>
                </span>
              </div>
            </div>
            {showDxccSelect && (
              <DXCCSelect dxLocked={dxLocked} onDXChange={handleDXChange} style={{ margin: '5px 0 10px 0' }} />
            )}
            {dxLocation.lat != null && dxLocation.lon != null && (
              <DXLocalTime currentTime={currentTime} timezone={dxTimezone} solarTimezone={dxSolarFallback} />
            )}
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
              {dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°
            </div>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
              <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
              <span style={{ color: 'var(--text-secondary)' }}> → </span>
              <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
              <span style={{ color: 'var(--text-secondary)' }}> UTC </span>
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--border-color)',
              paddingLeft: '12px',
              flex: '0 0 auto',
            }}
          >
            <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '6px' }}>
              {t?.('app.dxLocation.beamDir') || 'Beam Dir:'}
            </div>
            <div style={{ fontSize: '13px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t?.('app.dxLocation.sp') || 'SP:'} </span>
              <span
                style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}
                title={bearingMode === 'magnetic' ? 'Magnetic bearing (WMM2025)' : 'True bearing'}
              >
                {formatBearing(spBearing, config.location.lat, config.location.lon, bearingMode)}
              </span>
            </div>
            <div style={{ fontSize: '13px', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t?.('app.dxLocation.lp') || 'LP:'} </span>
              <span
                style={{ color: 'var(--accent-purple)', fontWeight: '700' }}
                title={bearingMode === 'magnetic' ? 'Magnetic bearing (WMM2025)' : 'True bearing'}
              >
                {formatBearing(lpBearing, config.location.lat, config.location.lon, bearingMode)}
              </span>
            </div>
            <div style={{ fontSize: '13px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
                📏 {formatDistance(distanceKm, config.allUnits.dist)}
              </span>
            </div>
          </div>
        </div>

        {showDxWeather && (
          <WeatherPanel weatherData={dxWeather} allUnits={config.allUnits} nodeId={nodeId} alerts={dxAlerts} />
        )}
      </div>
    );
  };

  const rot = useRotator({
    mock: false,
    endpointUrl: isLocalInstall ? '/api/rotator/status' : undefined,
    pollMs: 2000,
    staleMs: 5000,
  });
  const turnRotator = useCallback(async (azimuth) => {
    const res = await fetch('/api/rotator/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azimuth }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }, []);

  const stopRotator = useCallback(async () => {
    const res = await fetch('/api/rotator/stop', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }, []);

  // ── Satellite automation: rotator auto-track + Doppler tuning ──────────
  // Two rotator backends: Rig Bridge's rotctld plugin (az + el, preferred
  // when running) and the server's PSTRotator UDP route (az only).
  const rigForSat = useRig();
  const rbRotator = useRigBridgeRotator({
    rigUrl: rigForSat.rigUrl,
    apiToken: config.rigControl?.apiToken || '',
    enabled: !!rigForSat.enabled && !rigForSat.isCloudRelay,
  });
  const rotatorBackend = useMemo(
    () =>
      rbRotator.available
        ? {
            kind: 'rig-bridge',
            available: rbRotator.connected,
            connected: rbRotator.connected,
            azimuth: rbRotator.azimuth,
            elevation: rbRotator.elevation,
            hasElevation: true,
          }
        : {
            kind: 'server',
            available: rot.available && rot.status === 'connected',
            connected: rot.status === 'connected',
            azimuth: rot.azimuth,
            elevation: null,
            hasElevation: false,
          },
    [
      rbRotator.available,
      rbRotator.connected,
      rbRotator.azimuth,
      rbRotator.elevation,
      rot.available,
      rot.status,
      rot.azimuth,
    ],
  );
  const sendRotatorPosition = useCallback(
    async ({ az, el }) => (rbRotator.available ? rbRotator.setPosition(az, el) : turnRotator(Math.round(az))),
    [rbRotator.available, rbRotator.setPosition, turnRotator],
  );
  const stopAnyRotator = useCallback(async () => {
    setRotatorMode('off');
    return rbRotator.available ? rbRotator.stop() : stopRotator();
  }, [rbRotator.available, rbRotator.stop, stopRotator]);
  // What the Rotator panel and the map beam read: the live backend.
  const rotatorView = useMemo(
    () =>
      rbRotator.available
        ? {
            azimuth: rbRotator.azimuth,
            lastGoodAzimuth: rbRotator.azimuth,
            elevation: rbRotator.elevation,
            isStale: !rbRotator.connected,
            status: rbRotator.connected ? 'connected' : 'disconnected',
            lastError: rbRotator.error,
            source: 'rig-bridge',
            available: true,
            reconnect: undefined,
          }
        : rot,
    [rbRotator.available, rbRotator.azimuth, rbRotator.elevation, rbRotator.connected, rbRotator.error, rot],
  );
  useEffect(() => {
    setSatAutomationLive({ rotatorAvailable: rotatorBackend.available });
  }, [rotatorBackend.available]);
  const satAuto = useSatAutomation();
  const trackedSatNames = useMemo(
    () => (satellites?.data || []).filter((s) => s.omm).map((s) => s.name),
    [satellites?.data],
  );
  // Map beam: the commanded azimuth as a true bearing (un-flipped).
  const rotatorTargetAzimuth = useMemo(() => {
    const tgt = satAuto.rotatorTarget;
    if (!tgt || !Number.isFinite(tgt.az)) return null;
    return tgt.flip ? (tgt.az + 180) % 360 : tgt.az;
  }, [satAuto.rotatorTarget]);
  useDopplerTuning({
    satellites: satellites?.data,
    deLocation: config.location,
    rig: rigForSat,
    settings: config.satellite,
  });
  useRotatorAutoTrack({
    satellites: satellites?.data,
    deLocation: config.location,
    dxLocation,
    rotator: rotatorBackend,
    send: sendRotatorPosition,
    settings: config.satellite,
  });

  // Render World Map
  const renderWorldMap = () => (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <WorldMap
        config={config}
        isLocalInstall={isLocalInstall}
        deLocation={config.location}
        dxLocation={dxLocation}
        onDXChange={handleDXChange}
        dxLocked={dxLocked}
        onHoverSpot={setHoveredSpot}
        potaSpots={filteredPotaSpots ? filteredPotaSpots : potaSpots.data}
        wwffSpots={filteredWwffSpots ? filteredWwffSpots : wwffSpots.data}
        sotaSpots={filteredSotaSpots ? filteredSotaSpots : sotaSpots.data}
        wwbotaSpots={filteredWwbotaSpots ? filteredWwbotaSpots : wwbotaSpots.data}
        mySpots={mySpots.data}
        dxPaths={dxClusterData.paths}
        dxFilters={dxFilters}
        mapBandFilter={mapBandFilter}
        onMapBandFilterChange={setMapBandFilter}
        satellites={filteredSatellites}
        pskReporterSpots={filteredPskSpots}
        wsjtxSpots={wsjtxMapSpots}
        showDeDxMarkers={mapLayersEff.showDeDxMarkers}
        showDXPaths={mapLayersEff.showDXPaths}
        showDXLabels={mapLayersEff.showDXLabels}
        onToggleDXLabels={mapLayersEff.showDXPaths ? toggleDXLabelsEff : undefined}
        spotLabelMode={mapLayersEff.spotLabelMode}
        spotLabelMinKm={mapLayersEff.spotLabelMinKm}
        showPOTA={mapLayersEff.showPOTA}
        showPOTALabels={mapLayersEff.showPOTALabels}
        showWWFF={mapLayersEff.showWWFF}
        showWWFFLabels={mapLayersEff.showWWFFLabels}
        showSOTA={mapLayersEff.showSOTA}
        showSOTALabels={mapLayersEff.showSOTALabels}
        showWWBOTA={mapLayersEff.showWWBOTA}
        showWWBOTALabels={mapLayersEff.showWWBOTALabels}
        showSatellites={mapLayersEff.showSatellites}
        onToggleSatellites={toggleSatellitesEff}
        showPSKReporter={mapLayersEff.showPSKReporter}
        showPSKPaths={mapLayersEff.showPSKPaths}
        showMutualReception={config.showMutualReception !== false}
        showWSJTX={mapLayersEff.showWSJTX}
        showDXNews={mapLayersEff.showDXNews}
        showAPRS={mapLayersEff.showAPRS}
        aprsStations={aprsData?.filteredStations}
        aprsWatchlistCalls={aprsData?.allWatchlistCalls}
        showAPRSLabels={mapLayersEff.showAPRSLabels}
        aprsIconScale={mapLayersEff.aprsIconScale ?? 1}
        showMeshCom={mapLayersEff.showMeshCom}
        meshcomNodes={meshcomData?.nodes}
        // ✅ Rotator bearing overlay support
        showRotatorBearing={mapLayersEff.showRotatorBearing}
        rotatorAzimuth={rotatorView.azimuth}
        rotatorLastGoodAzimuth={rotatorView.lastGoodAzimuth}
        rotatorIsStale={rotatorView.isStale}
        rotatorControlEnabled={!rotatorView.isStale}
        onRotatorTurnRequest={(az) => sendRotatorPosition({ az, el: 0 })}
        rotatorTargetAzimuth={rotatorTargetAzimuth}
        hoveredSpot={hoveredSpot}
        leftSidebarVisible={true}
        rightSidebarVisible={true}
        callsign={config.callsign}
        lowMemoryMode={config.lowMemoryMode}
        allUnits={config.allUnits}
        onSpotClick={handleSpotClick}
        mouseZoom={config.mouseZoom}
      />
    </div>
  );

  // Factory for rendering panel content
  const factory = useCallback(
    (node) => {
      const component = node.getComponent();
      const nodeId = node.getId();

      let content;
      switch (component) {
        case 'world-map':
          return renderWorldMap(); // Map has its own zoom — skip panel zoom

        case 'map-list-view':
          content = (
            <MapDataListView
              dxSpots={dxClusterData.spots}
              satellites={filteredSatellites || satellites}
              potaSpots={filteredPotaSpots || potaSpots?.data}
              sotaSpots={filteredSotaSpots || sotaSpots?.data}
              wwffSpots={filteredWwffSpots || wwffSpots?.data}
              wwbotaSpots={filteredWwbotaSpots || wwbotaSpots?.data}
              lightning={mapTextData.lightning}
              aircraft={mapTextData.aircraft}
              aurora={mapTextData.aurora}
              winlink={mapTextData.winlink}
              deLocation={config.location}
              units={config.allUnits?.dist}
            />
          );
          break;

        case 'de-location':
          content = renderDELocation(nodeId);
          break;

        case 'dx-location':
          content = renderDXLocation(nodeId);
          break;

        case 'analog-clock':
          content = <AnalogClockPanel currentTime={currentTime} sunTimes={deSunTimes} />;
          break;

        case 'solar':
          content = <SolarPanel solarIndices={solarIndices} bandConditions={bandConditions} config={config} />;
          break;

        case 'solar-image':
          content = (
            <SolarPanel
              solarIndices={solarIndices}
              bandConditions={bandConditions}
              config={config}
              forcedMode="image"
            />
          );
          break;

        case 'solar-indices':
          content = (
            <SolarPanel
              solarIndices={solarIndices}
              bandConditions={bandConditions}
              config={config}
              forcedMode="indices"
            />
          );
          break;

        case 'solar-xray':
          content = (
            <SolarPanel solarIndices={solarIndices} bandConditions={bandConditions} config={config} forcedMode="xray" />
          );
          break;

        case 'lunar':
          content = (
            <SolarPanel
              solarIndices={solarIndices}
              bandConditions={bandConditions}
              config={config}
              forcedMode="lunar"
            />
          );
          break;

        case 'propagation':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              allUnits={config.allUnits}
              propConfig={config.propagation}
              deSunTimes={deSunTimes}
              currentTime={currentTime}
              dxSpots={dxClusterData.spots}
              clusterFilters={dxFilters}
              timeZone={config.timezone}
            />
          );
          break;

        case 'propagation-chart':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              allUnits={config.allUnits}
              propConfig={config.propagation}
              deSunTimes={deSunTimes}
              currentTime={currentTime}
              timeZone={config.timezone}
              forcedMode="chart"
            />
          );
          break;

        case 'propagation-bars':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              allUnits={config.allUnits}
              propConfig={config.propagation}
              deSunTimes={deSunTimes}
              currentTime={currentTime}
              timeZone={config.timezone}
              forcedMode="bars"
            />
          );
          break;

        case 'band-conditions':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              allUnits={config.allUnits}
              propConfig={config.propagation}
              deSunTimes={deSunTimes}
              currentTime={currentTime}
              timeZone={config.timezone}
              forcedMode="bands"
            />
          );
          break;

        case 'band-health':
          content = <BandHealthPanel dxSpots={dxClusterData.spots} clusterFilters={dxFilters} />;
          break;

        case 'band-activity':
          content = <BandActivityHeatmap dxSpots={dxClusterData.spots} userCallsign={config.callsign} />;
          break;

        case 'psk-bands':
          content = <PSKReporterBandActivityPanel pskReporter={pskReporter} />;
          break;

        case 'dx-cluster':
          content = (
            <DXClusterPanel
              data={dxClusterData.spots}
              loading={dxClusterData.loading}
              error={dxClusterData.error}
              totalSpots={dxClusterData.totalSpots}
              filters={dxFilters}
              onFilterChange={setDxFilters}
              onOpenFilters={() => setShowDXFilters(true)}
              onHoverSpot={setHoveredSpot}
              onSpotClick={handleSpotClick}
              hoveredSpot={hoveredSpot}
              showOnMap={mapLayersEff.showDXPaths}
              onToggleMap={toggleDXPathsEff}
              userCallsign={config.callsign}
              deLat={config.location?.lat}
              deLon={config.location?.lon}
            />
          );
          break;

        case 'logbook':
          content = (
            <LogbookPanel
              userCallsign={config.callsign}
              myGrid={liveGrid || deGrid}
              onDXChange={handleDXChange}
              dxLocation={dxLocation}
              dxCallsign={dxCallsign}
            />
          );
          break;

        case 'awards':
          content = <AwardsPanel />;
          break;

        case 'psk-reporter':
          content = (
            <PSKReporterPanel
              callsign={config.callsign}
              showMutualReception={config.showMutualReception !== false}
              pskReporter={pskReporter}
              showOnMap={mapLayersEff.showPSKReporter}
              onToggleMap={togglePSKReporterEff}
              showPaths={mapLayersEff.showPSKPaths}
              onTogglePaths={togglePSKPathsEff}
              filters={pskFilters}
              onOpenFilters={() => setShowPSKFilters(true)}
              onSpotClick={handleSpotClick}
              wsjtxDecodes={wsjtx.decodes}
              wsjtxClients={wsjtx.clients}
              wsjtxQsos={wsjtx.qsos}
              wsjtxWspr={wsjtx.wspr}
              wsjtxStats={wsjtx.stats}
              wsjtxLoading={wsjtx.loading}
              wsjtxEnabled={wsjtx.enabled}
              wsjtxPort={wsjtx.port}
              wsjtxRelayEnabled={wsjtx.relayEnabled}
              wsjtxRelayConnected={wsjtx.relayConnected}
              wsjtxSessionId={wsjtx.sessionId}
              showWSJTXOnMap={mapLayersEff.showWSJTX}
              onToggleWSJTXMap={toggleWSJTXEff}
              wsjtxRelayMulticast={config.wsjtxRelayMulticast}
            />
          );
          break;

        case 'dxpeditions':
          content = <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />;
          break;

        case 'pota':
          content = (
            <POTAPanel
              data={potaSpots.data}
              loading={potaSpots.loading}
              lastUpdated={potaSpots.lastUpdated}
              lastChecked={potaSpots.lastChecked}
              showOnMap={mapLayersEff.showPOTA}
              onToggleMap={togglePOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showPOTALabels}
              onToggleLabelsOnMap={togglePOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={potaFilters}
              onOpenFilters={() => setShowPotaFilters(true)}
              filteredData={filteredPotaSpots}
            />
          );
          break;

        case 'wwff':
          content = (
            <WWFFPanel
              data={wwffSpots.data}
              loading={wwffSpots.loading}
              lastUpdated={wwffSpots.lastUpdated}
              lastChecked={wwffSpots.lastChecked}
              showOnMap={mapLayersEff.showWWFF}
              onToggleMap={toggleWWFFEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showWWFFLabels}
              onToggleLabelsOnMap={toggleWWFFLabelsEff}
              onSpotClick={handleSpotClick}
              filters={wwffFilters}
              onOpenFilters={() => setShowWwffFilters(true)}
              filteredData={filteredWwffSpots}
            />
          );
          break;

        case 'sota':
          content = (
            <SOTAPanel
              data={sotaSpots.data}
              loading={sotaSpots.loading}
              lastUpdated={sotaSpots.lastUpdated}
              lastChecked={sotaSpots.lastChecked}
              showOnMap={mapLayersEff.showSOTA}
              onToggleMap={toggleSOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showSOTALabels}
              onToggleLabelsOnMap={toggleSOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={sotaFilters}
              onOpenFilters={() => setShowSotaFilters(true)}
              filteredData={filteredSotaSpots}
            />
          );
          break;

        case 'wwbota':
          content = (
            <WWBOTAPanel
              data={wwbotaSpots.data}
              loading={wwbotaSpots.loading}
              lastUpdated={wwbotaSpots.lastUpdated}
              connected={wwbotaSpots.connected}
              showOnMap={mapLayersEff.showWWBOTA}
              onToggleMap={toggleWWBOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showWWBOTALabels}
              onToggleLabelsOnMap={toggleWWBOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={wwbotaFilters}
              onOpenFilters={() => setShowWwbotaFilters(true)}
              filteredData={filteredWwbotaSpots}
            />
          );
          break;

        case 'aprs':
          content = (
            <APRSPanel
              aprsData={aprsData}
              showOnMap={mapLayersEff.showAPRS}
              onToggleMap={toggleAPRSEff}
              showLabelsOnMap={mapLayersEff.showAPRSLabels}
              onToggleLabelsOnMap={toggleAPRSLabelsEff}
              iconScale={mapLayersEff.aprsIconScale ?? 1}
              onCycleIconScale={cycleAprsIconScaleEff}
              onHoverSpot={setHoveredSpot}
              onSpotClick={handleSpotClick}
              deLocation={config.location}
              units={config.allUnits?.dist}
            />
          );
          break;

        case 'aprs-telemetry':
          content = <APRSTelemetryPanel />;
          break;

        case 'contests':
          content = <ContestPanel data={contests.data} loading={contests.loading} />;
          break;

        case 'swpc-alerts':
          content = (
            <SWPCAlertsPanel
              data={swpcAlerts?.data}
              loading={swpcAlerts?.loading}
              error={swpcAlerts?.error}
              scales={noaaScales.data}
            />
          );
          break;

        case 'meteor-showers':
          content = <MeteorShowerPanel deLat={config.location?.lat ?? null} deLon={config.location?.lon ?? null} />;
          break;

        case 'world-clocks':
          content = <WorldClockPanel />;
          break;

        case 'stopwatch':
          content = <StopwatchPanel />;
          break;

        case 'sun-moon':
          content = <SunMoonPanel deLocation={config.location} dxLocation={dxLocation} />;
          break;

        case 'sat-passes':
          content = <SatellitePassesPanel satellites={satellites} config={config} />;
          break;

        case 'rbn-mine':
          content = <RBNMySignalPanel config={config} />;
          break;

        case 'swpc-trends':
          content = <SpaceWxTrendsPanel />;
          break;

        case 'wspr-mine':
          content = <WSPRMySpotsPanel config={config} />;
          break;

        case 'amsat-status':
          content = <AMSATStatusPanel />;
          break;

        case 'repeaters':
          content = <RepeatersPanel config={config} />;
          break;

        case 'pota-activator':
          content = <POTAActivatorPanel config={config} />;
          break;

        case 'aircraft-nearby':
          content = <AircraftNearbyPanel config={config} />;
          break;

        case 'rotator':
          return (
            <RotatorPanel
              state={rotatorView}
              overlayEnabled={mapLayersEff.showRotatorBearing}
              onToggleOverlay={toggleRotatorBearingEff}
              onTurnAzimuth={(az) => sendRotatorPosition({ az, el: 0 })}
              onStop={stopAnyRotator}
              controlsEnabled={!rotatorView.isStale}
              satOptions={trackedSatNames}
              deLat={config.location?.lat ?? null}
              deLon={config.location?.lon ?? null}
            />
          );

        case 'ambient':
          content = <AmbientPanel allUnits={config.allUnits} />;
          break;

        case 'rig-control':
          content = <RigControlPanel />;
          break;

        case 'freq-memories':
          content = <FrequencyMemoriesPanel />;
          break;

        case 'net-schedule':
          content = <NetSchedulePanel />;
          break;

        case 'net-control':
          content = (
            <NetControlPanel callsign={config.callsign} timeZone={config.timezone} location={config.location} />
          );
          break;

        case 'callsign-search':
          content = (
            <CallsignSearchPanel
              deLocation={config.location}
              units={config.allUnits?.dist}
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
            />
          );
          break;

        case 'dx-news':
          content = <DXNewsPanel />;
          break;

        case 'solar-cycle':
          content = <SolarCyclePanel solarIndices={solarIndices} />;
          break;

        case 'log-stats':
          content = <LogStatsPanel deLocation={config.location} units={config.allUnits?.dist} />;
          break;

        case 'sked-planner':
          content = (
            <SkedPlannerPanel
              propagation={propagation.data}
              loading={propagation.loading}
              deLocation={config.location}
              dxLocation={dxLocation}
              dxCallsign={dxCallsign}
              propConfig={config.propagation}
              timeZone={config.timezone}
              dxTimezone={dxTimezone}
              dxSolarFallback={dxSolarFallback}
              allUnits={config.allUnits}
            />
          );
          break;

        case 'ionosonde':
          content = <IonosondePanel deLocation={config.location} units={config.allUnits?.dist} />;
          break;

        case 'prop-verify':
          content = (
            <PropVerifyPanel
              deLocation={config.location}
              deCallsign={config.callsign}
              dxLocation={dxLocation}
              dxCallsign={dxCallsign}
              units={config.allUnits?.dist}
              dxSpots={dxClusterData.spots}
              pskReporter={pskReporter}
              solarIndices={solarIndices}
              propConfig={config.propagation}
            />
          );
          break;

        case 'on-air':
          content = <OnAirPanel />;
          break;

        case 'id-timer':
          content = <IDTimerPanel callsign={config.callsign} />;
          break;

        case 'image':
          content = <ImagePanel />;
          break;

        case 'keybindings':
          content = <KeybindingsPanel keybindings={keybindingsList} nodeId={nodeId} />;
          break;

        case 'meshtastic':
          content = <MeshtasticPanel />;
          break;

        case 'meshcom':
          content = (
            <MeshComPanel
              showOnMap={mapLayersEff.showMeshCom}
              onToggleMap={toggleMeshComEff}
              onHoverSpot={setHoveredSpot}
              onSpotClick={handleSpotClick}
            />
          );
          break;

        case 'digital-modes':
          content = <DigitalModesPanel />;
          break;

        case 'decoder':
          content = (
            <DecoderPanel
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
              onSpotClick={handleSpotClick}
              apiToken={config.rigControl?.apiToken || ''}
            />
          );
          break;

        case 'winlink':
          content = (
            <WinlinkPanel
              deLocation={config.location}
              propConfig={config.propagation}
              solarIndices={solarIndices}
              units={config.allUnits?.dist}
              onSelectGateway={handleSelectWinlinkGateway}
            />
          );
          break;

        case 'ibp':
          content = (
            <IBPPanel
              deLat={config.location?.lat ?? null}
              deLon={config.location?.lon ?? null}
              units={config.allUnits?.dist ?? 'metric'}
            />
          );
          break;

        case 'grayline-planner':
          content = (
            <GraylinePlannerPanel
              deLocation={config.location}
              dxLocation={dxLocation}
              dxCallsign={dxCallsign}
              timeZone={config.timezone}
            />
          );
          break;

        case 'eme-planner':
          content = <EmePlannerPanel deLocation={config.location} dxLocation={dxLocation} dxCallsign={dxCallsign} />;
          break;

        case 'sat-planner':
          content = (
            <SatPlannerPanel satellites={satellites} config={config} dxLocation={dxLocation} dxCallsign={dxCallsign} />
          );
          break;

        case 'cluster-console':
          content = <ClusterConsolePanel config={config} isLocalInstall={isLocalInstall} />;
          break;

        case 'rover':
          content = <RoverPanel config={config} />;
          break;

        case 'env-sensors':
          content = <EnvSensorsPanel allUnits={config.allUnits} />;
          break;

        case 'opportunities':
          content = <OpportunityPanel opportunities={opportunities} onSpotClick={handleSpotClick} />;
          break;

        case 'solar-outlook':
          content = <SolarOutlookPanel />;
          break;

        case 'benchmark':
          content = <BenchmarkPanel config={config} />;
          break;

        case 'noaa-scales':
          content = <NOAAScalesPanel data={noaaScales.data} loading={noaaScales.loading} error={noaaScales.error} />;
          break;

        case 'dst':
          content = <DstPanel data={dst.data} loading={dst.loading} error={dst.error} />;
          break;

        case 'eclipse':
          content = <EclipsePanel deLat={config.location?.lat ?? null} deLon={config.location?.lon ?? null} />;
          break;

        case 'planets':
          content = (
            <PlanetsPanel
              deLat={config.location?.lat ?? null}
              deLon={config.location?.lon ?? null}
              use12Hour={use12Hour}
              timeZone={config.timezone || undefined}
            />
          );
          break;

        case 'space-launches':
          content = (
            <SpaceLaunchesPanel
              deLocation={config.location}
              units={config.allUnits?.dist}
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
            />
          );
          break;

        case 'tropical':
          content = (
            <TropicalPanel
              deLocation={config.location}
              units={config.allUnits?.dist}
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
            />
          );
          break;

        case 'fire-weather':
          content = (
            <FireWeatherPanel
              deLocation={config.location}
              units={config.allUnits?.dist}
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
            />
          );
          break;

        case 'marine':
          content = (
            <MarinePanel
              deLocation={config.location}
              units={config.allUnits?.dist}
              onSetDX={handleDXChange}
              dxLocked={dxLocked}
            />
          );
          break;

        case 'windy':
          content = <WindyPanel deLocation={config.location} dxLocation={dxLocation} units={config.allUnits?.dist} />;
          break;

        case 'wefax':
          content = <WefaxPanel onTune={handleSpotClick} rigEnabled={enabled} />;
          break;

        case 'hamalert':
          content = (
            <HamAlertPanel
              alerts={hamAlert.alerts}
              onClear={hamAlert.clear}
              onSpotClick={handleSpotClick}
              onHoverSpot={setHoveredSpot}
              configured={hamAlert.configured}
              serverEnabled={hamAlert.serverEnabled}
              bridgeActive={hamAlert.bridgeActive}
              error={hamAlert.error}
              isLocalInstall={isLocalInstall}
            />
          );
          break;

        case 'balloons':
          content = (
            <BalloonsPanel
              deLat={config.location?.lat ?? null}
              deLon={config.location?.lon ?? null}
              units={config.allUnits?.dist ?? 'imperial'}
              onSpotClick={handleSpotClick}
            />
          );
          break;

        case 'ics-forms':
          content = <IcsFormsPanel config={config} />;
          break;

        default: {
          // Auto-discovered panel plugins (src/plugins/local/panels/*.jsx).
          // v1 props contract: { config, t } only — see docs/PLUGINS.md.
          const plugin = getPanelPluginById(component);
          if (plugin) {
            const PluginPanel = plugin.Panel;
            content = (
              <div className="panel" style={{ height: '100%', overflow: 'auto' }}>
                <ErrorBoundary>
                  <PluginPanel config={config} t={t} />
                </ErrorBoundary>
              </div>
            );
          } else {
            content = (
              <div style={{ padding: '20px', color: '#ff6b6b', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', marginBottom: '8px' }}>Outdated panel: {component}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>Click "Reset" button below to update layout</div>
              </div>
            );
          }
        }
      }

      // Apply per-panel zoom
      const zoom = panelZoom[component] || 1.0;
      if (zoom !== 1.0) {
        return <div style={{ zoom, width: '100%', height: '100%', transformOrigin: 'top left' }}>{content}</div>;
      }
      return content;
    },
    [
      config,
      deGrid,
      liveGrid,
      dxGrid,
      dxLocation,
      dxCallsign,
      deSunTimes,
      dxSunTimes,
      showDxWeather,
      localWeather,
      dxWeather,
      localAlerts,
      dxAlerts,
      solarIndices,
      propagation,
      bandConditions,
      dxClusterData,
      dxFilters,
      mapBandFilter,
      hoveredSpot,
      mapLayers,
      potaSpots,
      wwffSpots,
      sotaSpots,
      mySpots,
      satellites,
      filteredSatellites,
      filteredPskSpots,
      wsjtxMapSpots,
      dxpeditions,
      contests,
      swpcAlerts,
      noaaScales,
      dst,
      use12Hour,
      hamAlert,
      isLocalInstall,
      bearingMode,
      pskFilters,
      wsjtx,
      handleDXChange,
      setDxFilters,
      setMapBandFilter,
      setShowDXFilters,
      setShowPSKFilters,
      setHoveredSpot,
      toggleDXPaths,
      toggleDXLabels,
      togglePOTA,
      toggleWWFF,
      toggleSOTA,
      toggleSatellites,
      togglePSKReporter,
      togglePSKPaths,
      toggleWSJTX,
      dxLocked,
      handleToggleDxLock,
      panelZoom,
      keybindingsList,
      t,
      opportunities,
    ],
  );

  // Add + and font size buttons to tabsets
  const onRenderTabSet = useCallback(
    (node, renderValues) => {
      // Get the active tab's component name for zoom controls
      const selectedNode = node.getSelectedNode?.();
      const selectedComponent = selectedNode?.getComponent?.();

      // Per-tab help — deep-links to the manual section for the selected panel
      if (selectedComponent) {
        renderValues.stickyButtons.push(
          <HelpLink
            key="help"
            topic={panelHelpTopic(selectedComponent)}
            label={selectedNode?.getName?.() || selectedComponent}
            className="flexlayout__tab_toolbar_button"
            style={{ fontSize: '11px', padding: '0 3px' }}
          />,
        );
      }

      // Skip zoom controls for world-map
      if (selectedComponent && selectedComponent !== 'world-map') {
        const currentZoom = panelZoom[selectedComponent] || 1.0;
        const zoomPct = Math.round(currentZoom * 100);

        renderValues.stickyButtons.push(
          <button
            key="zoom-out"
            title="Decrease font size"
            className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
              e.stopPropagation();
              adjustZoom(selectedComponent, -1);
            }}
            style={{
              fontSize: '11px',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              padding: '0 3px',
              opacity: currentZoom <= 0.7 ? 0.3 : 1,
            }}
          >
            A−
          </button>,
        );
        if (currentZoom !== 1.0) {
          renderValues.stickyButtons.push(
            <button
              key="zoom-reset"
              title="Reset font size"
              className="flexlayout__tab_toolbar_button"
              onClick={(e) => {
                e.stopPropagation();
                resetZoom(selectedComponent);
              }}
              style={{
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                padding: '0 2px',
                color: 'var(--accent-amber)',
              }}
            >
              {zoomPct}%
            </button>,
          );
        }
        renderValues.stickyButtons.push(
          <button
            key="zoom-in"
            title="Increase font size"
            className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
              e.stopPropagation();
              adjustZoom(selectedComponent, 1);
            }}
            style={{
              fontSize: '11px',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              padding: '0 3px',
              opacity: currentZoom >= 2.0 ? 0.3 : 1,
            }}
          >
            A+
          </button>,
        );
      }

      // Auto-rotation controls for tabsets with 2+ tabs
      const tabsetId = node.getId();
      const children = node.getChildren?.() || [];
      if (children.length >= 2) {
        const rotCfg = tabsetRotation[tabsetId];
        const isRotating = rotCfg?.enabled;

        if (isRotating) {
          renderValues.stickyButtons.push(
            <select
              key="rotate-interval"
              value={rotCfg?.interval || 15}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                setTabsetInterval(tabsetId, e.target.value);
              }}
              style={{
                fontSize: '9px',
                padding: '1px 2px',
                background: 'var(--bg-secondary)',
                color: 'var(--accent-amber)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                outline: 'none',
                cursor: 'pointer',
                width: '40px',
                height: '18px',
              }}
            >
              {[5, 10, 15, 20, 30, 45, 60].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>,
          );
        }

        renderValues.stickyButtons.push(
          <button
            key="rotate"
            title={isRotating ? 'Stop auto-rotate' : 'Auto-rotate tabs'}
            className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
              e.stopPropagation();
              toggleTabsetRotation(tabsetId);
            }}
            style={{
              fontSize: '11px',
              padding: '0 3px',
              color: isRotating ? 'var(--accent-amber)' : undefined,
            }}
          >
            {isRotating ? '⏸' : '▶'}
          </button>,
        );
      }

      renderValues.stickyButtons.push(
        <button
          key="add"
          title={layoutLocked ? 'Unlock layout to add panels' : 'Add panel'}
          className="flexlayout__tab_toolbar_button"
          disabled={layoutLocked}
          onClick={(e) => {
            e.stopPropagation();
            if (layoutLocked) return;
            setTargetTabSetId(node.getId());
            setShowPanelPicker(true);
          }}
          style={layoutLocked ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
        >
          <PlusIcon />
        </button>,
      );
    },
    [panelZoom, adjustZoom, resetZoom, layoutLocked, tabsetRotation, toggleTabsetRotation, setTabsetInterval],
  );

  // Get unused panels
  const getAvailablePanels = useCallback(() => {
    const used = new Set();
    const walk = (n) => {
      if (n.getType?.() === 'tab') used.add(n.getComponent());
      (n.getChildren?.() || []).forEach(walk);
    };
    walk(model.getRoot());
    return Object.entries(panelDefs)
      .filter(([id]) => !used.has(id))
      .map(([id, def]) => ({ id, ...def }));
  }, [model, panelDefs]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        padding: '8px',
        gap: '8px',
        background: 'var(--bg-primary)',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <Header
          config={config}
          utcTime={utcTime}
          utcDate={utcDate}
          localTime={localTime}
          localDate={localDate}
          localWeather={localWeather}
          spaceWeather={spaceWeather}
          solarIndices={solarIndices}
          bandConditions={bandConditions}
          use12Hour={use12Hour}
          onTimeFormatToggle={handleTimeFormatToggle}
          onSettingsClick={() => setShowSettings(true)}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
          onUpdateClick={handleUpdateClick}
          updateInProgress={updateInProgress}
          showUpdateButton={isLocalInstall}
        />
      </div>

      {/* Dockable Layout */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <DockableLayoutProvider model={model}>
          <Layout
            ref={layoutRef}
            model={model}
            factory={factory}
            onAction={handleAction}
            onModelChange={handleModelChange}
            onRenderTabSet={onRenderTabSet}
          />
        </DockableLayoutProvider>
      </div>

      {/* Panel picker modal */}
      {showPanelPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowPanelPicker(false)}
        >
          <div
            style={{
              background: 'rgba(26,32,44,0.98)',
              border: '1px solid #2d3748',
              borderRadius: '12px',
              padding: '20px',
              minWidth: '350px',
              width: 'min(960px, 94vw)',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
              Add Panel
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '8px',
              }}
            >
              {(() => {
                const panels = getAvailablePanels();
                const ungrouped = panels.filter((p) => !p.group);
                const groups = {};
                panels
                  .filter((p) => p.group)
                  .forEach((p) => {
                    if (!groups[p.group]) groups[p.group] = [];
                    groups[p.group].push(p);
                  });
                return (
                  <>
                    {ungrouped.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAddPanel(p.id)}
                        style={{
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid #2d3748',
                          borderRadius: '6px',
                          padding: '10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#00ffcc';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#2d3748';
                        }}
                      >
                        <PanelIcon
                          panelId={p.id}
                          icon={p.icon}
                          iconColor={p.iconColor}
                          size={20}
                          style={{ marginRight: '8px' }}
                        />
                        <span style={{ color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                          {p.name}
                        </span>
                      </button>
                    ))}
                    {Object.entries(groups).map(([group, items]) => (
                      <React.Fragment key={group}>
                        <div
                          style={{
                            gridColumn: '1 / -1',
                            fontSize: '10px',
                            color: '#718096',
                            fontFamily: 'var(--font-mono)',
                            marginTop: '6px',
                            borderTop: '1px solid #2d3748',
                            paddingTop: '8px',
                          }}
                        >
                          {group === 'Plugins' ? 'Plugins' : `${group} Sub-panels`}
                        </div>
                        {items.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleAddPanel(p.id)}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid #2d3748',
                              borderRadius: '6px',
                              padding: '8px 10px',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = '#00ffcc';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = '#2d3748';
                            }}
                          >
                            <PanelIcon
                              panelId={p.id}
                              icon={p.icon}
                              iconColor={p.iconColor}
                              size={20}
                              style={{ marginRight: '6px' }}
                            />
                            <span style={{ color: '#cbd5e0', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                              {p.name}
                            </span>
                          </button>
                        ))}
                      </React.Fragment>
                    ))}
                  </>
                );
              })()}
            </div>
            {getAvailablePanels().length === 0 && (
              <div style={{ color: '#718096', textAlign: 'center', padding: '20px' }}>All panels visible</div>
            )}
            <button
              onClick={() => setShowPanelPicker(false)}
              style={{
                width: '100%',
                marginTop: '12px',
                background: 'transparent',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                padding: '8px',
                color: '#a0aec0',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default DockableApp;
