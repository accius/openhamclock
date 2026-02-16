/**
 * SettingsPanel Component
 * Full settings modal with map layer controls
 */
import React, { useState, useEffect, useRef } from 'react';
import { calculateGridSquare } from '../utils/geo.js';
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
  importProfile
} from '../utils/profiles.js';

export const SettingsPanel = ({ isOpen, onClose, config, onSave, onResetLayout, satellites, satelliteFilters, onSatelliteFiltersChange, mapLayers, onToggleDXNews }) => {
  const [callsign, setCallsign] = useState(config?.callsign || '');
  const [headerSize, setheaderSize] = useState(config?.headerSize || 1.0);
  const [gridSquare, setGridSquare] = useState('');
  const [lat, setLat] = useState(config?.location?.lat || 0);
  const [lon, setLon] = useState(config?.location?.lon || 0);
  const [theme, setTheme] = useState(config?.theme || 'dark');
  const [layout, setLayout] = useState(config?.layout || 'modern');
  const [mouseZoom, setMouseZoom] = useState(config?.mouseZoom || 50);
  const [timezone, setTimezone] = useState(config?.timezone || '');
  const [dxClusterSource, setDxClusterSource] = useState(config?.dxClusterSource || 'dxspider-proxy');
  const [customDxCluster, setCustomDxCluster] = useState(config?.customDxCluster || { enabled: false, host: '', port: 7300 });
  const [lowMemoryMode, setLowMemoryMode] = useState(config?.lowMemoryMode || false);
  const [units, setUnits] = useState(config?.units || 'imperial');
  const [propMode, setPropMode] = useState(config?.propagation?.mode || 'SSB');
  const [propPower, setPropPower] = useState(config?.propagation?.power || 100);
  const [rigEnabled, setRigEnabled] = useState(config?.rigControl?.enabled || false);
  const [rigHost, setRigHost] = useState(config?.rigControl?.host || 'http://localhost');
  const [rigPort, setRigPort] = useState(config?.rigControl?.port || 5555);
  const [tuneEnabled, setTuneEnabled] = useState(config?.rigControl?.tuneEnabled || false);
  const [satelliteSearch, setSatelliteSearch] = useState('');
  const { t, i18n } = useTranslation();

  // Layer controls
  const [layers, setLayers] = useState([]);
  const [activeTab, setActiveTab] = useState('station');
  const [ctrlPressed, setCtrlPressed] = useState(false);

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

  useEffect(() => {
    if (config) {
      setCallsign(config.callsign || '');
      setheaderSize(config.headerSize || 1.0)
      setLat(config.location?.lat || 0);
      setLon(config.location?.lon || 0);
      setTheme(config.theme || 'dark');
      setLayout(config.layout || 'modern');
      setMouseZoom(config.mouseZoom || 50);
      setTimezone(config.timezone || '');
      setDxClusterSource(config.dxClusterSource || 'dxspider-proxy');
      setCustomDxCluster(config.customDxCluster || { enabled: false, host: '', port: 7300 });
      setLowMemoryMode(config.lowMemoryMode || false);
      setUnits(config.units || 'imperial');
      setPropMode(config.propagation?.mode || 'SSB');
      setPropMode(config.propagation?.mode || 'SSB');
      setPropPower(config.propagation?.power || 100);
      setRigEnabled(config.rigControl?.enabled || false);
      setRigHost(config.rigControl?.host || 'http://localhost');
      setRigPort(config.rigControl?.port || 5555);
      setTuneEnabled(config.rigControl?.tuneEnabled || false);
      if (config.location?.lat && config.location?.lon) {
        setGridSquare(calculateGridSquare(config.location.lat, config.location.lon));
      }
    }
  }, [config, isOpen]);

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
        .then(r => r.json())
        .then(data => setQrzStatus(data))
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
      'lightning': ['lightning-stats-position', 'lightning-proximity-position'],
      'wspr': ['wspr-filter-position', 'wspr-stats-position', 'wspr-legend-position', 'wspr-chart-position'],
      'rbn': ['rbn-panel-position'],
      'grayline': ['grayline-position'],
      'n3fjp_logged_qsos': ['n3fjp-position'],
      'voacap-heatmap': ['voacap-heatmap-position']
    };

    const keys = storageKeys[layerId] || [];
    keys.forEach(key => {
      localStorage.removeItem(key);
      // Also remove minimized state
      localStorage.removeItem(key + '-minimized');
    });

    // Reload the page to apply position resets
    if (keys.length > 0) {
      window.location.reload();
    }
  };

  const handleGridChange = (grid) => {
    setGridSquare(grid.toUpperCase());
    if (grid.length >= 4) {
      const parsed = parseGridSquare(grid);
      if (parsed) {
        setLat(parsed.lat);
        setLon(parsed.lon);
      }
    }
  };

  const parseGridSquare = (grid) => {
    grid = grid.toUpperCase();
    if (grid.length < 4) return null;

    const lon1 = (grid.charCodeAt(0) - 65) * 20 - 180;
    const lat1 = (grid.charCodeAt(1) - 65) * 10 - 90;
    const lon2 = parseInt(grid[2]) * 2;
    const lat2 = parseInt(grid[3]) * 1;

    let lon = lon1 + lon2 + 1;
    let lat = lat1 + lat2 + 0.5;

    if (grid.length >= 6) {
      const lon3 = (grid.charCodeAt(4) - 65) * (2 / 24);
      const lat3 = (grid.charCodeAt(5) - 65) * (1 / 24);
      lon = lon1 + lon2 + lon3 + (1 / 24);
      lat = lat1 + lat2 + lat3 + (1 / 48);
    }

    return { lat, lon };
  };

  useEffect(() => {
    if (lat && lon) {
      setGridSquare(calculateGridSquare(lat, lon));
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
        }
      );
    } else {
      alert(t('station.settings.useLocation.error2'));
    }
  };

  const handleToggleLayer = (layerId) => {
    if (window.hamclockLayerControls) {
      const layer = layers.find(l => l.id === layerId);
      const newEnabledState = !layer.enabled;

      // Update the control
      window.hamclockLayerControls.toggleLayer(layerId, newEnabledState);

      // Force immediate UI update
      setLayers(prevLayers =>
        prevLayers.map(l =>
          l.id === layerId ? { ...l, enabled: newEnabledState } : l
        )
      );

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

      setLayers(prevLayers =>
        prevLayers.map(l =>
          l.id === layerId
            ? { ...l, config: { ...(l.config || {}), ...configDelta } }
            : l
        )
      );
    }
  };

  const handleOpacityChange = (layerId, opacity) => {
    if (window.hamclockLayerControls) {
      window.hamclockLayerControls.setOpacity(layerId, opacity);
      setLayers([...window.hamclockLayerControls.layers]);
    }
  };

  const handleSave = () => {
    onSave({
      ...config,
      callsign: callsign.toUpperCase(),
      headerSize: headerSize,
      location: { lat: parseFloat(lat), lon: parseFloat(lon) },
      theme,
      layout,
      mouseZoom,
      timezone,
      dxClusterSource,
      customDxCluster,
      lowMemoryMode,
      units,
      propagation: { mode: propMode, power: parseFloat(propPower) || 100 },
      rigControl: { enabled: rigEnabled, host: rigHost, port: parseInt(rigPort) || 5555, tuneEnabled }
    });
    onClose();
  };

  if (!isOpen) return null;

  const Code = ({ children }) => (
    <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '3px' }}>
      {children}
    </code>
  );

  const themeDescriptions = {
    dark: t('station.settings.theme.dark.describe'),
    light: t('station.settings.theme.light.describe'),
    legacy: t('station.settings.theme.legacy.describe'),
    retro: t('station.settings.theme.retro.describe')
  };

  const layoutDescriptions = {
    modern: t('station.settings.layout.modern.describe'),
    classic: t('station.settings.layout.classic.describe'),
    tablet: t('station.settings.layout.tablet.describe'),
    compact: t('station.settings.layout.compact.describe'),
    dockable: t('station.settings.layout.dockable.describe')
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10000
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '2px solid var(--accent-amber)',
        borderRadius: '12px',
        padding: '24px',
        width: '520px',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <h2 style={{
          color: 'var(--accent-cyan)',
          marginTop: 0,
          marginBottom: '24px',
          textAlign: 'center',
          fontFamily: 'Orbitron, monospace',
          fontSize: '20px'
        }}>
          {t('station.settings.title')}
        </h2>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px'
        }}>
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
              fontFamily: 'JetBrains Mono, monospace'
            }}
          >
            {t('station.settings.tab1.title')}
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
              fontFamily: 'JetBrains Mono, monospace'
            }}
          >
            {t('station.settings.tab2.title')}
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
              fontFamily: 'JetBrains Mono, monospace'
            }}
          >
            {t('station.settings.tab3.title')}
          </button>
          <button
            onClick={() => { setActiveTab('profiles'); refreshProfiles(); }}
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
              fontFamily: 'JetBrains Mono, monospace'
            }}
          >
            Profiles
          </button>
        </div>

        {/* Station Settings Tab */}
        {activeTab === 'station' && (
          <>
            {/* First-time setup banner */}
            {(config?.configIncomplete || config?.callsign === 'N0CALL' || !config?.locator) && (
              <div style={{
                background: 'rgba(255, 193, 7, 0.15)',
                border: '1px solid var(--accent-amber)',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '20px',
                fontSize: '13px'
              }}>
                <div style={{ color: 'var(--accent-amber)', fontWeight: '700', marginBottom: '6px' }}>
                  {t("station.settings.welcome")}
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t("station.settings.describe")}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '8px' }}>
                  <Trans i18nKey="station.settings.tip.env" components={{ envExample: <Code />, env: <Code /> }} />
                </div>
              </div>
            )}

            {/* Callsign */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
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
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Callsign Size*/}
            <div style={{ marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  {t('station.settings.headerSize')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={isNaN(lat) ? '' : headerSize}
                  onChange={(e) => {
                    if (e.target.value >= 0.1 && e.target.value <= 2.0) {
                      setheaderSize(e.target.value)
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    fontFamily: 'JetBrains Mono, monospace',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Grid Square */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {t('station.settings.locator')}
              </label>
              <input
                type="text"
                value={gridSquare}
                onChange={(e) => handleGridChange(e.target.value)}
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
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Lat/Lon */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
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
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
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
                    boxSizing: 'border-box'
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
                marginBottom: '20px'
              }}
            >
              {t('station.settings.useLocation')}
            </button>

            {/* Mouse wheel zoom factor */}
            <div style={{ marginBottom: '31px' }}>
              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
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
                    marginTop: '3px'
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

            {/* Theme */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {t('station.settings.theme')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {['dark', 'light', 'legacy', 'retro'].map((th) => (
                  <button
                    key={th}
                    onClick={() => setTheme(th)}
                    style={{
                      padding: '10px',
                      background: theme === th ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                      border: `1px solid ${theme === th ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      color: theme === th ? '#000' : 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: theme === th ? '600' : '400'
                    }}
                  >
                    {th === 'dark' ? '🌙' : th === 'light' ? '☀️' : th === 'legacy' ? '💻' : '🪟'} {t('station.settings.theme.' + th)}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {themeDescriptions[theme]}
              </div>
            </div>

            {/* Layout */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {t('station.settings.layout')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {['modern', 'classic', 'tablet', 'compact', 'dockable'].map((l) => (
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
                      fontWeight: layout === l ? '600' : '400'
                    }}
                  >
                    {l === 'modern' ? '🖥️' : l === 'classic' ? '📺' : l === 'tablet' ? '📱' : l === 'compact' ? '📊' : '⊞'} {l === 'dockable' ? t('station.settings.layout.dockable') : t('station.settings.layout.' + l)}
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
                    gap: '6px'
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

            {/* DX Cluster Source */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {t('station.settings.timezone')}
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
                  cursor: 'pointer'
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
                {timezone ? '' : t('station.settings.timezone.currentDefault')}
              </div>
            </div>

            {/* Distance Units */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                📏 Distance Units
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setUnits('imperial')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: units === 'imperial' ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    border: `1px solid ${units === 'imperial' ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: units === 'imperial' ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: units === 'imperial' ? '600' : '400'
                  }}
                >
                  🇺🇸 Imperial (mi)
                </button>
                <button
                  onClick={() => setUnits('metric')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: units === 'metric' ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    border: `1px solid ${units === 'metric' ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '6px',
                    color: units === 'metric' ? '#000' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: units === 'metric' ? '600' : '400'
                  }}
                >
                  🌍 Metric (km)
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {units === 'imperial'
                  ? 'Distances shown in miles throughout the application.'
                  : 'Distances shown in kilometers throughout the application.'}
              </div>
            </div>

            {/* Rig Control Settings */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {t('station.settings.rigControl.title')} (Beta)
              </label>

              <div style={{
                background: 'var(--bg-tertiary)',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
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
                    <div style={{
                      background: 'rgba(99,102,241,0.08)',
                      border: '1px solid rgba(99,102,241,0.2)',
                      borderRadius: '6px',
                      padding: '10px',
                      marginBottom: '12px',
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.4 }}>
                        📻 Download the Rig Listener for your computer. Double-click to run — it connects your radio to OpenHamClock via USB.
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <a href="/api/rig/download/windows"
                          style={{
                            padding: '5px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8', textDecoration: 'none', cursor: 'pointer',
                          }}>⊞ Windows</a>
                        <a href="/api/rig/download/mac"
                          style={{
                            padding: '5px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8', textDecoration: 'none', cursor: 'pointer',
                          }}> Mac</a>
                        <a href="/api/rig/download/linux"
                          style={{
                            padding: '5px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                            color: '#818cf8', textDecoration: 'none', cursor: 'pointer',
                          }}>🐧 Linux</a>
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.7 }}>
                        Supports Yaesu, Kenwood, Elecraft, and Icom radios. No extra software needed.
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '10px' }}>
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
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '10px' }}>
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
                          boxSizing: 'border-box'
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
                  </>
                )}
              </div>
            </div>

            {/* Propagation Settings */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                ⌇ Propagation Mode & Power
              </label>

              {/* Mode */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Operating Mode</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {[
                    { id: 'SSB', label: 'SSB', desc: 'Voice' },
                    { id: 'CW', label: 'CW', desc: 'Morse' },
                    { id: 'FT8', label: 'FT8', desc: 'Weak sig' },
                    { id: 'FT4', label: 'FT4', desc: 'Weak sig' },
                    { id: 'WSPR', label: 'WSPR', desc: 'Beacon' },
                    { id: 'JS8', label: 'JS8', desc: 'Chat' },
                    { id: 'RTTY', label: 'RTTY', desc: 'Teletype' },
                    { id: 'PSK31', label: 'PSK31', desc: 'PSK' }
                  ].map(m => (
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
                        textAlign: 'center'
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
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>TX Power</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.2fr', gap: '4px', alignItems: 'center' }}>
                  {[
                    { w: 5, label: '5W', tip: 'QRP' },
                    { w: 25, label: '25W', tip: 'Low' },
                    { w: 100, label: '100W', tip: 'Std' },
                    { w: 1500, label: '1.5kW', tip: 'Max' }
                  ].map(p => (
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
                        fontFamily: 'JetBrains Mono, monospace'
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
                        boxSizing: 'border-box'
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
                  return `Signal margin: ${margin >= 0 ? '+' : ''}${margin.toFixed(1)} dB vs SSB@100W — ${margin >= 30 ? 'extreme weak-signal advantage' :
                    margin >= 15 ? 'strong advantage — marginal bands may open' :
                      margin >= 5 ? 'moderate advantage' :
                        margin >= -5 ? 'baseline conditions' :
                          margin >= -15 ? 'reduced margin — some bands may close' :
                            'significant disadvantage — only strong openings'
                    }`;
                })()}
              </div>
            </div>

            {/* Low Memory Mode */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
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
                    fontWeight: !lowMemoryMode ? '600' : '400'
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
                    fontWeight: lowMemoryMode ? '600' : '400'
                  }}
                >
                  🪶 Low Memory
                </button>
              </div>
              <div style={{ fontSize: '11px', color: lowMemoryMode ? 'var(--accent-green)' : 'var(--text-muted)', marginTop: '6px' }}>
                {lowMemoryMode
                  ? '✓ Low Memory Mode: Reduced animations, fewer map markers, smaller spot limits. Recommended for systems with <8GB RAM.'
                  : 'Full Mode: All features enabled. Requires 8GB+ RAM for best performance.'}
              </div>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
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
                  cursor: 'pointer'
                }}
              >
                <option value="dxspider-proxy">{t('station.settings.dx.option1')}</option>
                <option value="hamqth">{t('station.settings.dx.option2')}</option>
                <option value="dxwatch">{t('station.settings.dx.option3')}</option>
                <option value="auto">{t('station.settings.dx.option4')}</option>
                <option value="custom">{t('station.settings.dx.custom.option')}</option>
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {t('station.settings.dx.describe')}
              </div>
            </div>

            {/* Custom DX Cluster Settings */}
            {dxClusterSource === 'custom' && (
              <div style={{
                marginBottom: '20px',
                padding: '16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}>
                <label style={{ display: 'block', marginBottom: '12px', color: 'var(--accent-cyan)', fontSize: '12px', fontWeight: '600' }}>
                  {t('station.settings.dx.custom.title')}
                </label>

                {/* Host */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
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
                      fontFamily: 'JetBrains Mono, monospace'
                    }}
                  />
                </div>

                {/* Port */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
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
                      fontFamily: 'JetBrains Mono, monospace'
                    }}
                  />
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {t('station.settings.dx.custom.callsign', { callsign: callsign || 'N0CALL' })}
                  {' '}
                  {t('station.settings.dx.custom.commonPorts')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--accent-amber)', marginTop: '8px' }}>
                  {t('station.settings.dx.custom.warning')}
                </div>
              </div>
            )}

            {/* Language */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                ⊕ {t('station.settings.language')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => i18n.changeLanguage(lang.code)}
                    style={{
                      padding: '8px 6px',
                      background: i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                        ? 'rgba(0, 221, 255, 0.2)'
                        : 'var(--bg-tertiary)',
                      border: `1px solid ${i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                        ? 'var(--accent-cyan)'
                        : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      color: i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code))
                        ? 'var(--accent-cyan)'
                        : 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: i18n.language === lang.code || (i18n.language && i18n.language.startsWith(lang.code)) ? '600' : '400',
                      textAlign: 'center'
                    }}
                  >
                    {lang.flag} {lang.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Map Layers Tab */}
        {activeTab === 'layers' && (
          <div>
            {/* Map Overlays section */}
            <div style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '14px',
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-muted)',
                marginBottom: '10px'
              }}>
                Map Overlays
              </div>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={mapLayers?.showDXNews !== false}
                  onChange={() => onToggleDXNews?.()}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '18px' }}>📰</span>
                <div>
                  <div style={{
                    color: mapLayers?.showDXNews !== false ? 'var(--accent-amber)' : 'var(--text-primary)',
                    fontSize: '14px',
                    fontWeight: '600',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}>
                    DX News Ticker
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Scrolling DX news headlines on the map
                  </div>
                </div>
              </label>
            </div>

            {layers.length > 0 ? (
              layers
                .filter(layer => layer.category !== 'satellites') // Correctly filter out satellites
                .map(layer => (
                  <div key={layer.id} style={{
                    background: 'var(--bg-tertiary)',
                    border: `1px solid ${layer.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '14px',
                    marginBottom: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        flex: 1
                      }}>
                        <input
                          type="checkbox"
                          checked={layer.enabled}
                          onChange={() => handleToggleLayer(layer.id)}
                          style={{
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer'
                          }}
                        />
                        <span style={{ fontSize: '18px' }}>{layer.icon}</span>
                        <div>
                          <div style={{
                            color: layer.enabled ? 'var(--accent-amber)' : 'var(--text-primary)',
                            fontSize: '14px',
                            fontWeight: '600',
                            fontFamily: 'JetBrains Mono, monospace'
                          }}>
                            {layer.name.startsWith('plugins.') ? t(layer.name) : layer.name}
                          </div>
                          {layer.description && (
                            <div style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              marginTop: '2px'
                            }}>
                              {layer.description.startsWith('plugins.') ? t(layer.description) : layer.description}
                            </div>
                          )}
                        </div>
                      </label>
                      <span style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        color: 'var(--text-secondary)',
                        background: 'var(--bg-hover)',
                        padding: '2px 8px',
                        borderRadius: '3px'
                      }}>
                        {layer.category}
                      </span>
                    </div>

                    {layer.enabled && (
                      <div style={{ paddingLeft: '38px', marginTop: '12px' }}>
                        <label style={{
                          display: 'block',
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          marginBottom: '6px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          {t('station.settings.layers.opacity')}: {Math.round(layer.opacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={layer.opacity * 100}
                          onChange={(e) => handleOpacityChange(layer.id, parseFloat(e.target.value) / 100)}
                          style={{
                            width: '100%',
                            cursor: 'pointer'
                          }}
                        />

                        {/* CTRL+Click Reset Button - Hidden unless CTRL is pressed */}
                        {ctrlPressed && ['lightning', 'wspr', 'rbn', 'grayline', 'n3fjp_logged_qsos', 'voacap-heatmap'].includes(layer.id) && (
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
                              width: '100%'
                            }}
                          >
                            🔄 RESET POPUPS
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--text-muted)',
                fontSize: '13px'
              }}>
                {t('station.settings.layers.noLayers')}
              </div>
            )}
          </div>
        )}

        {/* Satellites Tab */}
        {activeTab === 'satellites' && (
          <div>
            {/* 1. Plugin Layer Toggle Section */}
            <div style={{ marginBottom: '20px' }}>
              {layers
                .filter(layer => layer.category === 'satellites')
                .map(layer => (
                  <div key={layer.id} style={{
                    background: 'var(--bg-tertiary)',
                    border: `1px solid ${layer.enabled ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '14px',
                    marginBottom: '12px'
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        onChange={() => handleToggleLayer(layer.id)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '18px' }}>🛰️</span>
                      <div>
                        <div style={{
                          color: layer.enabled ? 'var(--accent-amber)' : 'var(--text-primary)',
                          fontSize: '14px',
                          fontWeight: '600',
                          fontFamily: 'JetBrains Mono, monospace'
                        }}>
                          {layer.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {layer.description}
                        </div>
                      </div>
                    </label>

                    {layer.enabled && (
                      <div style={{ paddingLeft: '38px', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Sub-Toggles for Tracks and Footprints */}
                        <div style={{ display: 'flex', gap: '15px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={layer.config?.showTracks !== false}
                              onChange={(e) => handleUpdateLayerConfig(layer.id, { showTracks: e.target.checked })}
                            /> Track Lines
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={layer.config?.showFootprints !== false}
                              onChange={(e) => handleUpdateLayerConfig(layer.id, { showFootprints: e.target.checked })}
                            /> Footprints
                          </label>
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
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '16px',
              paddingBottom: '12px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <button
                onClick={() => {
                  const allSats = (satellites || []).map(s => s.name);
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
                  fontFamily: 'JetBrains Mono'
                }}
              >{t('station.settings.satellites.selectAll')}</button>
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
                  fontFamily: 'JetBrains Mono'
                }}
              >{t('station.settings.satellites.clear')}</button>
            </div>

            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginBottom: '12px'
            }}>
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
                  outline: 'none'
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
                    padding: '4px 8px'
                  }}
                >×</button>
              )}
            </div>

            {/* Satellite Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              {(satellites || [])
                .filter(sat =>
                  !satelliteSearch ||
                  sat.name.toLowerCase().includes(satelliteSearch.toLowerCase())
                )
                .sort((a, b) => {
                  const aSelected = satelliteFilters.includes(a.name);
                  const bSelected = satelliteFilters.includes(b.name);
                  if (aSelected && !bSelected) return -1;
                  if (!aSelected && bSelected) return 1;
                  return a.name.localeCompare(b.name);
                })
                .map(sat => {
                  const isSelected = satelliteFilters.includes(sat.name);
                  return (
                    <button
                      key={sat.name}
                      onClick={() => {
                        if (isSelected) {
                          onSatelliteFiltersChange(satelliteFilters.filter(n => n !== sat.name));
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
                        gap: '8px'
                      }}
                    >
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
                        border: `2px solid ${isSelected ? '#00ffff' : '#666'}`,
                        background: isSelected ? '#00ffff' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        flexShrink: 0
                      }}>
                        {isSelected && '✓'}
                      </span>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{
                          color: isSelected ? '#00ffff' : 'var(--text-primary)',
                          fontWeight: '600',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>{sat.name}</div>
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
              Save your current layout, theme, map layers, filters, and all preferences as a named profile.
              Switch between profiles when sharing a HamClock between operators, or to toggle between your own saved views.
            </div>

            {/* Active profile indicator */}
            {activeProfileName && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: 'rgba(0, 255, 136, 0.1)',
                border: '1px solid rgba(0, 255, 136, 0.3)',
                borderRadius: '6px',
                fontSize: '12px'
              }}>
                <span style={{ color: '#00ff88' }}>●</span>
                <span style={{ color: 'var(--text-primary)' }}>Active: <strong>{activeProfileName}</strong></span>
              </div>
            )}

            {/* Status message */}
            {profileMessage && (
              <div style={{
                padding: '8px 12px',
                background: profileMessage.type === 'error' ? 'rgba(255, 68, 102, 0.1)' : 'rgba(0, 255, 136, 0.1)',
                border: `1px solid ${profileMessage.type === 'error' ? 'rgba(255, 68, 102, 0.3)' : 'rgba(0, 255, 136, 0.3)'}`,
                borderRadius: '6px',
                fontSize: '11px',
                color: profileMessage.type === 'error' ? '#ff4466' : '#00ff88'
              }}>
                {profileMessage.text}
              </div>
            )}

            {/* Save new profile */}
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
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
                      if (exists && !window.confirm(`Profile "${newProfileName.trim()}" already exists. Overwrite?`)) return;
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
                    fontFamily: 'JetBrains Mono, monospace'
                  }}
                />
                <button
                  onClick={() => {
                    if (!newProfileName.trim()) return;
                    const exists = profiles[newProfileName.trim()];
                    if (exists && !window.confirm(`Profile "${newProfileName.trim()}" already exists. Overwrite?`)) return;
                    saveProfile(newProfileName.trim());
                    setNewProfileName('');
                    refreshProfiles();
                    setProfileMessage({ type: 'success', text: `Profile "${newProfileName.trim()}" saved` });
                    setTimeout(() => setProfileMessage(null), 3000);
                  }}
                  disabled={!newProfileName.trim()}
                  style={{
                    padding: '8px 16px',
                    background: newProfileName.trim() ? 'linear-gradient(135deg, #00ff88 0%, #00ddff 100%)' : 'var(--bg-tertiary)',
                    border: 'none',
                    borderRadius: '4px',
                    color: newProfileName.trim() ? '#000' : 'var(--text-muted)',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: newProfileName.trim() ? 'pointer' : 'default',
                    whiteSpace: 'nowrap'
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
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  border: '1px dashed var(--border-color)'
                }}>
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
                      } catch { }

                      // Parse layout type
                      let snapshotLayout = '';
                      try {
                        const cfg = profile.snapshot?.openhamclock_config;
                        if (cfg) snapshotLayout = JSON.parse(cfg).layout || '';
                      } catch { }

                      return (
                        <div key={name} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 12px',
                          background: isActive ? 'rgba(0, 255, 136, 0.08)' : 'var(--bg-tertiary)',
                          border: `1px solid ${isActive ? 'rgba(0, 255, 136, 0.3)' : 'var(--border-color)'}`,
                          borderRadius: '6px',
                        }}>
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
                                        setProfileMessage({ type: 'success', text: `Renamed to "${renameValue.trim()}"` });
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
                                    fontFamily: 'JetBrains Mono, monospace'
                                  }}
                                />
                                <button onClick={() => {
                                  if (renameProfile(name, renameValue)) {
                                    refreshProfiles();
                                    setProfileMessage({ type: 'success', text: `Renamed to "${renameValue.trim()}"` });
                                  } else {
                                    setProfileMessage({ type: 'error', text: 'Rename failed — name may already exist' });
                                  }
                                  setRenamingProfile(null);
                                  setTimeout(() => setProfileMessage(null), 3000);
                                }} style={{
                                  padding: '4px 8px', background: 'var(--accent-green)', border: 'none',
                                  borderRadius: '3px', color: '#000', fontSize: '10px', cursor: 'pointer', fontWeight: '700'
                                }}>✓</button>
                                <button onClick={() => setRenamingProfile(null)} style={{
                                  padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                                  borderRadius: '3px', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer'
                                }}>✕</button>
                              </div>
                            ) : (
                              <>
                                <div style={{
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  color: isActive ? '#00ff88' : 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>
                                  {isActive && <span style={{ marginRight: '4px' }}>●</span>}
                                  {name}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {snapshotCallsign && <span>{snapshotCallsign}</span>}
                                  {snapshotLayout && <span> • {snapshotLayout}</span>}
                                  {profile.updatedAt && <span> • {new Date(profile.updatedAt).toLocaleDateString()}</span>}
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
                                  if (window.confirm(`Load profile "${name}"? This will replace your current settings and reload.`)) {
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
                                  fontWeight: '600'
                                }}
                              >
                                {isActive ? '✓ Active' : '▶ Load'}
                              </button>
                              {/* Update (overwrite with current state) */}
                              <button
                                onClick={() => {
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
                                  cursor: 'pointer'
                                }}
                              >↻</button>
                              {/* Rename */}
                              <button
                                onClick={() => { setRenamingProfile(name); setRenameValue(name); }}
                                title="Rename"
                                style={{
                                  padding: '5px 8px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  color: 'var(--text-muted)',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >✎</button>
                              {/* Export */}
                              <button
                                onClick={() => {
                                  const json = exportProfile(name);
                                  if (json) {
                                    const blob = new Blob([json], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `hamclock-profile-${name.replace(/\s+/g, '-').toLowerCase()}.json`;
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
                                  cursor: 'pointer'
                                }}
                              >⤓</button>
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
                                  cursor: 'pointer'
                                }}
                              >✕</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* QRZ.com XML API Credentials */}
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📡 QRZ.com Callsign Lookup</span>
                {qrzStatus?.configured && (
                  <span style={{
                    fontSize: '10px', fontWeight: '500', padding: '1px 6px', borderRadius: '3px',
                    background: qrzStatus.hasSession ? 'rgba(46, 204, 113, 0.15)' : 'rgba(241, 196, 15, 0.15)',
                    color: qrzStatus.hasSession ? '#2ecc71' : '#f1c40f'
                  }}>
                    {qrzStatus.hasSession ? '● Connected' : '○ Configured'}
                    {qrzStatus.source === 'env' ? ' (env)' : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                Enables precise station locations from <a href="https://www.qrz.com/i/subscriptions.html" target="_blank" rel="noopener" style={{ color: 'var(--accent-blue)' }}>QRZ.com</a> user
                profiles (user-supplied coordinates, geocoded addresses, grid squares).
                Without this, locations fall back to HamQTH (country-level only).
                Requires a QRZ Logbook Data subscription.
              </div>
              {qrzStatus?.source === 'env' ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px', background: 'var(--bg-primary)', borderRadius: '4px' }}>
                  ✓ Credentials configured via <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '2px' }}>QRZ_USERNAME</code> / <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '2px' }}>QRZ_PASSWORD</code> in .env file
                  {qrzStatus.lookupCount > 0 && <span style={{ color: 'var(--accent-green)' }}> — {qrzStatus.lookupCount} lookups this session</span>}
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
                        flex: 1, padding: '8px 12px', background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)', borderRadius: '4px',
                        color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace',
                        boxSizing: 'border-box'
                      }}
                    />
                    <input
                      type="password"
                      placeholder="QRZ Password"
                      value={qrzPassword}
                      onChange={(e) => setQrzPassword(e.target.value)}
                      style={{
                        flex: 1, padding: '8px 12px', background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)', borderRadius: '4px',
                        color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace',
                        boxSizing: 'border-box'
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
                            body: JSON.stringify({ username: qrzUsername.trim(), password: qrzPassword.trim() })
                          });
                          const data = await res.json();
                          if (data.success) {
                            setQrzMessage({ type: 'success', text: 'Connected to QRZ.com successfully!' });
                            setQrzPassword('');
                            // Refresh status
                            const st = await fetch('/api/qrz/status').then(r => r.json());
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
                        padding: '6px 14px', fontSize: '11px', fontWeight: '600', borderRadius: '4px',
                        border: 'none', cursor: (qrzTesting || !qrzUsername.trim() || !qrzPassword.trim()) ? 'not-allowed' : 'pointer',
                        background: 'var(--accent-amber)', color: '#000', opacity: (qrzTesting || !qrzUsername.trim() || !qrzPassword.trim()) ? 0.5 : 1
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
                          const st = await fetch('/api/qrz/status').then(r => r.json());
                          setQrzStatus(st);
                        }}
                        style={{
                          padding: '6px 12px', fontSize: '11px', borderRadius: '4px',
                          border: '1px solid var(--border-color)', cursor: 'pointer',
                          background: 'transparent', color: 'var(--text-muted)'
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
                    <div style={{
                      marginTop: '6px', fontSize: '11px', padding: '6px 10px', borderRadius: '4px',
                      background: qrzMessage.type === 'success' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                      color: qrzMessage.type === 'success' ? '#2ecc71' : '#e74c3c'
                    }}>
                      {qrzMessage.type === 'success' ? '✓' : '✗'} {qrzMessage.text}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Open-Meteo API Key (optional) */}
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
                🌡️ Open-Meteo API Key <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '11px' }}>(optional)</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                Weather data is provided by Open-Meteo's free API. For higher rate limits or commercial use,
                enter your API key from <a href="https://open-meteo.com/en/pricing" target="_blank" rel="noopener" style={{ color: 'var(--accent-blue)' }}>open-meteo.com</a>.
                Leave blank for the free tier.
              </div>
              <input
                type="text"
                placeholder="Free tier (no key needed)"
                defaultValue={(() => { try { return localStorage.getItem('ohc_openmeteo_apikey') || ''; } catch { return ''; } })()}
                onChange={(e) => {
                  try {
                    const val = e.target.value.trim();
                    if (val) { localStorage.setItem('ohc_openmeteo_apikey', val); }
                    else { localStorage.removeItem('ohc_openmeteo_apikey'); }
                  } catch { }
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
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Import / Export section */}
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
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
                    fontWeight: '600'
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
                    a.download = `hamclock-current-${new Date().toISOString().split('T')[0]}.json`;
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
                    fontWeight: '600'
                  }}
                >
                  ⤓ Export Current State
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Share profile files between devices or operators. Exported files contain all settings, layout preferences, map layers, and filter configurations.
              </div>
            </div>
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
              cursor: 'pointer'
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
              cursor: 'pointer'
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
