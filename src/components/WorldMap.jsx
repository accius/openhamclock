/**
 * WorldMap Component
 * Leaflet map with DE/DX markers, terminator, DX paths, POTA/WWFF/SOTA, satellites, PSKReporter, WSJT-X
 * Includes DX Weather (local-only) hover overlay + popup weather + DX highlight.
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
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
import { getBandColor } from '../utils/callsign.js';
import { createTerminator } from '../utils/terminator.js';
import { getAllLayers } from '../plugins/layerRegistry.js';
import useLocalInstall from '../hooks/app/useLocalInstall.js';

import PluginLayer from './PluginLayer.jsx';
import AzimuthalMap from './AzimuthalMap.jsx';
import { DXNewsTicker } from './DXNewsTicker.jsx';
import { CallsignWeatherOverlay } from './CallsignWeatherOverlay.jsx';
import { getCallsignWeather } from '../utils/callsignWeather.js';
import { filterDXPaths } from '../utils';

// SECURITY: Escape HTML to prevent XSS in Leaflet popups/tooltips.
// DX cluster data, POTA/SOTA spots, and WSJT-X decodes come from external sources.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const normalizeCallsignKey = (v) => (v || '').toString().toUpperCase().trim();

function windArrow(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export const WorldMap = ({
  // core
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,

  // spots & paths
  potaSpots,
  wwffSpots,
  sotaSpots,
  mySpots,
  dxPaths,
  dxFilters,

  // other overlays
  satellites,
  pskReporterSpots,
  wsjtxSpots,

  // toggles
  showDXPaths,
  showDXLabels,
  onToggleDXLabels,
  showPOTA,
  showPOTALabels = true,
  showWWFF,
  showWWFFLabels = true,
  showSOTA,
  showPSKReporter,
  showWSJTX,
  onToggleSatellites,

  // interactions
  onSpotClick,
  hoveredSpot,
  onHoverSpot,

  // misc
  callsign = 'N0CALL',
  showDXNews = true,
  hideOverlays,
  lowMemoryMode = false,
  units = 'imperial',
  mouseZoom,

  // rotator
  showRotatorBearing = false,
  rotatorAzimuth = null,
  rotatorLastGoodAzimuth = null,
  rotatorIsStale = false,
  rotatorControlEnabled,
  onRotatorTurnRequest,
}) => {
  const { t } = useTranslation();

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const terminatorRef = useRef(null);

  const deMarkerRef = useRef([]);
  const dxMarkerRef = useRef([]);
  const sunMarkerRef = useRef(null);
  const moonMarkerRef = useRef(null);

  const potaMarkersRef = useRef([]);
  const wwffMarkersRef = useRef([]);
  const sotaMarkersRef = useRef([]);

  const dxPathsLinesRef = useRef([]);
  const dxPathsMarkersRef = useRef([]);

  const pskMarkersRef = useRef([]);
  const wsjtxMarkersRef = useRef([]);

  // DX highlight (existing polylines via refs; no rebuild)
  const dxLineIndexRef = useRef(new Map()); // key -> [polyline,...]
  const dxHighlightKeyRef = useRef('');
  const dxHighlightLockedRef = useRef(false);

  // map view / style
  const getStoredMapSettings = () => {
    try {
      const stored = localStorage.getItem('openhamclock_mapSettings');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  };

  const storedSettings = getStoredMapSettings();
  const [mapStyle, setMapStyle] = useState(storedSettings.mapStyle || 'dark');
  const [mapView, setMapView] = useState({
    center: storedSettings.center || [20, 0],
    zoom: storedSettings.zoom || 2.5,
  });

  // map lock
  const [mapLocked, setMapLocked] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_mapLocked') === 'true';
    } catch {
      return false;
    }
  });

  // Night overlay darkness (0-100 → fillOpacity 0.0-1.0)
  const [nightDarkness, setNightDarkness] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_nightDarkness')) || 60;
    } catch {
      return 60;
    }
  });

  // NASA GIBS MODIS helper (only used if MAP_STYLES includes "MODIS")
  const [gibsOffset, setGibsOffset] = useState(0);
  const getGibsUrl = (days) => {
    const date = new Date(Date.now() - (days * 24 + 12) * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  };

  // scaling for mouse zoom speed
  const getScaledZoomLevel = (inverseMultiplier) => {
    const clamped = Math.min(Math.max(inverseMultiplier ?? 60, 1), 100);
    const normalized = (100 - clamped) / 99;
    return Math.round(50 + normalized * 200);
  };

  // Keep refs synced for click handling
  const dxLockedRef = useRef(dxLocked);
  const rotatorTurnRef = useRef(onRotatorTurnRequest);
  const rotatorEnabledRef = useRef(rotatorControlEnabled);
  const deRef = useRef(deLocation);

  useEffect(() => {
    dxLockedRef.current = dxLocked;
  }, [dxLocked]);
  useEffect(() => {
    rotatorTurnRef.current = onRotatorTurnRequest;
  }, [onRotatorTurnRequest]);
  useEffect(() => {
    rotatorEnabledRef.current = rotatorControlEnabled;
  }, [rotatorControlEnabled]);
  useEffect(() => {
    deRef.current = deLocation;
  }, [deLocation]);

  // DE locator for plugins
  const deLocator = useMemo(() => {
    if (!deLocation?.lat || !deLocation?.lon) return '';
    return calculateGridSquare(deLocation.lat, deLocation.lon);
  }, [deLocation?.lat, deLocation?.lon]);

  // Expose DE location to window for plugins (e.g., RBN)
  useEffect(() => {
    if (deLocation?.lat != null && deLocation?.lon != null) {
      window.deLocation = { lat: deLocation.lat, lon: deLocation.lon };
    }
    return () => {
      try {
        delete window.deLocation;
      } catch {}
    };
  }, [deLocation?.lat, deLocation?.lon]);

  // --- DX Weather local-only gate ---
  const isLocalInstall = useLocalInstall();
  const [dxWeatherEnabled, setDxWeatherEnabled] = useState(() => {
    try {
      return localStorage.getItem('ohc_dx_weather_enabled') === '1';
    } catch {
      return false;
    }
  });
  const dxWeatherAllowed = isLocalInstall && dxWeatherEnabled;

  const [integrationsRev, setIntegrationsRev] = useState(0);
  useEffect(() => {
    const bump = () => {
      setIntegrationsRev((v) => v + 1);
      try {
        setDxWeatherEnabled(localStorage.getItem('ohc_dx_weather_enabled') === '1');
      } catch {}
    };
    try {
      window.addEventListener('ohc-dx-weather-config-changed', bump);
    } catch {}
    return () => {
      try {
        window.removeEventListener('ohc-dx-weather-config-changed', bump);
      } catch {}
    };
  }, []);

  const dxWeatherAllowedRef = useRef(dxWeatherAllowed);
  useEffect(() => {
    dxWeatherAllowedRef.current = !!dxWeatherAllowed;
  }, [dxWeatherAllowed]);

  // --- Weather cache for popup injection ---
  const wxCacheRef = useRef(new Map()); // key -> { t, wx }
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

    // Open-Meteo metric by request: C, km/h, hPa
    let temp = c.temperature_2m;
    let wind = c.wind_speed_10m;
    const windDir = c.wind_direction_10m;
    const humidity = c.relative_humidity_2m;
    const pressure = c.pressure_msl;
    const precipProb = wx?.hourly?.precipitation_probability?.[0];

    if (units === 'imperial') {
      temp = (temp * 9) / 5 + 32;
      wind = wind * 0.621371;
    }

    return `
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12)">
        <div style="font-weight:800;margin-bottom:4px">Weather</div>
        <div style="display:flex;flex-direction:column;gap:3px;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:18px;text-align:center">🌡</span>
            <span>${Math.round(temp)}°${units === 'imperial' ? 'F' : 'C'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:18px;text-align:center">💨</span>
            <span>${Math.round(wind)} ${units === 'imperial' ? 'mph' : 'km/h'} ${windArrow(windDir)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:18px;text-align:center">💧</span>
            <span>${humidity != null ? `${Math.round(humidity)}%` : '—'}</span>
            <span style="width:18px;text-align:center;margin-left:6px">🧭</span>
            <span>${pressure != null ? `${Math.round(pressure)} hPa` : '—'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:18px;text-align:center">🌧</span>
            <span>${precipProb != null ? `${Math.round(precipProb)}%` : '—'}</span>
          </div>
        </div>
      </div>
    `;
  };

  const bindSpotInteraction = (layer, onActivate) => {
    layer.on('click', (e) => {
      // Prevent map click (moving DX) from firing for interactive markers
      try {
        const L = window.L;
        const oe = e?.originalEvent;
        if (L?.DomEvent) {
          if (oe) L.DomEvent.stop(oe);
          // extra safety: stop any remaining propagation
          if (oe?.stopImmediatePropagation) oe.stopImmediatePropagation();
        } else {
          oe?.preventDefault?.();
          oe?.stopPropagation?.();
          if (oe?.stopImmediatePropagation) oe.stopImmediatePropagation();
        }
      } catch {}

      const oe = e?.originalEvent;
      const isAlt = !!oe?.altKey || (typeof oe?.getModifierState === 'function' && oe.getModifierState('Alt'));
      if (isAlt && typeof onActivate === 'function') {
        onActivate();
        return;
      }
      if (typeof layer.openPopup === 'function') layer.openPopup();
    });
  };

  const attachHoverHandlers = (layer, hoverObj) => {
    if (!layer || !hoverObj || typeof onHoverSpot !== 'function') return;

    const isPopupOpen = () => {
      try {
        return !!(layer.getPopup && layer.getPopup() && layer.isPopupOpen && layer.isPopupOpen());
      } catch {
        return false;
      }
    };

    layer.on('mouseover', () => {
      try {
        onHoverSpot(hoverObj);
      } catch {}
    });
    layer.on('mouseout', () => {
      try {
        if (!isPopupOpen()) onHoverSpot(null);
      } catch {}
    });
    layer.on('popupclose', () => {
      try {
        onHoverSpot(null);
      } catch {}
    });
  };

  const attachPopupWeather = (layer, lat, lon, baseHtml) => {
    const loadingHtml = baseHtml + `<div style="margin-top:6px;color:#888">Weather: loading...</div>`;
    layer.bindPopup(baseHtml);

    layer.on('popupopen', async (e) => {
      const target = e?.target || layer;

      if (!dxWeatherAllowedRef.current) {
        target.setPopupContent(
          baseHtml +
            `<div style="margin-top:6px;color:#888;line-height:1.2;">
               Enable DX Weather<br/><span style="opacity:0.85;">(Local mode)</span>
             </div>`,
        );
        return;
      }

      target.setPopupContent(loadingHtml);
      try {
        const wx = await getWxCached(lat, lon);
        target.setPopupContent(baseHtml + fmtWxHtml(wx));
      } catch (err) {
        console.warn('[WX] popup failed', err);
        target.setPopupContent(baseHtml + `<div style="margin-top:6px;color:#888">Weather unavailable</div>`);
      }
    });
  };

  // --- DX highlight helpers ---
  const clearDXHighlight = useCallback(() => {
    const prevKey = dxHighlightKeyRef.current;
    if (!prevKey) return;
    const prevLines = dxLineIndexRef.current.get(prevKey) || [];
    prevLines.forEach((ln) => {
      const base = ln._ohcBaseStyle || {
        color: ln.options.color,
        weight: ln.options.weight,
        opacity: ln.options.opacity,
      };
      ln.setStyle(base);
    });
    dxHighlightKeyRef.current = '';
  }, []);

  const setDXHighlight = useCallback(
    (key) => {
      const k = normalizeCallsignKey(key);
      if (!k) return;
      if (dxHighlightKeyRef.current === k) return;

      clearDXHighlight();
      const lines = dxLineIndexRef.current.get(k) || [];
      if (!lines.length) return;

      lines.forEach((ln) => {
        ln.setStyle({ color: '#ffffff', weight: 3, opacity: 1 });
        if (ln.bringToFront) ln.bringToFront();
      });
      dxHighlightKeyRef.current = k;
    },
    [clearDXHighlight],
  );

  // DX Cluster hover -> highlight matching DX path (unless locked by popup)
  useEffect(() => {
    if (dxHighlightLockedRef.current) return;
    const key = normalizeCallsignKey(hoveredSpot?.dxCall || hoveredSpot?.call || hoveredSpot?.dx || '');
    if (key) setDXHighlight(key);
    else clearDXHighlight();
  }, [hoveredSpot, setDXHighlight, clearDXHighlight]);

  // --- Save map settings ---
  useEffect(() => {
    try {
      const existing = getStoredMapSettings();
      localStorage.setItem(
        'openhamclock_mapSettings',
        JSON.stringify({
          ...existing,
          mapStyle,
          center: mapView.center,
          zoom: mapView.zoom,
          wheelPxPerZoomLevel: getScaledZoomLevel(mouseZoom),
        }),
      );
    } catch (e) {
      console.error('Failed to save map settings:', e);
    }
  }, [mapStyle, mapView, mouseZoom]);

  // --- Map init ---
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const L = window.L;
    if (!L) {
      console.error('Leaflet not loaded');
      return;
    }

    const map = L.map(mapRef.current, {
      center: mapView.center,
      zoom: mapView.zoom,
      minZoom: 1,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: true,
      zoomSnap: 0.1,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: getScaledZoomLevel(mouseZoom),
      maxBounds: [
        [-90, -Infinity],
        [90, Infinity],
      ],
      maxBoundsViscosity: 0.8,
    });

    // Tile layer
    let url = MAP_STYLES[mapStyle]?.url;
    if (mapStyle === 'MODIS') url = getGibsUrl(gibsOffset);
    tileLayerRef.current = L.tileLayer(url, {
      attribution: MAP_STYLES[mapStyle]?.attribution,
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

    // Terminator overlay
    terminatorRef.current = createTerminator({
      resolution: 2,
      fillOpacity: nightDarkness / 100,
      fillColor: '#000010',
      color: 'transparent',
      weight: 2,
      wrap: false,
    }).addTo(map);

    // Initial terminator update and periodic refresh
    const refreshTerminator = () => {
      try {
        terminatorRef.current?.setTime?.();
        const path = terminatorRef.current?.getElement?.();
        if (path) path.classList.add('terminator-path');
      } catch {}
    };
    setTimeout(refreshTerminator, 150);
    const terminatorInterval = setInterval(refreshTerminator, 60000);

    map.on('moveend', () => {
      const c = map.getCenter();
      setMapView({ center: [c.lat, c.lng], zoom: map.getZoom() });
    });

    // Click handler:
    // - Shift+click => turn rotator toward clicked point (if enabled)
    // - Normal click => set DX (only if not locked)
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const initialBearingDeg = (lat1, lon1, lat2, lon2) => {
      const φ1 = toRad(lat1);
      const φ2 = toRad(lat2);
      const Δλ = toRad(lon2 - lon1);
      const y = Math.sin(Δλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
      const θ = Math.atan2(y, x);
      return (toDeg(θ) + 360) % 360;
    };

    map.on('click', (e) => {
      let lon = e.latlng.lng;
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;

      const oe = e?.originalEvent;
      const isShift = !!oe?.shiftKey || (typeof oe?.getModifierState === 'function' && oe.getModifierState('Shift'));

      if (isShift && rotatorEnabledRef.current && typeof rotatorTurnRef.current === 'function') {
        const de = deRef.current;
        if (de?.lat != null && de?.lon != null) {
          const az = initialBearingDeg(de.lat, de.lon, e.latlng.lat, lon);
          Promise.resolve(rotatorTurnRef.current(az)).catch(() => {});
          return;
        }
      }

      if (onDXChange && !dxLockedRef.current) {
        onDXChange({ lat: e.latlng.lat, lon });
      }
    });

    mapInstanceRef.current = map;

    // Apply initial lock state
    if (mapLocked) {
      [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard].forEach((h) =>
        h?.disable?.(),
      );
      const zc = map.zoomControl?.getContainer?.();
      if (zc) zc.style.display = 'none';
    }

    const resizeObserver = new ResizeObserver(() => mapInstanceRef.current?.invalidateSize?.());
    resizeObserver.observe(mapRef.current);

    return () => {
      clearInterval(terminatorInterval);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update mouse zoom speed
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.options.wheelPxPerZoomLevel = getScaledZoomLevel(mouseZoom);
  }, [mouseZoom]);

  // Apply map lock toggles
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handlers = [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard];
    handlers.forEach((h) => (mapLocked ? h?.disable?.() : h?.enable?.()));

    const zoomControl = map.zoomControl?.getContainer?.();
    if (zoomControl) zoomControl.style.display = mapLocked ? 'none' : '';

    try {
      localStorage.setItem('openhamclock_mapLocked', mapLocked ? 'true' : 'false');
    } catch {}
  }, [mapLocked]);

  // Update tiles when style changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !tileLayerRef.current) return;

    map.removeLayer(tileLayerRef.current);

    let url = MAP_STYLES[mapStyle]?.url;
    if (mapStyle === 'MODIS') url = getGibsUrl(gibsOffset);

    tileLayerRef.current = L.tileLayer(url, {
      attribution: MAP_STYLES[mapStyle]?.attribution,
      noWrap: false,
      crossOrigin: 'anonymous',
      ...(mapStyle === 'MODIS'
        ? {
            bounds: [
              [-85, -180],
              [85, 180],
            ],
          }
        : {}),
    }).addTo(map);

    // keep terminator on top
    terminatorRef.current?.bringToFront?.();
  }, [mapStyle, gibsOffset]);

  // Live-update night overlay darkness
  useEffect(() => {
    terminatorRef.current?.setStyle?.({ fillOpacity: nightDarkness / 100 });
    try {
      localStorage.setItem('ohc_nightDarkness', String(nightDarkness));
    } catch {}
  }, [nightDarkness]);

  // --- DE/DX markers ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !deLocation || !dxLocation) return;

    // clear old
    deMarkerRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    dxMarkerRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    deMarkerRef.current = [];
    dxMarkerRef.current = [];

    // DE
    replicatePoint(deLocation.lat, deLocation.lon).forEach(([lat, lon]) => {
      const deIcon = L.divIcon({
        className: 'custom-marker de-marker',
        html: 'DE',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const html = `<b>DE - Your Location</b><br>${esc(calculateGridSquare(deLocation.lat, deLocation.lon))}<br>${deLocation.lat.toFixed(4)}°, ${deLocation.lon.toFixed(4)}°`;
      const m = L.marker([lat, lon], { icon: deIcon }).bindPopup(html).addTo(map);
      deMarkerRef.current.push(m);
    });

    // DX
    replicatePoint(dxLocation.lat, dxLocation.lon).forEach(([lat, lon]) => {
      const dxIcon = L.divIcon({
        className: 'custom-marker dx-marker',
        html: 'DX',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const baseHtml = `<b>DX - Target</b><br>${esc(calculateGridSquare(dxLocation.lat, dxLocation.lon))}<br>${dxLocation.lat.toFixed(4)}°, ${dxLocation.lon.toFixed(4)}°`;

      const m = L.marker([lat, lon], { icon: dxIcon }).bindPopup(baseHtml).addTo(map);

      m.on('popupopen', async (e) => {
        const marker = e?.target || m;

        if (!dxWeatherAllowedRef.current) {
          marker.setPopupContent(
            baseHtml +
              `<div style="margin-top:6px;color:#888;line-height:1.2;">
                 Enable DX Weather<br/><span style="opacity:0.85;">(Local mode)</span>
               </div>`,
          );
          return;
        }

        marker.setPopupContent(baseHtml + `<div style="margin-top:6px;color:#888">Weather: loading...</div>`);

        try {
          const ll = marker.getLatLng?.();
          const wxLat = ll?.lat;
          const wxLon = ll?.lng;
          if (typeof wxLat !== 'number' || typeof wxLon !== 'number') throw new Error('Invalid lat/lon');
          const wx = await getWxCached(wxLat, wxLon);
          marker.setPopupContent(baseHtml + fmtWxHtml(wx));
        } catch (err) {
          console.warn('[WX] dx marker failed', err);
          marker.setPopupContent(baseHtml + `<div style="margin-top:6px;color:#888">Weather unavailable</div>`);
        }
      });

      dxMarkerRef.current.push(m);
    });
  }, [deLocation, dxLocation, units, dxWeatherAllowed]);

  // --- Sun/Moon markers ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;

    const updateCelestial = () => {
      try {
        if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      } catch {}
      try {
        if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);
      } catch {}

      const now = new Date();
      const sunPos = getSunPosition(now);
      const sunIcon = L.divIcon({
        className: 'custom-marker sun-marker',
        html: '☼',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      sunMarkerRef.current = L.marker([sunPos.lat, sunPos.lon], { icon: sunIcon })
        .bindPopup(`<b>☼ Subsolar Point</b><br>${sunPos.lat.toFixed(2)}°, ${sunPos.lon.toFixed(2)}°`)
        .addTo(map);

      const moonPos = getMoonPosition(now);
      const moonIcon = L.divIcon({
        className: 'custom-marker moon-marker',
        html: '☽',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      moonMarkerRef.current = L.marker([moonPos.lat, moonPos.lon], { icon: moonIcon })
        .bindPopup(`<b>☽ Sublunar Point</b><br>${moonPos.lat.toFixed(2)}°, ${moonPos.lon.toFixed(2)}°`)
        .addTo(map);
    };

    updateCelestial();
    const interval = setInterval(updateCelestial, 60000);

    return () => {
      clearInterval(interval);
      try {
        if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      } catch {}
      try {
        if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);
      } catch {}
    };
  }, []);

  // --- DX paths ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;

    // remove old
    dxPathsLinesRef.current.forEach((l) => {
      try {
        map.removeLayer(l);
      } catch {}
    });
    dxPathsMarkersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    dxPathsLinesRef.current = [];
    dxPathsMarkersRef.current = [];

    dxLineIndexRef.current = new Map();
    dxHighlightKeyRef.current = '';

    if (!showDXPaths || !Array.isArray(dxPaths) || dxPaths.length === 0) return;

    const filtered = filterDXPaths(dxPaths, dxFilters);

    filtered.forEach((path) => {
      try {
        if (path?.spotterLat == null || path?.spotterLon == null || path?.dxLat == null || path?.dxLon == null) return;

        const dxCallKey = normalizeCallsignKey(
          path.dxCall || path.dxCallsign || path.dxCallSign || path.call || path.dx || '',
        );
        if (!dxCallKey) return;

        const pts = getGreatCirclePoints(path.spotterLat, path.spotterLon, path.dxLat, path.dxLon);
        if (!Array.isArray(pts) || pts.length < 2) return;

        const freqNum = parseFloat(path.freq);
        const color = getBandColor(freqNum);

        const hoverObj = {
          dxCall: dxCallKey,
          call: dxCallKey,
          dxLat: path.dxLat,
          dxLon: path.dxLon,
          lat: path.dxLat,
          lon: path.dxLon,
          freq: path.freq,
          spotter: path.spotter,
          spotterLat: path.spotterLat,
          spotterLon: path.spotterLon,
        };

        // line across world copies
        replicatePath(pts).forEach((copy) => {
          const line = L.polyline(copy, { color, weight: 1.5, opacity: 0.5 }).addTo(map);
          line._ohcBaseStyle = { color, weight: 1.5, opacity: 0.5 };
          const arr = dxLineIndexRef.current.get(dxCallKey) || [];
          arr.push(line);
          dxLineIndexRef.current.set(dxCallKey, arr);
          dxPathsLinesRef.current.push(line);
        });

        const baseHtml =
          `<b data-qrz-call="${esc(dxCallKey)}" style="color:${esc(color)};cursor:pointer">${esc(dxCallKey)}</b><br>` +
          `${esc(path.freq)} MHz<br>` +
          `by <span data-qrz-call="${esc(path.spotter)}" style="cursor:pointer">${esc(path.spotter)}</span>`;

        // DX dot marker (replicated)
        replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
          const dot = L.circleMarker([lat, lon], {
            radius: 6,
            fillColor: color,
            color: '#fff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.9,
            interactive: true,
            bubblingMouseEvents: false,
          }).addTo(map);

          attachHoverHandlers(dot, hoverObj);
          attachPopupWeather(dot, lat, lon, baseHtml);
          bindSpotInteraction(dot, () => onSpotClick?.(path));

          dot.on('popupopen', () => {
            dxHighlightLockedRef.current = true;
            setDXHighlight(dxCallKey);
          });
          dot.on('popupclose', () => {
            dxHighlightLockedRef.current = false;
            clearDXHighlight();
          });

          dxPathsMarkersRef.current.push(dot);
        });

        // Callsign label marker (replicated)
        if (showDXLabels) {
          const labelHtml = `
            <span style="
              display:inline-block;
              background:${esc(color)};
              color:#000;
              padding:4px 8px;
              border-radius:4px;
              font-family:'JetBrains Mono',monospace;
              font-size:12px;
              font-weight:900;
              white-space:nowrap;
              border:2px solid rgba(0,0,0,0.55);
              box-shadow:0 2px 4px rgba(0,0,0,0.4);
              text-shadow:0 1px 1px rgba(0,0,0,0.35);
            ">${esc(dxCallKey)}</span>
          `;
          const icon = L.divIcon({
            className: 'ohc-dx-label-icon',
            html: labelHtml,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });

          replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
            const label = L.marker([lat, lon], { icon, interactive: true, bubblingMouseEvents: false }).addTo(map);
            attachHoverHandlers(label, hoverObj);
            attachPopupWeather(label, lat, lon, baseHtml);
            bindSpotInteraction(label, () => onSpotClick?.(path));

            label.on('popupopen', () => {
              dxHighlightLockedRef.current = true;
              setDXHighlight(dxCallKey);
            });
            label.on('popupclose', () => {
              dxHighlightLockedRef.current = false;
              clearDXHighlight();
            });

            dxPathsMarkersRef.current.push(label);
          });
        }
      } catch (err) {
        console.error('Error rendering DX path:', err);
      }
    });
  }, [
    dxPaths,
    dxFilters,
    showDXPaths,
    showDXLabels,
    units,
    dxWeatherAllowed,
    onSpotClick,
    clearDXHighlight,
    setDXHighlight,
  ]);

  // --- POTA / WWFF / SOTA ---
  const addSimpleSpotMarkers = useCallback(
    (spots, show, showLabels, color, shape, storeRef) => {
      const map = mapInstanceRef.current;
      const L = window.L;
      if (!map || !L) return;

      storeRef.current.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch {}
      });
      storeRef.current = [];

      if (!show || !Array.isArray(spots) || spots.length === 0) return;

      spots.forEach((spot) => {
        if (spot?.lat == null || spot?.lon == null) return;

        const call = esc(spot.call || '');
        const ref = esc(spot.ref || '');
        const freq = esc(spot.freq || '');
        const mode = esc(spot.mode || '');
        const time = esc(spot.time || '');
        const loc = esc(spot.locationDesc || '');
        const name = spot.name ? `<i>${esc(spot.name)}</i><br>` : '';

        const baseHtml =
          `<b data-qrz-call="${call}" style="color:${color};cursor:pointer">${call}</b><br>` +
          `<span style="color:#888">${ref}</span> ${loc}<br>` +
          `${name}` +
          `${freq} ${mode} <span style="color:#888">${time}</span>`;

        // marker icon
        const iconHtml =
          shape === 'triangle-up'
            ? `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid ${color};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`
            : shape === 'triangle-down'
              ? `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:14px solid ${color};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`
              : `<span style="display:inline-block;width:12px;height:12px;background:${color};transform:rotate(45deg);border:1px solid rgba(0,0,0,0.4);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`;

        const iconSize = shape === 'diamond' ? [12, 12] : [14, 14];
        const iconAnchor = shape === 'triangle-down' ? [7, 0] : shape === 'triangle-up' ? [7, 14] : [6, 6];
        const markerIcon = L.divIcon({ className: '', html: iconHtml, iconSize, iconAnchor });

        // replicated marker
        replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
          const marker = L.marker([lat, lon], { icon: markerIcon }).addTo(map);
          attachHoverHandlers(marker, spot);
          attachPopupWeather(marker, lat, lon, baseHtml);
          bindSpotInteraction(marker, () => onSpotClick?.(spot));
          storeRef.current.push(marker);
        });

        if (showLabels) {
          const labelIcon = L.divIcon({
            className: '',
            html: `<span style="display:inline-block;background:${color};color:#000;padding:2px 5px;border-radius:3px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;">${call}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, -2],
          });

          replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
            const label = L.marker([lat, lon], { icon: labelIcon, interactive: false }).addTo(map);
            storeRef.current.push(label);
          });
        }
      });
    },
    [onSpotClick, dxWeatherAllowed],
  );

  useEffect(() => {
    addSimpleSpotMarkers(potaSpots, showPOTA, showPOTALabels, '#44cc44', 'triangle-up', potaMarkersRef);
  }, [addSimpleSpotMarkers, potaSpots, showPOTA, showPOTALabels]);

  useEffect(() => {
    addSimpleSpotMarkers(wwffSpots, showWWFF, showWWFFLabels, '#a3f3a3', 'triangle-down', wwffMarkersRef);
  }, [addSimpleSpotMarkers, wwffSpots, showWWFF, showWWFFLabels]);

  useEffect(() => {
    // For SOTA we reuse showDXLabels as the label toggle in many builds; keep behavior compatible:
    addSimpleSpotMarkers(sotaSpots, showSOTA, showDXLabels, '#ff9632', 'diamond', sotaMarkersRef);
  }, [addSimpleSpotMarkers, sotaSpots, showSOTA, showDXLabels]);

  // --- PSKReporter ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;

    pskMarkersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    pskMarkersRef.current = [];

    const hasValidDE =
      deLocation &&
      typeof deLocation.lat === 'number' &&
      !Number.isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' &&
      !Number.isNaN(deLocation.lon);

    if (!showPSKReporter || !Array.isArray(pskReporterSpots) || pskReporterSpots.length === 0 || !hasValidDE) return;

    pskReporterSpots.forEach((spot) => {
      const spotLat = parseFloat(spot.lat);
      const spotLon = parseFloat(spot.lon);
      if (Number.isNaN(spotLat) || Number.isNaN(spotLon)) return;

      const displayCall = spot.direction === 'rx' ? spot.sender : spot.receiver || spot.sender;
      const dirLabel = spot.direction === 'rx' ? 'RX' : 'TX';
      const freqMHz = spot.freqMHz || (spot.freq ? (spot.freq / 1_000_000).toFixed(3) : '?');
      const bandColor = getBandColor(parseFloat(freqMHz));

      try {
        const points = getGreatCirclePoints(deLocation.lat, deLocation.lon, spotLat, spotLon, 50);
        if (Array.isArray(points) && points.length > 1) {
          replicatePath(points).forEach((copy) => {
            const line = L.polyline(copy, { color: bandColor, weight: 1.5, opacity: 0.5, dashArray: '4, 4' }).addTo(
              map,
            );
            pskMarkersRef.current.push(line);
          });
        }

        replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
          const circle = L.circleMarker([rLat, rLon], {
            radius: 4,
            fillColor: bandColor,
            color: '#fff',
            weight: 1,
            opacity: 0.9,
            fillOpacity: 0.8,
          })
            .bindPopup(
              `<b data-qrz-call="${esc(displayCall)}" style="cursor:pointer">${esc(displayCall)}</b> ` +
                `<span style="color:#888;font-size:10px">${dirLabel}</span><br>` +
                `${esc(spot.mode)} @ ${esc(freqMHz)} MHz<br>` +
                (spot.snr != null ? `SNR: ${spot.snr > 0 ? '+' : ''}${spot.snr} dB` : ''),
            )
            .addTo(map);

          if (onSpotClick) circle.on('click', () => onSpotClick(spot));
          pskMarkersRef.current.push(circle);
        });
      } catch (err) {
        console.warn('Error rendering PSKReporter spot:', err);
      }
    });
  }, [pskReporterSpots, showPSKReporter, deLocation, onSpotClick]);

  // --- WSJT-X ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;

    wsjtxMarkersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    wsjtxMarkersRef.current = [];

    const hasValidDE =
      deLocation &&
      typeof deLocation.lat === 'number' &&
      !Number.isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' &&
      !Number.isNaN(deLocation.lon);

    if (!showWSJTX || !Array.isArray(wsjtxSpots) || wsjtxSpots.length === 0 || !hasValidDE) return;

    const seen = new Map();
    wsjtxSpots.forEach((spot) => {
      const call = spot.caller || spot.dxCall || '';
      if (call && (!seen.has(call) || (spot.timestamp ?? 0) > (seen.get(call).timestamp ?? 0))) seen.set(call, spot);
    });

    seen.forEach((spot, call) => {
      const spotLat = parseFloat(spot.lat);
      const spotLon = parseFloat(spot.lon);
      if (Number.isNaN(spotLat) || Number.isNaN(spotLon)) return;

      const freqMHz = spot.dialFrequency ? spot.dialFrequency / 1_000_000 : 0;
      const bandColor = freqMHz ? getBandColor(freqMHz) : '#a78bfa';
      const isEstimated = spot.gridSource === 'prefix';

      try {
        const points = getGreatCirclePoints(deLocation.lat, deLocation.lon, spotLat, spotLon, 50);
        if (Array.isArray(points) && points.length > 1) {
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

        replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
          const diamond = L.marker([rLat, rLon], {
            icon: L.divIcon({
              className: '',
              html: `<div style="width:8px;height:8px;background:${bandColor};border:1px solid ${
                isEstimated ? '#888' : '#fff'
              };transform:rotate(45deg);opacity:${isEstimated ? 0.5 : 0.9};"></div>`,
              iconSize: [8, 8],
              iconAnchor: [4, 4],
            }),
          })
            .bindPopup(
              `<b data-qrz-call="${esc(call)}" style="cursor:pointer">${esc(call)}</b> ${spot.type === 'CQ' ? 'CQ' : ''}<br>` +
                `${esc(spot.grid || '')} ${esc(spot.band || '')}` +
                (spot.gridSource === 'prefix' ? ' <i>(est)</i>' : spot.gridSource === 'cache' ? ' <i>(prev)</i>' : '') +
                `<br>${esc(spot.mode || '')} SNR: ${spot.snr != null ? (spot.snr >= 0 ? '+' : '') + spot.snr : '?'} dB`,
            )
            .addTo(map);

          if (onSpotClick) diamond.on('click', () => onSpotClick(spot));
          wsjtxMarkersRef.current.push(diamond);
        });
      } catch {
        // ignore
      }
    });
  }, [wsjtxSpots, showWSJTX, deLocation, onSpotClick]);

  // Plugin layer system
  const [pluginLayerStates, setPluginLayerStates] = useState({});
  const getAvailableLayers = useCallback(() => {
    void integrationsRev;
    return getAllLayers().filter((l) => !(l.localOnly && !isLocalInstall));
  }, [integrationsRev, isLocalInstall]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    try {
      const availableLayers = getAvailableLayers();
      const settings = getStoredMapSettings();
      const savedLayers = settings.layers || {};

      const initialStates = {};
      availableLayers.forEach((layerDef) => {
        if (savedLayers[layerDef.id]) initialStates[layerDef.id] = savedLayers[layerDef.id];
        else initialStates[layerDef.id] = { enabled: layerDef.defaultEnabled, opacity: layerDef.defaultOpacity };
      });

      if (Object.keys(pluginLayerStates).length === 0) setPluginLayerStates(initialStates);

      window.hamclockLayerControls = {
        layers: availableLayers.map((l) => ({
          ...l,
          enabled: pluginLayerStates[l.id]?.enabled ?? initialStates[l.id]?.enabled ?? l.defaultEnabled,
          opacity: pluginLayerStates[l.id]?.opacity ?? initialStates[l.id]?.opacity ?? l.defaultOpacity,
          config: pluginLayerStates[l.id]?.config ?? initialStates[l.id]?.config ?? l.config,
        })),
        toggleLayer: (id, enabled) => {
          const s = getStoredMapSettings();
          const layers = s.layers || {};
          layers[id] = { ...(layers[id] || {}), enabled };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...s, layers }));
          setPluginLayerStates((prev) => ({ ...prev, [id]: { ...prev[id], enabled } }));
        },
        setOpacity: (id, opacity) => {
          const s = getStoredMapSettings();
          const layers = s.layers || {};
          layers[id] = { ...(layers[id] || {}), opacity };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...s, layers }));
          setPluginLayerStates((prev) => ({ ...prev, [id]: { ...prev[id], opacity } }));
        },
        updateLayerConfig: (id, configDelta) => {
          const s = getStoredMapSettings();
          const layers = s.layers || {};
          const cur = layers[id] || {};
          layers[id] = { ...cur, config: { ...(cur.config || {}), ...configDelta } };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...s, layers }));
          setPluginLayerStates((prev) => ({
            ...prev,
            [id]: { ...prev[id], config: { ...(prev[id]?.config || {}), ...configDelta } },
          }));
        },
      };
    } catch (err) {
      console.error('Plugin system error:', err);
    }
  }, [pluginLayerStates, integrationsRev, getAvailableLayers]);

  // --- Render ---
  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '200px' }}>
      {/* Azimuthal equidistant projection (canvas-based) */}
      {mapStyle === 'azimuthal' && (
        <AzimuthalMap
          deLocation={deLocation}
          dxLocation={dxLocation}
          onDXChange={onDXChange}
          dxLocked={dxLocked}
          potaSpots={potaSpots}
          wwffSpots={wwffSpots}
          sotaSpots={sotaSpots}
          dxPaths={dxPaths}
          dxFilters={dxFilters}
          pskReporterSpots={pskReporterSpots}
          wsjtxSpots={wsjtxSpots}
          showDXPaths={showDXPaths}
          showPOTA={showPOTA}
          showWWFF={showWWFF}
          showSOTA={showSOTA}
          showPSKReporter={showPSKReporter}
          showWSJTX={showWSJTX}
          onSpotClick={onSpotClick}
          hoveredSpot={hoveredSpot}
          callsign={callsign}
          hideOverlays={hideOverlays}
        />
      )}

      {/* Leaflet map (hidden when azimuthal is active) */}
      <div
        ref={mapRef}
        style={{
          height: '100%',
          width: '100%',
          borderRadius: '8px',
          display: mapStyle === 'azimuthal' ? 'none' : undefined,
        }}
      />

      {/* Plugin layers (Leaflet only) */}
      {mapStyle !== 'azimuthal' &&
        mapInstanceRef.current &&
        getAllLayers().map((layerDef) => (
          <PluginLayer
            key={layerDef.id}
            plugin={layerDef}
            enabled={pluginLayerStates[layerDef.id]?.enabled ?? layerDef.defaultEnabled}
            opacity={pluginLayerStates[layerDef.id]?.opacity ?? layerDef.defaultOpacity}
            config={pluginLayerStates[layerDef.id]?.config ?? layerDef.config}
            map={mapInstanceRef.current}
            satellites={satellites}
            units={units}
            callsign={callsign}
            locator={deLocator}
            lowMemoryMode={lowMemoryMode}
          />
        ))}

      {/* Map lock toggle */}
      {mapStyle !== 'azimuthal' && (
        <button
          onClick={() => setMapLocked((prev) => !prev)}
          title={mapLocked ? 'Unlock map (enable panning/zooming)' : 'Lock map (prevent accidental panning/zooming)'}
          style={{
            position: 'absolute',
            top: '72px',
            left: '10px',
            width: '30px',
            height: '30px',
            background: mapLocked ? 'rgba(255, 80, 80, 0.25)' : 'rgba(0, 0, 0, 0.6)',
            border: `2px solid ${mapLocked ? 'rgba(255, 80, 80, 0.7)' : 'rgba(0,0,0,0.3)'}`,
            borderRadius: '4px',
            color: mapLocked ? '#ff5050' : '#ccc',
            fontSize: '14px',
            cursor: 'pointer',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {mapLocked ? '🔒' : '🔓'}
        </button>
      )}

      {/* Night darkness slider */}
      {mapStyle !== 'azimuthal' && (
        <div
          title="Adjust night overlay darkness"
          style={{
            position: 'absolute',
            top: '108px',
            left: '10px',
            background: 'rgba(0, 0, 0, 0.7)',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '6px 8px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
            width: '30px',
          }}
        >
          <span style={{ fontSize: '12px', lineHeight: 1 }}>🌙</span>
          <input
            type="range"
            min="0"
            max="90"
            value={nightDarkness}
            onChange={(e) => setNightDarkness(parseInt(e.target.value))}
            style={{
              cursor: 'pointer',
              width: '80px',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center center',
              margin: '32px 0',
            }}
          />
          <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#999', lineHeight: 1 }}>
            {nightDarkness}%
          </span>
        </div>
      )}

      {/* MODIS control */}
      {mapStyle === 'MODIS' && (
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
          <div style={{ color: '#00ffcc', fontSize: '10px', fontFamily: 'JetBrains Mono' }}>
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

      {/* Map style dropdown */}
      <select
        value={mapStyle}
        onChange={(e) => setMapStyle(e.target.value)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid #444',
          color: '#00ffcc',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono',
          cursor: 'pointer',
          zIndex: 1000,
          outline: 'none',
        }}
      >
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <option key={key} value={key}>
            {style.name}
          </option>
        ))}
        {/* Keep azimuthal option if not in MAP_STYLES */}
        {!MAP_STYLES.azimuthal && <option value="azimuthal">{t?.('Azimuthal') || 'Azimuthal'}</option>}
      </select>

      {/* DX labels toggle */}
      {onToggleDXLabels && showDXPaths && Array.isArray(dxPaths) && dxPaths.length > 0 && (
        <button
          onClick={onToggleDXLabels}
          title={showDXLabels ? 'Hide callsign labels on map' : 'Show callsign labels on map'}
          style={{
            position: 'absolute',
            top: '10px',
            left: '50px',
            background: showDXLabels ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 0, 0, 0.8)',
            border: `1px solid ${showDXLabels ? '#ffaa00' : '#666'}`,
            color: showDXLabels ? '#ffaa00' : '#888',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer',
            zIndex: 1000,
          }}
        >
          ⊞ CALLS {showDXLabels ? 'ON' : 'OFF'}
        </button>
      )}

      {/* DX weather hover overlay */}
      {!hideOverlays && <CallsignWeatherOverlay hoveredSpot={hoveredSpot} enabled={dxWeatherAllowed} units={units} />}

      {/* DX News Ticker */}
      {!hideOverlays && showDXNews && <DXNewsTicker />}

      {/* Simple legend */}
      {!hideOverlays && (
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span
              style={{
                background: 'var(--accent-amber)',
                color: '#000',
                padding: '2px 5px',
                borderRadius: '3px',
                fontWeight: 600,
              }}
            >
              ● DE
            </span>
            <span
              style={{ background: '#00aaff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 }}
            >
              ● DX
            </span>
          </div>
          {showPOTA && (
            <span
              style={{ background: '#44cc44', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 }}
            >
              ▲ POTA
            </span>
          )}
          {showWWFF && (
            <span
              style={{ background: '#a3f3a3', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 }}
            >
              ▼ WWFF
            </span>
          )}
          {showSOTA && (
            <span
              style={{ background: '#ff9632', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 }}
            >
              ◆ SOTA
            </span>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ color: '#ffcc00' }}>☼ Sun</span>
            <span style={{ color: '#aaaaaa' }}>☽ Moon</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
