/**
 * WorldMap Component
 * Leaflet map with DE/DX markers, terminator, DX paths, POTA/WWFF/SOTA/WWBOTA, satellites, PSKReporter, WSJT-X
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_STYLES } from '../utils/config.js';
import {
  calculateGridSquare,
  getSunPosition,
  getMoonPosition,
  getGreatCirclePoints,
  replicatePath,
  replicatePoint,
} from '../utils/geo.js';
import { getBandColor, getBandFromFreq } from '../utils/callsign.js';
import {
  BAND_LEGEND_ORDER,
  getBandColorForBand,
  getBandTextColor,
  getEffectiveBandColors,
  loadBandColorOverrides,
  saveBandColorOverrides,
} from '../utils/bandColors.js';
import { createTerminator } from '../utils/terminator.js';
import { getAprsSymbolIcon } from '../utils/aprs-symbols.js';
import { getAllLayers } from '../plugins/layerRegistry.js';
import useLocalInstall from '../hooks/app/useLocalInstall.js';
import PluginLayer from './PluginLayer.jsx';
import AzimuthalMap from './AzimuthalMap.jsx';
import { DXNewsTicker } from './DXNewsTicker.jsx';
import { CallsignWeatherOverlay } from './CallsignWeatherOverlay.jsx';
import { getCallsignWeather } from '../utils/callsignWeather.js';
import { filterDXPaths } from '../utils';

// SECURITY: Escape HTML to prevent XSS in Leaflet popups/tooltips
// DX cluster data, POTA/SOTA spots, and WSJT-X decodes come from external sources
// and could contain malicious HTML/script tags in callsigns, comments, or park names.
import { esc } from '../utils/escapeHtml.js';

// Lightweight error boundary for the azimuthal map — falls back to Mercator
// instead of crashing the entire dashboard.
class AzimuthalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('[AzimuthalMap] Render crash, falling back to Mercator:', error, info);
    if (this.props.onFallback) this.props.onFallback();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// Normalize callsign keys used for DX hover/highlight matching
const normalizeCallsignKey = (v) => (v || '').toString().toUpperCase().trim();

function windArrow(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

const normalizeBandKey = (band) => {
  if (band == null) return null;
  const raw = String(band).trim().toLowerCase();
  if (!raw || raw === 'other') return null;
  if (raw.endsWith('cm') || raw.endsWith('m')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
};

const bandFromAnyFrequency = (freq) => {
  if (freq == null || freq === '') return null;
  const n = parseFloat(freq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return normalizeBandKey(getBandFromFreq(n));
};

// ActivatePanel defaults
import { mapDefs as POTADefs } from './POTAPanel.jsx';
import { mapDefs as SOTADefs } from './SOTAPanel.jsx';
import { mapDefs as WWBOTADefs } from './WWBOTAPanel.jsx';
import { mapDefs as WWFFDefs } from './WWFFPanel.jsx';

const POPUP_AUTO_CLOSE_MS = 20_000;

export const WorldMap = ({
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,
  potaSpots,
  wwffSpots,
  sotaSpots,
  wwbotaSpots,
  dxPaths,
  dxFilters,
  mapBandFilter,
  onMapBandFilterChange,
  satellites,
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths,
  showDeDxMarkers = true,
  showDXLabels,
  onToggleDXLabels,
  showPOTA,
  showPOTALabels = true,
  showWWFF,
  showWWFFLabels = true,
  showSOTA,
  showSOTALabels = true,
  showWWBOTA,
  showWWBOTALabels = true,
  showPSKReporter,
  showPSKPaths = true,
  showMutualReception = true,
  showWSJTX,
  showAPRS,
  aprsStations,
  aprsWatchlistCalls,
  onSpotClick,
  hoveredSpot,
  callsign = 'N0CALL',
  showDXNews = true,
  hideOverlays,
  lowMemoryMode = false,
  allUnits = { dist: 'imperial', temp: 'imperial', press: 'imperial' },
  mouseZoom,
  showRotatorBearing = false,
  rotatorAzimuth = null,
  rotatorLastGoodAzimuth = null,
  rotatorIsStale = false,
  rotatorControlEnabled,
  onRotatorTurnRequest,
  onMapReady,
}) => {
  const { t, i18n } = useTranslation();
  const mapLang = i18n.language?.split('-')[0] || 'en'; // e.g. 'de', 'ja', 'en'
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const terminatorRef = useRef(null);
  const deMarkerRef = useRef([]);
  const dxMarkerRef = useRef([]);
  const sunMarkerRef = useRef([]);
  const moonMarkerRef = useRef([]);
  const potaMarkersRef = useRef([]);
  const wwffMarkersRef = useRef([]);
  const sotaMarkersRef = useRef([]);
  const wwbotaMarkersRef = useRef([]);
  const dxPathsLinesRef = useRef([]);
  const dxPathsMarkersRef = useRef([]);
  const pskMarkersRef = useRef([]);
  const wsjtxMarkersRef = useRef([]);
  const aprsMarkersRef = useRef([]);
  const countriesLayerRef = useRef([]);
  const dxLockedRef = useRef(dxLocked);
  const pinnedPopupRef = useRef({ marker: null, timer: null });
  const isTouchDeviceRef = useRef(
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0),
  );
  // Tracks which marker is waiting for a second tap on touch devices
  const touchPendingRef = useRef(null);
  const rotatorLineRef = useRef(null);
  const rotatorGlowRef = useRef(null);
  const rotatorTurnRef = useRef(onRotatorTurnRequest);
  const rotatorEnabledRef = useRef(rotatorControlEnabled);
  const deRef = useRef(deLocation);

  // Azimuthal overlay Leaflet map (from AzimuthalMap component)
  const azimuthalMapRef = useRef(null);
  const [azimuthalMapReady, setAzimuthalMapReady] = useState(false);

  // Unified spot-click handler — pointer devices pin popup + tune immediately;
  // touch devices require a second tap to tune (first tap pins the popup only).
  const bindSpotClick = useCallback((marker, onTune) => {
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      const pinned = pinnedPopupRef.current;

      if (isTouchDeviceRef.current) {
        if (touchPendingRef.current === marker) {
          // Second tap — tune rig and close popup
          if (pinned.marker) {
            pinned.marker.closePopup();
            clearTimeout(pinned.timer);
            pinned.marker = null;
            pinned.timer = null;
          }
          touchPendingRef.current = null;
          onTune();
        } else {
          // First tap — pin popup, wait for second tap
          if (pinned.marker) {
            pinned.marker.closePopup();
            clearTimeout(pinned.timer);
          }
          touchPendingRef.current = marker;
          pinned.marker = marker;
          marker.openPopup();
          pinned.timer = setTimeout(() => {
            marker.closePopup();
            pinned.marker = null;
            pinned.timer = null;
            if (touchPendingRef.current === marker) touchPendingRef.current = null;
          }, POPUP_AUTO_CLOSE_MS);
        }
      } else {
        // Pointer device — pin popup and tune immediately
        if (pinned.marker) {
          pinned.marker.closePopup();
          clearTimeout(pinned.timer);
        }
        pinned.marker = marker;
        marker.openPopup();
        pinned.timer = setTimeout(() => {
          marker.closePopup();
          pinned.marker = null;
          pinned.timer = null;
        }, POPUP_AUTO_CLOSE_MS);
        onTune();
      }
    });
  }, []);

  // On touch devices, visual spot markers are non-interactive; ghost markers with an
  // expanded hit area overlay them and handle all tap events.
  // realMarker + glowColor are optional — when supplied the ghost applies a glow to
  // the visual marker on popupopen and removes it on popupclose.
  const addTouchGhost = useCallback(
    (type, latlng, popupHtml, onTune, markersRef, realMarker, glowColor) => {
      if (!isTouchDeviceRef.current) return;
      const map = mapInstanceRef.current;
      if (!map) return;

      let ghost;
      if (type === 'circle') {
        ghost = L.circleMarker(latlng, {
          radius: 22,
          fillOpacity: 0,
          opacity: 0,
          interactive: true,
        });
      } else {
        ghost = L.marker(latlng, {
          icon: L.divIcon({
            className: '',
            html: '<div style="width:44px;height:44px;background:transparent;"></div>',
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
          interactive: true,
          zIndexOffset: 1000,
        });
      }

      // Apply glow to the real visual marker when the ghost's popup opens/closes
      if (realMarker && glowColor) {
        let glowRing = null;
        ghost.on('popupopen', () => {
          if (realMarker._path) {
            // SVG circleMarker — use a Leaflet glow ring
            glowRing = L.circleMarker(latlng, {
              radius: 16,
              fillColor: glowColor,
              color: glowColor,
              weight: 12,
              opacity: 0.3,
              fillOpacity: 0.2,
              interactive: false,
            }).addTo(map);
            markersRef.current.push(glowRing);
          } else if (realMarker._icon) {
            // divIcon — CSS drop-shadow filter
            realMarker._icon.style.filter = `drop-shadow(0 0 4px ${glowColor}) drop-shadow(0 0 10px ${glowColor}) drop-shadow(0 0 20px ${glowColor})`;
          }
        });
        ghost.on('popupclose', () => {
          if (glowRing) {
            try {
              map.removeLayer(glowRing);
            } catch (_) {}
            const idx = markersRef.current.indexOf(glowRing);
            if (idx !== -1) markersRef.current.splice(idx, 1);
            glowRing = null;
          }
          if (realMarker._icon) realMarker._icon.style.filter = '';
        });
      }

      ghost.bindPopup(popupHtml).addTo(map);
      if (onTune) bindSpotClick(ghost, onTune);
      markersRef.current.push(ghost);
    },
    [bindSpotClick],
  );

  // Attaches mouseover/mouseout popup + glow behaviour to any spot marker.
  // For SVG circleMarkers (this._path) a Leaflet glow ring is used; for divIcon
  // markers (this._icon) a CSS drop-shadow filter is applied instead.
  const bindHoverGlow = useCallback((marker, latlng, color, markersRef) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    let glowRing = null;
    marker
      .on('mouseover', function () {
        if (pinnedPopupRef.current.marker !== this) this.openPopup();
        if (this._path) {
          glowRing = L.circleMarker(latlng, {
            radius: 16,
            fillColor: color,
            color,
            weight: 12,
            opacity: 0.3,
            fillOpacity: 0.2,
            interactive: false,
          }).addTo(map);
          markersRef.current.push(glowRing);
        } else if (this._icon) {
          this._icon.style.filter = `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 10px ${color}) drop-shadow(0 0 20px ${color})`;
        }
      })
      .on('mouseout', function () {
        if (pinnedPopupRef.current.marker !== this) this.closePopup();
        if (glowRing) {
          map.removeLayer(glowRing);
          const idx = markersRef.current.indexOf(glowRing);
          if (idx !== -1) markersRef.current.splice(idx, 1);
          glowRing = null;
        }
        if (this._icon) this._icon.style.filter = '';
      });
  }, []);

  const handleAzimuthalMapReady = useCallback((map) => {
    azimuthalMapRef.current = map;
    setAzimuthalMapReady(!!map);
  }, []);

  // DX highlight state (style existing polylines via refs; no layer rebuilds)
  const dxLineIndexRef = useRef(new Map());
  const dxHighlightKeyRef = useRef('');

  // Calculate grid locator from DE location for plugins
  const deLocator = useMemo(() => {
    if (deLocation?.lat == null || deLocation?.lon == null) return '';
    return calculateGridSquare(deLocation.lat, deLocation.lon);
  }, [deLocation?.lat, deLocation?.lon]);

  const selectedMapBands = useMemo(() => {
    if (!Array.isArray(mapBandFilter)) return new Set();
    const normalized = mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean);
    return new Set(normalized);
  }, [mapBandFilter]);

  const hasMapBandFilter = selectedMapBands.size > 0;

  const bandPassesMapFilter = useCallback(
    (band) => {
      if (!hasMapBandFilter) return true;
      const key = normalizeBandKey(band);
      return !!key && selectedMapBands.has(key);
    },
    [hasMapBandFilter, selectedMapBands],
  );

  const writeMapBandFilter = useCallback(
    (bands) => {
      if (typeof onMapBandFilterChange !== 'function') return;
      const normalized = Array.from(new Set((bands || []).map((b) => normalizeBandKey(b)).filter(Boolean)));
      onMapBandFilterChange(normalized);
    },
    [onMapBandFilterChange],
  );

  const toggleMapBand = useCallback(
    (band) => {
      if (typeof onMapBandFilterChange !== 'function') return;
      const key = normalizeBandKey(band);
      if (!key) return;
      const next = new Set(selectedMapBands);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeMapBandFilter(Array.from(next));
    },
    [onMapBandFilterChange, selectedMapBands, writeMapBandFilter],
  );

  const clearMapBandFilter = useCallback(() => {
    writeMapBandFilter([]);
  }, [writeMapBandFilter]);

  // Expose DE location to window for plugins (e.g., RBN)
  useEffect(() => {
    if (deLocation?.lat != null && deLocation?.lon != null) {
      window.deLocation = {
        lat: deLocation.lat,
        lon: deLocation.lon,
      };
    }
    return () => {
      // Cleanup on unmount
      delete window.deLocation;
    };
  }, [deLocation?.lat, deLocation?.lon]);

  // Keep dxLockedRef in sync with prop
  useEffect(() => {
    dxLockedRef.current = dxLocked;
  }, [dxLocked]);

  useEffect(() => {
    const onBandColorsChange = () => {
      setBandColorOverrides(loadBandColorOverrides());
      setBandColorVersion((v) => v + 1);
    };
    window.addEventListener('openhamclock-band-colors-change', onBandColorsChange);
    return () => window.removeEventListener('openhamclock-band-colors-change', onBandColorsChange);
  }, []);

  // Plugin system refs and state
  const [pluginLayerStates, setPluginLayerStates] = useState({});
  const isLocalInstall = useLocalInstall();

  const [integrationsRev, setIntegrationsRev] = useState(0);

  // Re-evaluate feature-gated integrations when toggles change in Settings
  useEffect(() => {
    const bump = () => setIntegrationsRev((v) => v + 1);
    try {
      window.addEventListener('ohc-n3fjp-config-changed', bump);
      window.addEventListener('ohc-rotator-config-changed', bump);
      window.addEventListener('ohc-dx-weather-config-changed', bump);
    } catch {}
    return () => {
      try {
        window.removeEventListener('ohc-n3fjp-config-changed', bump);
        window.removeEventListener('ohc-rotator-config-changed', bump);
        window.removeEventListener('ohc-dx-weather-config-changed', bump);
      } catch {}
    };
  }, []);

  // Filter out localOnly layers on hosted version
  const getAvailableLayers = () => {
    // Reference integrationsRev so changes trigger a re-render pass.
    void integrationsRev;
    let n3fjpEnabled = false;
    try {
      n3fjpEnabled = localStorage.getItem('ohc_n3fjp_enabled') === '1';
    } catch {}

    return getAllLayers().filter((l) => {
      if (l.localOnly && !isLocalInstall) return false;
      // N3FJP is local-only + feature-gated (so hosted never shows it and local users must opt-in)
      if (l.id === 'n3fjp_logged_qsos' && !n3fjpEnabled) return false;
      return true;
    });
  };

  // --- DX Weather local-only gate ---
  const [dxWeatherEnabled, setDxWeatherEnabled] = useState(() => {
    try {
      return localStorage.getItem('ohc_dx_weather_enabled') === '1';
    } catch {
      return false;
    }
  });
  const dxWeatherAllowed = isLocalInstall && dxWeatherEnabled;
  const dxWeatherAllowedRef = useRef(dxWeatherAllowed);
  useEffect(() => {
    dxWeatherAllowedRef.current = !!dxWeatherAllowed;
  }, [dxWeatherAllowed]);

  // Sync DX weather toggle when config changes
  useEffect(() => {
    const sync = () => {
      try {
        setDxWeatherEnabled(localStorage.getItem('ohc_dx_weather_enabled') === '1');
      } catch {}
    };
    window.addEventListener('ohc-dx-weather-config-changed', sync);
    return () => window.removeEventListener('ohc-dx-weather-config-changed', sync);
  }, []);

  // --- Weather cache for popup injection ---
  const wxCacheRef = useRef(new Map());
  const WX_TTL_MS = 10 * 60 * 1000;

  const withTimeout = (p, ms = 7000) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`WX timeout after ${ms}ms`)), ms))]);

  const getWxCached = async (lat, lon) => {
    if (!dxWeatherAllowedRef.current) throw new Error('DX weather disabled');
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const now = Date.now();
    const hit = wxCacheRef.current.get(key);
    if (hit && now - hit.t < WX_TTL_MS) return hit.wx;
    const wx = await withTimeout(getCallsignWeather(lat, lon), 7000);
    wxCacheRef.current.set(key, { t: now, wx });
    return wx;
  };

  const fmtWxHtml = (wx) => {
    if (!wx?.current) return `<div style="margin-top:6px;color:#888">Weather unavailable</div>`;
    const c = wx.current;
    let temp = c.temperature_2m;
    let wind = c.wind_speed_10m;
    const windDir = c.wind_direction_10m;
    const humidity = c.relative_humidity_2m;
    const pressure = c.pressure_msl;
    const precipProb = wx?.hourly?.precipitation_probability?.[0];
    if (allUnits.temp === 'imperial') {
      temp = (temp * 9) / 5 + 32;
    }
    if (allUnits.dist === 'imperial') {
      wind = wind * 0.621371;
    }
    return `
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12)">
        <div style="font-weight:800;margin-bottom:4px">Weather</div>
        <div style="display:flex;flex-direction:column;gap:3px;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:12px">
          <div style="display:flex;align-items:center;gap:8px"><span style="width:18px;text-align:center">🌡</span><span>${Math.round(temp)}°${allUnits.temp === 'imperial' ? 'F' : 'C'}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="width:18px;text-align:center">💨</span><span>${Math.round(wind)} ${allUnits.dist === 'imperial' ? 'mph' : 'km/h'} ${windArrow(windDir)}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="width:18px;text-align:center">💧</span><span>${humidity != null ? `${Math.round(humidity)}%` : '—'}</span><span style="width:18px;text-align:center;margin-left:6px">🧭</span><span>${pressure != null ? `${Math.round(pressure)} hPa` : '—'}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="width:18px;text-align:center">🌧</span><span>${precipProb != null ? `${Math.round(precipProb)}%` : '—'}</span></div>
        </div>
      </div>`;
  };

  const attachPopupWeather = (layer, lat, lon, baseHtml) => {
    layer.bindPopup(baseHtml);
    layer.on('popupopen', async (e) => {
      const target = e?.target || layer;
      if (!dxWeatherAllowedRef.current) {
        target.setPopupContent(
          baseHtml +
            `<div style="margin-top:6px;color:#888;line-height:1.2;">Enable DX Weather<br/><span style="opacity:0.85;">(Local mode)</span></div>`,
        );
        return;
      }
      target.setPopupContent(baseHtml + `<div style="margin-top:6px;color:#888">Weather: loading...</div>`);
      try {
        const wx = await getWxCached(lat, lon);
        target.setPopupContent(baseHtml + fmtWxHtml(wx));
      } catch {
        target.setPopupContent(baseHtml + `<div style="margin-top:6px;color:#888">Weather unavailable</div>`);
      }
    });
  };

  // Load map style from localStorage
  const getStoredMapSettings = () => {
    try {
      const stored = localStorage.getItem('openhamclock_mapSettings');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  };
  const storedSettings = getStoredMapSettings();

  // Migration: saved isAzimuthal → split into projection + style
  // Also validate that saved mapStyle still exists in MAP_STYLES to prevent stale references
  const migratedStyle = storedSettings.isAzimuthal ? 'dark' : storedSettings.mapStyle || 'dark';
  // Validate style exists and isn't the legacy 'azimuthal' canvas entry
  const initialStyle = MAP_STYLES[migratedStyle] && !MAP_STYLES[migratedStyle].legacy ? migratedStyle : 'dark';
  const initialProjection = storedSettings.isAzimuthal ? 'azimuthal' : storedSettings.mapProjection || 'mercator';
  const [mapStyle, setMapStyle] = useState(initialStyle);
  const [mapProjection, setMapProjection] = useState(initialProjection);
  const isAzimuthal = mapProjection === 'azimuthal';
  const [bandColorVersion, setBandColorVersion] = useState(0);
  const [editingBand, setEditingBand] = useState(null);
  const [editingColor, setEditingColor] = useState('#ff6666');
  const [bandColorOverrides, setBandColorOverrides] = useState(() => loadBandColorOverrides());
  // Tracks whether window.L (Leaflet, loaded via <script> in index.html) is ready.
  // Leaflet is NOT bundled by Vite — it's a self-hosted vendor file. If it hasn't
  // loaded by the time this component mounts, we poll and flip this flag to retry.
  const [leafletReady, setLeafletReady] = useState(() => typeof window.L !== 'undefined');
  const effectiveBandColors = useMemo(() => getEffectiveBandColors(bandColorOverrides), [bandColorOverrides]);

  const getScaledZoomLevel = (inverseMultiplier) => {
    // Ensure the input stays within 1–100
    const clamped = Math.min(Math.max(inverseMultiplier, 1), 100);

    // Normalize the input value
    const normalized = (100 - clamped) / 99;

    // Scale to range 50–250. Leaflet's default is 60. Smaller numbers zoom faster.
    return Math.round(50 + normalized * 200);
  };

  // GIBS MODIS CODE
  const [gibsOffset, setGibsOffset] = useState(0);

  // Night overlay darkness (0-100 → fillOpacity 0.0-1.0)
  const [nightDarkness, setNightDarkness] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_nightDarkness')) || 60;
    } catch {
      return 60;
    }
  });

  const getGibsUrl = (days) => {
    const date = new Date(Date.now() - (days * 24 + 12) * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  };
  // End GIBS MODIS CODE

  const [mapView, setMapView] = useState({
    center: storedSettings.center || [20, 0],
    zoom: storedSettings.zoom || 2.5,
  });

  // Map lock — prevents accidental panning/zooming (useful on touch devices)
  const [mapLocked, setMapLocked] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_mapLocked') === 'true';
    } catch {
      return false;
    }
  });

  const [mapUiHidden, setMapUiHidden] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_mapUiHidden') === 'true';
    } catch {
      return false;
    }
  });

  // Legend visibility toggle (persisted)
  const [showLegend, setShowLegend] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_showLegend') !== 'false';
    } catch {
      return true;
    }
  });
  const toggleLegend = useCallback(() => {
    setShowLegend((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('openhamclock_showLegend', String(next));
      } catch {}
      return next;
    });
  }, []);

  const destinationPoint = (latDeg, lonDeg, bearingDeg, distanceDeg) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;

    const φ1 = toRad(latDeg);
    const λ1 = toRad(lonDeg);
    const θ = toRad(bearingDeg);
    const δ = toRad(distanceDeg);

    const sinφ1 = Math.sin(φ1),
      cosφ1 = Math.cos(φ1);
    const sinδ = Math.sin(δ),
      cosδ = Math.cos(δ);

    const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);

    const y = Math.sin(θ) * sinδ * cosφ1;
    const x = cosδ - sinφ1 * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    let lon2 = ((toDeg(λ2) + 540) % 360) - 180;
    let lat2 = toDeg(φ2);

    return { lat: lat2, lon: lon2 };
  };

  const buildBearingPoints = (lat, lon, azDeg, maxDeg = 90, stepDeg = 2) => {
    const pts = [];
    for (let d = 0; d <= maxDeg; d += stepDeg) {
      const p = destinationPoint(lat, lon, azDeg, d);
      pts.push([p.lat, p.lon]);
    }
    return pts;
  };

  const initialBearingDeg = (lat1, lon1, lat2, lon2) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;

    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    return (toDeg(θ) + 360) % 360;
  };

  useEffect(() => {
    rotatorTurnRef.current = onRotatorTurnRequest;
  }, [onRotatorTurnRequest]);

  useEffect(() => {
    rotatorEnabledRef.current = rotatorControlEnabled;
  }, [rotatorControlEnabled]);

  useEffect(() => {
    deRef.current = deLocation;
  }, [deLocation]);

  // Save map settings to localStorage when changed (merge, don't overwrite)
  useEffect(() => {
    try {
      const existing = getStoredMapSettings();
      localStorage.setItem(
        'openhamclock_mapSettings',
        JSON.stringify({
          ...existing,
          mapStyle,
          mapProjection,
          center: mapView.center,
          zoom: mapView.zoom,
          wheelPxPerZoomLevel: getScaledZoomLevel(mouseZoom),
        }),
      );
    } catch (e) {
      console.error('Failed to save map settings:', e);
    }
  }, [mapStyle, mapProjection, mapView, mouseZoom]);

  // Initialize map
  useEffect(() => {
    // If map is already initialized, don't do it again
    if (!mapRef.current || mapInstanceRef.current) return;

    // Leaflet is loaded via a <script> tag in index.html (self-hosted vendor file).
    // On slow connections or if the file 404s, window.L may not be ready yet.
    // Poll for up to 5 seconds before giving up with an actionable error.
    if (typeof window.L === 'undefined') {
      let attempts = 0;
      const maxAttempts = 50; // 50 × 100ms = 5 seconds
      const poll = setInterval(() => {
        attempts++;
        if (typeof window.L !== 'undefined') {
          clearInterval(poll);
          setLeafletReady(true); // triggers a re-render → re-runs this effect with L defined
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          console.error(
            'Leaflet failed to load after 5s. ' +
              'Check that /vendor/leaflet/leaflet.js is accessible. ' +
              'Run: bash scripts/vendor-download.sh',
          );
        }
      }, 100);
      return () => clearInterval(poll);
    }

    const L = window.L;

    const map = L.map(mapRef.current, {
      center: mapView.center,
      zoom: mapView.zoom,
      minZoom: 1,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: false,
      zoomSnap: 0.1,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: getScaledZoomLevel(mouseZoom),
      maxBounds: [
        [-90, -Infinity],
        [90, Infinity],
      ],
      maxBoundsViscosity: 0.8,
    });

    // --- night pane ---
    map.createPane('nightPane');
    const nightPane = map.getPane('nightPane');
    nightPane.style.zIndex = 650;
    nightPane.style.pointerEvents = 'none';
    nightPane.id = 'night-lights-pane';

    // Initial tile layer (Base Day Map)
    tileLayerRef.current = L.tileLayer(MAP_STYLES[mapStyle].url.replace('{lang}', mapLang), {
      attribution: MAP_STYLES[mapStyle].attribution,
      noWrap: false,
      crossOrigin: 'anonymous',
    }).addTo(map);

    // Day/night terminator
    terminatorRef.current = createTerminator({
      resolution: 2,
      fillOpacity: nightDarkness / 100,
      fillColor: '#000010',
      color: '#ffaa00',
      weight: 2,
      dashArray: '5, 5',
      wrap: false,
    }).addTo(map);

    // Refresh terminator immediately to set initial position
    setTimeout(() => {
      if (terminatorRef.current) {
        terminatorRef.current.setTime();
        const path = terminatorRef.current.getElement();
        if (path) {
          path.classList.add('terminator-path');
        }
      }
    }, 100);

    const terminatorInterval = setInterval(() => {
      if (terminatorRef.current) {
        terminatorRef.current.setTime();
        const path = terminatorRef.current.getElement();
        if (path) {
          path.classList.add('terminator-path');
        }
      }
    }, 60000);

    map.on('moveend', () => {
      try {
        const center = map.getCenter();
        const zoom = map.getZoom();
        setMapView({ center: [center.lat, center.lng], zoom });
      } catch {
        // Leaflet may throw if map panes are gone during resize/unmount
      }
    });

    // Click handler:
    // - Shift+click => turn rotator toward clicked point (if enabled)
    // - Normal click => set DX (only if not locked)
    map.on('click', (e) => {
      // Normalize longitude to -180..180
      let lon = e.latlng.lng;
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;

      const oe = e?.originalEvent;
      const isShift = !!oe?.shiftKey || (typeof oe?.getModifierState === 'function' && oe.getModifierState('Shift'));

      // SHIFT+click => turn rotator (do NOT move DX)
      if (isShift && rotatorEnabledRef.current && typeof rotatorTurnRef.current === 'function') {
        const de = deRef.current;
        if (de?.lat != null && de?.lon != null) {
          const az = initialBearingDeg(de.lat, de.lon, e.latlng.lat, lon);
          // Never allow an async failure here to create an unhandled rejection.
          Promise.resolve(rotatorTurnRef.current(az)).catch(() => {});
          return;
        }
      }

      // Normal click => move DX (only if not locked)
      if (onDXChange && !dxLockedRef.current) {
        onDXChange({ lat: e.latlng.lat, lon });
      }
    });

    mapInstanceRef.current = map;
    if (onMapReady) onMapReady(map);

    // Apply initial map lock state if saved
    if (mapLocked) {
      [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard].forEach(
        (h) => {
          if (h) h.disable();
        },
      );
    }
    if (mapUiHidden) {
      const controlContainer = map._controlContainer;
      if (controlContainer) controlContainer.style.display = 'none';
      const zc = map.zoomControl?.getContainer();
      if (zc) zc.style.display = 'none';
    }

    const resizeObserver = new ResizeObserver(() => {
      try {
        if (mapInstanceRef.current && mapRef.current && mapRef.current.isConnected) {
          mapInstanceRef.current.invalidateSize();
        }
      } catch {
        // Leaflet may throw if the container was removed mid-resize
      }
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      clearInterval(terminatorInterval);
      resizeObserver.disconnect();
      mapInstanceRef.current = null;
      try {
        map.remove();
      } catch {
        // Leaflet may throw during teardown if DOM was already removed
      }
    };
  }, [leafletReady]); // leafletReady flips to true once window.L is confirmed available

  // Unpin a pinned spot popup when the user clicks anywhere on the map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const handleMapClick = () => {
      touchPendingRef.current = null;
      const pinned = pinnedPopupRef.current;
      if (pinned.marker) {
        pinned.marker.closePopup();
        clearTimeout(pinned.timer);
        pinned.marker = null;
        pinned.timer = null;
      }
    };
    map.on('click', handleMapClick);
    return () => map.off('click', handleMapClick);
  }, [leafletReady]);

  // Update the value for how many scroll pixels count as a zoom level
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.options.wheelPxPerZoomLevel = getScaledZoomLevel(mouseZoom);
  }, [mouseZoom]);

  // Apply map lock — disable all navigation interactions while keeping click-through
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handlers = [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard];

    handlers.forEach((h) => {
      if (h) mapLocked ? h.disable() : h.enable();
    });

    // Hide/show zoom control
    const zoomControl = map.zoomControl;
    if (zoomControl) {
      const el = zoomControl.getContainer();
      if (el) el.style.display = mapLocked ? 'none' : '';
    }

    // Persist to localStorage
    try {
      localStorage.setItem('openhamclock_mapLocked', mapLocked ? 'true' : 'false');
    } catch {}
  }, [mapLocked]);

  // Persist global map UI visibility toggle
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapUiHidden', mapUiHidden ? 'true' : 'false');
    } catch {}
  }, [mapUiHidden]);

  // Hide/show Leaflet controls and plugin widgets created outside React
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const display = mapUiHidden ? 'none' : '';
    const controlContainer = map._controlContainer;
    if (controlContainer) controlContainer.style.display = display;

    const externalWidgetSelectors = [
      '.grayline-control',
      '.muf-map-control',
      '.voacap-heatmap-control',
      '.rbn-control',
      '.lightning-stats',
      '.lightning-proximity',
      '.wspr-filter-control',
      '.wspr-stats',
      '.wspr-legend',
      '.wspr-chart',
    ];
    externalWidgetSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = display;
      });
    });
  }, [mapUiHidden, pluginLayerStates]);

  // Update tile layer and handle night light clipping
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old tile layer completely — setUrl() doesn't flush the tile cache,
    // leaving stale "Map data not yet available" tiles visible until zoom/pan.
    map.removeLayer(tileLayerRef.current);

    // Determine the URL: Use the dynamic GIBS generator if 'MODIS' is selected
    let url = MAP_STYLES[mapStyle].url.replace('{lang}', mapLang);
    if (mapStyle === 'MODIS') {
      url = getGibsUrl(gibsOffset);
    }

    // Create fresh tile layer with correct attribution and options
    tileLayerRef.current = L.tileLayer(url, {
      attribution: MAP_STYLES[mapStyle].attribution,
      noWrap: false,
      crossOrigin: 'anonymous',
      // NASA GIBS tiles only cover -180..180; other tile providers wrap naturally
      ...(mapStyle === 'MODIS'
        ? {
            bounds: [
              [-85, -180],
              [85, 180],
            ],
          }
        : {}),
    }).addTo(map);

    // 3. Terminator Shadow (Gray Line) Set Color to transparent to hide terminator vertical lines at 180° and -180°
    if (terminatorRef.current) {
      terminatorRef.current.setStyle({
        fillOpacity: nightDarkness / 100,
        fillColor: '#000008',
        color: 'transparent',
        weight: 2,
      });

      if (typeof terminatorRef.current.bringToFront === 'function') {
        terminatorRef.current.bringToFront();
      }
    }

    // If you have a countries overlay, ensure it stays visible
    if (countriesLayerRef.current?.length) {
      countriesLayerRef.current.forEach((l) => {
        try {
          l.bringToFront();
        } catch (e) {}
      });
    }

    // 4. Handle Clipping Mask
    const updateMask = () => {
      const nightPane = document.getElementById('night-lights-pane');
      const terminatorPath = document.querySelector('.terminator-path');

      if (nightPane && terminatorPath) {
        const pathData = terminatorPath.getAttribute('d');
        if (pathData) {
          nightPane.style.clipPath = `path('${pathData}')`;
          nightPane.style.webkitClipPath = `path('${pathData}')`;
        }
      }
    };

    updateMask();
    const maskInterval = setInterval(updateMask, 3000);

    return () => clearInterval(maskInterval);
  }, [mapStyle, gibsOffset]);

  // Live-update night overlay darkness when slider changes
  useEffect(() => {
    if (terminatorRef.current) {
      terminatorRef.current.setStyle({ fillOpacity: nightDarkness / 100 });
    }
    try {
      localStorage.setItem('ohc_nightDarkness', String(nightDarkness));
    } catch {}
  }, [nightDarkness]);

  // End code dynamic GIBS generator if 'MODIS' is selected

  // Countries overlay for "Countries" map style
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove existing countries layers (all world copies)
    countriesLayerRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    countriesLayerRef.current = [];

    // Only add overlay for countries style
    if (!MAP_STYLES[mapStyle]?.countriesOverlay) return;

    // Bright distinct colors for countries (designed for maximum contrast between neighbors)
    const COLORS = [
      '#e6194b',
      '#3cb44b',
      '#4363d8',
      '#f58231',
      '#911eb4',
      '#42d4f4',
      '#f032e6',
      '#bfef45',
      '#fabed4',
      '#469990',
      '#dcbeff',
      '#9A6324',
      '#800000',
      '#aaffc3',
      '#808000',
      '#000075',
      '#e6beff',
      '#ff6961',
      '#77dd77',
      '#fdfd96',
      '#84b6f4',
      '#fdcae1',
      '#c1e1c1',
      '#b39eb5',
      '#ffb347',
    ];

    // Simple string hash for consistent color assignment
    const hashColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return COLORS[Math.abs(hash) % COLORS.length];
    };

    // Deep-shift all coordinates in a GeoJSON geometry by a longitude offset
    const shiftCoords = (coords, offset) => {
      if (typeof coords[0] === 'number') {
        // [lon, lat] point
        return [coords[0] + offset, coords[1]];
      }
      return coords.map((c) => shiftCoords(c, offset));
    };

    const shiftGeoJSON = (geojson, offset) => {
      if (offset === 0) return geojson;
      return {
        ...geojson,
        features: geojson.features.map((f) => ({
          ...f,
          geometry: {
            ...f.geometry,
            coordinates: shiftCoords(f.geometry.coordinates, offset),
          },
        })),
      };
    };

    // Fetch world countries GeoJSON (Natural Earth 110m simplified, ~240KB)
    fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((geojson) => {
        if (!mapInstanceRef.current) return;

        const styleFunc = (feature) => {
          const name = feature.properties?.name || feature.id || 'Unknown';
          return {
            fillColor: hashColor(name),
            fillOpacity: 0.65,
            color: '#fff',
            weight: 1,
            opacity: 0.8,
          };
        };

        // Create 3 world copies: left (-360), center (0), right (+360)
        for (const offset of [-360, 0, 360]) {
          const shifted = shiftGeoJSON(geojson, offset);
          const layer = L.geoJSON(shifted, {
            style: styleFunc,
            // Only add tooltips to center copy to avoid duplicates
            onEachFeature:
              offset === 0
                ? (feature, layer) => {
                    const name = feature.properties?.name || 'Unknown';
                    layer.bindTooltip(name, {
                      sticky: true,
                      className: 'country-tooltip',
                      direction: 'top',
                      offset: [0, -5],
                    });
                  }
                : undefined,
          }).addTo(map);

          countriesLayerRef.current.push(layer);
        }

        // Ensure countries layers are below markers but above tiles
        countriesLayerRef.current.forEach((l) => l.bringToBack());
        // Put tile layer behind countries
        if (tileLayerRef.current) tileLayerRef.current.bringToBack();
        // Terminator on top
        if (terminatorRef.current) terminatorRef.current.bringToFront();
      })
      .catch((err) => {
        console.warn('Could not load countries GeoJSON:', err);
      });

    return () => {
      try {
        if (rotatorLineRef.current) {
          map.removeLayer(rotatorLineRef.current);
          rotatorLineRef.current = null;
        }
        if (rotatorGlowRef.current) {
          map.removeLayer(rotatorGlowRef.current);
          rotatorGlowRef.current = null;
        }
      } catch {}
    };
  }, [mapStyle]);

  // Update DE/DX markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old markers
    deMarkerRef.current.forEach((m) => map.removeLayer(m));
    deMarkerRef.current = [];
    dxMarkerRef.current.forEach((m) => map.removeLayer(m));
    dxMarkerRef.current = [];

    if (!showDeDxMarkers) return;

    // DE Marker — replicate across world copies
    replicatePoint(deLocation.lat, deLocation.lon).forEach(([lat, lon]) => {
      const deIcon = L.divIcon({
        className: 'custom-marker de-marker',
        html: 'DE',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const html = `<b>DE - Your Location</b><br>${esc(calculateGridSquare(deLocation.lat, deLocation.lon))}<br>${deLocation.lat.toFixed(4)}°, ${deLocation.lon.toFixed(4)}°`;
      const m = L.marker([lat, lon], { icon: deIcon, zIndexOffset: 20000 }).addTo(map);
      attachPopupWeather(m, lat, lon, html);
      deMarkerRef.current.push(m);
    });

    // DX Marker — replicate across world copies
    replicatePoint(dxLocation.lat, dxLocation.lon).forEach(([lat, lon]) => {
      const dxIcon = L.divIcon({
        className: 'custom-marker dx-marker',
        html: 'DX',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const baseHtml = `<b>DX - Target</b><br>${esc(calculateGridSquare(dxLocation.lat, dxLocation.lon))}<br>${dxLocation.lat.toFixed(4)}°, ${dxLocation.lon.toFixed(4)}°`;
      const m = L.marker([lat, lon], { icon: dxIcon, zIndexOffset: 19000 }).addTo(map);
      attachPopupWeather(m, lat, lon, baseHtml);
      dxMarkerRef.current.push(m);
    });
  }, [deLocation, dxLocation, allUnits, dxWeatherAllowed, showDeDxMarkers]);

  // Update sun/moon markers every 60 seconds (matches terminator refresh)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const updateCelestial = () => {
      // Remove previous markers
      sunMarkerRef.current.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch (e) {}
      });
      moonMarkerRef.current.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch (e) {}
      });
      sunMarkerRef.current = [];
      moonMarkerRef.current = [];

      const now = new Date();
      // World copy offsets so sun/moon appear on all visible map copies
      const worldOffsets = [-360, 0, 360];

      // Sun marker — SVG sun with rays
      const sunPos = getSunPosition(now);
      const sunSvg = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="sg"><stop offset="0%" stop-color="#fff8a0"/><stop offset="50%" stop-color="#ffdd00"/><stop offset="100%" stop-color="#ff9900"/></radialGradient></defs>
        <g stroke="#ffaa00" stroke-width="1.5" stroke-linecap="round">
          <line x1="14" y1="1" x2="14" y2="5"/><line x1="14" y1="23" x2="14" y2="27"/>
          <line x1="1" y1="14" x2="5" y2="14"/><line x1="23" y1="14" x2="27" y2="14"/>
          <line x1="4.8" y1="4.8" x2="7.6" y2="7.6"/><line x1="20.4" y1="20.4" x2="23.2" y2="23.2"/>
          <line x1="23.2" y1="4.8" x2="20.4" y2="7.6"/><line x1="4.8" y1="23.2" x2="7.6" y2="20.4"/>
        </g>
        <circle cx="14" cy="14" r="7" fill="url(#sg)" stroke="#ffaa00" stroke-width="1"/>
      </svg>`;
      for (const offset of worldOffsets) {
        const sunIcon = L.divIcon({
          className: 'sun-marker-icon',
          html: sunSvg,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const m = L.marker([sunPos.lat, sunPos.lon + offset], { icon: sunIcon })
          .bindPopup(`<b>Subsolar Point</b><br>${sunPos.lat.toFixed(2)}°, ${sunPos.lon.toFixed(2)}°`)
          .addTo(map);
        sunMarkerRef.current.push(m);
      }

      // Moon marker — SVG crescent moon
      const moonPos = getMoonPosition(now);
      const moonSvg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="mg" cx="40%" cy="40%"><stop offset="0%" stop-color="#f0f0ff"/><stop offset="100%" stop-color="#b0b0cc"/></radialGradient></defs>
        <circle cx="12" cy="12" r="9" fill="url(#mg)" stroke="#aaaacc" stroke-width="1"/>
        <circle cx="16" cy="10" r="7" fill="rgba(0,0,20,0.85)"/>
      </svg>`;
      for (const offset of worldOffsets) {
        const moonIcon = L.divIcon({
          className: 'moon-marker-icon',
          html: moonSvg,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const m = L.marker([moonPos.lat, moonPos.lon + offset], { icon: moonIcon })
          .bindPopup(`<b>Sublunar Point</b><br>${moonPos.lat.toFixed(2)}°, ${moonPos.lon.toFixed(2)}°`)
          .addTo(map);
        moonMarkerRef.current.push(m);
      }
    };

    // Initial render
    updateCelestial();

    // Update every 60 seconds to match terminator
    const interval = setInterval(updateCelestial, 60000);
    return () => {
      clearInterval(interval);
      sunMarkerRef.current.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch (e) {}
      });
      moonMarkerRef.current.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch (e) {}
      });
    };
  }, []);

  // Update DX paths
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old DX paths
    dxPathsLinesRef.current.forEach((l) => map.removeLayer(l));
    dxPathsLinesRef.current = [];
    dxPathsMarkersRef.current.forEach((m) => map.removeLayer(m));
    dxPathsMarkersRef.current = [];

    // Add new DX paths if enabled
    if (showDXPaths && dxPaths && dxPaths.length > 0) {
      const filteredPaths = filterDXPaths(dxPaths, dxFilters);

      filteredPaths.forEach((path) => {
        const dxCall = String(path.dxCall || '').trim();
        if (!dxCall) return;
        const band = bandFromAnyFrequency(path.freq);
        if (!bandPassesMapFilter(band)) return;

        try {
          if (
            !Number.isFinite(path.spotterLat) ||
            !Number.isFinite(path.spotterLon) ||
            !Number.isFinite(path.dxLat) ||
            !Number.isFinite(path.dxLon)
          )
            return;

          const pathPoints = getGreatCirclePoints(path.spotterLat, path.spotterLon, path.dxLat, path.dxLon);

          if (!pathPoints || !Array.isArray(pathPoints) || pathPoints.length === 0) return;

          const freq = parseFloat(path.freq);
          const color = getBandColor(freq);

          const isHovered = hoveredSpot && hoveredSpot.call?.toUpperCase() === path.dxCall?.toUpperCase();

          // Render polyline on all 3 world copies so it's visible across the dateline
          replicatePath(pathPoints).forEach((copy) => {
            const line = L.polyline(copy, {
              color: isHovered ? '#ffffff' : color,
              weight: isHovered ? 4 : 1.5,
              opacity: isHovered ? 1 : 0.5,
            }).addTo(map);
            if (isHovered) line.bringToFront();
            dxPathsLinesRef.current.push(line);
          });

          // Render circleMarker on all 3 world copies
          const dxPopupHtml = `<b data-qrz-call="${esc(dxCall)}" style="color: ${color}; cursor:pointer">${esc(dxCall)}</b><br>${esc(path.freq)} MHz<br>by <span data-qrz-call="${esc(path.spotter)}" style="cursor:pointer">${esc(path.spotter)}</span>`;
          replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
            const dxCircle = L.circleMarker([lat, lon], {
              radius: isHovered ? 12 : 6,
              fillColor: isHovered ? '#ffffff' : color,
              color: isHovered ? color : '#fff',
              weight: isHovered ? 3 : 1.5,
              opacity: 1,
              fillOpacity: isHovered ? 1 : 0.9,
              interactive: !isTouchDeviceRef.current,
            })
              .bindPopup(dxPopupHtml)
              .addTo(map);

            bindHoverGlow(dxCircle, [lat, lon], color, dxPathsMarkersRef);

            if (onSpotClick) {
              if (!isTouchDeviceRef.current) {
                bindSpotClick(dxCircle, () => onSpotClick(path));
              } else {
                addTouchGhost(
                  'circle',
                  [lat, lon],
                  dxPopupHtml,
                  () => onSpotClick(path),
                  dxPathsMarkersRef,
                  dxCircle,
                  color,
                );
              }
            }

            if (isHovered) dxCircle.bringToFront();
            dxPathsMarkersRef.current.push(dxCircle);
          });

          // Add label if enabled — replicate across world copies
          if (showDXLabels || isHovered) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:${isHovered ? '#fff' : color};color:${isHovered ? color : '#000'};padding:${isHovered ? '3px 6px' : '2px 5px'};border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:${isHovered ? '12px' : '11px'};font-weight:700;white-space:nowrap;border:1px solid ${isHovered ? color : 'rgba(0,0,0,0.5)'};box-shadow:0 1px ${isHovered ? '4px' : '2px'} rgba(0,0,0,${isHovered ? '0.5' : '0.3'});line-height:1.1;">${esc(dxCall)}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });
            replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: !isTouchDeviceRef.current,
                zIndexOffset: isHovered ? 10000 : 0,
              })
                .bindPopup(dxPopupHtml)
                .addTo(map);

              bindHoverGlow(label, [lat, lon], color, dxPathsMarkersRef);

              if (onSpotClick) {
                if (!isTouchDeviceRef.current) {
                  bindSpotClick(label, () => onSpotClick(path));
                } else {
                  addTouchGhost(
                    'icon',
                    [lat, lon],
                    dxPopupHtml,
                    () => onSpotClick(path),
                    dxPathsMarkersRef,
                    label,
                    color,
                  );
                }
              }

              dxPathsMarkersRef.current.push(label);
            });
          }
        } catch (err) {
          console.error('Error rendering DX path:', err);
        }
      });
    }
  }, [dxPaths, dxFilters, showDXPaths, showDXLabels, hoveredSpot, bandColorVersion, bandPassesMapFilter]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof L === 'undefined') return;

    const lat = deLocation?.lat;
    const lon = deLocation?.lon;

    const aRaw = rotatorAzimuth ?? rotatorLastGoodAzimuth;
    const az = Number.isFinite(aRaw) ? ((aRaw % 360) + 360) % 360 : null;

    // If disabled or no DE/azimuth, remove layer if it exists
    if (!showRotatorBearing || !Number.isFinite(lat) || !Number.isFinite(lon) || az == null) {
      if (rotatorLineRef.current) {
        map.removeLayer(rotatorLineRef.current);
        rotatorLineRef.current = null;
      }
      if (rotatorGlowRef.current) {
        map.removeLayer(rotatorGlowRef.current);
        rotatorGlowRef.current = null;
      }
      return;
    }

    let points = buildBearingPoints(lat, lon, az, 95, 2);
    points = unwrapLonPath(points);

    // Create if missing
    if (!rotatorGlowRef.current) {
      rotatorGlowRef.current = L.polyline(points, {
        color: 'rgba(0,255,255,0.20)',
        weight: 8,
        opacity: 1,
        dashArray: '10 10',
        className: 'ohc-rotator-bearing-glow',
        interactive: false,
      }).addTo(map);
    } else {
      rotatorGlowRef.current.setLatLngs(points);
    }

    if (!rotatorLineRef.current) {
      rotatorLineRef.current = L.polyline(points, {
        color: 'rgba(0,255,255,0.78)',
        weight: 2.4,
        opacity: rotatorIsStale ? 0.55 : 1,
        dashArray: '10 10',
        className: 'ohc-rotator-bearing',
        interactive: false,
      }).addTo(map);
    } else {
      rotatorLineRef.current.setLatLngs(points);
      rotatorLineRef.current.setStyle({ opacity: rotatorIsStale ? 0.55 : 1 });
    }
  }, [showRotatorBearing, deLocation?.lat, deLocation?.lon, rotatorAzimuth, rotatorLastGoodAzimuth, rotatorIsStale]);

  const unwrapLonPath = (latlngs) => {
    if (!Array.isArray(latlngs) || latlngs.length < 2) return latlngs;

    const out = [];
    let prevLon = latlngs[0][1];
    out.push(latlngs[0]);

    for (let i = 1; i < latlngs.length; i++) {
      const [lat, lon] = latlngs[i];
      let adjLon = lon;

      // shift lon by +/- 360 to minimize jump from previous
      while (adjLon - prevLon > 180) adjLon -= 360;
      while (adjLon - prevLon < -180) adjLon += 360;

      out.push([lat, adjLon]);
      prevLon = adjLon;
    }
    return out;
  };

  function placeSpots(mapDefaults, spots, show, showLabels, markersRef) {
    // common code to place spots for ActivatePanel type spots
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    if (show && spots) {
      spots.forEach((spot) => {
        if (Number.isFinite(spot.lat) && Number.isFinite(spot.lon)) {
          const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
          if (!bandPassesMapFilter(band)) return;

          const grid = spot.grid6 ? spot.grid6 : spot.grid ? spot.grid : null;
          const spotPopupHtml = `<span style="color:${mapDefaults.color};background:#000">
                    ${mapDefaults.shape} ${mapDefaults.name} - </span>
                  <b data-qrz-call="${esc(spot.call)}" style="color:${mapDefaults.color}; cursor:pointer">${esc(spot.call)}</b><br/>
                  ${grid ? `${esc(grid)}<br/>` : ''}
                  <span style="color:#888">${esc(spot.ref)}</span> ${esc(spot.locationDesc || '')}<br/>
                  ${spot.name ? `<i>${esc(spot.name)}</i><br/>` : ''}${esc(spot.freq)} ${esc(spot.mode || '')} <span style="color:#888">${esc(spot.time || '')}</span>
                  ${spot.comments?.length > 0 ? `<br/><i>(${esc(spot.comments)})</i>` : ''}`;

          replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
            const marker = L.marker([lat, lon], { icon: mapDefaults.icon, interactive: !isTouchDeviceRef.current })
              .bindPopup(spotPopupHtml)
              .addTo(map);

            bindHoverGlow(marker, [lat, lon], mapDefaults.color, markersRef);

            if (onSpotClick) {
              if (!isTouchDeviceRef.current) {
                bindSpotClick(marker, () => onSpotClick(spot));
              } else {
                addTouchGhost(
                  'icon',
                  [lat, lon],
                  spotPopupHtml,
                  () => onSpotClick(spot),
                  markersRef,
                  marker,
                  mapDefaults.color,
                );
              }
            }

            markersRef.current.push(marker);
          });

          if (showLabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:${mapDefaults.color};color:#000;padding:2px 5px;border-radius:3px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;">${esc(spot.call)}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, -2],
            });
            replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: !isTouchDeviceRef.current,
              })
                .bindPopup(spotPopupHtml)
                .addTo(map);

              bindHoverGlow(label, [lat, lon], mapDefaults.color, markersRef);

              if (onSpotClick) {
                if (!isTouchDeviceRef.current) {
                  bindSpotClick(label, () => onSpotClick(spot));
                } else {
                  addTouchGhost(
                    'icon',
                    [lat, lon],
                    spotPopupHtml,
                    () => onSpotClick(spot),
                    markersRef,
                    label,
                    mapDefaults.color,
                  );
                }
              }

              markersRef.current.push(label);
            });
          }
        }
      });
    }
  }

  // Update POTA markers
  useEffect(() => {
    placeSpots(POTADefs, potaSpots, showPOTA, showPOTALabels, potaMarkersRef, mapInstanceRef);
  }, [potaSpots, showPOTA, showPOTALabels, bandPassesMapFilter]);

  // Update WWFF markers
  useEffect(() => {
    placeSpots(WWFFDefs, wwffSpots, showWWFF, showWWFFLabels, wwffMarkersRef, mapInstanceRef);
  }, [wwffSpots, showWWFF, showWWFFLabels, bandPassesMapFilter]);

  // Update SOTA markers
  useEffect(() => {
    placeSpots(SOTADefs, sotaSpots, showSOTA, showSOTALabels, sotaMarkersRef, mapInstanceRef);
  }, [sotaSpots, showSOTA, showSOTALabels, bandPassesMapFilter]);

  // Update WWBOTA markers
  useEffect(() => {
    placeSpots(WWBOTADefs, wwbotaSpots, showWWBOTA, showWWBOTALabels, wwbotaMarkersRef, mapInstanceRef);
  }, [wwbotaSpots, showWWBOTA, showWWBOTALabels, bandPassesMapFilter]);

  // Plugin layer system - properly load saved states
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    try {
      const availableLayers = getAvailableLayers();
      const settings = getStoredMapSettings();
      const savedLayers = settings.layers || {};

      // Build initial states from localStorage
      const initialStates = {};
      availableLayers.forEach((layerDef) => {
        // Use saved state if it exists, otherwise use defaults
        if (savedLayers[layerDef.id]) {
          initialStates[layerDef.id] = savedLayers[layerDef.id];
        } else {
          initialStates[layerDef.id] = {
            enabled: layerDef.defaultEnabled,
            opacity: layerDef.defaultOpacity,
          };
        }
      });

      // Initialize state ONLY on first mount (when empty)
      if (Object.keys(pluginLayerStates).length === 0) {
        console.log('Loading saved layer states:', initialStates);
        setPluginLayerStates(initialStates);
      }

      // Expose controls for SettingsPanel
      window.hamclockLayerControls = {
        layers: availableLayers.map((l) => ({
          ...l,
          enabled: pluginLayerStates[l.id]?.enabled ?? initialStates[l.id]?.enabled ?? l.defaultEnabled,
          opacity: pluginLayerStates[l.id]?.opacity ?? initialStates[l.id]?.opacity ?? l.defaultOpacity,
          config: pluginLayerStates[l.id]?.config ?? initialStates[l.id]?.config ?? l.config,
        })),

        toggleLayer: (id, enabled) => {
          const settings = getStoredMapSettings();
          const layers = settings.layers || {};
          layers[id] = { ...(layers[id] || {}), enabled };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
          setPluginLayerStates((prev) => ({
            ...prev,
            [id]: { ...prev[id], enabled },
          }));
        },

        setOpacity: (id, opacity) => {
          const settings = getStoredMapSettings();
          const layers = settings.layers || {};
          layers[id] = { ...(layers[id] || {}), opacity };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
          setPluginLayerStates((prev) => ({
            ...prev,
            [id]: { ...prev[id], opacity },
          }));
        },

        updateLayerConfig: (id, configDelta) => {
          const settings = getStoredMapSettings();
          const layers = settings.layers || {};
          const currentLayer = layers[id] || {};

          layers[id] = {
            ...currentLayer,
            config: { ...(currentLayer.config || {}), ...configDelta },
          };

          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));

          setPluginLayerStates((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              config: { ...(prev[id]?.config || {}), ...configDelta },
            },
          }));
        },
      };
    } catch (err) {
      console.error('Plugin system error:', err);
    }
  }, [pluginLayerStates, integrationsRev]);

  // Mutual reception lookup: callsigns that appear in BOTH TX and RX reports (same band)
  const pskMutualCalls = useMemo(() => {
    if (!showMutualReception || !pskReporterSpots || pskReporterSpots.length === 0) return new Set();
    const txCalls = new Set();
    const rxCalls = new Set();
    for (const spot of pskReporterSpots) {
      if (spot.direction === 'tx') txCalls.add(`${spot.receiver?.toUpperCase()}|${spot.band}`);
      else if (spot.direction === 'rx') rxCalls.add(`${spot.sender?.toUpperCase()}|${spot.band}`);
    }
    const mutual = new Set();
    for (const key of txCalls) {
      if (rxCalls.has(key)) mutual.add(key);
    }
    return mutual;
  }, [pskReporterSpots]);

  // Update PSKReporter markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    pskMarkersRef.current.forEach((m) => map.removeLayer(m));
    pskMarkersRef.current = [];

    // Validate deLocation exists and has valid coordinates
    const hasValidDE =
      deLocation &&
      typeof deLocation.lat === 'number' &&
      !isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' &&
      !isNaN(deLocation.lon);

    if (showPSKReporter && pskReporterSpots && pskReporterSpots.length > 0 && hasValidDE) {
      pskReporterSpots.forEach((spot) => {
        // Validate spot coordinates are valid numbers
        let spotLat = parseFloat(spot.lat);
        let spotLon = parseFloat(spot.lon);

        if (!isNaN(spotLat) && !isNaN(spotLon)) {
          // For TX spots (you transmitted → someone received): show the receiver (remote station)
          // For RX spots (someone transmitted → you received): show the sender (remote station)
          const displayCall = spot.direction === 'rx' ? spot.sender : spot.receiver || spot.sender;
          const dirLabel = spot.direction === 'rx' ? 'RX' : 'TX';
          const isRx = spot.direction === 'rx';
          const freqMHzRaw = spot.freqMHz || (spot.freq ? spot.freq / 1000000 : null);
          const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(freqMHzRaw || spot.freq);
          if (!bandPassesMapFilter(band)) return;

          const freqMHz = Number.isFinite(parseFloat(freqMHzRaw)) ? parseFloat(freqMHzRaw).toFixed(3) : '?';
          const bandColor = getBandColor(parseFloat(freqMHzRaw));
          const mutual = pskMutualCalls.has(`${displayCall?.toUpperCase()}|${spot.band}`);

          try {
            // Draw line from DE to spot location (only if paths enabled)
            // TX = solid line (my signal going out), RX = dashed line (signals coming in)
            if (showPSKPaths) {
              const points = getGreatCirclePoints(deLocation.lat, deLocation.lon, spotLat, spotLon, 50);

              if (
                points &&
                Array.isArray(points) &&
                points.length > 1 &&
                points.every((p) => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]))
              ) {
                replicatePath(points).forEach((copy) => {
                  const line = L.polyline(copy, {
                    color: bandColor,
                    weight: isRx ? 1.5 : 2,
                    opacity: isRx ? 0.4 : 0.6,
                    dashArray: isRx ? '4, 6' : null,
                  }).addTo(map);
                  pskMarkersRef.current.push(line);
                });
              }
            }

            // TX = circle marker, RX = diamond marker (colorblind-friendly shape distinction)
            // Mutual reception spots get a gold border ring
            const pskPopupHtml = `
                <b data-qrz-call="${esc(displayCall)}" style="cursor:pointer">${esc(displayCall)}</b> <span style="color:#888;font-size:10px">${dirLabel}</span>${mutual ? ' <span style="color:#fbbf24" title="Mutual reception — QSO possible">★</span>' : ''}<br>
                ${esc(spot.mode)} @ ${esc(freqMHz)} MHz<br>
                ${spot.snr !== null ? `SNR: ${spot.snr > 0 ? '+' : ''}${spot.snr} dB` : ''}
              `;
            replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
              let marker;

              if (isRx) {
                // Diamond marker for RX
                marker = L.marker([rLat, rLon], {
                  icon: L.divIcon({
                    className: '',
                    html: `<div style="
                      width: ${mutual ? '10px' : '8px'}; height: ${mutual ? '10px' : '8px'};
                      background: ${bandColor};
                      border: ${mutual ? '2px solid #fbbf24' : '1px solid #fff'};
                      transform: rotate(45deg);
                      opacity: 0.9;
                    "></div>`,
                    iconSize: [mutual ? 10 : 8, mutual ? 10 : 8],
                    iconAnchor: [mutual ? 5 : 4, mutual ? 5 : 4],
                  }),
                  interactive: !isTouchDeviceRef.current,
                });
              } else {
                // Circle marker for TX
                marker = L.circleMarker([rLat, rLon], {
                  radius: mutual ? 5 : 4,
                  fillColor: bandColor,
                  color: mutual ? '#fbbf24' : '#fff',
                  weight: mutual ? 2 : 1,
                  opacity: 0.9,
                  fillOpacity: 0.8,
                  interactive: !isTouchDeviceRef.current,
                });
              }

              marker.bindPopup(pskPopupHtml).addTo(map);

              bindHoverGlow(marker, [rLat, rLon], bandColor, pskMarkersRef);

              if (onSpotClick) {
                if (!isTouchDeviceRef.current) {
                  bindSpotClick(marker, () => onSpotClick(spot));
                } else {
                  const ghostType = isRx ? 'icon' : 'circle';
                  addTouchGhost(
                    ghostType,
                    [rLat, rLon],
                    pskPopupHtml,
                    () => onSpotClick(spot),
                    pskMarkersRef,
                    marker,
                    bandColor,
                  );
                }
              }

              pskMarkersRef.current.push(marker);
            });
          } catch (err) {
            console.warn('Error rendering PSKReporter spot:', err);
          }
        }
      });
    }
  }, [
    pskReporterSpots,
    showPSKReporter,
    showPSKPaths,
    deLocation,
    bandColorVersion,
    bandPassesMapFilter,
    pskMutualCalls,
  ]);

  // Update WSJT-X markers (CQ callers with grid locators)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    wsjtxMarkersRef.current.forEach((m) => map.removeLayer(m));
    wsjtxMarkersRef.current = [];

    const hasValidDE =
      deLocation &&
      typeof deLocation.lat === 'number' &&
      !isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' &&
      !isNaN(deLocation.lon);

    if (showWSJTX && wsjtxSpots && wsjtxSpots.length > 0 && hasValidDE) {
      // Deduplicate by callsign - keep most recent
      // For CQ: caller is the station. If deCall is us (i.e. callsign), then it's a QSO and the call is dxCall,
      // otherwise the call is deCall
      const seen = new Map();
      wsjtxSpots.forEach((spot) => {
        const call = spot.caller || (spot.deCall == callsign ? spot.dxCall : spot.deCall) || '';
        if (call && (!seen.has(call) || spot.timestamp > seen.get(call).timestamp)) {
          seen.set(call, spot);
        }
      });

      seen.forEach((spot, call) => {
        let spotLat = parseFloat(spot.lat);
        let spotLon = parseFloat(spot.lon);

        if (!isNaN(spotLat) && !isNaN(spotLon)) {
          const freqMHz = spot.dialFrequency ? spot.dialFrequency / 1000000 : 0;
          const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(freqMHz);
          if (!bandPassesMapFilter(band)) return;

          const bandColor = freqMHz ? getBandColor(freqMHz) : '#a78bfa';
          // Prefix-estimated locations get reduced opacity
          const isEstimated = spot.gridSource === 'prefix';

          try {
            // Draw line from DE to decoded station
            const points = getGreatCirclePoints(deLocation.lat, deLocation.lon, spotLat, spotLon, 50);

            if (
              points &&
              Array.isArray(points) &&
              points.length > 1 &&
              points.every((p) => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]))
            ) {
              // Render polyline on all 3 world copies
              replicatePath(points).forEach((copy) => {
                const line = L.polyline(copy, {
                  color: '#a78bfa',
                  weight: 1.5,
                  opacity: isEstimated ? 0.15 : 0.4,
                  dashArray: '2, 6',
                }).addTo(map);
                wsjtxMarkersRef.current.push(line);
              });
            }

            // Diamond-shaped marker — replicate across world copies
            const wsjtxPopupHtml = `
                <b data-qrz-call="${esc(call)}" style="cursor:pointer">${esc(call)}</b> ${spot.type === 'CQ' ? 'CQ' : ''}<br>
                ${esc(spot.grid || '')} ${esc(spot.band || '')}${spot.gridSource === 'prefix' ? ' <i>(est)</i>' : spot.gridSource === 'cache' ? ' <i>(prev)</i>' : ''}<br>
                ${esc(spot.mode || '')} SNR: ${spot.snr != null ? (spot.snr >= 0 ? '+' : '') + spot.snr : '?'} dB
              `;
            replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
              const diamond = L.marker([rLat, rLon], {
                icon: L.divIcon({
                  className: '',
                  html: `<div style="
                    width: 8px; height: 8px;
                    background: ${bandColor};
                    border: 1px solid ${isEstimated ? '#888' : '#fff'};
                    transform: rotate(45deg);
                    opacity: ${isEstimated ? 0.5 : 0.9};
                  "></div>`,
                  iconSize: [8, 8],
                  iconAnchor: [4, 4],
                }),
                interactive: !isTouchDeviceRef.current,
              })
                .bindPopup(wsjtxPopupHtml)
                .addTo(map);

              bindHoverGlow(diamond, [rLat, rLon], bandColor, wsjtxMarkersRef);

              if (onSpotClick) {
                if (!isTouchDeviceRef.current) {
                  bindSpotClick(diamond, () => onSpotClick(spot));
                } else {
                  addTouchGhost(
                    'icon',
                    [rLat, rLon],
                    wsjtxPopupHtml,
                    () => onSpotClick(spot),
                    wsjtxMarkersRef,
                    diamond,
                    bandColor,
                  );
                }
              }

              wsjtxMarkersRef.current.push(diamond);
            });
          } catch (err) {
            // skip bad spots
          }
        }
      });
    }
  }, [wsjtxSpots, showWSJTX, deLocation, bandColorVersion, bandPassesMapFilter]);

  // Update APRS markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    aprsMarkersRef.current.forEach((m) => map.removeLayer(m));
    aprsMarkersRef.current = [];

    if (showAPRS && aprsStations && aprsStations.length > 0) {
      const watchSet = aprsWatchlistCalls || new Set();

      aprsStations.forEach((station) => {
        const lat = parseFloat(station.lat);
        const lon = parseFloat(station.lon);
        if (isNaN(lat) || isNaN(lon)) return;

        const isWatched = watchSet.has?.(station.call) || watchSet.has?.(station.ssid);
        const isRF = station.source === 'local-tnc';
        // amber for watched, green for local RF, cyan for internet
        const color = isWatched ? '#f59e0b' : isRF ? '#4ade80' : '#22d3ee';
        const iconSize = isWatched ? 20 : 16;

        try {
          replicatePoint(lat, lon).forEach(([rLat, rLon]) => {
            // Use APRS symbol sprite when available, fall back to triangle
            const symbolDesc = getAprsSymbolIcon(station.symbol, { size: iconSize, borderColor: color });
            const iconOpts = symbolDesc
              ? { className: '', ...symbolDesc }
              : (() => {
                  const s = isWatched ? 7 : 5;
                  return {
                    className: '',
                    html: `<div style="width:0;height:0;border-left:${s}px solid transparent;border-right:${s}px solid transparent;border-bottom:${s * 1.6}px solid ${color};filter:drop-shadow(0 0 2px rgba(0,0,0,0.5));opacity:0.9"></div>`,
                    iconSize: [s * 2, s * 1.6],
                    iconAnchor: [s, s * 1.6],
                  };
                })();

            const marker = L.marker([rLat, rLon], {
              icon: L.divIcon(iconOpts),
              zIndexOffset: isWatched ? 5000 : 1000,
            });

            const ageMin =
              station.age ?? (station.timestamp != null ? Math.floor((Date.now() - station.timestamp) / 60000) : null);
            const ageStr =
              ageMin == null
                ? ''
                : ageMin < 1
                  ? 'now'
                  : ageMin < 60
                    ? `${ageMin}m ago`
                    : `${Math.floor(ageMin / 60)}h ago`;

            marker
              .bindPopup(
                `
                <b data-qrz-call="${esc(station.call)}" style="cursor:pointer">${esc(station.ssid || station.call)}</b>
                ${isWatched ? ' <span style="color:#f59e0b">★</span>' : ''}
                ${isRF ? ' <span style="color:#4ade80;font-size:10px">RF</span>' : ''}<br>
                <span style="color:#888;font-size:11px">${ageStr}</span><br>
                ${station.speed > 0 ? `Speed: ${station.speed} kt<br>` : ''}
                ${station.altitude ? `Alt: ${station.altitude} ft<br>` : ''}
                ${station.comment ? `<span style="font-size:11px;color:#aaa">${esc(station.comment.substring(0, 80))}</span>` : ''}
              `,
              )
              .addTo(map);

            // APRS clicks open the popup only — intentionally do not set DX location

            aprsMarkersRef.current.push(marker);
          });
        } catch (err) {
          // skip bad station
        }
      });
    }
  }, [aprsStations, showAPRS, aprsWatchlistCalls]);

  const openBandColorEditor = (band) => {
    setEditingBand(band);
    setEditingColor(getBandColorForBand(band, effectiveBandColors));
  };

  const saveBandColor = () => {
    if (!editingBand) return;
    const next = { ...bandColorOverrides, [editingBand]: editingColor };
    setBandColorOverrides(next);
    saveBandColorOverrides(next);
  };

  const resetBandColor = () => {
    if (!editingBand) return;
    const next = { ...bandColorOverrides };
    delete next[editingBand];
    setBandColorOverrides(next);
    setEditingColor(getBandColorForBand(editingBand));
    saveBandColorOverrides(next);
  };

  const resetAllBandColors = () => {
    setBandColorOverrides({});
    setEditingBand(null);
    saveBandColorOverrides({});
  };

  const adjustMapZoom = useCallback(
    (delta) => {
      if (mapLocked) return;
      const map = mapInstanceRef.current;
      if (!map) return;
      const current = map.getZoom();
      const min = map.getMinZoom();
      const max = map.getMaxZoom();
      const next = Math.max(min, Math.min(max, current + delta));
      map.setZoom(next);
    },
    [mapLocked],
  );

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '200px' }}>
      {/* Azimuthal equidistant projection (canvas-based) */}
      {isAzimuthal && (
        <AzimuthalErrorBoundary onFallback={() => setMapProjection('mercator')}>
          <AzimuthalMap
            leafletReady={leafletReady}
            deLocation={deLocation}
            dxLocation={dxLocation}
            onDXChange={onDXChange}
            dxLocked={dxLocked}
            potaSpots={potaSpots}
            wwffSpots={wwffSpots}
            sotaSpots={sotaSpots}
            wwbotaSpots={wwbotaSpots}
            dxPaths={dxPaths}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            pskReporterSpots={pskReporterSpots}
            wsjtxSpots={wsjtxSpots}
            showDXPaths={showDXPaths}
            showPOTA={showPOTA}
            showWWFF={showWWFF}
            showSOTA={showSOTA}
            showWWBOTA={showWWBOTA}
            showPSKReporter={showPSKReporter}
            showPSKPaths={showPSKPaths}
            showMutualReception={showMutualReception}
            showWSJTX={showWSJTX}
            onSpotClick={onSpotClick}
            hoveredSpot={hoveredSpot}
            callsign={callsign}
            hideOverlays={hideOverlays}
            hideUi={mapUiHidden}
            tileStyle={mapStyle}
            gibsOffset={gibsOffset}
            lowMemoryMode={lowMemoryMode}
            onMapReady={handleAzimuthalMapReady}
          />
        </AzimuthalErrorBoundary>
      )}

      <div
        ref={mapRef}
        style={{
          height: '100%',
          width: '100%',
          borderRadius: '8px',
          background: mapStyle === 'countries' ? '#4a90d9' : undefined,
          display: isAzimuthal ? 'none' : undefined,
        }}
      />

      {/* Render plugin layers on active map (Mercator or Azimuthal) */}
      {/* Key includes projection so hooks fully remount when map instance changes.
          This resets internal refs (layerGroupRef, controlRef) that are bound to a
          specific Leaflet map — without this, layers stay on the hidden old map. */}
      {getAllLayers().map((layerDef) => (
        <PluginLayer
          key={`${layerDef.id}-${isAzimuthal ? 'az' : 'merc'}`}
          plugin={layerDef}
          enabled={pluginLayerStates[layerDef.id]?.enabled ?? layerDef.defaultEnabled}
          opacity={pluginLayerStates[layerDef.id]?.opacity ?? layerDef.defaultOpacity}
          onDXChange={onDXChange}
          mapBandFilter={mapBandFilter}
          config={pluginLayerStates[layerDef.id]?.config ?? layerDef.config}
          map={isAzimuthal ? azimuthalMapRef.current : mapInstanceRef.current}
          satellites={satellites}
          allUnits={allUnits}
          callsign={callsign}
          locator={deLocator}
          deLat={deLocation?.lat ?? null}
          deLon={deLocation?.lon ?? null}
          lowMemoryMode={lowMemoryMode}
        />
      ))}

      {/* Unified map control dock */}
      {!isAzimuthal && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            alignItems: 'center',
          }}
        >
          <button
            onClick={() => setMapUiHidden((prev) => !prev)}
            title={mapUiHidden ? t('app.mapUi.show') : t('app.mapUi.hide')}
            style={{
              width: '42px',
              background: 'rgba(0, 0, 0, 0.85)',
              border: `1px solid ${mapUiHidden ? '#00ffcc' : '#444'}`,
              color: mapUiHidden ? '#00ffcc' : '#aaa',
              padding: '6px 8px',
              borderRadius: '4px',
              minHeight: '42px',
              fontFamily: 'JetBrains Mono, monospace',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            {mapUiHidden ? '👁' : '🙈'}
          </button>

          {!mapUiHidden && (
            <div
              style={{
                // width: '52px',
                background: 'rgba(0, 0, 0, 0.8)',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <button
                onClick={() => setMapLocked((prev) => !prev)}
                title={mapLocked ? t('app.mapControls.unlock') : t('app.mapControls.lock')}
                style={{
                  width: '30px',
                  minHeight: '30px',
                  background: mapLocked ? 'rgba(255, 80, 80, 0.25)' : 'rgba(0, 0, 0, 0.65)',
                  border: `1px solid ${mapLocked ? 'rgba(255, 80, 80, 0.7)' : '#444'}`,
                  borderRadius: '4px',
                  color: mapLocked ? '#ff5050' : '#ccc',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                  lineHeight: 1,
                  textAlign: 'center',
                }}
              >
                {mapLocked ? '🔒' : '🔓'}
              </button>

              {onToggleDXLabels && showDXPaths && Array.isArray(dxPaths) && dxPaths.length > 0 && (
                <button
                  onClick={onToggleDXLabels}
                  title={showDXLabels ? t('app.mapControls.calls.hide') : t('app.mapControls.calls.show')}
                  style={{
                    width: '30px',
                    background: showDXLabels ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 0, 0, 0.65)',
                    border: `1px solid ${showDXLabels ? '#ffaa00' : '#444'}`,
                    color: showDXLabels ? '#ffaa00' : '#888',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    fontFamily: 'JetBrains Mono, monospace',
                    cursor: 'pointer',
                    textAlign: 'center',
                    minHeight: '30px',
                  }}
                >
                  ⊞
                </button>
              )}

              <button
                onClick={() => adjustMapZoom(0.25)}
                disabled={mapLocked}
                title="Zoom in"
                style={{
                  width: '30px',
                  minHeight: '30px',
                  background: 'rgba(0, 0, 0, 0.65)',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#ccc',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: mapLocked ? 'not-allowed' : 'pointer',
                  opacity: mapLocked ? 0.45 : 1,
                  textAlign: 'center',
                  padding: '0 8px',
                }}
              >
                +
              </button>

              <button
                onClick={() => adjustMapZoom(-0.25)}
                disabled={mapLocked}
                title="Zoom out"
                style={{
                  width: '30px',
                  minHeight: '30px',
                  background: 'rgba(0, 0, 0, 0.65)',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#ccc',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: mapLocked ? 'not-allowed' : 'pointer',
                  opacity: mapLocked ? 0.45 : 1,
                  textAlign: 'center',
                  padding: '0 8px',
                }}
              >
                −
              </button>

              <div
                title="Adjust night overlay darkness"
                style={{
                  width: '30px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '5px',
                  color: '#999',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  textAlign: 'center',
                }}
              >
                <span>{nightDarkness}%</span>
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={nightDarkness}
                  onChange={(e) => setNightDarkness(parseInt(e.target.value, 10))}
                  style={{
                    cursor: 'pointer',
                    margin: 0,
                    writingMode: 'vertical-lr',
                    WebkitAppearance: 'slider-vertical',
                    transform: 'rotate(180deg)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {mapStyle === 'MODIS' && !mapUiHidden && (
        <div
          style={{
            position: 'absolute',
            top: '50px',
            right: '10px',
            background: 'rgba(0, 0, 0, 0.8)',
            border: '1px solid #444',
            padding: '8px',
            borderRadius: '4px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              color: '#00ffcc',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
            }}
          >
            {gibsOffset === 0 ? 'LATEST IMAGERY' : `${gibsOffset} DAYS AGO`}
          </div>
          <input
            type="range"
            min="0"
            max="7"
            value={gibsOffset}
            onChange={(e) => setGibsOffset(parseInt(e.target.value))}
            style={{ cursor: 'pointer', width: '100px' }}
          />
        </div>
      )}

      {/* Map style dropdown + projection toggle */}
      {!mapUiHidden && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
          }}
        >
          {/* Projection toggle */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(0, 0, 0, 0.8)',
              border: '1px solid #444',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {[
              { key: 'mercator', label: 'Flat' },
              { key: 'azimuthal', label: 'Azimuthal' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMapProjection(key)}
                style={{
                  background: mapProjection === key ? '#00ffcc' : 'transparent',
                  color: mapProjection === key ? '#000' : '#888',
                  border: 'none',
                  padding: '5px 8px',
                  fontSize: '10px',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                  fontWeight: mapProjection === key ? 'bold' : 'normal',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Style dropdown */}
          <select
            value={mapStyle}
            id="mapStyle"
            onChange={(e) => setMapStyle(e.target.value)}
            style={{
              background: 'rgba(0, 0, 0, 0.8)',
              border: '1px solid #444',
              color: '#00ffcc',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {Object.entries(MAP_STYLES)
              .filter(([, style]) => !style.legacy)
              .map(([key, style]) => (
                <option key={key} value={key}>
                  {style.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Satellite toggle */}

      {/* DX weather hover overlay */}

      {!hideOverlays && !mapUiHidden && (
        <CallsignWeatherOverlay hoveredSpot={hoveredSpot} enabled={dxWeatherAllowed} allUnits={allUnits} />
      )}

      {/* DX News Ticker - left side of bottom bar (independent of UI hide toggle) */}
      {!hideOverlays && showDXNews && <DXNewsTicker />}

      {/* Legend toggle button */}
      {!hideOverlays && !mapUiHidden && (
        <button
          onClick={toggleLegend}
          title={showLegend ? 'Hide legend' : 'Show legend'}
          style={{
            position: 'absolute',
            bottom: showLegend ? '80px' : '44px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '2px 8px',
            zIndex: 1001,
            cursor: 'pointer',
            fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace',
            color: '#888',
            lineHeight: 1.2,
          }}
        >
          {showLegend ? '▼ Legend' : '▲ Legend'}
        </button>
      )}

      {/* Legend - centered above news ticker */}
      {!hideOverlays && !mapUiHidden && showLegend && (
        <div
          style={{
            position: 'absolute',
            bottom: '44px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '6px 10px',
            zIndex: 1000,
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            flexWrap: 'nowrap',
          }}
        >
          {showDXPaths && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: '#888' }}>Bands:</span>
              <button
                type="button"
                onClick={() => clearMapBandFilter()}
                title="Show all bands"
                style={{
                  background: hasMapBandFilter ? 'rgba(120,120,120,0.35)' : '#00ffcc',
                  color: hasMapBandFilter ? '#ccc' : '#001f1a',
                  padding: '2px 5px',
                  borderRadius: '3px',
                  fontWeight: '700',
                  border: hasMapBandFilter ? '1px solid #666' : '1px solid rgba(0,0,0,0.35)',
                  cursor: 'pointer',
                  lineHeight: 1.1,
                }}
              >
                ALL
              </button>
              {BAND_LEGEND_ORDER.map((band) => {
                const bg = getBandColorForBand(band, effectiveBandColors);
                const fg = getBandTextColor(bg);
                const isEditing = editingBand === band;
                const isSelected = selectedMapBands.has(normalizeBandKey(band));
                const isDimmed = hasMapBandFilter && !isSelected;
                return (
                  <button
                    key={band}
                    type="button"
                    onClick={(e) => {
                      if (e.shiftKey) {
                        openBandColorEditor(band);
                        return;
                      }
                      toggleMapBand(band);
                    }}
                    title={`Click to filter ${band}; Shift+Click to edit color`}
                    style={{
                      background: bg,
                      color: fg,
                      padding: '2px 5px',
                      borderRadius: '3px',
                      fontWeight: '600',
                      border: isEditing
                        ? '2px solid #ffffff'
                        : isSelected
                          ? '1px solid #00ffcc'
                          : '1px solid rgba(0,0,0,0.35)',
                      cursor: 'pointer',
                      lineHeight: 1.1,
                      opacity: isDimmed ? 0.35 : 1,
                    }}
                  >
                    {band}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {!hideOverlays && !mapUiHidden && showLegend && editingBand && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '92px',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.92)',
            border: '1px solid #555',
            borderRadius: '6px',
            padding: '8px',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
          }}
        >
          <span style={{ color: '#bbb' }}>{editingBand}</span>
          <input
            type="color"
            value={editingColor}
            onChange={(e) => setEditingColor(e.target.value)}
            style={{
              width: '26px',
              height: '20px',
              padding: 0,
              border: '1px solid #444',
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
          <span
            style={{
              width: '80px',
              background: '#111',
              color: '#ddd',
              border: '1px solid #444',
              borderRadius: '3px',
              padding: '2px 5px',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {editingColor}
          </span>
          <button
            type="button"
            onClick={saveBandColor}
            style={{
              background: '#1f6d35',
              color: '#d2ffd8',
              border: '1px solid #3da15d',
              borderRadius: '4px',
              padding: '3px 7px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={resetBandColor}
            style={{
              background: '#6f3f0f',
              color: '#ffd7b0',
              border: '1px solid #a76a2d',
              borderRadius: '4px',
              padding: '3px 7px',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={resetAllBandColors}
            style={{
              background: '#5b1d1d',
              color: '#ffc1c1',
              border: '1px solid #9a3d3d',
              borderRadius: '4px',
              padding: '3px 7px',
              cursor: 'pointer',
            }}
          >
            Reset All
          </button>
          <button
            type="button"
            onClick={() => setEditingBand(null)}
            style={{
              background: '#222',
              color: '#ddd',
              border: '1px solid #555',
              borderRadius: '4px',
              padding: '3px 7px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
      <style>{`
        ${mapUiHidden ? '.leaflet-control-container,.grayline-control,.muf-map-control,.voacap-heatmap-control,.rbn-control,.lightning-stats,.lightning-proximity,.wspr-filter-control,.wspr-stats,.wspr-legend,.wspr-chart{display:none !important;}' : ''}
        .ohc-rotator-bearing {
          stroke-dasharray: 10 10;
          animation: ohcRotDash 2.8s linear infinite, ohcRotPulse 3.2s ease-in-out infinite;
          filter: drop-shadow(0 0 4px rgba(0,255,255,0.25));
        }

        .ohc-rotator-bearing-glow {
          stroke-dasharray: 10 10;
          animation: ohcRotDash 2.8s linear infinite, ohcRotGlow 3.2s ease-in-out infinite;
        }

        @keyframes ohcRotDash {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -44; }
        }

        @keyframes ohcRotPulse {
          0%,100% { opacity: 0.55; }
          50%     { opacity: 0.95; }
        }

        @keyframes ohcRotGlow {
          0%,100% { opacity: 0.10; }
          50%     { opacity: 0.24; }
        }
      `}</style>
    </div>
  );
};

export default WorldMap;
