/**
 * SettingsPanel Component
 * Full settings modal with map layer controls
 */
import { useState, useEffect, useRef } from 'react';
import { calculateGridSquare, parseGridSquare } from '../utils/geo.js';
import { useTranslation, Trans } from 'react-i18next';
import { LANGUAGES } from '../lang/i18n.js';
import {
  getProfiles,
  getActiveProfile,
  saveProfile,
  loadProfile,
  deleteProfile,
  renameProfile,
  exportProfile,
  exportCurrentState,
  importProfile,
} from '../utils/profiles.js';
import { useTheme } from '../theme/useTheme';
import ThemeSelector from './ThemeSelector';
import CustomThemeEditor from './CustomThemeEditor';
import useLocalInstall from '../hooks/app/useLocalInstall.js';
import { emojiToIso2 } from '../utils/countryFlags';
import { getAlertSettings, saveAlertSettings, playTone, TONE_PRESETS, ALERT_FEEDS } from '../utils/audioAlerts';

export const SettingsPanel = ({
  isOpen,
  onClose,
  config,
  onSave,
  onResetLayout,
  satellites,
  satelliteFilters,
  onSatelliteFiltersChange,
  mapLayers,
  onToggleDeDxMarkers,
  onToggleDXNews,
  wakeLockStatus,
  defaultTab,
  wsjtxSessionId,
}) => {
  const { theme, setTheme, customTheme, updateCustomVar } = useTheme();

  const [callsign, setCallsign] = useState(config?.callsign || '');
  const [headerSize, setheaderSize] = useState(config?.headerSize || 1.0);
  const [swapHeaderClocks, setSwapHeaderClocks] = useState(config?.swapHeaderClocks || false);
  const [showMutualReception, setShowMutualReception] = useState(config?.showMutualReception ?? true);
  const [gridSquare, setGridSquare] = useState(config?.locator || '');
  const [lat, setLat] = useState(config?.location?.lat ?? 0);
  const [lon, setLon] = useState(config?.location?.lon ?? 0);
  const [stationAlt, setStationAlt] = useState(config?.location?.stationAlt ?? 100);
  const [minElev, setMinElev] = useState(config?.satellite?.minElev ?? 5.0);
  const [layout, setLayout] = useState(config?.layout || 'modern');
  const [mouseZoom, setMouseZoom] = useState(config?.mouseZoom || 50);
  const [timezone, setTimezone] = useState(config?.timezone || '');
  const [dxClusterSource, setDxClusterSource] = useState(config?.dxClusterSource || 'dxspider-proxy');
  const [customDxCluster, setCustomDxCluster] = useState(
    config?.customDxCluster || { enabled: false, host: '', port: 7300 },
  );
  const [udpDxCluster, setUdpDxCluster] = useState(config?.udpDxCluster || { host: '', port: 12060 });
  const [lowMemoryMode, setLowMemoryMode] = useState(config?.lowMemoryMode || false);
  const [preventSleep, setPreventSleep] = useState(config?.preventSleep || false);
  const [sharePresence, setSharePresence] = useState(config?.sharePresence !== false);
  const [displaySchedule, setDisplaySchedule] = useState(
    config?.displaySchedule || { enabled: false, sleepTime: '23:00', wakeTime: '07:00' },
  );
  const [distUnits, setDistUnits] = useState(config?.allUnits?.dist || config?.units || 'imperial');
  const [tempUnits, setTempUnits] = useState(config?.allUnits?.temp || config?.units || 'imperial');
  const [pressUnits, setPressUnits] = useState(config?.allUnits?.press || config?.units || 'imperial');
  const [propMode, setPropMode] = useState(config?.propagation?.mode || 'SSB');
  const [propPower, setPropPower] = useState(config?.propagation?.power || 100);
  const [rigEnabled, setRigEnabled] = useState(config?.rigControl?.enabled || false);
  const [rigHost, setRigHost] = useState(config?.rigControl?.host || 'http://localhost');
  const [rigPort, setRigPort] = useState(normalizeRigPort(config?.rigControl?.port));
  const [tuneEnabled, setTuneEnabled] = useState(config?.rigControl?.tuneEnabled || false);
  const [autoMode, setAutoMode] = useState(config?.rigControl?.autoMode !== false);
  const [rigApiToken, setRigApiToken] = useState(config?.rigControl?.apiToken || '');
  const [cloudRelaySession, setCloudRelaySession] = useState(config?.rigControl?.cloudRelaySession || '');
  const [showRigToken, setShowRigToken] = useState(false);
  const [wsjtxRelayStatus, setWsjtxRelayStatus] = useState(null); // null | 'pushing' | 'ok' | 'error'
  const [wsjtxRelayMsg, setWsjtxRelayMsg] = useState('');
  const [satelliteSearch, setSatelliteSearch] = useState('');
  const isLocalInstall = useLocalInstall();
  const [rotatorEnabled, setRotatorEnabled] = useState(() => {
    try {
      return localStorage.getItem('ohc_rotator_enabled') === '1';
    } catch {
      return false;
    }
  });
  const [wsjtxMulticastEnabled, setWsjtxMulticastEnabled] = useState(config?.wsjtxRelayMulticast.enabled || false);
  const [wsjtxMulticastAddress, setWsjtxMulticastAddress] = useState(
    config?.wsjtxRelayMulticast.address || '224.0.0.1',
  );
  // Local-only integration flags
  const [n3fjpEnabled, setN3fjpEnabled] = useState(() => {
    try {
      return localStorage.getItem('ohc_n3fjp_enabled') === '1';
    } catch {
      return false;
    }
  });

  // DX Weather (local-only)
  const [dxWeatherEnabled, setDxWeatherEnabled] = useState(() => {
    try {
      return localStorage.getItem('ohc_dx_weather_enabled') === '1';
    } catch {
      return false;
    }
  });

  // N3FJP UI settings (persisted)
  const [n3fjpDisplayMinutes, setN3fjpDisplayMinutes] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('n3fjp_display_minutes') || '15', 10);
      return Number.isFinite(v) ? v : 15;
    } catch {
      return 15;
    }
  });
  const [n3fjpLineColor, setN3fjpLineColor] = useState(() => {
    try {
      return localStorage.getItem('n3fjp_line_color') || '#3388ff';
    } catch {
      return '#3388ff';
    }
  });
  const { t, i18n } = useTranslation();

  // Layer controls
  const [layers, setLayers] = useState([]);
  const [activeTab, setActiveTab] = useState(defaultTab || 'station');
  const [ctrlPressed, setCtrlPressed] = useState(false);

  // Switch to requested tab when opened from sidebar
  useEffect(() => {
    if (isOpen && defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [isOpen, defaultTab]);

  // Profile management state
  const [profiles, setProfilesList] = useState({});
  const [activeProfileName, setActiveProfileName] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [renamingProfile, setRenamingProfile] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [profileMessage, setProfileMessage] = useState(null);
  const fileInputRef = useRef(null);

  // QRZ API state
  const [qrzUsername, setQrzUsername] = useState('');
  const [qrzPassword, setQrzPassword] = useState('');
  const [qrzStatus, setQrzStatus] = useState(null); // { configured, hasSession, source, ... }
  const [qrzTesting, setQrzTesting] = useState(false);
  const [qrzMessage, setQrzMessage] = useState(null); // { type: 'success'|'error', text }

  const refreshProfiles = () => {
    setProfilesList(getProfiles());
    setActiveProfileName(getActiveProfile());
  };

  const toggleUnitType = (t) => {
    return t == 'imperial' ? 'metric' : 'imperial';
  };
  const toggleDistUnits = () => {
    setDistUnits(toggleUnitType(distUnits));
  };
  const toggleTempUnits = () => {
    setTempUnits(toggleUnitType(tempUnits));
  };
  const togglePressUnits = () => {
    setPressUnits(toggleUnitType(pressUnits));
  };

  useEffect(() => {
    if (config) {
      setCallsign(config.callsign || '');
      setheaderSize(config.headerSize || 1.0);
      setLat(config.location?.lat ?? 0);
      setLon(config.location?.lon ?? 0);
      setStationAlt(config.location?.stationAlt ?? 100);
      setMinElev(config.satellite?.minElev ?? 5.0);
      setLayout(config.layout || 'modern');
      setMouseZoom(config.mouseZoom || 50);
      setTimezone(config.timezone || '');
      setDxClusterSource(config.dxClusterSource || 'dxspider-proxy');
      setCustomDxCluster(config.customDxCluster || { enabled: false, host: '', port: 7300 });
      setUdpDxCluster(config.udpDxCluster || { host: '', port: 12060 });
      setLowMemoryMode(config.lowMemoryMode || false);
      setPreventSleep(config.preventSleep || false);
      setSharePresence(config.sharePresence !== false);
      setDistUnits(config.allUnits?.dist || config.units || 'imperial');
      setTempUnits(config.allUnits?.temp || config.units || 'imperial');
      setPressUnits(config.allUnits?.press || config.units || 'imperial');
      setPropMode(config.propagation?.mode || 'SSB');
      setPropPower(config.propagation?.power || 100);
      setRigEnabled(config.rigControl?.enabled || false);
      setRigHost(config.rigControl?.host || 'http://localhost');
      setRigPort(normalizeRigPort(config.rigControl?.port));
      setTuneEnabled(config.rigControl?.tuneEnabled || false);
      setAutoMode(config.rigControl?.autoMode !== false);
      setRigApiToken(config.rigControl?.apiToken || '');
      if (config.location?.lat != null && config.location?.lon != null) {
        const grid = calculateGridSquare(config.location.lat, config.location.lon);
        setGridSquare(grid);
        setConfigLocator(grid);
      }
    }
  }, [config, isOpen]);

  // Keep rotator toggle in sync with localStorage when opening settings
  useEffect(() => {
    if (!isOpen) return;
    try {
      setRotatorEnabled(localStorage.getItem('ohc_rotator_enabled') === '1');
    } catch {
      setRotatorEnabled(false);
    }
  }, [isOpen]);

  // Keep N3FJP toggle/settings in sync with localStorage when opening settings
  useEffect(() => {
    if (!isOpen) return;
    try {
      setN3fjpEnabled(localStorage.getItem('ohc_n3fjp_enabled') === '1');
      const v = parseInt(localStorage.getItem('n3fjp_display_minutes') || '15', 10);
      setN3fjpDisplayMinutes(Number.isFinite(v) ? v : 15);
      setN3fjpLineColor(localStorage.getItem('n3fjp_line_color') || '#3388ff');
    } catch {
      setN3fjpEnabled(false);
      setN3fjpDisplayMinutes(15);
      setN3fjpLineColor('#3388ff');
    }
  }, [isOpen]);

  // Load layers when panel opens
  useEffect(() => {
    if (isOpen && window.hamclockLayerControls) {
      setLayers(window.hamclockLayerControls.layers || []);
    }
    if (isOpen) {
      refreshProfiles();
    }
  }, [isOpen]);

  // Refresh layers periodically
  useEffect(() => {
    if (isOpen && activeTab === 'layers') {
      const interval = setInterval(() => {
        if (window.hamclockLayerControls) {
          setLayers([...window.hamclockLayerControls.layers]);
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [isOpen, activeTab]);

  // Fetch QRZ status when profiles tab opens
  useEffect(() => {
    if (isOpen && activeTab === 'profiles') {
      fetch('/api/qrz/status')
        .then((r) => r.json())
        .then((data) => setQrzStatus(data))
        .catch(() => setQrzStatus(null));
    }
  }, [isOpen, activeTab]);

  // Track CTRL key state
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Control') setCtrlPressed(true);
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Control') setCtrlPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Reset all popup positions for a plugin
  const resetPopupPositions = (layerId) => {
    const storageKeys = {
      lightning: ['lightning-stats-position', 'lightning-proximity-position'],
      wspr: ['wspr-filter-position', 'wspr-stats-position', 'wspr-legend-position', 'wspr-chart-position'],
      rbn: ['rbn-panel-position'],
      grayline: ['grayline-position'],
      n3fjp_logged_qsos: ['n3fjp-position'],
      'voacap-heatmap': ['voacap-heatmap-position'],
    };

    const keys = storageKeys[layerId] || [];
    keys.forEach((key) => {
      localStorage.removeItem(key);
      // Also remove minimized state
      localStorage.removeItem(key + '-minimized');
    });

    // Reload the page to apply position resets
    if (keys.length > 0) {
      window.location.reload();
    }
  };

  const gridEditingRef = useRef(false);

  function setConfigLocator(grid) {
    if (grid.length >= 4) {
      config.locator = grid.slice(0, 4).toUpperCase() + grid.slice(4).toLowerCase();
    } else {
      config.locator = grid.toUpperCase();
    }
  }
  const handleGridChange = (grid) => {
    gridEditingRef.current = true;
    setGridSquare(grid.toUpperCase());
    if (grid.length >= 4) {
      const parsed = parseGridSquare(grid);
      if (parsed) {
        setLat(parsed.lat);
        setLon(parsed.lon);
      }
    }
    setConfigLocator(grid);
  };

  const handleGridBlur = () => {
    gridEditingRef.current = false;
    // Now recalculate full 6-char grid from lat/lon
    if (lat != null && lon != null) {
      const grid = calculateGridSquare(lat, lon);
      setGridSquare(grid);
      setConfigLocator(grid);
    }
  };

  useEffect(() => {
    // Skip auto-completion while user is actively typing in the grid field
    if (gridEditingRef.current) return;
    if (lat != null && lon != null) {
      const grid = calculateGridSquare(lat, lon);
      setGridSquare(grid);
      setConfigLocator(grid);
    }
  }, [lat, lon]);

  const handleUseLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(position.coords.latitude);
          setLon(position.coords.longitude);
        },
        (error) => {
          console.error('Geolocation error:', error);
          alert(t('station.settings.useLocation.error1'));
        },
      );
    } else {
      alert(t('station.settings.useLocation.error2'));
    }
  };

  const handleToggleLayer = (layerId) => {
    if (window.hamclockLayerControls) {
      const layer = layers.find((l) => l.id === layerId);
      const newEnabledState = !layer.enabled;

      // Update the control
      window.hamclockLayerControls.toggleLayer(layerId, newEnabledState);

      // Force immediate UI update
      setLayers((prevLayers) => prevLayers.map((l) => (l.id === layerId ? { ...l, enabled: newEnabledState } : l)));

      // Refresh after a short delay to get the updated state
      setTimeout(() => {
        if (window.hamclockLayerControls) {
          setLayers([...window.hamclockLayerControls.layers]);
        }
      }, 100);
    }
  };
  const handleUpdateLayerConfig = (layerId, configDelta) => {
    if (window.hamclockLayerControls?.updateLayerConfig) {
      window.hamclockLayerControls.updateLayerConfig(layerId, configDelta);

      setLayers((prevLayers) =>
        prevLayers.map((l) => (l.id === layerId ? { ...l, config: { ...(l.config || {}), ...configDelta } } : l)),
      );
    }
  };

  const handleOpacityChange = (layerId, opacity) => {
    if (window.hamclockLayerControls) {
      window.hamclockLayerControls.setOpacity(layerId, opacity);
      setLayers([...window.hamclockLayerControls.layers]);
    }
  };

  const persistCurrentSettings = () => {
    const rigPortValue = String(rigPort ?? '').trim();
    let nextRigPort = 5555;
    if (rigPortValue === '0') {
      nextRigPort = 0;
    } else {
      const parsedRigPort = parseInt(rigPortValue, 10);
      if (Number.isFinite(parsedRigPort) && parsedRigPort > 0) {
        nextRigPort = parsedRigPort;
      }
    }

    onSave({
      ...config,
      callsign: callsign.toUpperCase(),
      headerSize: headerSize,
      swapHeaderClocks,
      showMutualReception,
      location: {
        lat: parseFloat(lat) || 0,
        lon: parseFloat(lon) || 0,
        stationAlt: isNaN(parseInt(stationAlt)) ? 100 : parseInt(stationAlt),
      },
      satellite: { minElev: isNaN(parseFloat(minElev)) ? 5.0 : parseFloat(minElev) },
      theme,
      customTheme,
      layout,
      mouseZoom,
      timezone,
      dxClusterSource,
      customDxCluster,
      udpDxCluster,
      lowMemoryMode,
      preventSleep,
      sharePresence,
      displaySchedule,
      // units,
      allUnits: { dist: distUnits, temp: tempUnits, press: pressUnits },
      propagation: { mode: propMode, power: parseFloat(propPower) || 100 },
      wsjtxRelayMulticast: { enabled: wsjtxMulticastEnabled, address: wsjtxMulticastAddress },
      rigControl: {
        enabled: rigEnabled,
        host: rigHost,
        port: nextRigPort,
        tuneEnabled,
        autoMode,
        apiToken: rigApiToken.trim(),
        cloudRelaySession: cloudRelaySession.trim(),
      },
    });
  };

  const handleConfigureWsjtxRelay = async () => {
    const rigBridgeUrl = `${rigHost.replace(/\/$/, '')}:${rigPort}`;
    if (!rigHost || !rigPort) {
      setWsjtxRelayStatus('error');
      setWsjtxRelayMsg(t('station.settings.rigControl.wsjtxRelay.status.error.norig'));
      return;
    }
    setWsjtxRelayStatus('pushing');
    setWsjtxRelayMsg('');
    try {
      // Fetch relay key from the local OHC server (same-origin, no CORS needed)
      const credRes = await fetch('/api/wsjtx/relay-credentials');
      if (!credRes.ok) {
        const err = await credRes.json().catch(() => ({}));
        setWsjtxRelayStatus('error');
        setWsjtxRelayMsg(err.error || t('station.settings.rigControl.wsjtxRelay.status.error.nokey'));
        return;
      }
      const { relayKey } = await credRes.json();
      // Push to rig-bridge
      const headers = { 'Content-Type': 'application/json' };
      if (rigApiToken) headers['X-RigBridge-Token'] = rigApiToken;
      const pushRes = await fetch(`${rigBridgeUrl}/api/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          wsjtxRelay: {
            url: window.location.origin,
            key: relayKey,
            session: wsjtxSessionId || '',
            enabled: true,
            relayToServer: true,
          },
        }),
      });
      if (!pushRes.ok) {
        setWsjtxRelayStatus('error');
        setWsjtxRelayMsg(t('station.settings.rigControl.wsjtxRelay.status.error.push'));
        return;
      }
      setWsjtxRelayStatus('ok');
      setWsjtxRelayMsg(t('station.settings.rigControl.wsjtxRelay.status.ok'));
    } catch {
      setWsjtxRelayStatus('error');
      setWsjtxRelayMsg(t('station.settings.rigControl.wsjtxRelay.status.error.push'));
    }
  };

  const handleSave = () => {
    persistCurrentSettings();
    onClose();
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const Code = ({ children }) => (
    <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '3px' }}>{children}</code>
  );

  const layoutDescriptions = {
    modern: t('station.settings.layout.modern.describe'),
    classic: t('station.settings.layout.classic.describe'),
    tablet: t('station.settings.layout.tablet.describe'),
    compact: t('station.settings.layout.compact.describe'),
    dockable: t('station.settings.layout.dockable.describe'),
    emcomm: t('station.settings.layout.emcomm.describe'),
  };

  const unitString = (t) => {
    // Use "US Customary" instead of "Imperial" to avoid confusion with UK Imperial units which are different,
    // for instance pressure 'inHg' is not a UK Imperial unit but is used in USA.
    return t == 'imperial' ? 'US Customary' : 'Metric';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '2px solid var(--accent-amber)',
          borderRadius: '12px',
          padding: '24px',
          width: '80vw',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2
          style={{
            color: 'var(--accent-cyan)',
            marginTop: 0,
            marginBottom: '24px',
            textAlign: 'center',
            fontFamily: 'Orbitron, monospace',
            fontSize: '20px',
          }}
        >
          ⚙ {t('station.settings.title')}
        </h2>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            marginBottom: '24px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '12px',
          }}
        >
          <button
            onClick={() => setActiveTab('station')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'station' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'station' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'station' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            📻 {t('station.settings.tab.title.station')}
          </button>

          <button
            onClick={() => setActiveTab('integrations')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'integrations' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'integrations' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'integrations' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🔌 {t('station.settings.tab.title.integrations')}
          </button>

          <button
            onClick={() => setActiveTab('display')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'display' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'display' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'display' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🎨 {t('station.settings.tab.title.display')}
          </button>

          <button
            onClick={() => setActiveTab('layers')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'layers' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'layers' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'layers' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🗺️ {t('station.settings.tab.title.mapLayers')}
          </button>

          <button
            onClick={() => setActiveTab('satellites')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'satellites' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'satellites' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'satellites' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🛰️ {t('station.settings.tab.title.satellites')}
          </button>

          <button
            onClick={() => {
              setActiveTab('profiles');
              refreshProfiles();
            }}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'profiles' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'profiles' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'profiles' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            👤 {t('station.settings.tab.title.profiles')}
          </button>

          <button
            onClick={() => setActiveTab('community')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'community' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'community' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'community' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🌐 {t('station.settings.tab.title.community')}
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'alerts' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'alerts' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'alerts' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🔔 {t('station.settings.tab.title.alerts')}
          </button>

          <button
            onClick={() => setActiveTab('rig-bridge')}
            style={{
              flex: 1,
              padding: '10px',
              background: activeTab === 'rig-bridge' ? 'var(--accent-amber)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === 'rig-bridge' ? '#000' : 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === 'rig-bridge' ? '700' : '400',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            📻 Rig Bridge
          </button>
        </div>

        {/* Station Settings Tab */}
        {activeTab === 'station' && (
          <>
            {/* First-time setup banner */}
            {(config?.configIncomplete || config?.callsign === 'N0CALL' || !config?.locator) && (
              <div
                style={{
                  background: 'rgba(255, 193, 7, 0.15)',
                  border: '1px solid var(--accent-amber)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  fontSize: '13px',
                }}
              >
                <div style={{ color: 'var(--accent-amber)', fontWeight: '700', marginBottom: '6px' }}>
                  {t('station.settings.welcome')}
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('station.settings.describe')}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '8px' }}>
                  <Trans i18nKey="station.settings.tip.env" components={{ envExample: <Code />, env: <Code /> }} />
                </div>
              </div>
            )}

            {/* Integrations moved to dedicated tab */}
            <div
              style={{
                background: 'rgba(0, 255, 255, 0.04)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '20px',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              Looking for Rotator / N3FJP / other add-ons? See{' '}
              <b>Settings → {t('station.settings.tab.title.integrations')}</b>.
            </div>

            {/* Callsign */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.callsign')}
              </label>
              <input
                type="text"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--accent-amber)',
                  fontSize: '18px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: '700',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Grid Square */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.locator')}
              </label>
              <input
                type="text"
                value={gridSquare}
                onChange={(e) => handleGridChange(e.target.value)}
                onBlur={handleGridBlur}
                placeholder={t('station.settings.locator.placeholder')}
                maxLength={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--accent-amber)',
                  fontSize: '18px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: '700',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Lat/Lon */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('station.settings.latitude')}
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={isNaN(lat) ? '' : lat}
                  onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    fontFamily: 'JetBrains Mono, monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('station.settings.longitude')}
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={isNaN(lon) ? '' : lon}
                  onChange={(e) => setLon(parseFloat(e.target.value) || 0)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    fontFamily: 'JetBrains Mono, monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <button
              onClick={handleUseLocation}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                cursor: 'pointer',
                marginBottom: '20px',
              }}
            >
              📍 {t('station.settings.useLocation')}
            </button>

            {/* Mouse wheel zoom factor */}
            <div style={{ marginBottom: '31px' }}>
              <label
                style={{
                  display: 'block',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.mouseZoom')}
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={mouseZoom}
                  onChange={(e) => setMouseZoom(e.target.value)}
                  style={{
                    width: '100%',
                    cursor: 'pointer',
                    marginTop: '3px',
                  }}
                />
              </label>
              <span style={{ float: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('station.settings.mouseZoom.describeMin')}
              </span>
              <span style={{ float: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('station.settings.mouseZoom.describeMax')}
              </span>
            </div>

            {/* DX Cluster Source */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                🕐 {t('station.settings.timezone')}
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: timezone ? 'var(--accent-green)' : 'var(--text-muted)',
                  fontSize: '14px',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                }}
              >
                <option value="">{t('station.settings.timezone.auto')}</option>
                <optgroup label={t('station.settings.timezone.group.northAmerica')}>
                  <option value="America/New_York">Eastern (New York)</option>
                  <option value="America/Chicago">Central (Chicago)</option>
                  <option value="America/Denver">Mountain (Denver)</option>
                  <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                  <option value="America/Anchorage">Alaska</option>
                  <option value="Pacific/Honolulu">Hawaii</option>
                  <option value="America/Phoenix">Arizona (no DST)</option>
                  <option value="America/Regina">Saskatchewan (no DST)</option>
                  <option value="America/Halifax">Atlantic (Halifax)</option>
                  <option value="America/St_Johns">Newfoundland</option>
                  <option value="America/Toronto">Ontario (Toronto)</option>
                  <option value="America/Winnipeg">Manitoba (Winnipeg)</option>
                  <option value="America/Edmonton">Alberta (Edmonton)</option>
                  <option value="America/Vancouver">BC (Vancouver)</option>
                  <option value="America/Mexico_City">Mexico City</option>
                </optgroup>
                <optgroup label={t('station.settings.timezone.group.europe')}>
                  <option value="Europe/London">UK (London)</option>
                  <option value="Europe/Dublin">Ireland (Dublin)</option>
                  <option value="Europe/Paris">Central Europe (Paris)</option>
                  <option value="Europe/Berlin">Germany (Berlin)</option>
                  <option value="Europe/Rome">Italy (Rome)</option>
                  <option value="Europe/Madrid">Spain (Madrid)</option>
                  <option value="Europe/Amsterdam">Netherlands (Amsterdam)</option>
                  <option value="Europe/Brussels">Belgium (Brussels)</option>
                  <option value="Europe/Stockholm">Sweden (Stockholm)</option>
                  <option value="Europe/Helsinki">Finland (Helsinki)</option>
                  <option value="Europe/Athens">Greece (Athens)</option>
                  <option value="Europe/Bucharest">Romania (Bucharest)</option>
                  <option value="Europe/Moscow">Russia (Moscow)</option>
                  <option value="Europe/Warsaw">Poland (Warsaw)</option>
                  <option value="Europe/Zurich">Switzerland (Zurich)</option>
                  <option value="Europe/Lisbon">Portugal (Lisbon)</option>
                </optgroup>
                <optgroup label={t('station.settings.timezone.group.asiaPacific')}>
                  <option value="Asia/Tokyo">Japan (Tokyo)</option>
                  <option value="Asia/Seoul">Korea (Seoul)</option>
                  <option value="Asia/Shanghai">China (Shanghai)</option>
                  <option value="Asia/Hong_Kong">Hong Kong</option>
                  <option value="Asia/Taipei">Taiwan (Taipei)</option>
                  <option value="Asia/Singapore">Singapore</option>
                  <option value="Asia/Kolkata">India (Kolkata)</option>
                  <option value="Asia/Dubai">UAE (Dubai)</option>
                  <option value="Asia/Riyadh">Saudi Arabia (Riyadh)</option>
                  <option value="Asia/Tehran">Iran (Tehran)</option>
                  <option value="Asia/Bangkok">Thailand (Bangkok)</option>
                  <option value="Asia/Jakarta">Indonesia (Jakarta)</option>
                  <option value="Asia/Manila">Philippines (Manila)</option>
                  <option value="Australia/Brisbane">Australia Eastern (Brisbane)</option>
                  <option value="Australia/Sydney">Australia Eastern (Sydney, Canberra, Melbourne, Hobart)</option>
                  <option value="Australia/Adelaide">Australia Central (Adelaide)</option>
                  <option value="Australia/Perth">Australia Western (Perth)</option>
                  <option value="Pacific/Auckland">New Zealand (Auckland)</option>
                  <option value="Pacific/Fiji">Fiji</option>
                </optgroup>
                <optgroup label={t('station.settings.timezone.group.southAmerica')}>
                  <option value="America/Sao_Paulo">Brazil (São Paulo)</option>
                  <option value="America/Argentina/Buenos_Aires">Argentina (Buenos Aires)</option>
                  <option value="America/Santiago">Chile (Santiago)</option>
                  <option value="America/Bogota">Colombia (Bogotá)</option>
                  <option value="America/Lima">Peru (Lima)</option>
                  <option value="America/Caracas">Venezuela (Caracas)</option>
                </optgroup>
                <optgroup label={t('station.settings.timezone.group.africa')}>
                  <option value="Africa/Cairo">Egypt (Cairo)</option>
                  <option value="Africa/Johannesburg">South Africa (Johannesburg)</option>
                  <option value="Africa/Lagos">Nigeria (Lagos)</option>
                  <option value="Africa/Nairobi">Kenya (Nairobi)</option>
                  <option value="Africa/Casablanca">Morocco (Casablanca)</option>
                </optgroup>
                <optgroup label={t('station.settings.timezone.group.other')}>
                  <option value="UTC">UTC</option>
                  <option value="Atlantic/Reykjavik">Iceland (Reykjavik)</option>
                  <option value="Atlantic/Azores">Azores</option>
                  <option value="Indian/Maldives">Maldives</option>
                  <option value="Indian/Mauritius">Mauritius</option>
                </optgroup>
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {t('station.settings.timezone.describe')}
                {timezone ? '' : ' ' + t('station.settings.timezone.currentDefault')}
              </div>
            </div>

            {/* Units (Distance, Temperature and Pressure ) */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                📏 {t('station.settings.units.title')}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => toggleDistUnits()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--accent-green)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  {t('station.settings.units.distance')}: {unitString(distUnits)}
                </button>
                <button
                  onClick={() => toggleTempUnits()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--accent-green)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  {t('station.settings.units.temperature')}: {unitString(tempUnits)}
                </button>
                <button
                  onClick={() => togglePressUnits()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--accent-green)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  {t('station.settings.units.pressure')}: {unitString(pressUnits)}
                </button>
              </div>
            </div>

            {/* WSJTX Relay Multicast Options */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                🔁 WSJTX Relay Multicast Options
              </label>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                <input
                  type="checkbox"
                  checked={wsjtxMulticastEnabled}
                  onChange={(e) => setWsjtxMulticastEnabled(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>Use multicast address &nbsp;</span>
                <input
                  type="text"
                  value={wsjtxMulticastAddress}
                  onChange={(e) => setWsjtxMulticastAddress(e.target.value.toUpperCase())}
                  style={{
                    width: '10%',
                    marginLeft: '8px',
                    padding: '8px 12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: wsjtxMulticastEnabled ? 'var(--text-primary)' : 'var(--text-secondary',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                    boxSizing: 'border-box',
                  }}
                />
                If you are going to run a wsjt-x relay, define here if you need a multicast listener and what address it
                should be using.
              </div>
            </div>

            {/* Rig Control Settings */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.rigControl.title')} (Beta)
              </label>

              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                  <input
                    type="checkbox"
                    checked={rigEnabled}
                    onChange={(e) => setRigEnabled(e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
                    {t('station.settings.rigControl.enabled')}
                  </span>
                </div>

                {rigEnabled && (
                  <>
                    {/* Download Rig Listener */}
                    <div
                      style={{
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: '6px',
                        padding: '10px',
                        marginBottom: '12px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginBottom: '8px',
                          lineHeight: 1.4,
                        }}
                      >
                        📻 Download the Rig Listener for your computer. Double-click to run — it connects your radio to
                        OpenHamClock via USB.
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <a
                          href="/api/rig/download/windows"
                          style={{
                            padding: '5px 12px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          ⊞ Windows
                        </a>
                        <a
                          href="/api/rig/download/mac"
                          style={{
                            padding: '5px 12px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {' '}
                          Mac
                        </a>
                        <a
                          href="/api/rig/download/linux"
                          style={{
                            padding: '5px 12px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          🐧 Linux
                        </a>
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.7 }}>
                        Supports Yaesu, Kenwood, Elecraft, and Icom radios. No extra software needed.
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            marginBottom: '4px',
                            color: 'var(--text-muted)',
                            fontSize: '10px',
                          }}
                        >
                          {t('station.settings.rigControl.host')}
                        </label>
                        <input
                          type="text"
                          value={rigHost}
                          onChange={(e) => setRigHost(e.target.value)}
                          placeholder="http://localhost"
                          style={{
                            width: '100%',
                            padding: '8px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--accent-cyan)',
                            fontSize: '13px',
                            fontFamily: 'JetBrains Mono',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            marginBottom: '4px',
                            color: 'var(--text-muted)',
                            fontSize: '10px',
                          }}
                        >
                          {t('station.settings.rigControl.port')}
                        </label>
                        <input
                          type="number"
                          value={rigPort}
                          onChange={(e) => setRigPort(e.target.value)}
                          placeholder="5555"
                          style={{
                            width: '100%',
                            padding: '8px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--accent-cyan)',
                            fontSize: '13px',
                            fontFamily: 'JetBrains Mono',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={tuneEnabled}
                        onChange={(e) => setTuneEnabled(e.target.checked)}
                        style={{ marginRight: '8px' }}
                      />
                      <div>
                        <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                          {t('station.settings.rigControl.tuneEnabled')}
                        </span>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {t('station.settings.rigControl.tuneEnabled.hint')}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={autoMode}
                        onChange={(e) => setAutoMode(e.target.checked)}
                        style={{ marginRight: '8px' }}
                      />
                      <div>
                        <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                          {t('station.settings.rigControl.autoMode')}
                        </span>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {t('station.settings.rigControl.autoMode.hint')}
                        </div>
                      </div>
                    </div>

                    {/* API Token */}
                    <div style={{ marginTop: '12px' }}>
                      <label
                        style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}
                      >
                        {t('station.settings.rigControl.apiToken')}
                      </label>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type={showRigToken ? 'text' : 'password'}
                          value={rigApiToken}
                          onChange={(e) => setRigApiToken(e.target.value)}
                          placeholder={t('station.settings.rigControl.apiToken.placeholder')}
                          style={{
                            flex: 1,
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowRigToken((v) => !v)}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-secondary)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {showRigToken ? '🙈 Hide' : '👁 Show'}
                        </button>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                        {t('station.settings.rigControl.apiToken.hint')}
                      </div>
                    </div>

                    {/* WSJT-X Relay */}
                    <div
                      style={{
                        marginTop: '16px',
                        paddingTop: '12px',
                        borderTop: '1px solid var(--border-color)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '1px',
                          marginBottom: '6px',
                        }}
                      >
                        {t('station.settings.rigControl.wsjtxRelay.title')}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginBottom: '10px',
                          lineHeight: 1.4,
                        }}
                      >
                        {t('station.settings.rigControl.wsjtxRelay.hint')}
                      </div>

                      {/* Session ID display */}
                      {wsjtxSessionId && (
                        <div style={{ marginBottom: '10px' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                            {t('station.settings.rigControl.wsjtxRelay.sessionId')}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input
                              type="text"
                              readOnly
                              value={wsjtxSessionId}
                              style={{
                                flex: 1,
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(wsjtxSessionId)}
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--text-secondary)',
                                fontSize: '11px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              📋 Copy
                            </button>
                          </div>
                          <div
                            style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}
                          >
                            {t('station.settings.rigControl.wsjtxRelay.sessionId.hint')}
                          </div>
                        </div>
                      )}

                      {/* Configure button */}
                      <button
                        type="button"
                        onClick={handleConfigureWsjtxRelay}
                        disabled={wsjtxRelayStatus === 'pushing'}
                        style={{
                          width: '100%',
                          padding: '8px',
                          background: 'rgba(99,102,241,0.15)',
                          border: '1px solid rgba(99,102,241,0.3)',
                          borderRadius: '4px',
                          color: '#818cf8',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: wsjtxRelayStatus === 'pushing' ? 'wait' : 'pointer',
                        }}
                      >
                        {wsjtxRelayStatus === 'pushing'
                          ? t('station.settings.rigControl.wsjtxRelay.status.pushing')
                          : t('station.settings.rigControl.wsjtxRelay.configure')}
                      </button>

                      {/* Status feedback */}
                      {wsjtxRelayStatus && wsjtxRelayStatus !== 'pushing' && (
                        <div
                          style={{
                            marginTop: '6px',
                            fontSize: '11px',
                            color:
                              wsjtxRelayStatus === 'ok' ? 'var(--accent-green, #4ade80)' : 'var(--accent-red, #f87171)',
                            lineHeight: 1.4,
                          }}
                        >
                          {wsjtxRelayStatus === 'ok' ? '✅ ' : '❌ '}
                          {wsjtxRelayMsg}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Propagation Settings */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                ⌇ {t('station.settings.operatingMode.title')}
              </label>

              {/* Mode */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  {t('station.settings.operatingMode')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {[
                    { id: 'SSB', label: 'SSB', desc: 'Voice' },
                    { id: 'CW', label: 'CW', desc: 'Morse' },
                    { id: 'FT8', label: 'FT8', desc: 'Weak sig' },
                    { id: 'FT4', label: 'FT4', desc: 'Weak sig' },
                    { id: 'WSPR', label: 'WSPR', desc: 'Beacon' },
                    { id: 'JS8', label: 'JS8', desc: 'Chat' },
                    { id: 'RTTY', label: 'RTTY', desc: 'Teletype' },
                    { id: 'PSK31', label: 'PSK31', desc: 'PSK' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPropMode(m.id)}
                      style={{
                        padding: '6px 4px',
                        background: propMode === m.id ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                        border: `1px solid ${propMode === m.id ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                        borderRadius: '4px',
                        color: propMode === m.id ? '#000' : 'var(--text-secondary)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: propMode === m.id ? '700' : '400',
                        fontFamily: 'JetBrains Mono, monospace',
                        lineHeight: 1.2,
                        textAlign: 'center',
                      }}
                      title={m.desc}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Power */}
              <div style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  {t('station.settings.operatingMode.txPower')}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr) 1.2fr',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  {[
                    { w: 5, label: '5W', tip: 'QRP' },
                    { w: 25, label: '25W', tip: 'Low' },
                    { w: 100, label: '100W', tip: 'Std' },
                    { w: 1500, label: '1.5kW', tip: 'Max' },
                  ].map((p) => (
                    <button
                      key={p.w}
                      onClick={() => setPropPower(p.w)}
                      style={{
                        padding: '6px 4px',
                        background: propPower === p.w ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                        border: `1px solid ${propPower === p.w ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                        borderRadius: '4px',
                        color: propPower === p.w ? '#000' : 'var(--text-secondary)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: propPower === p.w ? '700' : '400',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      title={p.tip}
                    >
                      {p.label}
                    </button>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <input
                      type="number"
                      value={propPower}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (v > 0 && v <= 2000) setPropPower(v);
                      }}
                      style={{
                        width: '100%',
                        padding: '5px 4px',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace',
                        textAlign: 'center',
                        boxSizing: 'border-box',
                      }}
                      min="0.1"
                      max="2000"
                      step="1"
                    />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>W</span>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {(() => {
                  const modeAdv = { SSB: 0, CW: 10, RTTY: 8, PSK31: 10, FT8: 34, FT4: 30, WSPR: 41, JS8: 37 };
                  const adv = modeAdv[propMode] || 0;
                  const pwrDb = 10 * Math.log10((propPower || 100) / 100);
                  const margin = adv + pwrDb;
                  return `Signal margin: ${margin >= 0 ? '+' : ''}${margin.toFixed(1)} dB vs SSB@100W — ${
                    margin >= 30
                      ? 'extreme weak-signal advantage'
                      : margin >= 15
                        ? 'strong advantage — marginal bands may open'
                        : margin >= 5
                          ? 'moderate advantage'
                          : margin >= -5
                            ? 'baseline conditions'
                            : margin >= -15
                              ? 'reduced margin — some bands may close'
                              : 'significant disadvantage — only strong openings'
                  }`;
                })()}
              </div>
            </div>

            {/* Low Memory Mode */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                🧠 Performance Mode
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setLowMemoryMode(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: !lowMemoryMode ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    border: `1px solid ${!lowMemoryMode ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: !lowMemoryMode ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: !lowMemoryMode ? '600' : '400',
                  }}
                >
                  🚀 Full
                </button>
                <button
                  onClick={() => setLowMemoryMode(true)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: lowMemoryMode ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    border: `1px solid ${lowMemoryMode ? 'var(--accent-green)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: lowMemoryMode ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: lowMemoryMode ? '600' : '400',
                  }}
                >
                  🪶 Low Memory
                </button>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: lowMemoryMode ? 'var(--accent-green)' : 'var(--text-muted)',
                  marginTop: '6px',
                }}
              >
                {lowMemoryMode
                  ? '✓ Low Memory Mode: Reduced animations, fewer map markers, smaller spot limits. Recommended for systems with <8GB RAM.'
                  : 'Full Mode: All features enabled. Requires 8GB+ RAM for best performance.'}
              </div>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.preventSleep')}
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setPreventSleep(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: !preventSleep ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    border: `1px solid ${!preventSleep ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: !preventSleep ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: !preventSleep ? '600' : '400',
                  }}
                >
                  💤 {t('station.settings.preventSleep.off')}
                </button>
                <button
                  onClick={() => setPreventSleep(true)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: preventSleep ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    border: `1px solid ${preventSleep ? 'var(--accent-green)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: preventSleep ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: preventSleep ? '600' : '400',
                  }}
                >
                  🖥️ {t('station.settings.preventSleep.on')}
                </button>
              </div>
              <div style={{ marginTop: '8px' }}>
                {preventSleep && wakeLockStatus && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontWeight: '600',
                      marginBottom: '6px',
                      background: wakeLockStatus.active ? 'rgba(0,200,100,0.15)' : 'rgba(255,160,0,0.15)',
                      border: `1px solid ${wakeLockStatus.active ? 'var(--accent-green)' : 'var(--accent-amber)'}`,
                      color: wakeLockStatus.active ? 'var(--accent-green)' : 'var(--accent-amber)',
                    }}
                  >
                    {wakeLockStatus.active ? '🔒' : '⚠'}
                    {wakeLockStatus.active
                      ? t('station.settings.preventSleep.status.active')
                      : t(`station.settings.preventSleep.status.${wakeLockStatus.reason}`, {
                          defaultValue: t('station.settings.preventSleep.status.error'),
                        })}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '11px',
                    color: preventSleep && wakeLockStatus?.active ? 'var(--accent-green)' : 'var(--text-muted)',
                  }}
                >
                  {t(
                    preventSleep
                      ? 'station.settings.preventSleep.describe.on'
                      : 'station.settings.preventSleep.describe.off',
                  )}
                </div>
              </div>
            </div>

            {/* Active Users Presence */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.sharePresence')}
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setSharePresence(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: !sharePresence ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    border: `1px solid ${!sharePresence ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: !sharePresence ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: !sharePresence ? '600' : '400',
                  }}
                >
                  {t('station.settings.sharePresence.off')}
                </button>
                <button
                  onClick={() => setSharePresence(true)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: sharePresence ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    border: `1px solid ${sharePresence ? 'var(--accent-green)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: sharePresence ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: sharePresence ? '600' : '400',
                  }}
                >
                  {t('station.settings.sharePresence.on')}
                </button>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '8px',
                }}
              >
                {t(
                  sharePresence
                    ? 'station.settings.sharePresence.describe.on'
                    : 'station.settings.sharePresence.describe.off',
                )}
              </div>
            </div>

            {/* Display Schedule */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Display Schedule
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  marginBottom: '10px',
                }}
              >
                <input
                  type="checkbox"
                  checked={displaySchedule.enabled}
                  onChange={(e) => setDisplaySchedule({ ...displaySchedule, enabled: e.target.checked })}
                  style={{ accentColor: 'var(--accent-amber)' }}
                />
                Enable scheduled display sleep
              </label>
              {displaySchedule.enabled && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <label
                      style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}
                    >
                      Sleep at
                    </label>
                    <input
                      type="time"
                      value={displaySchedule.sleepTime}
                      onChange={(e) => setDisplaySchedule({ ...displaySchedule, sleepTime: e.target.value })}
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        padding: '6px 10px',
                        fontSize: '13px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}
                    >
                      Wake at
                    </label>
                    <input
                      type="time"
                      value={displaySchedule.wakeTime}
                      onChange={(e) => setDisplaySchedule({ ...displaySchedule, wakeTime: e.target.value })}
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        padding: '6px 10px',
                        fontSize: '13px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                  </div>
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {displaySchedule.enabled
                  ? `Display will go black at ${displaySchedule.sleepTime} and wake at ${displaySchedule.wakeTime} (local time). The wake lock will also be released so your TV or monitor can sleep.`
                  : 'Set a daily schedule to automatically black out the display and release the wake lock. Ideal for shack TVs and kiosk displays.'}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.dx.title')}
              </label>
              <select
                value={dxClusterSource}
                onChange={(e) => setDxClusterSource(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--accent-green)',
                  fontSize: '14px',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                }}
              >
                <option value="dxspider-proxy">{t('station.settings.dx.option1')}</option>
                <option value="hamqth">{t('station.settings.dx.option2')}</option>
                <option value="dxwatch">{t('station.settings.dx.option3')}</option>
                <option value="auto">{t('station.settings.dx.option4')}</option>
                <option value="custom">{t('station.settings.dx.custom.option')}</option>
                <option value="udp">
                  {t('station.settings.dx.udp.option', { defaultValue: 'UDP Spots (Local Network)' })}
                </option>
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {t('station.settings.dx.describe')}
              </div>
            </div>

            {dxClusterSource === 'udp' && (
              <div
                style={{
                  marginBottom: '20px',
                  padding: '16px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <label
                  style={{
                    display: 'block',
                    marginBottom: '12px',
                    color: 'var(--accent-cyan)',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}
                >
                  {t('station.settings.dx.udp.title', { defaultValue: 'UDP Spot Listener' })}
                </label>

                <div style={{ marginBottom: '12px' }}>
                  <label
                    style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {t('station.settings.dx.udp.host', { defaultValue: 'UDP IP Address (optional)' })}
                  </label>
                  <input
                    type="text"
                    value={udpDxCluster.host}
                    onChange={(e) => setUdpDxCluster({ ...udpDxCluster, host: e.target.value.trim() })}
                    placeholder={t('station.settings.dx.udp.host.placeholder', {
                      defaultValue: 'Leave blank unless a specific sender/multicast IP is required',
                    })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label
                    style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {t('station.settings.dx.udp.port', { defaultValue: 'UDP Port' })}
                  </label>
                  <input
                    type="number"
                    value={udpDxCluster.port}
                    onChange={(e) => setUdpDxCluster({ ...udpDxCluster, port: parseInt(e.target.value, 10) || 12060 })}
                    placeholder={t('station.settings.dx.udp.port.placeholder', { defaultValue: '12060' })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {t('station.settings.dx.udp.help', {
                    defaultValue:
                      'OpenHamClock listens for UDP DX spot packets on this port and plots matched spots on the map.',
                  })}
                </div>
              </div>
            )}

            {/* Custom DX Cluster Settings */}
            {dxClusterSource === 'custom' && (
              <div
                style={{
                  marginBottom: '20px',
                  padding: '16px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <label
                  style={{
                    display: 'block',
                    marginBottom: '12px',
                    color: 'var(--accent-cyan)',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}
                >
                  {t('station.settings.dx.custom.title')}
                </label>

                {/* Host */}
                <div style={{ marginBottom: '12px' }}>
                  <label
                    style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {t('station.settings.dx.custom.host')}
                  </label>
                  <input
                    type="text"
                    value={customDxCluster.host}
                    onChange={(e) => setCustomDxCluster({ ...customDxCluster, host: e.target.value })}
                    placeholder={t('station.settings.dx.custom.host.placeholder')}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                {/* Port */}
                <div style={{ marginBottom: '12px' }}>
                  <label
                    style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {t('station.settings.dx.custom.port')}
                  </label>
                  <input
                    type="number"
                    value={customDxCluster.port}
                    onChange={(e) => setCustomDxCluster({ ...customDxCluster, port: parseInt(e.target.value) || 7300 })}
                    placeholder={t('station.settings.dx.custom.port.placeholder')}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {t('station.settings.dx.custom.callsign', { callsign: callsign || 'N0CALL' })}{' '}
                  {t('station.settings.dx.custom.commonPorts')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--accent-amber)', marginTop: '8px' }}>
                  {t('station.settings.dx.custom.warning')}
                </div>
              </div>
            )}

            {/* Language */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                ⊕ {t('station.settings.language')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => i18n.changeLanguage(lang.code)}
                    style={{
                      padding: '8px 6px',
                      background:
                        i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                          ? 'rgba(0, 221, 255, 0.2)'
                          : 'var(--bg-tertiary)',
                      border: `1px solid ${
                        i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                          ? 'var(--accent-cyan)'
                          : 'var(--border-color)'
                      }`,
                      borderRadius: '6px',
                      color:
                        i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                          ? 'var(--accent-cyan)'
                          : 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight:
                        i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                          ? '600'
                          : '400',
                      textAlign: 'center',
                    }}
                  >
                    {(() => {
                      const iso = emojiToIso2(lang.flag);
                      return iso ? (
                        <img
                          src={`https://flagcdn.com/w20/${iso}.png`}
                          alt=""
                          style={{ height: '0.9em', verticalAlign: 'middle', borderRadius: '1px', marginRight: '4px' }}
                          crossOrigin="anonymous"
                        />
                      ) : (
                        <span style={{ marginRight: '4px' }}>{lang.flag}</span>
                      );
                    })()}
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Integrations Tab */}
        {activeTab === 'integrations' && (
          <div>
            {/* Status pill */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
              }}
            >
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                These features require a local OpenHamClock instance.
              </div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: `1px solid ${isLocalInstall ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.18)'}`,
                  color: isLocalInstall ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  background: isLocalInstall ? 'rgba(0,255,255,0.10)' : 'rgba(0,0,0,0.25)',
                }}
              >
                {isLocalInstall ? 'Local mode' : 'Hosted mode'}
              </div>
            </div>

            {/* Local-only group */}
            <div
              style={{
                background: 'rgba(0, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ color: 'var(--accent-cyan)', fontWeight: 800, letterSpacing: 0.2 }}>Local-only</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
                    These integrations are disabled on the hosted site so they can never crash or spam the network.
                  </div>
                </div>
              </div>

              {/* Rotator */}
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  paddingTop: 12,
                  marginTop: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>🧭 Rotator</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
                      Requires a rotator backend (e.g., PstRotatorAz or a simple HTTP bridge) reachable by your local
                      OpenHamClock Node server.
                    </div>
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!isLocalInstall}
                      checked={!!rotatorEnabled && isLocalInstall}
                      onChange={(e) => {
                        const next = !!e.target.checked;
                        setRotatorEnabled(next);
                        try {
                          localStorage.setItem('ohc_rotator_enabled', next ? '1' : '0');
                        } catch {}
                        // Default overlay OFF when enabling (hosted-safe + predictable)
                        if (next) {
                          try {
                            const raw = localStorage.getItem('openhamclock_mapLayers') || '{}';
                            const ml = JSON.parse(raw);
                            ml.showRotatorBearing = false;
                            localStorage.setItem('openhamclock_mapLayers', JSON.stringify(ml));
                          } catch {}
                        }
                        try {
                          window.dispatchEvent(new Event('ohc-rotator-config-changed'));
                        } catch {}
                      }}
                    />
                    Enable
                  </label>
                </div>

                <details style={{ marginTop: 10 }}>
                  <summary
                    style={{
                      cursor: 'pointer',
                      color: 'var(--accent-amber)',
                      fontSize: 12,
                      userSelect: 'none',
                    }}
                  >
                    Learn how
                  </summary>

                  <div
                    style={{
                      marginTop: 8,
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      <b>Quick start (Local Only):</b>
                    </div>

                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      <li>
                        Run OpenHamClock locally:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>npm start</div>
                        Open the local URL shown in your terminal (example: http://127.0.0.1:3001).
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Install and configure <b>PstRotatorAz</b> (or another rotator backend) on your LAN.
                        <div style={{ marginTop: 4 }}>Enable and start its control interface (web/UDP).</div>
                      </li>

                      <li style={{ marginTop: 6 }}>
                        In the OpenHamClock folder:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>copy .env.example → .env</div>
                        Then edit:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>
                          VITE_PSTROTATOR_TARGET=http://192.168.1.43:50004
                        </div>
                        (Replace with the IP and port of your PstRotatorAz machine.)
                      </li>

                      <li style={{ marginTop: 6 }}>Ensure Windows Firewall allows the PstRotatorAz port.</li>

                      <li style={{ marginTop: 6 }}>
                        Enable Rotator here, then add the <b>Rotator</b> panel using the “+” button on any tabset.
                      </li>
                    </ol>

                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                      Tip: Click <b>MAP ON</b> inside the Rotator panel to show the bearing overlay. Hold <b>Shift</b>{' '}
                      and click the map to rotate your antenna to that heading.
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      Note: This feature cannot work on the hosted site because it requires access to devices on your
                      local network.
                    </div>
                  </div>
                </details>

                {/* DX Weather (Map overlays) */}
                <div
                  style={{
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    paddingTop: 12,
                    marginTop: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>🌦️ DX Weather</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
                        Adds a small weather bubble on hover and weather details inside map popups (DX spots, POTA/SOTA,
                        and the movable DX marker).
                      </div>

                      {!isLocalInstall && (
                        <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                          Hosted mode disables this feature to protect shared weather-provider rate limits. Available in
                          Local mode.
                        </div>
                      )}
                    </div>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={!isLocalInstall}
                        checked={!!dxWeatherEnabled}
                        onChange={(e) => {
                          const next = !!e.target.checked;
                          if (!isLocalInstall) return;
                          setDxWeatherEnabled(next);
                          try {
                            localStorage.setItem('ohc_dx_weather_enabled', next ? '1' : '0');
                          } catch {}
                          try {
                            window.dispatchEvent(new Event('ohc-dx-weather-config-changed'));
                          } catch {}
                        }}
                      />
                      Enable
                    </label>
                  </div>

                  <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                    Tip: A 5–10 minute cache is used automatically and hover fetches are debounced.
                  </div>
                </div>

                {!isLocalInstall && (
                  <div
                    style={{
                      marginTop: 8,
                      color: 'var(--text-muted)',
                      fontSize: 11,
                    }}
                  >
                    Hosted mode detected — Rotator cannot be enabled here.
                  </div>
                )}
              </div>

              {/* N3FJP */}
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  paddingTop: 12,
                  marginTop: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>🗺️ N3FJP Logged QSOs</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
                      Shows recent QSOs posted by your local N3FJP→OHC bridge (layer overlay).
                    </div>
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!isLocalInstall}
                      checked={!!n3fjpEnabled && isLocalInstall}
                      onChange={(e) => {
                        const next = !!e.target.checked;
                        setN3fjpEnabled(next);
                        try {
                          localStorage.setItem('ohc_n3fjp_enabled', next ? '1' : '0');
                        } catch {}
                        try {
                          window.dispatchEvent(new Event('ohc-n3fjp-config-changed'));
                        } catch {}

                        // ✅ Also toggle the map layer automatically
                        try {
                          // Preferred: uses live WorldMap controls (updates state + localStorage)
                          if (window.hamclockLayerControls?.toggleLayer) {
                            window.hamclockLayerControls.toggleLayer('n3fjp_logged_qsos', next);
                          } else {
                            // Fallback: write the plugin-layer setting directly
                            const raw = localStorage.getItem('openhamclock_mapSettings') || '{}';
                            const settings = JSON.parse(raw);
                            const layers = settings.layers || {};
                            layers['n3fjp_logged_qsos'] = { ...(layers['n3fjp_logged_qsos'] || {}), enabled: next };
                            settings.layers = layers;
                            localStorage.setItem('openhamclock_mapSettings', JSON.stringify(settings));
                          }
                        } catch {}
                      }}
                    />
                    Enable
                  </label>
                </div>

                {/* Simple config */}
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label
                      style={{
                        display: 'block',
                        marginBottom: 6,
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                      }}
                    >
                      Display window
                    </label>
                    <select
                      disabled={!isLocalInstall || !n3fjpEnabled}
                      value={n3fjpDisplayMinutes}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        const next = Number.isFinite(v) ? v : 15;
                        setN3fjpDisplayMinutes(next);
                        try {
                          localStorage.setItem('n3fjp_display_minutes', String(next));
                        } catch {}
                        try {
                          window.dispatchEvent(new Event('ohc-n3fjp-config-changed'));
                        } catch {}
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {[15, 30, 60, 120, 240, 720, 1440].map((m) => (
                        <option key={m} value={m}>
                          {m === 60 ? '1 hour' : m < 60 ? `${m} min` : `${m / 60} hours`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ flex: '0 0 120px' }}>
                    <label
                      style={{
                        display: 'block',
                        marginBottom: 6,
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                      }}
                    >
                      Line color
                    </label>
                    <input
                      disabled={!isLocalInstall || !n3fjpEnabled}
                      type="color"
                      value={n3fjpLineColor}
                      onChange={(e) => {
                        const next = e.target.value || '#3388ff';
                        setN3fjpLineColor(next);
                        try {
                          localStorage.setItem('n3fjp_line_color', next);
                        } catch {}
                        try {
                          window.dispatchEvent(new Event('ohc-n3fjp-config-changed'));
                        } catch {}
                      }}
                      style={{
                        width: '100%',
                        height: 40,
                        padding: 0,
                        border: '1px solid var(--border-color)',
                        borderRadius: 6,
                        background: 'transparent',
                      }}
                    />
                  </div>
                </div>

                <details style={{ marginTop: 10 }}>
                  <summary
                    style={{
                      cursor: 'pointer',
                      color: 'var(--accent-amber)',
                      fontSize: 12,
                      userSelect: 'none',
                    }}
                  >
                    Learn how
                  </summary>

                  <div
                    style={{
                      marginTop: 8,
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      <b>Quick start (Local Only):</b>
                    </div>

                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      <li>
                        Run OpenHamClock locally:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>npm start</div>
                        Open the local URL shown in your terminal (example: http://127.0.0.1:3001).
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Install the N3FJP bridge on the same PC (or LAN machine) that can access your N3FJP logger.
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Edit the bridge <b>config.json</b> file and set:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>
                          "OHC_BASE_URL": "http://127.0.0.1:3001"
                        </div>
                        (Use the exact URL printed by OpenHamClock.)
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Ensure:
                        <div style={{ fontFamily: 'JetBrains Mono', marginTop: 4 }}>"ENABLE_OHC_HTTP": true</div>
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Start the bridge script (PowerShell or VBS launcher). You should see log messages when QSOs are
                        entered.
                      </li>

                      <li style={{ marginTop: 6 }}>
                        Enable this integration here, then turn on
                        <b> Logged QSOs (N3FJP)</b> in
                        <b> Settings → Map Layers</b>.
                      </li>
                    </ol>

                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                      Tip: If you see “connection refused,” verify that OpenHamClock is running locally and that the
                      port matches your
                      <b> OHC_BASE_URL</b> setting.
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      Note: This integration cannot work on the hosted site because it requires access to your local
                      N3FJP logger and LAN services.
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* Display Tab */}
        {activeTab === 'display' && (
          <div>
            {/* Header Sizing */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Header Size
              </label>

              {/* Live preview of header text at current scale */}
              <div
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    fontFamily: 'Orbitron, monospace',
                    fontWeight: 900,
                    color: 'var(--accent-amber)',
                    fontSize: `${22 * headerSize}px`,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {callsign || 'K0CJH'}
                </span>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                    color: 'var(--accent-cyan)',
                    fontSize: `${24 * headerSize}px`,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  14:32
                </span>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: `${13 * headerSize}px`,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  SFI 158
                </span>
              </div>

              {/* Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Small</span>
                <input
                  type="range"
                  min="0.5"
                  max="4"
                  step="0.1"
                  value={headerSize}
                  onChange={(e) => setheaderSize(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent-amber)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Large</span>
              </div>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--accent-amber)',
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                  marginTop: '4px',
                }}
              >
                {Number(headerSize).toFixed(1)}x
              </div>
            </div>

            {/* Clock Order */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={swapHeaderClocks}
                  onChange={(e) => setSwapHeaderClocks(e.target.checked)}
                  style={{ accentColor: 'var(--accent-amber)' }}
                />
                Show Local Time before UTC in header
              </label>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                By default, UTC is shown first. Enable this to display Local Time first.
              </div>
            </div>

            {/* Mutual Reception Indicator */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={showMutualReception}
                  onChange={(e) => setShowMutualReception(e.target.checked)}
                  style={{ accentColor: 'var(--accent-amber)' }}
                />
                Show mutual reception indicator on PSK Reporter spots
              </label>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Marks spots with a gold star (★) when a station hears you AND you hear them on the same band, indicating
                a QSO is likely possible.
              </div>
            </div>

            {/* Layout */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.layout')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {['modern', 'classic', 'tablet', 'compact', 'dockable', 'emcomm'].map((l) => (
                  <button
                    key={l}
                    onClick={() => setLayout(l)}
                    style={{
                      padding: '10px',
                      background: layout === l ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                      border: `1px solid ${layout === l ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      color: layout === l ? '#000' : 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: layout === l ? '600' : '400',
                    }}
                  >
                    {l === 'modern'
                      ? '🖥️'
                      : l === 'classic'
                        ? '📺'
                        : l === 'tablet'
                          ? '📱'
                          : l === 'compact'
                            ? '📊'
                            : l === 'emcomm'
                              ? '📍'
                              : '⊞'}{' '}
                    {l === 'dockable' ? t('station.settings.layout.dockable') : t('station.settings.layout.' + l)}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {layoutDescriptions[layout]}
              </div>
              {layout === 'dockable' && onResetLayout && (
                <button
                  onClick={() => {
                    if (confirm(t('station.settings.layout.reset.confirm'))) {
                      onResetLayout();
                    }
                  }}
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  {t('station.settings.layout.reset.button')}
                </button>
              )}
            </div>

            {/* Theme */}
            <div style={{ marginBottom: '8px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {t('station.settings.theme')}
              </label>
              <ThemeSelector theme={theme} setTheme={setTheme} id="theme-selector-component" />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {t('station.settings.theme.' + theme + '.describe')}
              </div>
              {theme === 'custom' && customTheme && (
                <CustomThemeEditor
                  customTheme={customTheme}
                  updateCustomVar={updateCustomVar}
                  id="custom-theme-editor-component"
                />
              )}
            </div>
          </div>
        )}

        {/* Map Layers Tab */}
        {activeTab === 'layers' && (
          <div>
            {(() => {
              const togglePanelVisible = (panelKey) => {
                const panels = { ...config.panels };
                panels[panelKey] = { ...panels[panelKey], visible: !(panels[panelKey]?.visible !== false) };
                onSave({ ...config, panels });
              };

              const overlayCards = [
                {
                  id: 'de-dx-markers',
                  checked: mapLayers?.showDeDxMarkers !== false,
                  onChange: () => onToggleDeDxMarkers?.(),
                  icon: '📍',
                  title: 'DE/DX Markers',
                  description: 'Show or hide your DE and DX position markers on the map',
                },
                {
                  id: 'dx-target-panel',
                  checked: config.panels?.dxLocation?.visible !== false,
                  onChange: () => togglePanelVisible('dxLocation'),
                  icon: '🎯',
                  title: 'DX Target Panel',
                  description: 'Show or hide the DX target info panel (grid, bearing, sun times)',
                },
                {
                  id: 'dx-news-ticker',
                  checked: mapLayers?.showDXNews !== false,
                  onChange: () => onToggleDXNews?.(),
                  icon: '📰',
                  title: 'DX News Ticker',
                  description: 'Scrolling DX news headlines on the map',
                },
              ];
              return (() => {
                const categoryOrder = [
                  { key: 'overlay', label: '🗺️ Map Overlays' },
                  { key: 'propagation', label: '📡 Propagation' },
                  { key: 'amateur', label: '📻 Amateur Radio' },
                  { key: 'weather', label: '🌤️ Weather' },
                  { key: 'space-weather', label: '☀️ Space Weather' },
                  { key: 'hazards', label: '⚠️ Natural Hazards' },
                  { key: 'geology', label: '🌍 Geology' },
                  { key: 'fun', label: '🎉 Community' },
                ];

                const nonSatLayers = layers.filter((l) => l.category !== 'satellites');
                const grouped = {};
                nonSatLayers.forEach((l) => {
                  const cat = l.category || 'overlay';
                  if (!grouped[cat]) grouped[cat] = [];
                  grouped[cat].push(l);
                });
                Object.values(grouped).forEach((arr) =>
                  arr.sort((a, b) => {
                    const nameA = (a.name.startsWith('plugins.') ? t(a.name) : a.name).toLowerCase();
                    const nameB = (b.name.startsWith('plugins.') ? t(b.name) : b.name).toLowerCase();
                    return nameA.localeCompare(nameB);
                  }),
                );

                const renderBuiltInOverlayCard = (item) => (
                  <div
                    key={item.id}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${item.checked ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                      borderRadius: '8px',
                      padding: '14px',
                      marginBottom: '12px',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={item.onChange}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '18px' }}>{item.icon}</span>
                      <div>
                        <div
                          style={{
                            color: item.checked ? 'var(--accent-amber)' : 'var(--text-primary)',
                            fontSize: '14px',
                            fontWeight: '600',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {item.title}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {item.description}
                        </div>
                      </div>
                    </label>
                  </div>
                );

                const renderLayerCard = (layer) => (
                  <div
                    key={layer.id}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${layer.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                      borderRadius: '8px',
                      padding: '14px',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={layer.enabled}
                          onChange={() => handleToggleLayer(layer.id)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '18px' }}>{layer.icon}</span>
                        <div>
                          <div
                            style={{
                              color: layer.enabled ? 'var(--accent-amber)' : 'var(--text-primary)',
                              fontSize: '14px',
                              fontWeight: '600',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {layer.name.startsWith('plugins.') ? t(layer.name) : layer.name}
                          </div>
                          {layer.description && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {layer.description.startsWith('plugins.') ? t(layer.description) : layer.description}
                            </div>
                          )}
                        </div>
                      </label>
                    </div>

                    {layer.enabled && (
                      <div style={{ paddingLeft: '38px', marginTop: '12px' }}>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {t('station.settings.layers.opacity')}: {Math.round(layer.opacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={layer.opacity * 100}
                          onChange={(e) => handleOpacityChange(layer.id, parseFloat(e.target.value) / 100)}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                        {ctrlPressed &&
                          ['lightning', 'wspr', 'rbn', 'grayline', 'n3fjp_logged_qsos', 'voacap-heatmap'].includes(
                            layer.id,
                          ) && (
                            <button
                              onClick={() => resetPopupPositions(layer.id)}
                              style={{
                                marginTop: '12px',
                                padding: '8px 12px',
                                background: 'var(--accent-red)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                width: '100%',
                              }}
                            >
                              🔄 RESET POPUPS
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                );

                const result = [];
                const rendered = new Set();
                categoryOrder.forEach(({ key, label }) => {
                  const hasBuiltInOverlays = key === 'overlay' && overlayCards.length > 0;
                  if (!grouped[key] && !hasBuiltInOverlays) return;
                  if ((!grouped[key] || grouped[key].length === 0) && !hasBuiltInOverlays) return;
                  result.push(
                    <div
                      key={`cat-${key}`}
                      style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        color: 'var(--text-muted)',
                        marginBottom: '8px',
                        marginTop: result.length > 0 ? '16px' : '0',
                        paddingBottom: '4px',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      {label}
                    </div>,
                  );
                  if (key === 'overlay') {
                    overlayCards.forEach((item) => {
                      result.push(renderBuiltInOverlayCard(item));
                    });
                  }
                  (grouped[key] || []).forEach((layer) => {
                    result.push(renderLayerCard(layer));
                    rendered.add(layer.id);
                  });
                });
                // Any uncategorized leftovers
                nonSatLayers
                  .filter((l) => !rendered.has(l.id))
                  .forEach((layer) => {
                    result.push(renderLayerCard(layer));
                  });
                if (result.length === 0) {
                  return (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                        color: 'var(--text-muted)',
                        fontSize: '13px',
                      }}
                    >
                      {t('station.settings.layers.noLayers')}
                    </div>
                  );
                }
                return result;
              })();
            })()}
          </div>
        )}

        {/* Satellites Tab */}
        {activeTab === 'satellites' && (
          <div>
            {/* 1. Plugin Layer Toggle Section */}
            <div style={{ marginBottom: '20px' }}>
              {layers
                .filter((layer) => layer.category === 'satellites')
                .map((layer) => (
                  <div
                    key={layer.id}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${layer.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                      borderRadius: '8px',
                      padding: '14px',
                      marginBottom: '12px',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        onChange={() => handleToggleLayer(layer.id)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '18px' }}>🛰️</span>
                      <div>
                        <div
                          style={{
                            color: layer.enabled ? 'var(--accent-amber)' : 'var(--text-primary)',
                            fontSize: '14px',
                            fontWeight: '600',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {layer.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{layer.description}</div>
                      </div>
                    </label>

                    {layer.enabled && (
                      <div
                        style={{
                          paddingLeft: '38px',
                          marginTop: '10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        {/* Sub-Toggles for Tracks and Footprints */}
                        <div style={{ display: 'flex', gap: '15px' }}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={layer.config?.showTracks !== false}
                              onChange={(e) => handleUpdateLayerConfig(layer.id, { showTracks: e.target.checked })}
                            />{' '}
                            Track Lines
                          </label>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={layer.config?.showFootprints !== false}
                              onChange={(e) => handleUpdateLayerConfig(layer.id, { showFootprints: e.target.checked })}
                            />{' '}
                            Footprints
                          </label>
                        </div>

                        {/* station altitude and minimum elevation inputs */}
                        <div
                          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}
                        >
                          <div>
                            <label
                              style={{
                                display: 'block',
                                marginBottom: '6px',
                                color: 'var(--text-muted)',
                                fontSize: '11px',
                                textTransform: 'uppercase',
                              }}
                            >
                              Station Altitude [m]
                            </label>
                            <input
                              type="number"
                              step="1"
                              min="-500"
                              max="9000"
                              value={isNaN(stationAlt) ? '' : stationAlt}
                              onChange={(e) =>
                                setStationAlt(isNaN(e.target.valueAsNumber) ? 100 : e.target.valueAsNumber)
                              }
                              style={{
                                width: '100%',
                                padding: '10px',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                                fontFamily: 'JetBrains Mono, monospace',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                          <div>
                            <label
                              style={{
                                display: 'block',
                                marginBottom: '6px',
                                color: 'var(--text-muted)',
                                fontSize: '11px',
                                textTransform: 'uppercase',
                              }}
                            >
                              Minimum Elevation [°]
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              min="-5.0"
                              max="89.0"
                              value={isNaN(minElev) ? '' : minElev}
                              onChange={(e) => setMinElev(isNaN(e.target.valueAsNumber) ? 5.0 : e.target.valueAsNumber)}
                              style={{
                                width: '100%',
                                padding: '10px',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                                fontFamily: 'JetBrains Mono, monospace',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        </div>

                        {/* Lead Time Slider WIP
						<div style={{ marginTop: '8px' }}>
						  <label style={{
							display: 'flex',
							justifyContent: 'space-between',
							fontSize: '10px',
							color: 'var(--text-muted)',
							textTransform: 'uppercase'
						  }}>
							<span>Track Prediction (Lead Time)</span>
							<span style={{ color: 'var(--accent-amber)' }}>{layer.config?.leadTimeMins || 45} min</span>
						  </label>
						  <input
							type="range"
							min="15"
							max="120"
							step="5"
							value={layer.config?.leadTimeMins || 45}
							onChange={(e) => handleUpdateLayerConfig(layer.id, { leadTimeMins: parseInt(e.target.value) })}
							style={{ width: '100%', cursor: 'pointer' }}
						  />
						</div> */}

                        {/* Opacity Slider */}
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            Opacity: {Math.round(layer.opacity * 100)}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={layer.opacity * 100}
                            onChange={(e) => handleOpacityChange(layer.id, parseFloat(e.target.value) / 100)}
                            style={{ width: '100%', cursor: 'pointer' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* 2. Existing Satellite Filter Controls */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <button
                onClick={() => {
                  const allSats = (satellites || []).map((s) => s.name);
                  onSatelliteFiltersChange(allSats);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid #00ffff',
                  borderRadius: '4px',
                  color: '#00ffff',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono',
                }}
              >
                {t('station.settings.satellites.selectAll')}
              </button>
              <button
                onClick={() => onSatelliteFiltersChange([])}
                style={{
                  background: 'transparent',
                  border: '1px solid #ff6666',
                  borderRadius: '4px',
                  color: '#ff6666',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono',
                }}
              >
                {t('station.settings.satellites.clear')}
              </button>
            </div>

            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginBottom: '12px',
              }}
            >
              {satelliteFilters.length === 0
                ? t('station.settings.satellites.showAll')
                : t('station.settings.satellites.selectedCount', { count: satelliteFilters.length })}
            </div>

            {/* Search Box */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                type="text"
                value={satelliteSearch}
                onChange={(e) => setSatelliteSearch(e.target.value)}
                placeholder="🔍 Search satellites..."
                style={{
                  width: '100%',
                  padding: '8px 32px 8px 12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
              {satelliteSearch && (
                <button
                  onClick={() => setSatelliteSearch('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#ff6666',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px 8px',
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* Satellite Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                maxHeight: '400px',
                overflowY: 'auto',
              }}
            >
              {(satellites || [])
                .filter((sat) => !satelliteSearch || sat.name.toLowerCase().includes(satelliteSearch.toLowerCase()))
                .sort((a, b) => {
                  const aSelected = satelliteFilters.includes(a.name);
                  const bSelected = satelliteFilters.includes(b.name);
                  if (aSelected && !bSelected) return -1;
                  if (!aSelected && bSelected) return 1;
                  return a.name.localeCompare(b.name);
                })
                .map((sat) => {
                  const isSelected = satelliteFilters.includes(sat.name);
                  return (
                    <button
                      key={sat.name}
                      onClick={() => {
                        if (isSelected) {
                          onSatelliteFiltersChange(satelliteFilters.filter((n) => n !== sat.name));
                        } else {
                          onSatelliteFiltersChange([...satelliteFilters, sat.name]);
                        }
                      }}
                      style={{
                        background: isSelected ? 'rgba(0, 255, 255, 0.15)' : 'var(--bg-tertiary)',
                        border: `1px solid ${isSelected ? '#00ffff' : 'var(--border-color)'}`,
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '3px',
                          border: `2px solid ${isSelected ? '#00ffff' : '#666'}`,
                          background: isSelected ? '#00ffff' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          flexShrink: 0,
                        }}
                      >
                        {isSelected && '✓'}
                      </span>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div
                          style={{
                            color: isSelected ? '#00ffff' : 'var(--text-primary)',
                            fontWeight: '600',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {sat.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Profiles Tab */}
        {activeTab === 'profiles' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Description */}
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Save your current layout, theme, map layers, filters, and all preferences as a named profile. Switch
              between profiles when sharing a HamClock between operators, or to toggle between your own saved views.
            </div>

            {/* Active profile indicator */}
            {activeProfileName && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  background: 'rgba(0, 255, 136, 0.1)',
                  border: '1px solid rgba(0, 255, 136, 0.3)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: '#00ff88' }}>●</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  Active: <strong>{activeProfileName}</strong>
                </span>
              </div>
            )}

            {/* Status message */}
            {profileMessage && (
              <div
                style={{
                  padding: '8px 12px',
                  background: profileMessage.type === 'error' ? 'rgba(255, 68, 102, 0.1)' : 'rgba(0, 255, 136, 0.1)',
                  border: `1px solid ${profileMessage.type === 'error' ? 'rgba(255, 68, 102, 0.3)' : 'rgba(0, 255, 136, 0.3)'}`,
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: profileMessage.type === 'error' ? '#ff4466' : '#00ff88',
                }}
              >
                {profileMessage.text}
              </div>
            )}

            {/* Save new profile */}
            <div
              style={{
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
                💾 Save Current State as Profile
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      const exists = profiles[newProfileName.trim()];
                      if (exists && !window.confirm(`Profile "${newProfileName.trim()}" already exists. Overwrite?`))
                        return;
                      persistCurrentSettings();
                      saveProfile(newProfileName.trim());
                      setNewProfileName('');
                      refreshProfiles();
                      setProfileMessage({ type: 'success', text: `Profile "${newProfileName.trim()}" saved` });
                      setTimeout(() => setProfileMessage(null), 3000);
                    }
                  }}
                  placeholder="Profile name (e.g. K0CJH, Contest, Field Day)"
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <button
                  onClick={() => {
                    if (!newProfileName.trim()) return;
                    const exists = profiles[newProfileName.trim()];
                    if (exists && !window.confirm(`Profile "${newProfileName.trim()}" already exists. Overwrite?`))
                      return;
                    persistCurrentSettings();
                    saveProfile(newProfileName.trim());
                    setNewProfileName('');
                    refreshProfiles();
                    setProfileMessage({ type: 'success', text: `Profile "${newProfileName.trim()}" saved` });
                    setTimeout(() => setProfileMessage(null), 3000);
                  }}
                  disabled={!newProfileName.trim()}
                  style={{
                    padding: '8px 16px',
                    background: newProfileName.trim()
                      ? 'linear-gradient(135deg, #00ff88 0%, #00ddff 100%)'
                      : 'var(--bg-tertiary)',
                    border: 'none',
                    borderRadius: '4px',
                    color: newProfileName.trim() ? '#000' : 'var(--text-muted)',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: newProfileName.trim() ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Save
                </button>
              </div>
            </div>

            {/* Saved profiles list */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
                📋 Saved Profiles ({Object.keys(profiles).length})
              </div>
              {Object.keys(profiles).length === 0 ? (
                <div
                  style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    border: '1px dashed var(--border-color)',
                  }}
                >
                  No saved profiles yet. Save your current configuration above.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {Object.entries(profiles)
                    .sort((a, b) => (b[1].updatedAt || '').localeCompare(a[1].updatedAt || ''))
                    .map(([name, profile]) => {
                      const isActive = name === activeProfileName;
                      const isRenaming = renamingProfile === name;

                      // Parse callsign from snapshot if available
                      let snapshotCallsign = '';
                      try {
                        const cfg = profile.snapshot?.openhamclock_config;
                        if (cfg) snapshotCallsign = JSON.parse(cfg).callsign || '';
                      } catch {}

                      // Parse layout type
                      let snapshotLayout = '';
                      try {
                        const cfg = profile.snapshot?.openhamclock_config;
                        if (cfg) snapshotLayout = JSON.parse(cfg).layout || '';
                      } catch {}

                      return (
                        <div
                          key={name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 12px',
                            background: isActive ? 'rgba(0, 255, 136, 0.08)' : 'var(--bg-tertiary)',
                            border: `1px solid ${isActive ? 'rgba(0, 255, 136, 0.3)' : 'var(--border-color)'}`,
                            borderRadius: '6px',
                          }}
                        >
                          {/* Profile info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {isRenaming ? (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      if (renameProfile(name, renameValue)) {
                                        refreshProfiles();
                                        setProfileMessage({
                                          type: 'success',
                                          text: `Renamed to "${renameValue.trim()}"`,
                                        });
                                      } else {
                                        setProfileMessage({ type: 'error', text: 'Rename failed — name may be taken' });
                                      }
                                      setRenamingProfile(null);
                                      setTimeout(() => setProfileMessage(null), 3000);
                                    }
                                    if (e.key === 'Escape') setRenamingProfile(null);
                                  }}
                                  autoFocus
                                  style={{
                                    flex: 1,
                                    padding: '4px 6px',
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--accent-amber)',
                                    borderRadius: '3px',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    fontFamily: 'JetBrains Mono, monospace',
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    if (renameProfile(name, renameValue)) {
                                      refreshProfiles();
                                      setProfileMessage({
                                        type: 'success',
                                        text: `Renamed to "${renameValue.trim()}"`,
                                      });
                                    } else {
                                      setProfileMessage({
                                        type: 'error',
                                        text: 'Rename failed — name may already exist',
                                      });
                                    }
                                    setRenamingProfile(null);
                                    setTimeout(() => setProfileMessage(null), 3000);
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    background: 'var(--accent-green)',
                                    border: 'none',
                                    borderRadius: '3px',
                                    color: '#000',
                                    fontSize: '10px',
                                    cursor: 'pointer',
                                    fontWeight: '700',
                                  }}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={() => setRenamingProfile(null)}
                                  style={{
                                    padding: '4px 8px',
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '3px',
                                    color: 'var(--text-muted)',
                                    fontSize: '10px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <>
                                <div
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    color: isActive ? '#00ff88' : 'var(--text-primary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {isActive && <span style={{ marginRight: '4px' }}>●</span>}
                                  {name}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {snapshotCallsign && <span>{snapshotCallsign}</span>}
                                  {snapshotLayout && <span> • {snapshotLayout}</span>}
                                  {profile.updatedAt && (
                                    <span> • {new Date(profile.updatedAt).toLocaleDateString()}</span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Action buttons */}
                          {!isRenaming && (
                            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                              {/* Load */}
                              <button
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Load profile "${name}"? This will replace your current settings and reload.`,
                                    )
                                  ) {
                                    loadProfile(name);
                                    window.location.reload();
                                  }
                                }}
                                title="Load this profile"
                                style={{
                                  padding: '5px 10px',
                                  background: isActive ? 'rgba(0,255,136,0.15)' : 'var(--bg-primary)',
                                  border: `1px solid ${isActive ? 'rgba(0,255,136,0.3)' : 'var(--border-color)'}`,
                                  borderRadius: '4px',
                                  color: isActive ? '#00ff88' : 'var(--text-secondary)',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  fontWeight: '600',
                                }}
                              >
                                {isActive ? '✓ Active' : '▶ Load'}
                              </button>
                              {/* Update (overwrite with current state) */}
                              <button
                                onClick={() => {
                                  persistCurrentSettings();
                                  saveProfile(name);
                                  refreshProfiles();
                                  setProfileMessage({ type: 'success', text: `"${name}" updated with current state` });
                                  setTimeout(() => setProfileMessage(null), 3000);
                                }}
                                title="Update with current settings"
                                style={{
                                  padding: '5px 8px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  color: 'var(--text-muted)',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                ↻
                              </button>
                              {/* Rename */}
                              <button
                                onClick={() => {
                                  setRenamingProfile(name);
                                  setRenameValue(name);
                                }}
                                title="Rename"
                                style={{
                                  padding: '5px 8px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  color: 'var(--text-muted)',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                ✎
                              </button>
                              {/* Export */}
                              <button
                                onClick={() => {
                                  const json = exportProfile(name);
                                  if (json) {
                                    const blob = new Blob([json], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = (() => {
                                      const now = new Date();
                                      const date = now.toISOString().split('T')[0];
                                      const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
                                      return `hamclock-profile-${name.replace(/\s+/g, '-').toLowerCase()}-${date}-${time}.json`;
                                    })();
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    setProfileMessage({ type: 'success', text: `Exported "${name}"` });
                                    setTimeout(() => setProfileMessage(null), 3000);
                                  }
                                }}
                                title="Export to file"
                                style={{
                                  padding: '5px 8px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  color: 'var(--text-muted)',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                ⤓
                              </button>
                              {/* Delete */}
                              <button
                                onClick={() => {
                                  if (window.confirm(`Delete profile "${name}"? This cannot be undone.`)) {
                                    deleteProfile(name);
                                    refreshProfiles();
                                    setProfileMessage({ type: 'success', text: `Deleted "${name}"` });
                                    setTimeout(() => setProfileMessage(null), 3000);
                                  }
                                }}
                                title="Delete"
                                style={{
                                  padding: '5px 8px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid rgba(255,68,102,0.3)',
                                  borderRadius: '4px',
                                  color: '#ff4466',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* QRZ.com XML API Credentials */}
            <div
              style={{
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: 'var(--accent-amber)',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>📡 QRZ.com Callsign Lookup</span>
                {qrzStatus?.configured && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: '500',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: qrzStatus.hasSession ? 'rgba(46, 204, 113, 0.15)' : 'rgba(241, 196, 15, 0.15)',
                      color: qrzStatus.hasSession ? '#2ecc71' : '#f1c40f',
                    }}
                  >
                    {qrzStatus.hasSession ? '● Connected' : '○ Configured'}
                    {qrzStatus.source === 'env' ? ' (env)' : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                Enables precise station locations from{' '}
                <a
                  href="https://www.qrz.com/i/subscriptions.html"
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  QRZ.com
                </a>{' '}
                user profiles (user-supplied coordinates, geocoded addresses, grid squares). Without this, locations
                fall back to HamQTH (country-level only). Requires a QRZ Logbook Data subscription.
                <br />
                <strong>Note</strong> this is a server setting and is not related to clicking a callsign to go to
                qrz.com. If you are not running a server, you will likely not have the permissions to change this.
              </div>
              {qrzStatus?.source === 'env' ? (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    padding: '8px',
                    background: 'var(--bg-primary)',
                    borderRadius: '4px',
                  }}
                >
                  ✓ Credentials configured via{' '}
                  <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '2px' }}>
                    QRZ_USERNAME
                  </code>{' '}
                  /{' '}
                  <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '2px' }}>
                    QRZ_PASSWORD
                  </code>{' '}
                  in .env file
                  {qrzStatus.lookupCount > 0 && (
                    <span style={{ color: 'var(--accent-green)' }}>
                      {' '}
                      — {qrzStatus.lookupCount} lookups this session
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                      type="text"
                      placeholder="QRZ Username (callsign)"
                      value={qrzUsername}
                      onChange={(e) => setQrzUsername(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                        fontFamily: 'JetBrains Mono, monospace',
                        boxSizing: 'border-box',
                      }}
                    />
                    <input
                      type="password"
                      placeholder="QRZ Password"
                      value={qrzPassword}
                      onChange={(e) => setQrzPassword(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                        fontFamily: 'JetBrains Mono, monospace',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      disabled={qrzTesting || !qrzUsername.trim() || !qrzPassword.trim()}
                      onClick={async () => {
                        setQrzTesting(true);
                        setQrzMessage(null);
                        try {
                          const res = await fetch('/api/qrz/configure', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: qrzUsername.trim(), password: qrzPassword.trim() }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            setQrzMessage({ type: 'success', text: 'Connected to QRZ.com successfully!' });
                            setQrzPassword('');
                            // Refresh status
                            const st = await fetch('/api/qrz/status').then((r) => r.json());
                            setQrzStatus(st);
                          } else {
                            setQrzMessage({ type: 'error', text: data.error || 'Login failed' });
                          }
                        } catch (e) {
                          setQrzMessage({ type: 'error', text: 'Connection error' });
                        }
                        setQrzTesting(false);
                      }}
                      style={{
                        padding: '6px 14px',
                        fontSize: '11px',
                        fontWeight: '600',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: qrzTesting || !qrzUsername.trim() || !qrzPassword.trim() ? 'not-allowed' : 'pointer',
                        background: 'var(--accent-amber)',
                        color: '#000',
                        opacity: qrzTesting || !qrzUsername.trim() || !qrzPassword.trim() ? 0.5 : 1,
                      }}
                    >
                      {qrzTesting ? 'Testing...' : 'Save & Test'}
                    </button>
                    {qrzStatus?.configured && qrzStatus.source !== 'env' && (
                      <button
                        onClick={async () => {
                          await fetch('/api/qrz/remove', { method: 'POST' });
                          setQrzUsername('');
                          setQrzPassword('');
                          setQrzMessage(null);
                          const st = await fetch('/api/qrz/status').then((r) => r.json());
                          setQrzStatus(st);
                        }}
                        style={{
                          padding: '6px 12px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          cursor: 'pointer',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {qrzStatus?.configured && qrzStatus.lookupCount > 0 && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {qrzStatus.lookupCount} lookups this session
                      </span>
                    )}
                  </div>
                  {qrzMessage && (
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '11px',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        background:
                          qrzMessage.type === 'success' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                        color: qrzMessage.type === 'success' ? '#2ecc71' : '#e74c3c',
                      }}
                    >
                      {qrzMessage.type === 'success' ? '✓' : '✗'} {qrzMessage.text}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Open-Meteo API Key (optional) */}
            <div
              style={{
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                marginBottom: '12px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
                🌡️ Open-Meteo API Key{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '11px' }}>(optional)</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                Weather data is provided by Open-Meteo's free API. For higher rate limits or commercial use, enter your
                API key from{' '}
                <a
                  href="https://open-meteo.com/en/pricing"
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  open-meteo.com
                </a>
                . Leave blank for the free tier.
              </div>
              <input
                type="text"
                placeholder="Free tier (no key needed)"
                defaultValue={(() => {
                  try {
                    return localStorage.getItem('ohc_openmeteo_apikey') || '';
                  } catch {
                    return '';
                  }
                })()}
                onChange={(e) => {
                  try {
                    const val = e.target.value.trim();
                    if (val) {
                      localStorage.setItem('ohc_openmeteo_apikey', val);
                    } else {
                      localStorage.removeItem('ohc_openmeteo_apikey');
                    }
                  } catch {}
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Import / Export section */}
            <div
              style={{
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
                📦 Import / Export
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const imported = importProfile(ev.target.result);
                      if (imported) {
                        refreshProfiles();
                        setProfileMessage({ type: 'success', text: `Imported profile "${imported}"` });
                      } else {
                        setProfileMessage({ type: 'error', text: 'Import failed — invalid profile file' });
                      }
                      setTimeout(() => setProfileMessage(null), 3000);
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  ⤒ Import Profile from File
                </button>
                <button
                  onClick={() => {
                    const json = exportCurrentState('Current');
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (() => {
                      const now = new Date();
                      const date = now.toISOString().split('T')[0];
                      const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
                      return `hamclock-current-${date}-${time}.json`;
                    })();
                    a.click();
                    URL.revokeObjectURL(url);
                    setProfileMessage({ type: 'success', text: 'Exported current state' });
                    setTimeout(() => setProfileMessage(null), 3000);
                  }}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  ⤓ Export Current State
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Share profile files between devices or operators. Exported files contain all settings, layout
                preferences, map layers, and filter configurations.
              </div>
            </div>
          </div>
        )}

        {/* Community Tab */}
        {activeTab === 'community' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Join the OpenHamClock community — report bugs, request features, and connect with other operators.
            </p>
            <a
              href="https://github.com/accius/openhamclock"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                border: '1px solid transparent',
                transition: 'border-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              onMouseOut={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>GitHub</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Source code, issues & releases</div>
              </div>
            </a>
            <a
              href="https://www.facebook.com/groups/1217043013897440"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                border: '1px solid transparent',
                transition: 'border-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              onMouseOut={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#1877F2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>Facebook Group</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Community discussion & help</div>
              </div>
            </a>
            <a
              href="https://www.reddit.com/r/OpenHamClock/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                textDecoration: 'none',
                color: 'var(--text-primary)',
                border: '1px solid transparent',
                transition: 'border-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              onMouseOut={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#FF4500">
                <path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.463.327.327 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.094z" />
              </svg>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>Reddit</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>r/OpenHamClock</div>
              </div>
            </a>
            <div
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent-amber)' }}>
                Created by Chris Hetherington — K0CJH
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: '1.5' }}>
                Built with the help of an amazing community of amateur radio operators contributing features, reporting
                bugs, and making OpenHamClock better every day.
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                K0CJH / openhamclock.com
              </div>
            </div>

            {/* Contributors */}
            <div
              style={{ marginTop: '12px', padding: '14px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--accent-amber)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '10px',
                  textAlign: 'center',
                }}
              >
                Contributors
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px' }}>
                Thank you to everyone who has contributed code, features, bug fixes, and ideas.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                {[
                  'creinemann',
                  'ceotjoe',
                  'alanhargreaves',
                  'dmazan',
                  'Delerius',
                  'rfreedman',
                  'SebFox2011',
                  'infopcgood',
                  'thomas-schreck',
                  'echo-gravitas',
                  'yuryja',
                  'Holyszewski',
                  'trancen',
                  'ThePangel',
                  'w8mej',
                  'JoshuaNewport',
                  'denete',
                  'kmanwar89',
                  'KentenRoth',
                  's53zo',
                  'theodeurne76',
                  'm1dst',
                  'brianbruff',
                  'agocs',
                  'kwirk',
                  'Oukagen',
                  'ftl',
                  'phether',
                ].map((name) => (
                  <a
                    key={name}
                    href={`https://github.com/${name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '12px',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontFamily: 'JetBrains Mono, monospace',
                      border: '1px solid transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                      e.currentTarget.style.color = 'var(--accent-cyan)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                  >
                    {name}
                  </a>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '10px' }}>
                Want to contribute? Check out our GitHub — issues, pull requests, and ideas are all welcome.
              </div>
            </div>

            {/* Privacy Notice */}
            <div
              style={{ marginTop: '12px', padding: '14px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--accent-amber)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '10px',
                  textAlign: 'center',
                }}
              >
                Privacy
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                <p style={{ marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>No Cookies or Tracking</strong>
                  <br />
                  OpenHamClock does not set any HTTP cookies. There are no analytics services, tracking pixels, ad
                  networks, or telemetry. All vendor libraries (maps, fonts) are self-hosted.
                </p>
                <p style={{ marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Browser Storage</strong>
                  <br />
                  Your settings (callsign, theme, filters, layout) are saved to your browser's localStorage. This data
                  stays on your device and is never shared with third parties. Clearing your browser data removes it.
                </p>
                <p style={{ marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Visitor Statistics</strong>
                  <br />
                  The server counts unique visitors using anonymized, one-way hashed identifiers. No IP addresses are
                  stored to disk or sent to third parties. Only aggregate counts are retained.
                </p>
                <p style={{ marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Active Users Layer</strong>
                  <br />
                  If enabled, your callsign and grid square (rounded to ~1km) are shared with other operators on the
                  map. You can opt out in Station settings without affecting other features. Your presence is
                  automatically removed when you close the tab or disable the setting.
                </p>
                <p style={{ marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Third-Party APIs</strong>
                  <br />
                  Weather data is fetched from Open-Meteo and NOAA directly from your browser. No personal data beyond
                  your configured coordinates is sent. API keys you provide are stored locally in your browser only.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Settings Sync</strong>
                  <br />
                  If the server operator has enabled settings sync, your preferences may be synced to the server for
                  cross-device use. This is off by default and does not include profile data.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Audio Alerts Tab */}
        {activeTab === 'alerts' && <AudioAlertsTab />}

        {/* Rig Bridge Tab */}
        {activeTab === 'rig-bridge' && (
          <div>
            <div
              style={{
                background: 'var(--bg-tertiary)',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '10px',
                }}
              >
                Connection
              </div>

              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={rigEnabled}
                  onChange={(e) => setRigEnabled(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>Enable Rig Bridge</span>
              </div>

              {rigEnabled && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label
                        style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '10px' }}
                      >
                        {t('station.settings.rigControl.host')}
                      </label>
                      <input
                        type="text"
                        value={rigHost}
                        onChange={(e) => setRigHost(e.target.value)}
                        placeholder="http://localhost"
                        style={{
                          width: '100%',
                          padding: '8px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--accent-cyan)',
                          fontSize: '13px',
                          fontFamily: 'JetBrains Mono',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '10px' }}
                      >
                        {t('station.settings.rigControl.port')}
                      </label>
                      <input
                        type="number"
                        value={rigPort}
                        onChange={(e) => setRigPort(e.target.value)}
                        placeholder="5555"
                        style={{
                          width: '100%',
                          padding: '8px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--accent-cyan)',
                          fontSize: '13px',
                          fontFamily: 'JetBrains Mono',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    <label
                      style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}
                    >
                      {t('station.settings.rigControl.apiToken')}
                    </label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type={showRigToken ? 'text' : 'password'}
                        value={rigApiToken}
                        onChange={(e) => setRigApiToken(e.target.value)}
                        placeholder={t('station.settings.rigControl.apiToken.placeholder')}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRigToken((v) => !v)}
                        style={{
                          padding: '6px 10px',
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-secondary)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {showRigToken ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                      {t('station.settings.rigControl.apiToken.hint')}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    >
                      <input type="checkbox" checked={tuneEnabled} onChange={(e) => setTuneEnabled(e.target.checked)} />
                      Click-to-tune
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    >
                      <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
                      Auto-mode from band plan
                    </label>
                  </div>
                </>
              )}
            </div>

            {rigEnabled && (
              <>
                {/* Setup UI Link */}
                <div
                  style={{
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div
                    style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.4 }}
                  >
                    Download and run Rig Bridge on your local computer. Configure your radio, digital modes, APRS TNC,
                    rotator, and cloud relay in its setup UI.
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <a
                      href="/api/rig-bridge/download/windows"
                      style={{
                        padding: '6px 14px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Windows
                    </a>
                    <a
                      href="/api/rig-bridge/download/mac"
                      style={{
                        padding: '6px 14px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Mac
                    </a>
                    <a
                      href="/api/rig-bridge/download/linux"
                      style={{
                        padding: '6px 14px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Linux
                    </a>
                    <a
                      href={`${rigHost.replace(/\/$/, '')}:${rigPort}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '6px 14px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Open Setup UI
                    </a>
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', opacity: 0.7 }}>
                    Requires Node.js and git. The installer downloads rig-bridge and starts it automatically.
                  </div>
                </div>

                {/* Plugin Status */}
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    marginBottom: '16px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '8px',
                    }}
                  >
                    Available Plugins
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <div>
                      <strong>Radio:</strong> Yaesu, Kenwood, Icom (USB) | rigctld, flrig, TCI, SmartSDR, RTL-TCP
                    </div>
                    <div>
                      <strong>Digital:</strong> WSJT-X, MSHV, JTDX, JS8Call (bidirectional)
                    </div>
                    <div>
                      <strong>Packet:</strong> APRS TNC (KISS/Direwolf), Winlink (Pat client)
                    </div>
                    <div>
                      <strong>Hardware:</strong> Rotator (rotctld)
                    </div>
                    <div>
                      <strong>Cloud:</strong> Cloud Relay (proxy rig features to cloud-hosted OHC)
                    </div>
                  </div>
                </div>

                {/* Cloud Relay Setup */}
                <div
                  style={{
                    background: cloudRelaySession ? 'rgba(34, 197, 94, 0.12)' : 'rgba(34, 197, 94, 0.08)',
                    border: cloudRelaySession ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(34, 197, 94, 0.2)',
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '8px',
                    }}
                  >
                    Cloud Relay
                  </div>
                  {cloudRelaySession ? (
                    <>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#22c55e',
                          marginBottom: '10px',
                          lineHeight: 1.4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontSize: '10px' }}>&#9679;</span>
                        Active &mdash; session{' '}
                        <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>
                          {cloudRelaySession.slice(0, 8)}&hellip;
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const rigPortValue = String(rigPort ?? '').trim();
                          let nextRigPort = 5555;
                          if (rigPortValue === '0') {
                            nextRigPort = 0;
                          } else {
                            const p = parseInt(rigPortValue, 10);
                            if (Number.isFinite(p) && p > 0) nextRigPort = p;
                          }
                          setCloudRelaySession('');
                          onSave({
                            ...config,
                            rigControl: {
                              ...config.rigControl,
                              enabled: rigEnabled,
                              host: rigHost,
                              port: nextRigPort,
                              tuneEnabled,
                              autoMode,
                              apiToken: rigApiToken.trim(),
                              cloudRelaySession: '',
                            },
                          });
                        }}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#ef4444',
                          cursor: 'pointer',
                        }}
                      >
                        Disconnect Cloud Relay
                      </button>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.7 }}>
                        Switches to direct connection. Disable the Cloud Relay plugin in rig-bridge too.
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginBottom: '10px',
                          lineHeight: 1.4,
                        }}
                      >
                        Running OpenHamClock in the cloud? The Cloud Relay connects your local rig-bridge to this
                        server, enabling click-to-tune, PTT, WSJT-X decodes, and APRS from anywhere.
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const credRes = await fetch('/api/rig-bridge/relay/configure', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({}),
                            });
                            const credData = await credRes.json();
                            if (!credRes.ok) {
                              alert(`Error: ${credData.error}`);
                              return;
                            }

                            setCloudRelaySession(credData.session);

                            // Copy config to clipboard for easy paste into rig-bridge
                            const configText = JSON.stringify(credData.configPayload, null, 2);
                            try {
                              await navigator.clipboard.writeText(configText);
                            } catch (e) {}

                            alert(
                              `Cloud Relay credentials generated!\n\n` +
                                `Session: ${credData.session}\n` +
                                `Server: ${credData.serverUrl}\n\n` +
                                `Next steps:\n` +
                                `1. Open Rig Bridge setup UI at http://localhost:5555\n` +
                                `2. Go to the Plugins tab\n` +
                                `3. Enable "Cloud Relay"\n` +
                                `4. Paste these settings:\n` +
                                `   Server URL: ${credData.serverUrl}\n` +
                                `   API Key: ${credData.relayKey}\n` +
                                `   Session: ${credData.session}\n` +
                                `5. Restart rig-bridge\n` +
                                `6. Click Save below in OHC settings\n\n` +
                                `(Config copied to clipboard)`,
                            );
                          } catch (e) {
                            alert(`Failed to get relay credentials: ${e.message}`);
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          color: '#22c55e',
                          cursor: 'pointer',
                        }}
                      >
                        Connect Cloud Relay
                      </button>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.7 }}>
                        Requires rig-bridge running locally and RIG_BRIDGE_RELAY_KEY set on this server.
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '24px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '14px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '14px',
              background: 'linear-gradient(135deg, #00ff88 0%, #00ddff 100%)',
              border: 'none',
              borderRadius: '6px',
              color: '#000',
              fontSize: '14px',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            {t('station.settings.button.save')}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
          {t('station.settings.button.save.confirm')}
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

/** Audio Alerts settings tab */
function AudioAlertsTab() {
  const [alertSettings, setAlertSettingsState] = useState(() => getAlertSettings());
  const updateSettings = (newSettings) => {
    setAlertSettingsState(newSettings);
    saveAlertSettings(newSettings);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.5' }}>
        Play audio tones when new items appear in data feeds. Each feed can have its own tone. Alerts are suppressed on
        initial page load and when returning to a background tab.
      </div>

      {/* Volume */}
      <div
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>Master Volume</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {Math.round((alertSettings.volume ?? 0.5) * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((alertSettings.volume ?? 0.5) * 100)}
          onChange={(e) => updateSettings({ ...alertSettings, volume: parseInt(e.target.value) / 100 })}
          style={{ width: '100%', accentColor: 'var(--accent-amber)' }}
        />
      </div>

      {/* Per-feed settings */}
      {Object.entries(ALERT_FEEDS).map(([feedId, feed]) => {
        const feedConf = alertSettings[feedId] || { enabled: false, tone: feed.defaultTone };
        return (
          <div
            key={feedId}
            style={{
              background: 'var(--bg-tertiary)',
              border: `1px solid ${feedConf.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
              borderRadius: '8px',
              padding: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: feedConf.enabled ? '10px' : '0',
              }}
            >
              <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>{feed.label}</span>
              <button
                onClick={() =>
                  updateSettings({
                    ...alertSettings,
                    [feedId]: { ...feedConf, enabled: !feedConf.enabled },
                  })
                }
                style={{
                  background: feedConf.enabled ? 'var(--accent-amber)' : 'var(--bg-secondary)',
                  color: feedConf.enabled ? '#000' : 'var(--text-muted)',
                  border: `1px solid ${feedConf.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                  borderRadius: '4px',
                  padding: '4px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {feedConf.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {feedConf.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={feedConf.tone}
                  onChange={(e) =>
                    updateSettings({
                      ...alertSettings,
                      [feedId]: { ...feedConf, tone: e.target.value },
                    })
                  }
                  style={{
                    flex: 1,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {Object.entries(TONE_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => playTone(feedConf.tone, alertSettings.volume ?? 0.5)}
                  title="Preview tone"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '5px 10px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  🔊
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const normalizeRigPort = (value) => {
  if (value === 0 || value === '0') return 0;
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 5555;
};
