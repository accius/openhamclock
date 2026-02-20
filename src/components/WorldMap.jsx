/**
 * WorldMap Component
 * Leaflet map with DE/DX markers, terminator, DX paths, POTA, satellites, PSKReporter
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
  normalizeLon,
  classifyTwilight,
  calculateSolarElevation,
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
import { getAllLayers } from '../plugins/layerRegistry.js';
import useLocalInstall from '../hooks/app/useLocalInstall.js';
import { IconSatellite, IconTag, IconSun, IconMoon } from './Icons.jsx';
import PluginLayer from './PluginLayer.jsx';
import AzimuthalMap from './AzimuthalMap.jsx';
import { DXNewsTicker } from './DXNewsTicker.jsx';
import { CallsignWeatherOverlay } from './CallsignWeatherOverlay.jsx';
import { getCallsignWeather } from '../utils/callsignWeather.js';
import { filterDXPaths } from '../utils';

// SECURITY: Escape HTML to prevent XSS in Leaflet popups/tooltips
// DX cluster data, POTA/SOTA spots, and WSJT-X decodes come from external sources
// and could contain malicious HTML/script tags in callsigns, comments, or park names.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normalize callsign keys used for DX hover/highlight matching
const normalizeCallsignKey = (v) => (v || '').toString().toUpperCase().trim();

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

export const WorldMap = ({
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,
  potaSpots,
  wwffSpots,
  sotaSpots,
  dxPaths,
  dxFilters,
  mapBandFilter,
  onMapBandFilterChange,
  satellites,
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths,
  showDXLabels,
  onToggleDXLabels,
  showPOTA,
  showPOTALabels = true,
  showWWFF,
  showWWFFLabels = true,
  showSOTA,
  showSOTALabels = true,
  showPSKReporter,
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
  units = 'imperial',
  mouseZoom,
  showRotatorBearing = false,
  rotatorAzimuth = null,
  rotatorLastGoodAzimuth = null,
  rotatorIsStale = false,
  rotatorControlEnabled,
  onRotatorTurnRequest,
  mySpots,
  onToggleSatellites,
  onHoverSpot,
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
  const aprsMarkersRef = useRef([]);
  const countriesLayerRef = useRef([]);
  const dxLockedRef = useRef(dxLocked);
  const rotatorLineRef = useRef(null);
  const rotatorGlowRef = useRef(null);
  const rotatorTurnRef = useRef(onRotatorTurnRequest);
  const rotatorEnabledRef = useRef(rotatorControlEnabled);
  const deRef = useRef(deLocation);
  const mySpotsMarkersRef = useRef([]);
  const mySpotsLinesRef = useRef([]);
  const satMarkersRef = useRef([]);
  const satTracksRef = useRef([]);
  // DX highlight state (style existing polylines via refs; no layer rebuilds)
  const dxLineIndexRef = useRef(new Map());
  const dxHighlightKeyRef = useRef('');
  const dxHighlightLockedRef = useRef(false);

  // Calculate grid locator from DE location for plugins
  const deLocator = useMemo(() => {
    if (!deLocation?.lat || !deLocation?.lon) return '';
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

  // ── DX highlight helpers (click highlight + DX Cluster panel hover highlight) ──
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
      dxHighlightKeyRef.current = k;
      const lines = dxLineIndexRef.current.get(k) || [];
      lines.forEach((ln) => {
        ln.setStyle({ color: '#ffffff', weight: 3, opacity: 1 });
      });
    },
    [clearDXHighlight],
  );

  // Expose DE location to window for plugins (e.g., RBN)
  useEffect(() => {
    if (deLocation?.lat && deLocation?.lon) {
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
    } catch {}
    return () => {
      try {
        window.removeEventListener('ohc-n3fjp-config-changed', bump);
        window.removeEventListener('ohc-rotator-config-changed', bump);
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
  const [mapStyle, setMapStyle] = useState(storedSettings.mapStyle || 'dark');
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
          center: mapView.center,
          zoom: mapView.zoom,
          wheelPxPerZoomLevel: getScaledZoomLevel(mouseZoom),
        }),
      );
    } catch (e) {
      console.error('Failed to save map settings:', e);
    }
  }, [mapStyle, mapView, mouseZoom]);

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

    // --- night pane ---
    map.createPane('nightPane');
    const nightPane = map.getPane('nightPane');
    nightPane.style.zIndex = 650;
    nightPane.style.pointerEvents = 'none';
    nightPane.id = 'night-lights-pane';

    // Initial tile layer (Base Day Map)
    tileLayerRef.current = L.tileLayer(MAP_STYLES[mapStyle].url, {
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
      const center = map.getCenter();
      const zoom = map.getZoom();
      setMapView({ center: [center.lat, center.lng], zoom });
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

    // Apply initial map lock state if saved
    if (mapLocked) {
      [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard].forEach(
        (h) => {
          if (h) h.disable();
        },
      );
      const zc = map.zoomControl?.getContainer();
      if (zc) zc.style.display = 'none';
    }

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      clearInterval(terminatorInterval);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [leafletReady]); // leafletReady flips to true once window.L is confirmed available

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

  // Update tile layer and handle night light clipping
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old tile layer completely — setUrl() doesn't flush the tile cache,
    // leaving stale "Map data not yet available" tiles visible until zoom/pan.
    map.removeLayer(tileLayerRef.current);

    // Determine the URL: Use the dynamic GIBS generator if 'MODIS' is selected
    let url = MAP_STYLES[mapStyle].url;
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

    // DE Marker — replicate across world copies
    replicatePoint(deLocation.lat, deLocation.lon).forEach(([lat, lon]) => {
      const deIcon = L.divIcon({
        className: 'custom-marker de-marker',
        html: 'DE',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const m = L.marker([lat, lon], { icon: deIcon })
        .bindPopup(
          `<b>DE - Your Location</b><br>${calculateGridSquare(deLocation.lat, deLocation.lon)}<br>${deLocation.lat.toFixed(4)}°, ${deLocation.lon.toFixed(4)}°`,
        )
        .addTo(map);
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
      const m = L.marker([lat, lon], { icon: dxIcon })
        .bindPopup(
          `<b>DX - Target</b><br>${calculateGridSquare(dxLocation.lat, dxLocation.lon)}<br>${dxLocation.lat.toFixed(4)}°, ${dxLocation.lon.toFixed(4)}°`,
        )
        .addTo(map);
      dxMarkerRef.current.push(m);
    });
  }, [deLocation, dxLocation]);

  // Update sun/moon markers every 60 seconds (matches terminator refresh)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const updateCelestial = () => {
      if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);

      const now = new Date();

      // Sun marker
      const sunPos = getSunPosition(now);
      const sunIcon = L.divIcon({
        className: 'custom-marker sun-marker',
        html: '☼',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      sunMarkerRef.current = L.marker([sunPos.lat, sunPos.lon], {
        icon: sunIcon,
      })
        .bindPopup(`<b>☼ Subsolar Point</b><br>${sunPos.lat.toFixed(2)}°, ${sunPos.lon.toFixed(2)}°`)
        .addTo(map);

      // Moon marker
      const moonPos = getMoonPosition(now);
      const moonIcon = L.divIcon({
        className: 'custom-marker moon-marker',
        html: '☽',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      moonMarkerRef.current = L.marker([moonPos.lat, moonPos.lon], {
        icon: moonIcon,
      })
        .bindPopup(`<b>☽ Sublunar Point</b><br>${moonPos.lat.toFixed(2)}°, ${moonPos.lon.toFixed(2)}°`)
        .addTo(map);
    };

    // Initial render
    updateCelestial();

    // Update every 60 seconds to match terminator
    const interval = setInterval(updateCelestial, 60000);
    return () => {
      clearInterval(interval);
      if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);
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
        const band = bandFromAnyFrequency(path.freq);
        if (!bandPassesMapFilter(band)) return;

        try {
          if (!path.spotterLat || !path.spotterLon || !path.dxLat || !path.dxLon) return;
          if (isNaN(path.spotterLat) || isNaN(path.spotterLon) || isNaN(path.dxLat) || isNaN(path.dxLon)) return;

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
          replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
            const dxCircle = L.circleMarker([lat, lon], {
              radius: isHovered ? 12 : 6,
              fillColor: isHovered ? '#ffffff' : color,
              color: isHovered ? color : '#fff',
              weight: isHovered ? 3 : 1.5,
              opacity: 1,
              fillOpacity: isHovered ? 1 : 0.9,
              interactive: !!onSpotClick,
            })
              .bindPopup(
                `<b data-qrz-call="${esc(path.dxCall)}" style="color: ${color}; cursor:pointer">${esc(path.dxCall)}</b><br>${esc(path.freq)} MHz<br>by <span data-qrz-call="${esc(path.spotter)}" style="cursor:pointer">${esc(path.spotter)}</span>`,
              )
              .addTo(map);

            if (onSpotClick) {
              dxCircle.on('click', () => onSpotClick(path));
            }

            if (isHovered) dxCircle.bringToFront();
            dxPathsMarkersRef.current.push(dxCircle);
          });

          // Add label if enabled — replicate across world copies
          if (showDXLabels || isHovered) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:${isHovered ? '#fff' : color};color:${isHovered ? color : '#000'};padding:${isHovered ? '3px 6px' : '2px 5px'};border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:${isHovered ? '12px' : '11px'};font-weight:700;white-space:nowrap;border:1px solid ${isHovered ? color : 'rgba(0,0,0,0.5)'};box-shadow:0 1px ${isHovered ? '4px' : '2px'} rgba(0,0,0,${isHovered ? '0.5' : '0.3'});line-height:1.1;">${path.dxCall}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });
            replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: !!onSpotClick,
                zIndexOffset: isHovered ? 10000 : 0,
              }).addTo(map);

              if (onSpotClick) {
                label.on('click', () => onSpotClick(path));
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

  // Update POTA markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    potaMarkersRef.current.forEach((m) => map.removeLayer(m));
    potaMarkersRef.current = [];

    if (showPOTA && potaSpots) {
      potaSpots.forEach((spot) => {
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        if (spot.lat && spot.lon) {
          // Green triangle marker for POTA activators — replicate across world copies
          replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
            const triangleIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid #44cc44;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
              iconSize: [14, 14],
              iconAnchor: [7, 14],
            });
            const marker = L.marker([lat, lon], { icon: triangleIcon })
              .bindPopup(
                `<b data-qrz-call="${esc(spot.call)}" style="color:#44cc44; cursor:pointer">${esc(spot.call)}</b><br><span style="color:#888">${esc(spot.ref)}</span> ${esc(spot.locationDesc || '')}<br>${spot.name ? `<i>${esc(spot.name)}</i><br>` : ''}${esc(spot.freq)} ${esc(spot.mode || '')} <span style="color:#888">${esc(spot.time || '')}</span>`,
              )
              .addTo(map);

            if (onSpotClick) {
              marker.on('click', () => onSpotClick(spot));
            }

            potaMarkersRef.current.push(marker);
          });

          // Only show callsign label when labels are enabled — replicate
          if (showPOTALabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:#44cc44;color:#000;padding:2px 5px;border-radius:3px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;">${spot.call}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, -2],
            });
            replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: false,
              }).addTo(map);
              potaMarkersRef.current.push(label);
            });
          }
        }
      });
    }
  }, [potaSpots, showPOTA, showPOTALabels, bandPassesMapFilter]);

  // Update WWFF markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    wwffMarkersRef.current.forEach((m) => map.removeLayer(m));
    wwffMarkersRef.current = [];

    if (showWWFF && wwffSpots) {
      wwffSpots.forEach((spot) => {
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        if (spot.lat && spot.lon) {
          // Light green inverted triangle for WWFF activators — replicate across world copies
          replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
            const triangleIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:14px solid #a3f3a3;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
              iconSize: [14, 14],
              iconAnchor: [7, 0],
            });
            const marker = L.marker([lat, lon], { icon: triangleIcon })
              .bindPopup(
                `<b data-qrz-call="${esc(spot.call)}" style="color:#a3f3a3; cursor:pointer">${esc(spot.call)}</b><br><span style="color:#888">${esc(spot.ref)}</span> ${esc(spot.locationDesc || '')}<br>${spot.name ? `<i>${esc(spot.name)}</i><br>` : ''}${esc(spot.freq)} ${esc(spot.mode || '')} <span style="color:#888">${esc(spot.time || '')}</span>`,
              )
              .addTo(map);

            if (onSpotClick) {
              marker.on('click', () => onSpotClick(spot));
            }

            wwffMarkersRef.current.push(marker);
          });

          // Only show callsign label when labels are enabled — replicate
          if (showWWFFLabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:#a3f3a3;color:#000;padding:2px 5px;border-radius:3px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;">${esc(spot.call)}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, -2],
            });
            replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: false,
              }).addTo(map);
              wwffMarkersRef.current.push(label);
            });
          }
        }
      });
    }
  }, [wwffSpots, showWWFF, showWWFFLabels, bandPassesMapFilter]);

  // Update SOTA markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    sotaMarkersRef.current.forEach((m) => map.removeLayer(m));
    sotaMarkersRef.current = [];

    if (showSOTA && sotaSpots) {
      sotaSpots.forEach((spot) => {
        const band = normalizeBandKey(spot.band) || bandFromAnyFrequency(spot.freq);
        if (!bandPassesMapFilter(band)) return;

        if (spot.lat && spot.lon) {
          // Orange diamond marker for SOTA activators — replicate across world copies
          replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
            const diamondIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;width:12px;height:12px;background:#ff9632;transform:rotate(45deg);border:1px solid rgba(0,0,0,0.4);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            });
            const marker = L.marker([lat, lon], { icon: diamondIcon })
              .bindPopup(
                `<b data-qrz-call="${esc(spot.call)}" style="color:#ff9632; cursor:pointer">${esc(spot.call)}</b><br><span style="color:#888">${esc(spot.ref)}</span>${spot.summit ? ` — ${esc(spot.summit)}` : ''}${spot.points ? ` <span style="color:#ff9632">(${esc(spot.points)}pt)</span>` : ''}<br>${esc(spot.freq)} ${esc(spot.mode || '')} <span style="color:#888">${esc(spot.time || '')}</span>`,
              )
              .addTo(map);

            if (onSpotClick) {
              marker.on('click', () => onSpotClick(spot));
            }

            sotaMarkersRef.current.push(marker);
          });

          // Only show callsign label when labels are enabled — replicate
          if (showSOTALabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:#ff9632;color:#000;padding:2px 5px;border-radius:3px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;">${spot.call}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, -2],
            });
            replicatePoint(spot.lat, spot.lon).forEach(([lat, lon]) => {
              const label = L.marker([lat, lon], {
                icon: labelIcon,
                interactive: false,
              }).addTo(map);
              sotaMarkersRef.current.push(label);
            });
          }
        }
      });
    }
  }, [sotaSpots, showSOTA, showSOTALabels, bandPassesMapFilter]);

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

          try {
            // Draw line from DE to spot location
            // TX = solid line (my signal going out), RX = dashed line (signals coming in)
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

            // TX = circle marker, RX = diamond marker (colorblind-friendly shape distinction)
            replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
              let marker;
              if (isRx) {
                // Diamond marker for RX
                marker = L.marker([rLat, rLon], {
                  icon: L.divIcon({
                    className: '',
                    html: `<div style="
                      width: 8px; height: 8px;
                      background: ${bandColor};
                      border: 1px solid #fff;
                      transform: rotate(45deg);
                      opacity: 0.9;
                    "></div>`,
                    iconSize: [8, 8],
                    iconAnchor: [4, 4],
                  }),
                });
              } else {
                // Circle marker for TX
                marker = L.circleMarker([rLat, rLon], {
                  radius: 4,
                  fillColor: bandColor,
                  color: '#fff',
                  weight: 1,
                  opacity: 0.9,
                  fillOpacity: 0.8,
                });
              }

              marker
                .bindPopup(
                  `
                <b data-qrz-call="${esc(displayCall)}" style="cursor:pointer">${esc(displayCall)}</b> <span style="color:#888;font-size:10px">${dirLabel}</span><br>
                ${esc(spot.mode)} @ ${esc(freqMHz)} MHz<br>
                ${spot.snr !== null ? `SNR: ${spot.snr > 0 ? '+' : ''}${spot.snr} dB` : ''}
              `,
                )
                .addTo(map);

              if (onSpotClick) {
                marker.on('click', () => onSpotClick(spot));
              }

              pskMarkersRef.current.push(marker);
            });
          } catch (err) {
            console.warn('Error rendering PSKReporter spot:', err);
          }
        }
      });
    }
  }, [pskReporterSpots, showPSKReporter, deLocation, bandColorVersion, bandPassesMapFilter]);

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
      // For CQ: caller is the station. For QSO: dxCall is the remote station.
      const seen = new Map();
      wsjtxSpots.forEach((spot) => {
        const call = spot.caller || spot.dxCall || '';
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
              })
                .bindPopup(
                  `
                <b data-qrz-call="${esc(call)}" style="cursor:pointer">${esc(call)}</b> ${spot.type === 'CQ' ? 'CQ' : ''}<br>
                ${esc(spot.grid || '')} ${esc(spot.band || '')}${spot.gridSource === 'prefix' ? ' <i>(est)</i>' : spot.gridSource === 'cache' ? ' <i>(prev)</i>' : ''}<br>
                ${esc(spot.mode || '')} SNR: ${spot.snr != null ? (spot.snr >= 0 ? '+' : '') + spot.snr : '?'} dB
              `,
                )
                .addTo(map);

              if (onSpotClick) {
                diamond.on('click', () => onSpotClick(spot));
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
        const color = isWatched ? '#f59e0b' : '#22d3ee'; // amber for watched, cyan for regular
        const size = isWatched ? 7 : 5;

        try {
          // Triangle marker for APRS stations (distinct from circles/diamonds)
          replicatePoint(lat, lon).forEach(([rLat, rLon]) => {
            const marker = L.marker([rLat, rLon], {
              icon: L.divIcon({
                className: '',
                html: `<div style="
                  width: 0; height: 0;
                  border-left: ${size}px solid transparent;
                  border-right: ${size}px solid transparent;
                  border-bottom: ${size * 1.6}px solid ${color};
                  filter: drop-shadow(0 0 2px rgba(0,0,0,0.5));
                  opacity: 0.9;
                "></div>`,
                iconSize: [size * 2, size * 1.6],
                iconAnchor: [size, size * 1.6],
              }),
              zIndexOffset: isWatched ? 5000 : 1000,
            });

            const ageStr = station.age < 1 ? 'now' : station.age < 60 ? `${station.age}m ago` : `${Math.floor(station.age / 60)}h ago`;

            marker
              .bindPopup(`
                <b data-qrz-call="${esc(station.call)}" style="cursor:pointer">${esc(station.ssid || station.call)}</b>
                ${isWatched ? ' <span style="color:#f59e0b">★</span>' : ''}<br>
                <span style="color:#888;font-size:11px">${ageStr}</span><br>
                ${station.speed > 0 ? `Speed: ${station.speed} kt<br>` : ''}
                ${station.altitude ? `Alt: ${station.altitude} ft<br>` : ''}
                ${station.comment ? `<span style="font-size:11px;color:#aaa">${esc(station.comment.substring(0, 80))}</span>` : ''}
              `)
              .addTo(map);

            if (onSpotClick) {
              marker.on('click', () => onSpotClick({ call: station.call, lat, lon }));
            }

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
          mapBandFilter={mapBandFilter}
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

      <div
        ref={mapRef}
        style={{
          height: '100%',
          width: '100%',
          borderRadius: '8px',
          background: mapStyle === 'countries' ? '#4a90d9' : undefined,
          display: mapStyle === 'azimuthal' ? 'none' : undefined,
        }}
      />

      {/* Render all plugin layers (Leaflet only) */}
      {mapStyle !== 'azimuthal' &&
        mapInstanceRef.current &&
        getAllLayers().map((layerDef) => (
          <PluginLayer
            key={layerDef.id}
            plugin={layerDef}
            enabled={pluginLayerStates[layerDef.id]?.enabled ?? layerDef.defaultEnabled}
            opacity={pluginLayerStates[layerDef.id]?.opacity ?? layerDef.defaultOpacity}
            mapBandFilter={mapBandFilter}
            config={pluginLayerStates[layerDef.id]?.config ?? layerDef.config}
            map={mapInstanceRef.current}
            satellites={satellites}
            units={units}
            callsign={callsign}
            locator={deLocator}
            lowMemoryMode={lowMemoryMode}
          />
        ))}

      {/* MODIS Control (Only shows when MODIS map style is active) */}

      {/* Map lock toggle — below Leaflet zoom controls (Leaflet only) */}
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

      {/* Night darkness slider (Leaflet only) */}
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
          <span
            style={{
              fontSize: '9px',
              fontFamily: 'JetBrains Mono, monospace',
              color: '#999',
              lineHeight: 1,
            }}
          >
            {nightDarkness}%
          </span>
        </div>
      )}

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
      </select>

      {/* Satellite toggle */}

      {/* Labels toggle */}
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

      {/* DX News Ticker - left side of bottom bar */}
      {!hideOverlays && showDXNews && <DXNewsTicker />}

      {/* Legend - centered above news ticker */}
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span
              style={{
                background: 'var(--accent-amber)',
                color: '#000',
                padding: '2px 5px',
                borderRadius: '3px',
                fontWeight: '600',
              }}
            >
              ●&nbsp;DE
            </span>
            <span
              style={{
                background: '#00aaff',
                color: '#000',
                padding: '2px 5px',
                borderRadius: '3px',
                fontWeight: '600',
              }}
            >
              ●&nbsp;DX
            </span>
          </div>
          {showPOTA && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span
                style={{
                  background: '#44cc44',
                  color: '#000',
                  padding: '2px 5px',
                  borderRadius: '3px',
                  fontWeight: '600',
                }}
              >
                ▲&nbsp;POTA
              </span>
            </div>
          )}
          {showWWFF && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span
                style={{
                  background: '#a3f3a3',
                  color: '#000',
                  padding: '2px 5px',
                  borderRadius: '3px',
                  fontWeight: '600',
                }}
              >
                ▼ WWFF
              </span>
            </div>
          )}
          {showSOTA && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span
                style={{
                  background: '#ff9632',
                  color: '#000',
                  padding: '2px 5px',
                  borderRadius: '3px',
                  fontWeight: '600',
                }}
              >
                ◆&nbsp;SOTA
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ color: '#ffcc00' }}>☼&nbsp;{t('app.legend.sun')}</span>
            <span style={{ color: '#aaaaaa' }}>☽&nbsp;{t('app.legend.moon')}</span>
          </div>
        </div>
      )}
      {!hideOverlays && editingBand && (
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
