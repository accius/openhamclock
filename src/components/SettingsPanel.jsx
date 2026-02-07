/**
 * SettingsPanel Component
 * Full settings modal with map layer controls
 */
import React, { useState, useEffect } from 'react';
import { calculateGridSquare } from '../utils/geo.js';
import { useTranslation, Trans } from 'react-i18next';
import { LANGUAGES } from '../lang/i18n.js';

export const SettingsPanel = ({ isOpen, onClose, config, onSave, onResetLayout, satellites, satelliteFilters, onSatelliteFiltersChange }) => {
  const [callsign, setCallsign] = useState(config?.callsign || '');
  const [headerSize, setheaderSize] = useState(config?.headerSize || 1.0);
  const [gridSquare, setGridSquare] = useState('');
  const [lat, setLat] = useState(config?.location?.lat || 0);
  const [lon, setLon] = useState(config?.location?.lon || 0);
  const [theme, setTheme] = useState(config?.theme || 'dark');
  const [layout, setLayout] = useState(config?.layout || 'modern');
  const [units, setUnits] = useState(config?.units || 'metric');
  const [timezone, setTimezone] = useState(config?.timezone || '');
  const [dxClusterSource, setDxClusterSource] = useState(config?.dxClusterSource || 'dxspider-proxy');
  const [customDxCluster, setCustomDxCluster] = useState(config?.customDxCluster || { enabled: false, host: '', port: 7300 });
  const [lowMemoryMode, setLowMemoryMode] = useState(config?.lowMemoryMode || false);
  const [satelliteSearch, setSatelliteSearch] = useState('');
  const { t, i18n } = useTranslation();

  // Layer controls
  const [layers, setLayers] = useState([]);
  const [activeTab, setActiveTab] = useState('station');

  useEffect(() => {
    if (config) {
      setCallsign(config.callsign || '');
      setheaderSize(config.headerSize || 1.0)
      setLat(config.location?.lat || 0);
      setLon(config.location?.lon || 0);
      setTheme(config.theme || 'dark');
      setLayout(config.layout || 'modern');
      setUnits(config.units || 'metric');
      setTimezone(config.timezone || '');
      setDxClusterSource(config.dxClusterSource || 'dxspider-proxy');
      setCustomDxCluster(config.customDxCluster || { enabled: false, host: '', port: 7300 });
      setLowMemoryMode(config.lowMemoryMode || false);
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
      const lon3 = (grid.charCodeAt(4) - 65) * (2/24);
      const lat3 = (grid.charCodeAt(5) - 65) * (1/24);
      lon = lon1 + lon2 + lon3 + (1/24);
      lat = lat1 + lat2 + lat3 + (1/48);
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
      units,
      timezone,
      dxClusterSource,
      customDxCluster,
      lowMemoryMode
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
            <div style={{ marginBottom: '20px'}}>
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
                    }}}
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

            {/* Units */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Units
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['imperial', 'metric'].map((u) => (
                  <button
                    key={u}
                    onClick={() => setUnits(u)}
                    style={{
                      padding: '12px',
                      background: units === u ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                      border: `1px solid ${units === u ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      color: units === u ? '#000' : 'var(--text-secondary)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      fontWeight: units === u ? '700' : '400',
                      textTransform: 'capitalize'
                    }}
                  >
                    {u === 'imperial' ? '🇺🇸' : '🌍'} {u}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                {units === 'imperial' ? '°F, miles (mi)' : '°C, kilometers (km)'}
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
            {layers.length > 0 ? (
              layers.map(layer => (
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
            <div style={{
              position: 'relative',
              marginBottom: '12px'
            }}>
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
