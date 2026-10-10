/**
 * Globe3D Component
 * WebGL globe (three.js) rendering the station's world view on a real sphere.
 *
 * Unlike the Mercator and azimuthal views this one is not backed by Leaflet, so
 * great circles are drawn as true 3D arcs (slerp between unit vectors) and the
 * day/night terminator is a shader on the sphere rather than a canvas overlay.
 *
 * Consequence: Leaflet-bound plugin layers cannot attach here. Satellites
 * render natively in 3D, and the globe-capable overlay subset (Maidenhead
 * grid, CQ/ITU zones, D-RAP, aurora — see utils/globeOverlays.js) paints onto
 * one shared equirectangular canvas draped as a transparent shell over the
 * sphere. Everything else stays 2D-only and WorldMap suppresses it (with a
 * visible note) while this projection is active.
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getBandColor, getBandFromFreq } from '../utils/callsign.js';
import { getBandColorForBand } from '../utils/bandColors.js';
import { getSunPosition, getMoonPosition, getMoonAzEl, densifyGeoJson } from '../utils/geo.js';
import { lzwDecode } from '../plugins/layers/useLightning.js';
import { MAP_STYLES } from '../utils/config.js';
import { buildGlobeTexture, buildGlobeDetailPatch, chooseGlobeTileZoom } from '../utils/globeTexture.js';
import {
  classifySatellite,
  getArchetypeTemplate,
  getEnterpriseTemplate,
  loadIssTemplate,
} from '../utils/satelliteModels.js';
import { getSantaTemplate } from '../utils/santaModel.js';
import { getSantaState, resolveSantaClock, destinationPoint, formatPresents } from '../utils/santa.js';
import { GLOBE_OVERLAY_PAINTERS, ZONE_SOURCES, workedGridCounts, decimateAircraft } from '../utils/globeOverlays.js';
import logbookStore from '../services/logbookStore.js';
import { MAX_LOGBOOK_LINES, useLogbookMapPoints } from '../utils/logbookMap.js';
import {
  acquire as acquireHistory,
  release as releaseHistory,
  subscribe as subscribeHistory,
  buildTransportControl as buildHistoryTransportControl,
} from '../services/historyPlaybackStore.js';
import { makeDraggable } from '../plugins/layers/makeDraggable.js';
import { addMinimizeToggle } from '../plugins/layers/addMinimizeToggle.js';
import { ACTIVITY_COLORS } from '../utils/activityColors.js';
// Project icon set — exists because bare glyphs/emoji render inconsistently
// (or as tofu) depending on the platform's font coverage.
import { LiEye, LiEyeOff, LiRotate } from './Icons.jsx';
import SatelliteInfoPanel from './SatelliteInfoPanel.jsx';

const DEG = Math.PI / 180;
const EARTH_R = 1;
const DEFAULT_CAM_DISTANCE = 3.2;
// Orbit ceiling. The EME layout lifts it so Earth and Moon frame together.
const CAM_MAX_DISTANCE = 8;
const EME_CAM_MAX_DISTANCE = 22;
// Where the moon sprite sits: compressed (true scale is ~60 Earth radii) but
// outside the normal orbit ceiling and inside the starfield.
const MOON_DIST = 12;
// EME framing: orbit target at the Earth–Moon midpoint; the camera distance
// is derived from the viewport so Earth (radius 1) and Moon both fit, with
// this much clearance beyond the Earth's limb, in Earth radii.
const EME_FRAME_MARGIN = 1.8;
// Altitude of every overlay above the sphere, as a multiple of EARTH_R.
// Markers and arc endpoints share it so arcs start exactly at the dot.
const MARKER_ALT = 1.012;
// Plugin overlay shell: above the surface (so it never z-fights the earth
// mesh) but below the markers, so heatmaps never cover spot dots.
const OVERLAY_ALT = 1.005;
// Shared plugin-overlay canvas resolution (equirectangular, 2:1). At 2048
// wide a 1° aurora cell is ~5.7 px — smooth enough once the GPU's bilinear
// filtering has its say. The whole feature is skipped in low-memory mode.
const OVERLAY_TEX_W = 2048;
const OVERLAY_TEX_H = 1024;
// Below this panel width WorldMap's projection toggle wraps across the top of
// the map, so the globe's own controls have to move out from under it.
const NARROW_PANEL_PX = 480;
const CONTROLS_TOP_WIDE = '10px';
const CONTROLS_TOP_NARROW = '52px';
const AUTOROTATE_KEY = 'ohc_globe_autorotate';
const AUTOROTATE_SPEED = 0.6;
// Screensaver delay: rotation starts only after this much user inactivity.
const AUTOROTATE_IDLE_MS = 30_000;

// ── Geometry helpers ───────────────────────────────────────
// Matches THREE.SphereGeometry's UV layout: u=0 at lon -180, v=1 at lat +90.
function latLonToVec3(lat, lon, r = EARTH_R, target = new THREE.Vector3()) {
  const theta = (90 - lat) * DEG;
  const phi = (lon + 180) * DEG;
  const sinT = Math.sin(theta);
  return target.set(-r * Math.cos(phi) * sinT, r * Math.cos(theta), r * Math.sin(phi) * sinT);
}

function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) / DEG;
  let lon = Math.atan2(n.z, -n.x) / DEG - 180;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

/**
 * Great circle arc as 3D points, bowed outward so it reads above the surface.
 * Longer paths arc higher, which keeps antipodal hops legible.
 */
function greatCircleArc(lat1, lon1, lat2, lon2, segments = 64) {
  const a = latLonToVec3(lat1, lon1, 1);
  const b = latLonToVec3(lat2, lon2, 1);
  const angle = a.angleTo(b);
  const pts = [];

  if (angle < 1e-6) return [a.clone().multiplyScalar(EARTH_R * MARKER_ALT)];

  // Matches the QSO plotter's profile: a floor so short hops still stand off
  // the surface, ramping to a high arc by ~18000 km.
  const lift = 0.03 + 0.15 * Math.min(1, (angle * 6371) / 18000);
  const sinAngle = Math.sin(angle);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Spherical linear interpolation — the true great circle between a and b.
    const w1 = Math.sin((1 - t) * angle) / sinAngle;
    const w2 = Math.sin(t * angle) / sinAngle;
    const p = new THREE.Vector3(a.x * w1 + b.x * w2, a.y * w1 + b.y * w2, a.z * w1 + b.z * w2);
    p.normalize().multiplyScalar(EARTH_R * (MARKER_ALT + lift * Math.sin(t * Math.PI)));
    pts.push(p);
  }
  return pts;
}

// ── Band helpers (mirrors AzimuthalMap) ────────────────────
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

// ── Round sprite for spot markers ──────────────────────────
function makeDotTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Relative luminance of any CSS colour string, resolved by letting canvas do
 * the parsing. Composited over black so the theme's translucent panel colours
 * resolve the way they actually appear.
 */
function cssColorLuma(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1, 1);
  try {
    ctx.fillStyle = color;
  } catch {
    return 0;
  }
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Resolve a CSS custom property to a colour string.
 * WebGL materials cannot reference var(), so theme colours have to be read out
 * and handed to THREE.Color; the fallback covers a missing/renamed variable.
 */
function cssVarColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Globe-only marker colours. The activity programmes (POTA/WWFF/SOTA/WWBOTA)
 * come from the shared palette so the globe cannot drift from the panels and
 * the other projections again; these are the ones only this view draws.
 */
const GLOBE_COLORS = {
  pskRx: '#ff44aa',
  pskTx: '#aa66ff',
  wsjtx: '#00ddff',
  bandFallback: '#ffcc00',
};

// Same sessionStorage key the Leaflet satellite layer uses, so a satellite
// selected in Flat mode stays selected when switching to 3D and back.
const SAT_SELECTED_KEY = 'selected_satellites';

// Camera distance (earth radii from center) below which satellites swap from
// dots to 3D models. Selected satellites show their model at any distance.
const SAT_MODEL_LOD_DIST = 2.6;

// Built globe textures, keyed by template|zoom|lang. Entries are 4096- or
// 8192-wide canvases (up to ~130 MB each), so keep only the last two — enough
// that the detail upgrade and a style toggle don't refetch their tiles.
const textureCanvasCache = new Map();
const TEXTURE_CACHE_MAX = 2;

function readSelectedSats() {
  try {
    const raw = sessionStorage.getItem(SAT_SELECTED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Circle of points on the sphere at a given angular radius around a centre —
 * the satellite's footprint (the region that can hear it).
 */
function footprintRingPoints(lat, lon, angularRadius, r, segments = 72) {
  const n = latLonToVec3(lat, lon, 1);
  // Any vector not parallel to n gives a tangent basis.
  const ref = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(n, ref).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const cosT = Math.cos(angularRadius);
  const sinT = Math.sin(angularRadius);
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        cosT * n.x + sinT * (Math.cos(phi) * e1.x + Math.sin(phi) * e2.x),
        cosT * n.y + sinT * (Math.cos(phi) * e1.y + Math.sin(phi) * e2.y),
        cosT * n.z + sinT * (Math.cos(phi) * e1.z + Math.sin(phi) * e2.z),
      ).multiplyScalar(r),
    );
  }
  return pts;
}

/**
 * Cone from a satellite down to its footprint ring — the volume it can hear.
 *
 * A triangle fan from the satellite to consecutive points of the ring, so the
 * cone's base is exactly the footprint the ring already draws rather than an
 * approximation of it. Open at both ends: there is no cap at the satellite (it
 * is a point) and none on the ground, where the ring itself reads as the edge.
 */
function footprintConeGeometry(apex, ringPts) {
  const positions = new Float32Array(ringPts.length * 9);
  for (let i = 0; i < ringPts.length; i++) {
    const a = ringPts[i];
    const b = ringPts[(i + 1) % ringPts.length];
    positions.set([apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z], i * 9);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

// Stars and the atmospheric limb only read against a dark backdrop; on the
// Light and Retro themes they turn into grey noise around the globe.
function backdropIsDark() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim();
  if (!v) return true;
  return cssColorLuma(v) < 0.4;
}

function makeStarfield(count = 1800) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform points on a large sphere shell.
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 22 + Math.random() * 12;
    positions[i * 3] = r * s * Math.cos(phi);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// ── Earth shader: texture + day/night terminator ───────────
const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uDetail;    // close-zoom patch for the visible window
  uniform float uDetailOn;      // 0/1
  uniform vec4 uDetailBounds;   // uMin, uSpan, vTop, vBottom (base-texture UV space)
  uniform vec3 uSunDir;         // in view space
  uniform float uNightDarkness; // 0..1, same meaning as the flat map's overlay opacity
  uniform float uBrightness;    // lift for dark basemaps
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec3 tex = texture2D(uMap, vUv).rgb * uBrightness;
    // High-zoom detail patch: replaces the base inside its window, feathered
    // at the edges so the seam never reads as a hard line. Longitude compare
    // wraps so a patch spanning the antimeridian still works.
    if (uDetailOn > 0.5) {
      float du = mod(vUv.x - uDetailBounds.x + 1.0, 1.0);
      float vSpan = uDetailBounds.z - uDetailBounds.w;
      if (du < uDetailBounds.y && vUv.y > uDetailBounds.w && vUv.y < uDetailBounds.z) {
        vec2 duv = vec2(du / uDetailBounds.y, (vUv.y - uDetailBounds.w) / vSpan);
        vec3 det = texture2D(uDetail, duv).rgb * uBrightness;
        float f = smoothstep(0.0, 0.04, duv.x) * smoothstep(0.0, 0.04, 1.0 - duv.x) *
                  smoothstep(0.0, 0.04, duv.y) * smoothstep(0.0, 0.04, 1.0 - duv.y);
        tex = mix(tex, det, f);
      }
    }
    float d = dot(normalize(vNormal), normalize(uSunDir));
    // Soft band across the terminator rather than a hard edge.
    float day = smoothstep(-0.14, 0.14, d);
    // Flat mode paints a near-black polygon at fillOpacity over the night side,
    // which resolves to tex * (1 - opacity); match that so the slider means the
    // same thing in both projections.
    vec3 night = tex * (1.0 - uNightDarkness) + vec3(0.0, 0.01, 0.035) * uNightDarkness;
    vec3 col = mix(night, tex, day);
    gl_FragColor = vec4(col, 1.0);

    // Sampling an sRGB texture yields linear values; without this the linear
    // numbers are written as if they were already sRGB and everything renders
    // far too dark. Built-in materials include this chunk for us.
    #include <colorspace_fragment>
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMO_FRAG = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    // Rim brightest at grazing angles — cheap atmospheric limb.
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
    gl_FragColor = vec4(0.25, 0.65, 1.0, 1.0) * intensity;
    #include <colorspace_fragment>
  }
`;

// ── Component ──────────────────────────────────────────────
export default function Globe3D({
  deLocation,
  dxLocation,
  onDXChange,
  dxLocked,
  potaSpots,
  wwffSpots,
  sotaSpots,
  wwbotaSpots,
  dxPaths,
  mapBandFilter,
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths,
  showPOTA,
  showWWFF,
  showSOTA,
  showWWBOTA,
  showPSKReporter,
  showPSKPaths = true,
  showWSJTX,
  onSpotClick,
  callsign,
  showDeDxMarkers = true,
  satellites,
  satellitesEnabled = true,
  suppressedLayers = [],
  // { layerId: { enabled, opacity } } for the globe-capable plugin layers —
  // same states the flat map persists to openhamclock_mapSettings.layers.
  overlayLayerStates = null,
  allUnits = { dist: 'imperial' },
  config,
  hideUi = false,
  // Flips WorldMap's mapUiHidden state (persisted as openhamclock_mapUiHidden)
  // — the globe's counterpart to the flat map's eye button, which lives in a
  // Leaflet-only dock that never renders in 3D.
  onToggleHideUi,
  tileStyle = 'dark',
  lowMemoryMode = false,
  nightDarkness = 60,
  // EME layout: draw the DE→Moon→DX legs and frame Earth + Moon together.
  // emeFrameKey re-runs the framing when bumped (a "re-centre" button).
  emeMode = false,
  emeFrameKey = 0,
  // Satellite relay mode (EME layout): legs go DE→satellite→DX instead of
  // via the moon, only this satellite is drawn (with its footprint), and
  // framing centres over its sub-point. relayTarget refreshes every second.
  relaySatName = null,
  relayTarget = null, // { lat, lon, altKm, deUp, dxUp }
  // EME activity (PSK Reporter Q65/JT65 reports): faint sender→Moon→receiver
  // paths in band colour, drawn alongside the DE/DX legs in moon mode.
  emeActivityPaths = null, // [{ aLat, aLon, bLat, bLon, freqMHz }]
  onNightDarknessChange,
}) {
  const { t, i18n } = useTranslation();
  // Basemap label language, resolved the way AzimuthalMap does it. Without
  // this, {lang} templates fell through to the builder's 'en' default and
  // non-English operators got English labels only in 3D.
  const mapLang = i18n.language?.split('-')[0] || 'en';
  const containerRef = useRef(null);
  const gl = useRef({}); // three.js objects, kept off React state
  // Mirrors the nightDarkness prop so a scene rebuild seeds the shader uniform
  // with the current value instead of snapping back to the material default.
  const nightDarknessRef = useRef(nightDarkness);
  // Screensaver machinery: `autoRotate` state means the feature is enabled;
  // actual rotation only engages after AUTOROTATE_IDLE_MS without interaction.
  const autoRotateEnabledRef = useRef(true);
  const idleTimerRef = useRef(0);
  const kickIdleTimer = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    const s = gl.current;
    if (s.controls) s.controls.autoRotate = false;
    if (!autoRotateEnabledRef.current) return;
    idleTimerRef.current = setTimeout(() => {
      const s2 = gl.current;
      if (s2.controls && autoRotateEnabledRef.current) {
        s2.controls.autoRotate = true;
        s2.requestRender?.(); // loop is parked by now; nudge it back to life
      }
    }, AUTOROTATE_IDLE_MS);
  }, []);
  const [textureLoading, setTextureLoading] = useState(true);
  // One-way per-session detail upgrade: once the camera has been close enough
  // that tile resolution visibly limits the basemap (labels pixelate), the
  // texture rebuilds at +1 tile zoom in the background. Sticky so zooming
  // back out doesn't thrash rebuilds.
  const [detailBump, setDetailBump] = useState(false);
  const detailBumpRef = useRef(false);
  // template|lang of the texture currently on the sphere — tells the texture
  // effect whether a rebuild is a silent detail upgrade or a visible change.
  const appliedTextureKeyRef = useRef('');
  const [textureProgress, setTextureProgress] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  // On by default, but remembered — otherwise switching it off would not
  // survive a reload and the toggle would feel broken.
  const [autoRotate, setAutoRotate] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTOROTATE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  // config.lowMemoryMode arrives asynchronously as undefined then false;
  // normalising stops that flip from rebuilding the entire WebGL scene.
  const lowMem = !!lowMemoryMode;
  // Logbook QSOs layer: drawn natively like DX spots (markers + arcs from DE),
  // from the same points as the flat layer — live log + the Logbook panel's
  // filter (utils/logbookMap.js).
  const logbookLayer = overlayLayerStates?.['logbook-qsos'];
  const logbookOn = !lowMem && !!logbookLayer?.enabled;
  const logbookOpacity = logbookLayer?.opacity ?? 0.8;
  const logbookPoints = useLogbookMapPoints(logbookOn);
  const [panelWidth, setPanelWidth] = useState(0);
  // WebGL construction failure, rethrown during render so WorldMap's error
  // boundary can fall back to Mercator. Swallowing it here left the user on a
  // dead "Loading globe" panel forever — wedged across reloads, since the
  // projection choice is persisted.
  const [initError, setInitError] = useState(null);
  // Satellite selection, shared with the Leaflet layer via sessionStorage.
  const [selectedSats, setSelectedSats] = useState(readSelectedSats);
  const clearSatSelection = useCallback(() => {
    setSelectedSats([]);
    try {
      sessionStorage.setItem(SAT_SELECTED_KEY, JSON.stringify([]));
    } catch {}
  }, []);
  const toggleSatSelection = useCallback((name) => {
    setSelectedSats((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      try {
        sessionStorage.setItem(SAT_SELECTED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  // Set once the operator drags or zooms — the usage hint has served its
  // purpose by then and only adds clutter.
  const [hasInteracted, setHasInteracted] = useState(false);
  const narrowPanel = panelWidth > 0 && panelWidth < NARROW_PANEL_PX;

  const hasDE = Number.isFinite(deLocation?.lat) && Number.isFinite(deLocation?.lon);
  const lat0 = hasDE ? deLocation.lat : 0;
  const lon0 = hasDE ? deLocation.lon : 0;

  // Latest QTH, readable from callbacks and the scene-setup effect without
  // making them depend on it (a DE change must not rebuild the scene).
  const deRef = useRef({ has: hasDE, lat: lat0, lon: lon0 });
  useEffect(() => {
    deRef.current = { has: hasDE, lat: lat0, lon: lon0 };
  }, [hasDE, lat0, lon0]);

  // Set once the operator drags or zooms; from then on the view is theirs and
  // nothing re-frames it behind their back.
  const userMovedRef = useRef(false);

  // Follow the active theme. Prebuilt themes swap [data-theme]; the custom
  // theme editor writes CSS variables onto the root element's style attribute,
  // so both have to be watched.
  const [isDarkBackdrop, setIsDarkBackdrop] = useState(() => backdropIsDark());
  // Bumped on every theme change so the WebGL overlays — whose colours were
  // resolved from CSS variables at build time — get rebuilt with the new ones.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const update = () => {
      setIsDarkBackdrop(backdropIsDark());
      setThemeTick((n) => n + 1);
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => mo.disconnect();
  }, []);

  // mapBandFilter is an array of selected bands; empty means "all bands".
  const selectedMapBands = useMemo(
    () =>
      Array.isArray(mapBandFilter) ? new Set(mapBandFilter.map((b) => normalizeBandKey(b)).filter(Boolean)) : new Set(),
    [mapBandFilter],
  );

  const bandPassesMapFilter = useCallback(
    (band) => {
      if (selectedMapBands.size === 0) return true;
      const key = normalizeBandKey(band);
      return !!key && selectedMapBands.has(key);
    },
    [selectedMapBands],
  );

  // ── Collect every marker into one flat list ──────────────
  const markers = useMemo(() => {
    const out = [];

    const pushSimple = (spots, color, kind) => {
      if (!spots?.length) return;
      spots.forEach((s) => {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
        const band = normalizeBandKey(s.band) || bandFromAnyFrequency(s.freq);
        if (!bandPassesMapFilter(band)) return;
        out.push({
          lat: s.lat,
          lon: s.lon,
          color,
          size: 8,
          kind,
          label: s.call || s.callsign || s.activator || kind,
          detail: [s.ref || s.reference, band, s.freq ? `${s.freq} MHz` : null, s.mode, s.name]
            .filter(Boolean)
            .join(' · '),
          raw: s,
        });
      });
    };

    if (showPOTA) pushSimple(potaSpots, ACTIVITY_COLORS.pota, 'POTA');
    if (showWWFF) pushSimple(wwffSpots, ACTIVITY_COLORS.wwff, 'WWFF');
    if (showSOTA) pushSimple(sotaSpots, ACTIVITY_COLORS.sota, 'SOTA');
    if (showWWBOTA) pushSimple(wwbotaSpots, ACTIVITY_COLORS.wwbota, 'WWBOTA');

    if (showDXPaths && dxPaths?.length) {
      dxPaths.forEach((p) => {
        if (!Number.isFinite(p.dxLat) || !Number.isFinite(p.dxLon)) return;
        const band = bandFromAnyFrequency(p.freq);
        if (!bandPassesMapFilter(band)) return;
        out.push({
          lat: p.dxLat,
          lon: p.dxLon,
          color: getBandColor(parseFloat(p.freq)) || GLOBE_COLORS.bandFallback,
          size: 9,
          kind: 'DX',
          label: p.dxCall || p.callsign || 'DX',
          detail: [p.freq ? `${p.freq} MHz` : null, band, p.spotter ? `de ${p.spotter}` : null]
            .filter(Boolean)
            .join(' · '),
          raw: p,
        });
      });
    }

    if (showPSKReporter && pskReporterSpots?.length) {
      pskReporterSpots.forEach((s) => {
        const lat = parseFloat(s.lat);
        const lon = parseFloat(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        // PSKReporter reports freq in Hz; freqMHz is the pre-converted variant.
        const freqMHz = s.freqMHz || (s.freq ? s.freq / 1e6 : null);
        const band = normalizeBandKey(s.band) || bandFromAnyFrequency(freqMHz || s.freq);
        if (!bandPassesMapFilter(band)) return;
        const isRx = s.direction === 'rx';
        out.push({
          lat,
          lon,
          // Band colour to match the flat map's markers (#1169); the RX/TX
          // colours remain the fallback for spots with no parsable frequency.
          color: getBandColor(parseFloat(freqMHz)) || (isRx ? GLOBE_COLORS.pskRx : GLOBE_COLORS.pskTx),
          size: 7,
          kind: isRx ? 'PSK RX' : 'PSK TX',
          label: (isRx ? s.sender : s.receiver || s.sender) || 'PSK',
          detail: [band, s.mode].filter(Boolean).join(' · '),
          raw: s,
        });
      });
    }

    if (showWSJTX && wsjtxSpots?.length) {
      wsjtxSpots.forEach((s) => {
        const lat = parseFloat(s.lat);
        const lon = parseFloat(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        // s.freq is the FT8 audio offset in Hz, not a dial frequency — band
        // must come from dialFrequency, mirroring the Leaflet path.
        const freqMHz = s.dialFrequency ? s.dialFrequency / 1e6 : 0;
        const band = normalizeBandKey(s.band) || bandFromAnyFrequency(freqMHz);
        if (!bandPassesMapFilter(band)) return;
        // CQ decodes carry the station in `caller`; QSO decodes name both
        // sides, and the plotted station is whichever of them is not us.
        const call = s.caller || (s.deCall === callsign ? s.dxCall : s.deCall) || 'WSJT-X';
        out.push({
          lat,
          lon,
          color: GLOBE_COLORS.wsjtx,
          size: 8,
          kind: 'WSJT-X',
          label: call,
          detail: [band, s.mode, s.snr != null ? `${s.snr} dB` : null].filter(Boolean).join(' · '),
          raw: s,
        });
      });
    }

    // Logbook QSOs: one dot per worked position and band. Clicking sets DX
    // only — `raw` carries no frequency, so a past QSO never retunes the rig.
    if (logbookOn) {
      logbookPoints.forEach((p) => {
        const latest = p.qsos.reduce((a, b) =>
          `${b.qso_date || ''}${b.time_on || ''}` > `${a.qso_date || ''}${a.time_on || ''}` ? b : a,
        );
        const more = p.qsos.length > 1 ? ` +${p.qsos.length - 1}` : '';
        out.push({
          lat: p.lat,
          lon: p.lon,
          color: getBandColorForBand(p.band),
          size: p.qsos.length > 1 ? 8 : 7,
          kind: 'QSO',
          label: `${latest.call}${more}`,
          detail: [p.band, latest.mode, p.approx ? `${p.place} (country position)` : p.place]
            .filter(Boolean)
            .join(' · '),
          raw: { lat: p.lat, lon: p.lon, call: latest.call },
        });
      });
    }

    return out;
  }, [
    logbookOn,
    logbookPoints,
    potaSpots,
    wwffSpots,
    sotaSpots,
    wwbotaSpots,
    dxPaths,
    pskReporterSpots,
    wsjtxSpots,
    showPOTA,
    showWWFF,
    showSOTA,
    showWWBOTA,
    showDXPaths,
    showPSKReporter,
    showWSJTX,
    bandPassesMapFilter,
    callsign, // WSJT-X QSO decodes: which side gets plotted depends on our call
  ]);

  // Spotter → DX arcs, plus the DE → DX path.
  const arcs = useMemo(() => {
    const out = [];

    if (showDXPaths && dxPaths?.length) {
      dxPaths.forEach((p) => {
        if (!Number.isFinite(p.dxLat) || !Number.isFinite(p.dxLon)) return;
        if (!Number.isFinite(p.spotterLat) || !Number.isFinite(p.spotterLon)) return;
        const band = bandFromAnyFrequency(p.freq);
        if (!bandPassesMapFilter(band)) return;
        out.push({
          from: [p.spotterLat, p.spotterLon],
          to: [p.dxLat, p.dxLon],
          color: getBandColor(parseFloat(p.freq)) || GLOBE_COLORS.bandFallback,
          opacity: 0.62,
        });
      });
    }

    // PSK Reporter DE→spot paths (#1169): band-coloured like the flat map's
    // polylines, TX brighter than RX, RX dashed (handled at vertex build).
    if (showPSKReporter && showPSKPaths && pskReporterSpots?.length && Number.isFinite(lat0) && Number.isFinite(lon0)) {
      pskReporterSpots.forEach((s) => {
        const lat = parseFloat(s.lat);
        const lon = parseFloat(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const freqMHz = s.freqMHz || (s.freq ? s.freq / 1e6 : null);
        const band = normalizeBandKey(s.band) || bandFromAnyFrequency(freqMHz || s.freq);
        if (!bandPassesMapFilter(band)) return;
        const isRx = s.direction === 'rx';
        out.push({
          from: [lat0, lon0],
          to: [lat, lon],
          color: getBandColor(parseFloat(freqMHz)) || GLOBE_COLORS.bandFallback,
          opacity: isRx ? 0.4 : 0.6,
          dashed: isRx,
        });
      });
    }

    // Logbook QSOs: DE → each worked position, band-coloured — only while
    // they stay readable (see MAX_LOGBOOK_LINES); the dots always show.
    if (logbookOn && hasDE && logbookPoints.length <= MAX_LOGBOOK_LINES) {
      logbookPoints.forEach((p) => {
        out.push({
          from: [lat0, lon0],
          to: [p.lat, p.lon],
          color: getBandColorForBand(p.band),
          opacity: logbookOpacity * 0.8, // 0.64 at the default, like the cluster arcs
        });
      });
    }

    // The DE→DX arc exists to connect the two station markers, so it hides
    // with them — unlike the cluster paths, which have their own toggle.
    if (showDeDxMarkers && Number.isFinite(dxLocation?.lat) && Number.isFinite(dxLocation?.lon)) {
      out.push({
        from: [lat0, lon0],
        to: [dxLocation.lat, dxLocation.lon],
        color: cssVarColor('--accent-cyan', '#00ddff'),
        opacity: 1,
      });
    }

    return out;
    // themeTick: the DE→DX arc colour is read from a CSS variable.
  }, [
    logbookOn,
    logbookPoints,
    logbookOpacity,
    hasDE,
    dxPaths,
    showDXPaths,
    bandPassesMapFilter,
    dxLocation,
    lat0,
    lon0,
    themeTick,
    showDeDxMarkers,
    pskReporterSpots,
    showPSKReporter,
    showPSKPaths,
  ]);

  // ── Scene setup (once) ───────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    // Open looking straight down on the operator's QTH. If the location has not
    // arrived yet, an effect below re-centres once it does.
    if (deRef.current.has) {
      latLonToVec3(deRef.current.lat, deRef.current.lon, DEFAULT_CAM_DISTANCE, camera.position);
    } else {
      camera.position.set(0, 0, DEFAULT_CAM_DISTANCE);
    }

    // Seed from the mount-time width: the ResizeObserver's first callback can
    // land while the panel still measures zero and take the early return.
    if (container.clientWidth) setPanelWidth(container.clientWidth);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !lowMem, alpha: true });
    } catch (e) {
      console.error('[Globe3D] WebGL unavailable:', e);
      setInitError(e instanceof Error ? e : new Error('WebGL unavailable'));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowMem ? 1 : 2));
    renderer.setSize(container.clientWidth || 300, container.clientHeight || 300);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.borderRadius = '8px';
    renderer.domElement.style.cursor = 'grab';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.7;
    controls.enablePan = false;
    controls.minDistance = 1.25;
    controls.maxDistance = emeMode ? EME_CAM_MAX_DISTANCE : CAM_MAX_DISTANCE;
    controls.autoRotate = false;
    controls.autoRotateSpeed = AUTOROTATE_SPEED;
    // Fires on pointer-down / wheel, i.e. genuine user gestures — programmatic
    // controls.update() calls do not trigger it.
    controls.addEventListener('start', () => {
      userMovedRef.current = true;
      setHasInteracted(true);
      // Any drag or zoom counts as presence: stop rotating, restart the clock.
      kickIdleTimer();
    });

    // Placeholder texture until the tiles land.
    const placeholder = document.createElement('canvas');
    placeholder.width = placeholder.height = 2;
    const pctx = placeholder.getContext('2d');
    pctx.fillStyle = '#0b1a2b';
    pctx.fillRect(0, 0, 2, 2);

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: new THREE.CanvasTexture(placeholder) },
        uDetail: { value: new THREE.CanvasTexture(placeholder) },
        uDetailOn: { value: 0 },
        uDetailBounds: { value: new THREE.Vector4(0, 0, 0, 0) },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uNightDarkness: { value: THREE.MathUtils.clamp(nightDarknessRef.current / 100, 0, 1) },
        uBrightness: { value: 1 },
      },
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    });

    const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 96, 64), earthMat);
    scene.add(earth);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R * 1.02, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(atmosphere);

    const stars = lowMem ? null : makeStarfield();
    if (stars) {
      // Seed visibility so a light theme never flashes a starfield on mount;
      // the dedicated effect below owns it from here on.
      stars.visible = isDarkBackdrop;
      scene.add(stars);
    }
    atmosphere.visible = isDarkBackdrop;

    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);

    // Satellites live in their own group: they refresh every 5 s and must not
    // force the spot cloud and arcs to rebuild with them.
    const satGroup = new THREE.Group();
    scene.add(satGroup);

    // Plugin overlay shell — one shared equirectangular canvas (Maidenhead,
    // zones, D-RAP, aurora) draped on a transparent sphere just above the
    // earth mesh. SphereGeometry's UV layout matches the canvas's lat/lon
    // projection exactly, so painters stay pure 2D. Repainted only when a
    // layer toggle/opacity/dataset changes — never per frame. Skipped
    // entirely in low-memory mode, like the starfield and satellite models.
    let overlayShell = null;
    let overlayTexture = null;
    let overlayCanvas = null;
    if (!lowMem) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = OVERLAY_TEX_W;
      overlayCanvas.height = OVERLAY_TEX_H;
      overlayTexture = new THREE.CanvasTexture(overlayCanvas);
      overlayTexture.colorSpace = THREE.SRGBColorSpace;
      overlayTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
      overlayShell = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_R * OVERLAY_ALT, 64, 48),
        new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true, depthWrite: false }),
      );
      overlayShell.visible = false; // until a painter actually draws something
      scene.add(overlayShell);
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.02;
    const pointer = new THREE.Vector2();

    gl.current = {
      needsRender: true, // first paint
      scene,
      camera,
      renderer,
      controls,
      earth,
      earthMat,
      atmosphere,
      stars,
      overlayGroup,
      satGroup,
      overlayShell,
      overlayTexture,
      overlayCanvas,
      overlayCtx: overlayCanvas ? overlayCanvas.getContext('2d') : null,
      raycaster,
      pointer,
      dotTexture: makeDotTexture(),
      markerData: [],
      disposables: [],
    };

    // ── Render loop (on demand) ────────────────────────────
    // A still globe used to redraw 60 times a second to produce identical
    // pixels — real heat on Pi-class hardware. The loop now runs only while
    // something is actually changing and parks itself when nothing is.
    //
    // controls.update() reports whether it moved the camera, which covers both
    // the damping tail after a drag and auto-rotate, so neither needs a special
    // case. Everything else that mutates the scene calls requestRender().
    let raf = 0;
    let running = false;

    const renderFrame = () => {
      const s = gl.current;
      if (!s.renderer) {
        running = false;
        return;
      }
      const moved = s.controls.update();
      // Never park while auto-rotating. update() reports movement below its own
      // epsilon as "no change", and parking on such a frame would be terminal:
      // the event that would wake us comes from the very update that no longer
      // runs, so the globe would silently stop mid-spin.
      if (!moved && !s.needsRender && !s.controls.autoRotate) {
        running = false; // idle — stop until something invalidates
        return;
      }
      s.needsRender = false;
      // Counter-scale the station markers so they hold a constant apparent
      // size, matching the spot dots instead of swelling as you zoom in.
      if (s.stationMarkers?.length) {
        const k = s.camera.position.length() / DEFAULT_CAM_DISTANCE;
        for (let i = 0; i < s.stationMarkers.length; i++) s.stationMarkers[i].scale.setScalar(k);
      }
      // Satellite 3D models: shown inside the LOD distance (always for
      // selected birds), scaled per frame to a constant apparent size. The
      // dots underneath stay visible and remain the raycast target.
      if (s.satModels?.length) {
        const near = s.camera.position.length() < SAT_MODEL_LOD_DIST;
        const h = s.renderer.domElement.clientHeight || 1;
        const fovK = 2 * Math.tan((s.camera.fov * Math.PI) / 360);
        const dots = s.satDotSizes;
        let dotsChanged = false;
        for (let i = 0; i < s.satModels.length; i++) {
          const m = s.satModels[i];
          const show = near || m.userData.satSelected;
          m.visible = show;
          // Hide the dot under a visible model — it would sit on top of the
          // mesh and obscure it. Sat i's model and dot share an index.
          if (dots && i < dots.attr.count) {
            const want = show ? 0 : dots.base[i];
            if (dots.attr.array[i] !== want) {
              dots.attr.array[i] = want;
              dotsChanged = true;
            }
          }
          if (!show) continue;
          const px = m.userData.satSelected ? 46 : 34;
          m.scale.setScalar((px * fovK * s.camera.position.distanceTo(m.position)) / h);
        }
        if (dotsChanged && dots) dots.attr.needsUpdate = true;
      }
      // Close-zoom detail: when the camera first dwells inside the sphere's
      // pixelation range on capable hardware, trigger the one-way texture
      // upgrade. GPU must fit an 8192-wide texture; lowMem never upgrades.
      if (
        !detailBumpRef.current &&
        !lowMem &&
        s.camera.position.length() < 1.8 &&
        (s.renderer?.capabilities?.maxTextureSize ?? 0) >= 8192
      ) {
        detailBumpRef.current = true;
        setDetailBump(true);
      }
      // Sun direction is fixed in world space; convert to view space per frame.
      if (s.sunWorld) {
        s.earthMat.uniforms.uSunDir.value.copy(s.sunWorld).transformDirection(s.camera.matrixWorldInverse);
      }
      s.renderer.render(s.scene, s.camera);
      raf = requestAnimationFrame(renderFrame);
    };

    const requestRender = () => {
      const g = gl.current;
      if (!g.renderer) return;
      g.needsRender = true;
      if (!running) {
        running = true;
        raf = requestAnimationFrame(renderFrame);
      }
    };

    // Published on the handle now that it exists — the handle is built above,
    // before this closure, so it cannot go in the object literal.
    gl.current.requestRender = requestRender;

    // OrbitControls fires 'change' for drags, wheel zoom and each damping step,
    // which is what restarts the loop after it has parked.
    controls.addEventListener('change', requestRender);

    // ── Resize ─────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
      // On a narrow panel WorldMap's projection toggle spans the full width and
      // would sit on top of our control column, so the column drops below it.
      setPanelWidth(w);
    });
    ro.observe(container);

    requestRender(); // first paint

    // A fresh scene starts still; the screensaver clock decides when it turns.
    kickIdleTimer();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimerRef.current);
      ro.disconnect();
      controls.dispose();
      const s = gl.current;
      s.disposables?.forEach((d) => d.dispose?.());
      earth.geometry.dispose();
      earthMat.uniforms.uMap.value?.dispose?.();
      earthMat.dispose();
      atmosphere.geometry.dispose();
      atmosphere.material.dispose();
      if (overlayShell) {
        overlayShell.geometry.dispose();
        overlayShell.material.dispose();
        overlayTexture.dispose();
      }
      if (stars) {
        stars.geometry.dispose();
        stars.material.dispose();
      }
      s.dotTexture?.dispose?.();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      gl.current = {};
    };
  }, [lowMem, kickIdleTimer]);

  // ── Night overlay darkness ───────────────────────────────
  useEffect(() => {
    nightDarknessRef.current = nightDarkness;
    const s = gl.current;
    if (!s.earthMat) return;
    s.earthMat.uniforms.uNightDarkness.value = THREE.MathUtils.clamp(nightDarkness / 100, 0, 1);
    s.requestRender?.();
  }, [nightDarkness]);

  // ── Starfield / atmosphere follow the backdrop ───────────
  useEffect(() => {
    const s = gl.current;
    if (s.stars) s.stars.visible = isDarkBackdrop;
    if (s.atmosphere) s.atmosphere.visible = isDarkBackdrop;
    s.requestRender?.();
  }, [isDarkBackdrop]);

  // ── Auto-rotate toggle ───────────────────────────────────
  useEffect(() => {
    autoRotateEnabledRef.current = autoRotate;
    try {
      localStorage.setItem(AUTOROTATE_KEY, String(autoRotate));
    } catch {}
    // Enabling arms the 30 s clock; disabling stops any rotation immediately.
    kickIdleTimer();
    return () => clearTimeout(idleTimerRef.current);
  }, [autoRotate, kickIdleTimer]);

  // ── Texture: rebuild when the map style changes ──────────
  useEffect(() => {
    // No renderer (WebGL failed) means nobody to consume the texture — do not
    // spend a full tile fetch on a scene that will never draw.
    if (!gl.current.renderer) return undefined;
    const style = MAP_STYLES[tileStyle]?.url ? tileStyle : 'dark';
    const template = MAP_STYLES[style].url;
    if (!template) return undefined;

    const ac = new AbortController();
    const baseZoom = chooseGlobeTileZoom({ lowMemory: lowMem, pixelRatio: window.devicePixelRatio || 1 });
    const zoom = Math.min(5, baseZoom + (detailBump && !lowMem ? 1 : 0));
    const cacheKey = `${template}|${zoom}|${mapLang}`;
    // A detail upgrade replaces a texture this style is already showing — do
    // it silently in the background rather than blanking the globe with the
    // loading overlay. Style/language changes keep the visible progress.
    const isUpgrade = appliedTextureKeyRef.current === `${template}|${mapLang}`;
    if (!isUpgrade) {
      setTextureLoading(true);
      setTextureProgress(0);
    }

    const applyBuilt = ({ canvas, meanLuma }) => {
      const s = gl.current;
      if (!s.earthMat) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = s.renderer?.capabilities.getMaxAnisotropy?.() ?? 1;
      tex.wrapS = THREE.RepeatWrapping;
      const old = s.earthMat.uniforms.uMap.value;
      s.earthMat.uniforms.uMap.value = tex;
      old?.dispose?.();
      // Dark basemaps read as a black ball on a sphere; lift them toward the
      // brightness satellite imagery already has (mean luma ≈ 0.30) while
      // leaving anything that bright untouched — the clamp floor of 1 means
      // this only ever brightens.
      s.earthMat.uniforms.uBrightness.value = THREE.MathUtils.clamp(0.3 / Math.max(meanLuma, 0.001), 1, 4);
      appliedTextureKeyRef.current = `${template}|${mapLang}`;
      s.requestRender?.();
      setTextureLoading(false);
    };

    const cached = textureCanvasCache.get(cacheKey);
    if (cached) {
      applyBuilt(cached);
      return () => ac.abort();
    }

    buildGlobeTexture({
      tileUrlTemplate: template,
      tileZoom: zoom,
      lang: mapLang,
      // Countries ships transparent overlay tiles; flat mode paints this same
      // blue behind them via the map div's background.
      baseColor: MAP_STYLES[style].countriesOverlay ? '#4a90d9' : undefined,
      // ...and fills every country under those tiles, same as the flat map (#1166).
      countries: !!MAP_STYLES[style].countriesOverlay,
      // Real imagery for the polar caps, where this basemap has a polar source.
      polar: MAP_STYLES[style].polar,
      onProgress: isUpgrade ? undefined : (p) => setTextureProgress(p),
      signal: ac.signal,
    })
      .then((built) => {
        if (ac.signal.aborted) return;
        textureCanvasCache.set(cacheKey, built);
        while (textureCanvasCache.size > TEXTURE_CACHE_MAX) {
          textureCanvasCache.delete(textureCanvasCache.keys().next().value);
        }
        applyBuilt(built);
      })
      .catch((e) => {
        if (!ac.signal.aborted) {
          console.warn('[Globe3D] texture build failed:', e);
          if (!isUpgrade) setTextureLoading(false);
        }
      });

    return () => ac.abort();
  }, [tileStyle, lowMem, mapLang, detailBump]);

  // ── Close-zoom detail patch ──────────────────────────────
  // A whole-globe texture cannot match tiled LOD up close, so once the camera
  // settles inside 2.3 earth radii we stream Leaflet-grade tiles for just the
  // visible window and blend them over the base in the shader. Zoom ladder is
  // chosen to keep every rebuild under ~200 tile requests; closer camera =
  // higher zoom over a narrower (center-screen) window. Debounced on control
  // changes, so nothing rebuilds mid-drag or during auto-rotate.
  useEffect(() => {
    const s = gl.current;
    if (!s.controls || lowMem) return undefined;
    const style = MAP_STYLES[tileStyle]?.url ? tileStyle : 'dark';
    const template = MAP_STYLES[style].url;
    if (!template) return undefined;

    let ac = null;
    let last = null; // { zoom, lat, lon }
    let timer = null;

    const disable = () => {
      if (s.earthMat && s.earthMat.uniforms.uDetailOn.value !== 0) {
        s.earthMat.uniforms.uDetailOn.value = 0;
        s.requestRender?.();
      }
      last = null;
    };

    const update = () => {
      if (!s.camera || !s.earthMat) return;
      const d = s.camera.position.length();
      if (d > 2.3) {
        disable();
        return;
      }
      const { lat, lon } = vec3ToLatLon(s.camera.position);
      const horizonDeg = Math.acos(Math.min(1, 1 / d)) / DEG;
      // Zoom ladder: closer camera → higher zoom over a narrower window that
      // covers where the user is actually looking; the feather hands off to
      // the base texture outside it.
      let zoom;
      let span;
      if (d < 1.35) {
        zoom = 7;
        span = 40;
      } else if (d < 1.7) {
        zoom = 6;
        span = 70;
      } else {
        zoom = 5;
        span = 140;
      }
      span = Math.min(span, 2 * horizonDeg + 24);
      // Reuse the current patch while the view stays well inside it.
      const lonDelta = Math.abs(((((lon - (last?.lon ?? 999)) % 360) + 540) % 360) - 180);
      if (last && last.zoom === zoom && Math.abs(lat - last.lat) < span * 0.2 && lonDelta < span * 0.2) return;

      ac?.abort();
      ac = new AbortController();
      const signal = ac.signal;
      const req = { zoom, lat, lon };
      buildGlobeDetailPatch({
        tileUrlTemplate: template,
        lang: mapLang,
        zoom,
        lonMin: lon - span / 2,
        lonSpan: span,
        latTop: Math.min(80, lat + span / 2),
        latBottom: Math.max(-80, lat - span / 2),
        countries: !!MAP_STYLES[style].countriesOverlay,
        signal,
      })
        .then(({ canvas, bounds }) => {
          if (signal.aborted || !s.earthMat) return;
          last = req;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = s.renderer?.capabilities.getMaxAnisotropy?.() ?? 1;
          const old = s.earthMat.uniforms.uDetail.value;
          s.earthMat.uniforms.uDetail.value = tex;
          old?.dispose?.();
          s.earthMat.uniforms.uDetailBounds.value.set(
            (bounds.lonMin + 180) / 360,
            bounds.lonSpan / 360,
            1 - (90 - bounds.latTop) / 180,
            1 - (90 - bounds.latBottom) / 180,
          );
          s.earthMat.uniforms.uDetailOn.value = 1;
          s.requestRender?.();
        })
        .catch(() => {
          /* aborted or offline — the base texture stays */
        });
    };

    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 700);
    };
    s.controls.addEventListener('change', onChange);
    update();

    return () => {
      clearTimeout(timer);
      ac?.abort();
      s.controls?.removeEventListener('change', onChange);
      disable();
    };
  }, [tileStyle, lowMem, mapLang]);

  // ── Terminator: track the subsolar point ─────────────────
  // Depends on lowMem because a scene rebuild loses s.sunWorld, which would
  // otherwise leave the terminator misplaced until the next 60 s tick.
  useEffect(() => {
    const update = () => {
      const s = gl.current;
      if (!s.earthMat) return;
      const sun = getSunPosition(new Date());
      s.sunWorld = latLonToVec3(sun.lat, sun.lon, 1).normalize();
      s.requestRender?.(); // the sun moves on a timer, not on input
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [lowMem]);

  // ── Moon: real position, real phase ──────────────────────
  // A sprite textured with NASA's Dial-A-Moon render (already proxied at
  // /api/moon-image, hourly) — the photo shows the actual current phase and
  // libration, so no phase shader is needed. The JPEG has no alpha channel,
  // so it is luminance-keyed on a scratch canvas: the black background goes
  // fully transparent (no square against space — the renderer canvas is
  // alpha-composited over the page, so blending tricks can't hide it) and
  // the unlit limb fades out naturally, which is how the moon actually
  // looks in the sky. Placement follows the real sublunar point
  // (getMoonPosition) at a compressed distance: far outside the camera's
  // 8-unit orbit ceiling but inside the starfield, at an exaggerated size
  // so it reads as the moon rather than a pixel (the true angular size at
  // this distance would be invisible). Earth occludes it naturally via the
  // depth test. Skipped in low-memory mode.
  useEffect(() => {
    if (lowMem) return undefined;
    const s = gl.current;
    if (!s.scene) return undefined;

    const MOON_SIZE = 0.85; // sprite diameter in world units
    const MOON_TEX_SIZE = 512;

    const material = new THREE.SpriteMaterial({
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });
    const moon = new THREE.Sprite(material);
    moon.scale.set(MOON_SIZE, MOON_SIZE, 1);
    moon.visible = false; // until the texture arrives
    s.scene.add(moon);

    let alive = true;
    let lastImageBucket = null;

    const updatePosition = () => {
      const pos = getMoonPosition(new Date());
      latLonToVec3(pos.lat, pos.lon, MOON_DIST, moon.position);
      s.requestRender?.();
    };

    // Luminance → alpha: below ~2% black stays fully transparent, and
    // anything moderately lit ramps quickly to opaque so stars don't
    // bleed through the maria. The steep ramp doubles as a soft edge.
    const keyOutBlack = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = MOON_TEX_SIZE;
      const cctx = canvas.getContext('2d');
      cctx.drawImage(img, 0, 0, MOON_TEX_SIZE, MOON_TEX_SIZE);
      const pixels = cctx.getImageData(0, 0, MOON_TEX_SIZE, MOON_TEX_SIZE);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.max(d[i], d[i + 1], d[i + 2]);
        d[i + 3] = lum <= 5 ? 0 : Math.min(255, (lum - 5) * 8);
      }
      cctx.putImageData(pixels, 0, 0);
      return canvas;
    };

    const updateTexture = () => {
      const bucket = Math.floor(Date.now() / 3600_000);
      if (bucket === lastImageBucket) return;
      lastImageBucket = bucket;
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        try {
          const texture = new THREE.CanvasTexture(keyOutBlack(img));
          texture.colorSpace = THREE.SRGBColorSpace;
          const old = material.map;
          material.map = texture;
          material.needsUpdate = true;
          old?.dispose();
          moon.visible = true;
          s.requestRender?.();
        } catch {
          lastImageBucket = null; // canvas readback failed — retry next tick
        }
      };
      img.onerror = () => {
        // image unavailable — retry next hourly tick
        lastImageBucket = null;
      };
      img.src = `/api/moon-image?t=${bucket}`;
    };

    updatePosition();
    updateTexture();
    const posId = setInterval(updatePosition, 60_000);
    const texId = setInterval(updateTexture, 600_000); // checks the hour bucket

    return () => {
      alive = false;
      clearInterval(posId);
      clearInterval(texId);
      s.scene?.remove(moon);
      material.map?.dispose();
      material.dispose();
      s.requestRender?.();
    };
  }, [lowMem]);

  // Latest relay target, read by the framing effect without re-running it.
  const relayTargetRef = useRef(null);
  relayTargetRef.current = relayTarget;

  // ── EME: DE→Moon→DX legs ─────────────────────────────────
  // Straight lines in space from each station to the moon sprite's position
  // (same compressed sublunar placement as the sprite, so the legs meet it).
  // A leg is solid in the station's marker colour while that station can see
  // the moon, and dashed red once the moon is below its horizon — the path
  // then visibly dives through the Earth, which is the point. In low-memory
  // mode the sprite is skipped, so a plain disc stands in for the moon.
  useEffect(() => {
    const s = gl.current;
    if (!s.scene || !emeMode) return undefined;

    const group = new THREE.Group();
    s.scene.add(group);
    const disposables = [];

    const clear = () => {
      while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
      }
      disposables.forEach((d) => d.dispose?.());
      disposables.length = 0;
    };

    const addLeg = (fromVec, toVec, color, up) => {
      const geo = new THREE.BufferGeometry().setFromPoints([fromVec, toVec]);
      const mat = up
        ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
        : new THREE.LineDashedMaterial({
            color: '#ef4444',
            dashSize: 0.22,
            gapSize: 0.14,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
          });
      const line = new THREE.Line(geo, mat);
      if (!up) line.computeLineDistances();
      line.frustumCulled = false;
      group.add(line);
      disposables.push(geo, mat);
    };

    const build = () => {
      clear();
      const now = new Date();
      const viaSat = !!relayTarget && Number.isFinite(relayTarget.lat) && Number.isFinite(relayTarget.lon);
      let targetVec;
      let deUp;
      let dxUp;
      if (viaSat) {
        targetVec = latLonToVec3(relayTarget.lat, relayTarget.lon, EARTH_R + (relayTarget.altKm || 0) / 6371);
        deUp = !!relayTarget.deUp;
        dxUp = !!relayTarget.dxUp;
      } else {
        const moonPos = getMoonPosition(now);
        targetVec = latLonToVec3(moonPos.lat, moonPos.lon, MOON_DIST);
        deUp = hasDE && getMoonAzEl(now, lat0, lon0).elevation >= 0;
        dxUp =
          Number.isFinite(dxLocation?.lat) &&
          Number.isFinite(dxLocation?.lon) &&
          getMoonAzEl(now, dxLocation.lat, dxLocation.lon).elevation >= 0;
        if (lowMem) {
          const geo = new THREE.SphereGeometry(0.3, 16, 12);
          const mat = new THREE.MeshBasicMaterial({ color: '#e6e6f0' });
          const disc = new THREE.Mesh(geo, mat);
          disc.position.copy(targetVec);
          group.add(disc);
          disposables.push(geo, mat);
        }
      }

      // Third-party moonbounce reports: both stations bounce off the same
      // moon, so each report is two thin legs meeting at the sprite. Capped
      // and faint so the operator's own DE/DX legs stay the loudest lines.
      if (!viaSat && emeActivityPaths?.length) {
        const c = new THREE.Color();
        const verts = [];
        const cols = [];
        emeActivityPaths.slice(0, 60).forEach((r) => {
          if (![r.aLat, r.aLon, r.bLat, r.bLon].every(Number.isFinite)) return;
          c.set(getBandColor(parseFloat(r.freqMHz)) || GLOBE_COLORS.bandFallback);
          const a = latLonToVec3(r.aLat, r.aLon, EARTH_R * MARKER_ALT);
          const b = latLonToVec3(r.bLat, r.bLon, EARTH_R * MARKER_ALT);
          verts.push(a.x, a.y, a.z, targetVec.x, targetVec.y, targetVec.z);
          verts.push(b.x, b.y, b.z, targetVec.x, targetVec.y, targetVec.z);
          for (let k = 0; k < 4; k++) cols.push(c.r, c.g, c.b);
        });
        if (verts.length) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
          const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: isDarkBackdrop ? THREE.AdditiveBlending : THREE.NormalBlending,
          });
          const lines = new THREE.LineSegments(geo, mat);
          lines.frustumCulled = false;
          group.add(lines);
          disposables.push(geo, mat);
        }
      }

      if (hasDE) {
        addLeg(
          latLonToVec3(lat0, lon0, EARTH_R * MARKER_ALT),
          targetVec,
          cssVarColor('--accent-blue', '#4488ff'),
          deUp,
        );
      }
      if (Number.isFinite(dxLocation?.lat) && Number.isFinite(dxLocation?.lon)) {
        addLeg(
          latLonToVec3(dxLocation.lat, dxLocation.lon, EARTH_R * MARKER_ALT),
          targetVec,
          cssVarColor('--accent-cyan', '#00ddff'),
          dxUp,
        );
      }
      s.requestRender?.();
    };

    build();
    // Moon legs drift slowly (one-minute tick); satellite legs rebuild with
    // every relayTarget update instead, so no timer in that mode.
    const id = relayTarget ? null : setInterval(build, 60_000);
    return () => {
      if (id) clearInterval(id);
      clear();
      s.scene?.remove(group);
      s.requestRender?.();
    };
    // themeTick: leg colours come from CSS variables. lowMem: scene rebuild.
    // emeActivityPaths / isDarkBackdrop: third-party report legs.
  }, [
    emeMode,
    hasDE,
    lat0,
    lon0,
    dxLocation?.lat,
    dxLocation?.lon,
    themeTick,
    lowMem,
    relayTarget,
    emeActivityPaths,
    isDarkBackdrop,
  ]);

  // ── EME: frame Earth + Moon ──────────────────────────────
  // Orbit around the Earth–Moon midpoint from a point beside the line, tilted
  // a little above it, so both bodies sit in frame with the legs between them.
  // Leaving EME mode restores the normal ceiling and an Earth-centred orbit.
  useEffect(() => {
    const s = gl.current;
    if (!s.camera || !s.controls) return;
    s.controls.maxDistance = emeMode ? EME_CAM_MAX_DISTANCE : CAM_MAX_DISTANCE;
    if (!emeMode) {
      s.controls.target.set(0, 0, 0);
      if (s.camera.position.length() > CAM_MAX_DISTANCE) s.camera.position.setLength(DEFAULT_CAM_DISTANCE);
      s.controls.update();
      s.requestRender?.();
      return;
    }
    // The QTH auto-follow re-centres on Earth; it must not fight the framing.
    userMovedRef.current = true;
    if (relaySatName) {
      // Satellite relay: an ordinary Earth-centred orbit above the satellite's
      // sub-point (LEO — no need to pull back), so DE, satellite and DX all
      // sit under the camera.
      const rt = relayTargetRef.current;
      s.controls.target.set(0, 0, 0);
      if (rt && Number.isFinite(rt.lat) && Number.isFinite(rt.lon)) {
        latLonToVec3(rt.lat, rt.lon, DEFAULT_CAM_DISTANCE + 0.6, s.camera.position);
      } else if (hasDE) {
        latLonToVec3(lat0, lon0, DEFAULT_CAM_DISTANCE + 0.6, s.camera.position);
      }
      s.controls.update();
      s.requestRender?.();
      return;
    }
    const pos = getMoonPosition(new Date());
    const moonDir = latLonToVec3(pos.lat, pos.lon, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(moonDir, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const mid = moonDir.clone().multiplyScalar(MOON_DIST / 2);
    s.controls.target.copy(mid);
    // Half the Earth–Moon span plus clearance must fit in the narrower of the
    // two half-extents at the target distance (vertical fov, aspect for width).
    const halfSpan = MOON_DIST / 2 + EME_FRAME_MARGIN;
    const tanHalfFov = Math.tan((s.camera.fov * Math.PI) / 360);
    const aspect = Math.max(0.5, s.camera.aspect || 1);
    const dist = Math.min(EME_CAM_MAX_DISTANCE - 1, halfSpan / (tanHalfFov * Math.min(aspect, 1.6)));
    s.camera.position
      .copy(mid)
      .addScaledVector(side, dist)
      .addScaledVector(up, dist * 0.22);
    s.controls.update();
    s.requestRender?.();
    // lowMem: scene rebuild — re-apply to the fresh camera/controls.
    // relaySatName: re-frame when the relay satellite changes, not per tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emeMode, emeFrameKey, lowMem, relaySatName]);

  // ── Trek theme easter egg: the Enterprise on patrol ──────
  // While the LCARS theme is active, a procedural Constitution-class
  // silhouette flies a slow inclined orbit whose plane precesses so the
  // ground track drifts around the planet. Purely decorative: never a
  // raycast target (picking intersects earth/sats/spots explicitly). The
  // flight is continuous by nature, so its ticker keeps the on-demand
  // render loop awake — same cost class as the auto-rotate screensaver —
  // and is skipped entirely in low-memory mode. themeTick re-runs this
  // effect whenever [data-theme] changes.
  useEffect(() => {
    if (lowMem) return undefined;
    if (document.documentElement.getAttribute('data-theme') !== 'trek') return undefined;
    const s = gl.current;
    if (!s.scene) return undefined;

    const ship = getEnterpriseTemplate().clone();
    s.scene.add(ship);

    const ORBIT_R = EARTH_R * 1.35;
    const PERIOD_MS = 95_000; // one lap ~95 s — brisk but stately
    const RAAN_PERIOD_MS = 1_800_000; // orbit plane precesses once per 30 min
    const INCLINATION = THREE.MathUtils.degToRad(35);
    const SHIP_PX = 44; // constant apparent size, a touch over a selected sat
    const TICK_MS = 33; // ~30 fps flight

    const pos = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const qIncl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), INCLINATION);
    const qRaan = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);

    let raf = 0;
    let last = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < TICK_MS) return;
      last = now;
      if (!s.renderer) return;

      const t = ((now % PERIOD_MS) / PERIOD_MS) * Math.PI * 2;
      qRaan.setFromAxisAngle(yAxis, ((now % RAAN_PERIOD_MS) / RAAN_PERIOD_MS) * Math.PI * 2);
      pos.set(Math.cos(t), 0, Math.sin(t)).applyQuaternion(qIncl).applyQuaternion(qRaan).multiplyScalar(ORBIT_R);
      forward.set(-Math.sin(t), 0, Math.cos(t)).applyQuaternion(qIncl).applyQuaternion(qRaan);

      // Nose along the velocity, saucer facing away from the planet
      up.copy(pos).normalize();
      right.crossVectors(up, forward).normalize();
      forward.crossVectors(right, up); // re-orthogonalize
      basis.makeBasis(right, up, forward);
      ship.quaternion.setFromRotationMatrix(basis);
      ship.position.copy(pos);

      // Constant apparent size, same math as the satellite models
      const h = s.renderer.domElement.clientHeight || 1;
      const fovK = 2 * Math.tan((s.camera.fov * Math.PI) / 360);
      ship.scale.setScalar((SHIP_PX * fovK * s.camera.position.distanceTo(ship.position)) / h);

      s.requestRender?.();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      s.scene?.remove(ship);
      s.requestRender?.();
      // Template geometry/materials are shared session-cached resources —
      // never disposed, same convention as the satellite archetypes.
    };
  }, [lowMem, themeTick]);

  // ── Christmas easter egg: Santa's sleigh on Christmas Eve ──────
  // On 24–25 December (UTC) a procedural Santa, sleigh and nine reindeer fly
  // the route in src/utils/santa.js: launch from the North Pole when it
  // turns midnight in the first time zone, then westward one zone per hour
  // through recognisable cities, home after Samoa. Same cost class and
  // conventions as the Enterprise above (decorative, never picked, skipped
  // in low-memory mode). santaOn is re-evaluated every minute so the effect
  // starts and stops on its own at the day boundaries; ?santa=… drives a
  // simulated clock for demos (see resolveSantaClock).
  const [santaOn, setSantaOn] = useState(() => getSantaState(resolveSantaClock().nowMs).visible);
  const [santaInfo, setSantaInfo] = useState(null);
  useEffect(() => {
    const check = () => setSantaOn(getSantaState(resolveSantaClock().nowMs).visible);
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (lowMem || !santaOn) {
      setSantaInfo(null);
      return undefined;
    }
    const s = gl.current;
    if (!s.scene) return undefined;

    const sleigh = getSantaTemplate().clone();
    s.scene.add(sleigh);

    const ALT = EARTH_R * 1.045;
    const SLEIGH_PX = 110; // nose-to-runner length on screen; the sleigh itself is ~1/4 of that
    const TICK_MS = 50;
    const INFO_MS = 5_000;

    const pos = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const basis = new THREE.Matrix4();

    let raf = 0;
    let last = 0;
    let lastInfo = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < TICK_MS) return;
      last = now;
      if (!s.renderer) return;

      const clock = resolveSantaClock();
      const st = getSantaState(clock.nowMs);
      sleigh.visible = st.visible;
      if (!st.visible) return;

      latLonToVec3(st.lat, st.lon, ALT, pos);
      up.copy(pos).normalize();
      // Nose along the track: a point half a degree ahead on the current bearing
      const a = destinationPoint(st, st.heading, 0.5);
      latLonToVec3(a.lat, a.lon, ALT, ahead);
      forward.subVectors(ahead, pos);
      right.crossVectors(up, forward).normalize();
      forward.crossVectors(right, up).normalize();
      basis.makeBasis(right, up, forward);
      sleigh.quaternion.setFromRotationMatrix(basis);
      // Gentle bob so the team looks airborne rather than pinned
      pos.addScaledVector(up, 0.004 * Math.sin(now / 350));
      sleigh.position.copy(pos);

      const h = s.renderer.domElement.clientHeight || 1;
      const fovK = 2 * Math.tan((s.camera.fov * Math.PI) / 360);
      sleigh.scale.setScalar((SLEIGH_PX * fovK * s.camera.position.distanceTo(sleigh.position)) / h);

      if (now - lastInfo > INFO_MS) {
        lastInfo = now;
        setSantaInfo({
          phase: st.phase,
          lastStop: st.lastStop,
          nextStop: st.nextStop,
          delivered: st.delivered,
          simulated: clock.simulated,
        });
      }
      s.requestRender?.();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      s.scene?.remove(sleigh);
      s.requestRender?.();
      setSantaInfo(null);
    };
  }, [lowMem, santaOn]);

  const santaText = useMemo(() => {
    if (!santaInfo) return '';
    const presents = formatPresents(santaInfo.delivered);
    const vars = { stop: santaInfo.lastStop, next: santaInfo.nextStop, presents };
    const byPhase = {
      pre: t('santa.pre', {
        ...vars,
        defaultValue: 'Santa is loading the sleigh at the North Pole — first stop {{next}}',
      }),
      flight: t('santa.flight', {
        ...vars,
        defaultValue: 'Santa is over {{stop}} · next stop {{next}} · {{presents}} presents delivered',
      }),
      home: t('santa.home', {
        ...vars,
        defaultValue: 'Santa is heading home to the North Pole · {{presents}} presents delivered',
      }),
      post: t('santa.post', {
        ...vars,
        defaultValue: 'Santa is back at the North Pole · {{presents}} presents delivered · Merry Christmas!',
      }),
    };
    const text = byPhase[santaInfo.phase] || '';
    return santaInfo.simulated ? `${text} (${t('santa.simulated', 'simulated')})` : text;
  }, [santaInfo, t]);

  // ── Plugin overlay layers (Maidenhead / zones / D-RAP / aurora / worked grids) ──────
  // The globe-capable subset of the plugin layers, driven by the same
  // enabled/opacity states the flat map persists (openhamclock_mapSettings
  // .layers). Data is fetched with the same endpoints and cadence as the
  // Leaflet hooks; painting happens on the shared overlay canvas only when a
  // toggle, opacity, or dataset changes — the render loop never repaints it.
  // In low-memory mode the whole feature is off and the layers stay in
  // WorldMap's suppressed-layers note instead.
  const drapOverlayOn = !lowMem && !!overlayLayerStates?.drap?.enabled;
  const auroraOverlayOn = !lowMem && !!overlayLayerStates?.aurora?.enabled;
  const zonesOverlayOn = !lowMem && !!overlayLayerStates?.zones?.enabled;
  const workedGridsOverlayOn = !lowMem && !!overlayLayerStates?.['worked-grids']?.enabled;
  const wxradarOverlayOn = !lowMem && !!overlayLayerStates?.wxradar?.enabled;
  const lightningOverlayOn = !lowMem && !!overlayLayerStates?.lightning?.enabled;
  const earthquakesOverlayOn = !lowMem && !!overlayLayerStates?.earthquakes?.enabled;
  const wildfiresOverlayOn = !lowMem && !!overlayLayerStates?.wildfires?.enabled;
  const floodsOverlayOn = !lowMem && !!overlayLayerStates?.floods?.enabled;
  const tornadoOverlayOn = !lowMem && !!overlayLayerStates?.['tornado-warnings']?.enabled;
  const aircraftOverlayOn = !lowMem && !!overlayLayerStates?.aircraft?.enabled;
  const atcOverlayOn = !lowMem && !!overlayLayerStates?.['atc-sectors']?.enabled;
  const historyOverlayOn = !lowMem && !!overlayLayerStates?.['history-playback']?.enabled;
  const [overlayDrap, setOverlayDrap] = useState(null);
  const [overlayAurora, setOverlayAurora] = useState(null);
  const [overlayZones, setOverlayZones] = useState(null);
  const [overlayWorkedGrids, setOverlayWorkedGrids] = useState(null);
  const [overlayWxRadar, setOverlayWxRadar] = useState(null);
  const [overlayLightning, setOverlayLightning] = useState(null);
  const [overlayEarthquakes, setOverlayEarthquakes] = useState(null);
  const [overlayWildfires, setOverlayWildfires] = useState(null);
  const [overlayFloods, setOverlayFloods] = useState(null);
  const [overlayTornado, setOverlayTornado] = useState(null);
  const [overlayAircraft, setOverlayAircraft] = useState(null);
  const [overlayATC, setOverlayATC] = useState(null);
  const [overlayHistory, setOverlayHistory] = useState(null);

  useEffect(() => {
    if (!drapOverlayOn) return undefined;
    let alive = true;
    const fetchDrap = async () => {
      try {
        const res = await fetch('/api/drap');
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.lats) && Array.isArray(data.lons) && Array.isArray(data.freqs)) {
          setOverlayDrap(data);
        }
      } catch (err) {
        console.error('[Globe3D] D-RAP fetch error:', err);
      }
    };
    fetchDrap();
    const id = setInterval(fetchDrap, 300_000); // server caches 5 min, like the flat layer
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [drapOverlayOn]);

  useEffect(() => {
    if (!auroraOverlayOn) return undefined;
    let alive = true;
    const fetchAurora = async () => {
      try {
        const res = await fetch('/api/noaa/aurora');
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.coordinates) && data.coordinates.length) {
          setOverlayAurora(data.coordinates);
        }
      } catch (err) {
        console.error('[Globe3D] aurora fetch error:', err);
      }
    };
    fetchAurora();
    const id = setInterval(fetchAurora, 600_000); // OVATION cadence, like the flat layer
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [auroraOverlayOn]);

  useEffect(() => {
    if (!zonesOverlayOn) return undefined;
    // CQ vs ITU is whatever the flat layer's on-map control last persisted.
    let zoneType = 'cq';
    try {
      zoneType = localStorage.getItem('openhamclock_zones_type') === 'itu' ? 'itu' : 'cq';
    } catch {}
    const src = ZONE_SOURCES[zoneType];
    let alive = true;
    fetch(src.file)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && Array.isArray(data.features)) {
          setOverlayZones({ geojson: data, color: src.color });
        }
      })
      .catch((err) => console.error('[Globe3D] zones fetch error:', err));
    return () => {
      alive = false;
    };
  }, [zonesOverlayOn]);

  useEffect(() => {
    if (!workedGridsOverlayOn) return undefined;
    // Same data source as the flat layer: the logbook cache, live via
    // subscribe (newly logged QSOs repaint immediately). The flat layer's
    // persisted band filter is honoured, read once per enable.
    let band = null;
    try {
      band = localStorage.getItem('openhamclock_worked_grids_band') || null;
    } catch {}
    return logbookStore.subscribe((qsos) => {
      setOverlayWorkedGrids(workedGridCounts(qsos, band));
    });
  }, [workedGridsOverlayOn]);

  // NEXRAD radar: one full-extent EPSG:4326 WMS image, pixel-aligned with
  // the 2048×1024 overlay canvas (n0r covers CONUS; elsewhere transparent).
  // crossOrigin keeps the canvas clean for WebGL texture upload.
  useEffect(() => {
    if (!wxradarOverlayOn) return undefined;
    let alive = true;
    const fetchRadar = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (alive) setOverlayWxRadar(img);
      };
      img.onerror = () => {
        if (alive) console.warn('[Globe3D] radar WMS image failed');
      };
      img.src =
        'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi' +
        '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=nexrad-n0r' +
        '&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=2048&HEIGHT=1024' +
        '&FORMAT=image/png&TRANSPARENT=true&t=' +
        Math.floor(Date.now() / 120_000); // 2-min buckets, like the flat layer
    };
    fetchRadar();
    const id = setInterval(fetchRadar, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayWxRadar(null);
    };
  }, [wxradarOverlayOn]);

  // Lightning: own Blitzortung socket (the Leaflet layer's socket never runs
  // in globe mode). Strikes are buffered and flushed to state every 10 s —
  // a deliberate cadence compromise between liveness and the globe's
  // render-on-change design (each flush repaints the whole overlay canvas).
  useEffect(() => {
    if (!lightningOverlayOn) return undefined;
    let alive = true;
    let ws = null;
    let serverIdx = 0;
    const servers = [
      'wss://ws8.blitzortung.org',
      'wss://ws7.blitzortung.org',
      'wss://ws2.blitzortung.org',
      'wss://ws1.blitzortung.org',
    ];
    const buffer = [];
    const flush = setInterval(() => {
      if (!alive || !buffer.length) return;
      const cutoff = Date.now() - 30 * 60 * 1000;
      const kept = buffer.filter((s) => s.timestamp > cutoff).slice(-500);
      buffer.length = 0;
      buffer.push(...kept);
      setOverlayLightning([...kept]);
    }, 10_000);
    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket(servers[serverIdx % servers.length]);
        ws.onopen = () => ws.send(JSON.stringify({ a: 111 }));
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(lzwDecode(event.data));
            if (data.time && data.lat != null && data.lon != null) {
              buffer.push({
                lat: parseFloat(data.lat),
                lon: parseFloat(data.lon),
                timestamp: parseInt(data.time / 1000000, 10),
              });
            }
          } catch {}
        };
        ws.onerror = () => {
          serverIdx++;
          try {
            ws.close();
          } catch {}
        };
        ws.onclose = () => {
          if (alive) setTimeout(connect, 5000);
        };
      } catch {
        serverIdx++;
        if (alive) setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      alive = false;
      clearInterval(flush);
      try {
        ws?.close();
      } catch {}
      setOverlayLightning(null);
    };
  }, [lightningOverlayOn]);

  // Earthquakes: same USGS feed choice the flat layer persists.
  useEffect(() => {
    if (!earthquakesOverlayOn) return undefined;
    let alive = true;
    let feed = '2.5_day';
    try {
      feed = localStorage.getItem('earthquake-feed') || '2.5_day';
    } catch {}
    const fetchQuakes = async () => {
      try {
        const res = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.features)) setOverlayEarthquakes(data.features.slice(0, 100));
      } catch (err) {
        console.error('[Globe3D] earthquakes fetch error:', err);
      }
    };
    fetchQuakes();
    const id = setInterval(fetchQuakes, 300_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayEarthquakes(null);
    };
  }, [earthquakesOverlayOn]);

  // Wildfires + floods: NASA EONET open events, same feeds as the flat layers.
  useEffect(() => {
    if (!wildfiresOverlayOn) return undefined;
    let alive = true;
    const fetchFires = async () => {
      try {
        const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open');
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.events)) setOverlayWildfires(data.events.slice(0, 150));
      } catch (err) {
        console.error('[Globe3D] wildfires fetch error:', err);
      }
    };
    fetchFires();
    const id = setInterval(fetchFires, 600_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayWildfires(null);
    };
  }, [wildfiresOverlayOn]);

  useEffect(() => {
    if (!floodsOverlayOn) return undefined;
    let alive = true;
    const fetchFloods = async () => {
      try {
        const [floods, storms] = await Promise.all([
          fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=floods&status=open').then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open').then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        const events = [...(floods?.events || []), ...(storms?.events || [])];
        if (alive && events.length) setOverlayFloods(events.slice(0, 150));
      } catch (err) {
        console.error('[Globe3D] floods fetch error:', err);
      }
    };
    fetchFloods();
    const id = setInterval(fetchFloods, 600_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayFloods(null);
    };
  }, [floodsOverlayOn]);

  // Tornado warnings: NWS active alerts, polygon geometries.
  useEffect(() => {
    if (!tornadoOverlayOn) return undefined;
    let alive = true;
    const fetchWarnings = async () => {
      try {
        const res = await fetch('https://api.weather.gov/alerts/active?event=Tornado%20Warning');
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.features)) {
          setOverlayTornado(data.features.filter((f) => f.geometry).slice(0, 150));
        }
      } catch (err) {
        console.error('[Globe3D] tornado warnings fetch error:', err);
      }
    };
    fetchWarnings();
    const id = setInterval(fetchWarnings, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayTornado(null);
    };
  }, [tornadoOverlayOn]);

  // Aircraft: the server's world snapshot (adsb.lol proxy, 60 s cache).
  // The globe shows the whole planet, so cap hard for canvas sanity.
  useEffect(() => {
    if (!aircraftOverlayOn) return undefined;
    let alive = true;
    const fetchPlanes = async () => {
      try {
        const res = await fetch('/api/aircraft');
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.aircraft)) {
          // Never prefix-slice this: adsb.lol orders the array west→east by
          // longitude, so a cap here would drop everything east of some
          // meridian. paintAircraft decimates spatially instead.
          setOverlayAircraft(data.aircraft.filter((p) => p.lat != null && p.lon != null && !p.onGround));
        }
      } catch (err) {
        console.error('[Globe3D] aircraft fetch error:', err);
      }
    };
    fetchPlanes();
    const id = setInterval(fetchPlanes, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
      setOverlayAircraft(null);
    };
  }, [aircraftOverlayOn]);

  // ATC sectors: static-ish boundaries (7-day server cache), densified like
  // the flat layer so long edges follow the projection honestly.
  useEffect(() => {
    if (!atcOverlayOn) return undefined;
    let alive = true;
    fetch('/api/atc/sectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data?.sectors)) {
          setOverlayATC({
            sectors: data.sectors.map((s) => ({ ...s, geometry: densifyGeoJson(s.geometry, 2) })),
          });
        }
      })
      .catch((err) => console.error('[Globe3D] ATC sectors fetch error:', err));
    return () => {
      alive = false;
      setOverlayATC(null);
    };
  }, [atcOverlayOn]);

  // History Playback: transport state, fetching, and the control UI live in
  // the shared store (services/historyPlaybackStore.js) so the flat map and
  // the globe scrub the same timeline. Subscribe for window data and mount
  // the same transport control absolutely over the WebGL canvas.
  useEffect(() => {
    if (!historyOverlayOn) return undefined;
    acquireHistory();
    const unsub = subscribeHistory((snap) => setOverlayHistory(snap.result));

    let control = null;
    let wrapper = null;
    const container = containerRef.current;
    if (container) {
      control = buildHistoryTransportControl(document);
      const el = control.el;
      // Same chrome as the Leaflet placement: .panel-wrapper > div carries
      // the floating-panel styling.
      wrapper = document.createElement('div');
      wrapper.className = 'panel-wrapper';
      wrapper.style.position = 'absolute';
      wrapper.style.top = '52px'; // below the projection/style controls
      wrapper.style.right = '10px';
      wrapper.style.zIndex = '1000';
      wrapper.appendChild(el);
      container.appendChild(wrapper);
      // Keep drags/scrolls on the control from grabbing the globe
      for (const evt of ['pointerdown', 'wheel', 'dblclick']) {
        el.addEventListener(evt, (e) => e.stopPropagation());
      }
      const saved = localStorage.getItem('history-playback-panel-position');
      if (saved) {
        try {
          const { top, left } = JSON.parse(saved);
          el.style.position = 'fixed';
          el.style.top = top + 'px';
          el.style.left = left + 'px';
          el.style.right = 'auto';
        } catch (_) {}
      }
      makeDraggable(el, 'history-playback-panel-position', { snap: 5 });
      addMinimizeToggle(el, 'history-playback-panel-position', {
        contentClassName: 'history-panel-content',
        buttonClassName: 'history-minimize-btn',
      });
    }

    return () => {
      unsub();
      releaseHistory();
      setOverlayHistory(null);
      if (control) {
        control.dispose();
        control.el.remove();
      }
      wrapper?.remove();
    };
  }, [historyOverlayOn]);

  // Repaint the shared overlay canvas. Content-keyed on the states object so
  // a parent re-render with identical enabled/opacity values repaints nothing.
  const overlayStatesKey = JSON.stringify(overlayLayerStates ?? null);
  useEffect(() => {
    const s = gl.current;
    if (!s.overlayCtx || !s.overlayShell) return;
    const states = overlayLayerStates || {};
    const { width, height } = s.overlayCanvas;
    const ctx = s.overlayCtx;
    ctx.clearRect(0, 0, width, height);
    const dataById = {
      zones: overlayZones,
      drap: overlayDrap,
      aurora: overlayAurora,
      'worked-grids': overlayWorkedGrids,
      wxradar: overlayWxRadar,
      lightning: overlayLightning,
      earthquakes: overlayEarthquakes,
      wildfires: overlayWildfires,
      floods: overlayFloods,
      'tornado-warnings': overlayTornado,
      'atc-sectors': overlayATC,
      'history-playback': overlayHistory,
    };
    let painted = false;
    for (const [id, painter] of Object.entries(GLOBE_OVERLAY_PAINTERS)) {
      const st = states[id];
      if (!st?.enabled) continue;
      // Painters with no data yet draw nothing — the canvas fills in when
      // the fetch effects above deliver.
      painter(ctx, { width, height, opacity: st.opacity, data: dataById[id] });
      painted = true;
    }
    s.overlayShell.visible = painted;
    s.overlayTexture.needsUpdate = true;
    s.requestRender?.();
    // overlayStatesKey stands in for overlayLayerStates (content compare);
    // lowMem: scene rebuild — repaint onto the fresh canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overlayStatesKey,
    overlayZones,
    overlayDrap,
    overlayAurora,
    overlayWorkedGrids,
    overlayWxRadar,
    overlayLightning,
    overlayEarthquakes,
    overlayWildfires,
    overlayFloods,
    overlayTornado,
    overlayATC,
    overlayHistory,
    lowMem,
  ]);

  // ── Aircraft: native 3D models ───────────────────────────
  // One InstancedMesh of flat airliner silhouettes (one draw call for
  // thousands of aircraft), each positioned just above the surface and
  // rotated to its true heading along the local tangent plane. Replaces
  // the old equirect-canvas darts — actual objects on the globe instead
  // of low-res arrows baked into a 2048px texture. Rebuilt when the 60 s
  // snapshot refreshes; nothing animates per-frame, so the parked render
  // loop stays parked.
  useEffect(() => {
    const s = gl.current;
    if (!s.scene) return undefined;

    const disposeMesh = () => {
      if (s.aircraftMesh) {
        s.scene.remove(s.aircraftMesh);
        s.aircraftMesh.geometry.dispose();
        s.aircraftMesh.material.dispose();
        s.aircraftMesh = null;
        s.requestRender?.();
      }
    };

    if (!aircraftOverlayOn || !overlayAircraft?.length) {
      disposeMesh();
      return undefined;
    }

    const AIRCRAFT_ALT = 1.007; // above the overlay shell, below markers
    const AIRCRAFT_SIZE = 0.0085; // world units — exaggerated for visibility
    const opacity = overlayLayerStates?.aircraft?.opacity ?? 0.9;

    const planes = decimateAircraft(overlayAircraft, 0.9);

    // Airliner silhouette (top view, nose +Y), symmetric about the Y axis.
    const half = [
      [0, 1],
      [0.07, 0.72],
      [0.09, 0.28],
      [0.78, -0.2],
      [0.78, -0.32],
      [0.1, -0.15],
      [0.07, -0.6],
      [0.34, -0.82],
      [0.34, -0.92],
      [0.04, -0.86],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(0, 1);
    for (const [x, y] of half.slice(1)) shape.lineTo(x, y);
    shape.lineTo(0, -0.95);
    for (const [x, y] of half.slice(1).reverse()) shape.lineTo(-x, y);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0xd7ecff,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    });

    disposeMesh();
    const mesh = new THREE.InstancedMesh(geometry, material, planes.length);
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const posUnit = new THREE.Vector3();
    const northPt = new THREE.Vector3();
    const eastPt = new THREE.Vector3();
    const north = new THREE.Vector3();
    const east = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const scale = new THREE.Vector3(AIRCRAFT_SIZE, AIRCRAFT_SIZE, AIRCRAFT_SIZE);

    planes.forEach((plane, i) => {
      latLonToVec3(plane.lat, plane.lon, AIRCRAFT_ALT, pos);
      latLonToVec3(plane.lat, plane.lon, 1, posUnit);
      // Local tangent frame, derived numerically so it matches whatever
      // axis convention latLonToVec3 uses.
      latLonToVec3(Math.min(89.5, plane.lat + 0.5), plane.lon, 1, northPt)
        .sub(posUnit)
        .normalize();
      north.copy(northPt);
      latLonToVec3(plane.lat, plane.lon + 0.5, 1, eastPt)
        .sub(posUnit)
        .normalize();
      east.copy(eastPt);
      const h = (((plane.heading ?? 0) % 360) * Math.PI) / 180;
      dir.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
      // Orthonormalize against the surface normal
      posUnit.normalize();
      dir.addScaledVector(posUnit, -dir.dot(posUnit)).normalize();
      xAxis.crossVectors(dir, posUnit).normalize();
      matrix.makeBasis(xAxis, dir, posUnit);
      matrix.scale(scale);
      matrix.setPosition(pos);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    s.scene.add(mesh);
    s.aircraftMesh = mesh;
    s.requestRender?.();

    return disposeMesh;
    // overlayLayerStates is content-keyed elsewhere; opacity changes ride
    // the aircraftOverlayOn/data refresh cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftOverlayOn, overlayAircraft, lowMem]);

  // ── Markers + arcs ───────────────────────────────────────
  useEffect(() => {
    const s = gl.current;
    if (!s.overlayGroup) return;

    // Clear previous frame's overlay objects.
    while (s.overlayGroup.children.length) {
      const child = s.overlayGroup.children.pop();
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose?.();
    }

    // Spot markers as a single Points cloud.
    if (markers.length) {
      const positions = new Float32Array(markers.length * 3);
      const colors = new Float32Array(markers.length * 3);
      const sizes = new Float32Array(markers.length);
      const v = new THREE.Vector3();
      const c = new THREE.Color();

      markers.forEach((m, i) => {
        latLonToVec3(m.lat, m.lon, EARTH_R * MARKER_ALT, v);
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
        c.set(m.color);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        sizes[i] = m.size;
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: s.dotTexture },
          uPixelRatio: { value: s.renderer?.getPixelRatio?.() ?? 1 },
        },
        vertexShader: /* glsl */ `
          attribute float size;
          uniform float uPixelRatio;
          varying vec3 vColor;
          void main() {
            vColor = color;
            // No distance term: markers keep a constant on-screen size at any
            // zoom, matching PointsMaterial's sizeAttenuation:false. gl_PointSize
            // is in device pixels, hence the pixel-ratio scale.
            gl_PointSize = size * uPixelRatio;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex;
          varying vec3 vColor;
          void main() {
            vec4 t = texture2D(uTex, gl_PointCoord);
            // Hard cut rather than a soft fade, so dots stay crisp discs.
            if (t.a < 0.5) discard;
            // THREE.Color.set() converts hex strings to linear, so band colours
            // need the same output transform as the globe texture.
            gl_FragColor = vec4(vColor, t.a);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        vertexColors: true,
        depthWrite: false,
      });

      const points = new THREE.Points(geo, mat);
      points.name = 'spots';
      points.frustumCulled = false;
      s.overlayGroup.add(points);
      s.markerData = markers;
    } else {
      s.markerData = [];
    }

    // Arcs — one merged LineSegments per opacity bucket keeps draw calls low.
    const buckets = new Map();
    arcs.forEach((a) => {
      const key = a.opacity;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(a);
    });

    buckets.forEach((list, opacity) => {
      const verts = [];
      const cols = [];
      const c = new THREE.Color();
      list.forEach((a) => {
        const pts = greatCircleArc(a.from[0], a.from[1], a.to[0], a.to[1], 48);
        c.set(a.color);
        for (let i = 0; i < pts.length - 1; i++) {
          // Dashed arcs (PSK RX paths, #1169) come free with LineSegments:
          // skipping every other segment leaves 24 separate dashes.
          if (a.dashed && i % 2) continue;
          verts.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      });
      if (!verts.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        // Additive makes crossing paths glow where they overlap, as in the QSO
        // plotter. It only works against a dark backdrop though — added onto a
        // white or grey panel it saturates and the lines vanish.
        blending: isDarkBackdrop ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      s.overlayGroup.add(line);
    });

    // DE / DX markers — hidden by the Settings toggle. Matches the flat map,
    // which gates only the markers themselves and leaves paths alone.
    s.stationMarkers = [];
    if (showDeDxMarkers) {
      // DE marker — station QTH.
      const deVec = latLonToVec3(lat0, lon0, EARTH_R * MARKER_ALT);
      const deDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 16, 12),
        new THREE.MeshBasicMaterial({ color: cssVarColor('--accent-blue', '#4488ff') }),
      );
      deDot.position.copy(deVec);
      s.overlayGroup.add(deDot);
      s.stationMarkers.push(deDot);

      const deRing = new THREE.Mesh(
        new THREE.RingGeometry(0.03, 0.038, 32),
        new THREE.MeshBasicMaterial({
          color: cssVarColor('--accent-blue', '#4488ff'),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
        }),
      );
      deRing.position.copy(deVec);
      deRing.lookAt(0, 0, 0);
      s.overlayGroup.add(deRing);
      s.stationMarkers.push(deRing);

      // DX marker — current target.
      if (Number.isFinite(dxLocation?.lat) && Number.isFinite(dxLocation?.lon)) {
        const dxVec = latLonToVec3(dxLocation.lat, dxLocation.lon, EARTH_R * MARKER_ALT);
        const dxRing = new THREE.Mesh(
          new THREE.RingGeometry(0.032, 0.045, 32),
          new THREE.MeshBasicMaterial({ color: cssVarColor('--accent-cyan', '#00ddff'), side: THREE.DoubleSide }),
        );
        dxRing.position.copy(dxVec);
        dxRing.lookAt(0, 0, 0);
        s.overlayGroup.add(dxRing);
        s.stationMarkers.push(dxRing);

        const dxDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.014, 16, 12),
          new THREE.MeshBasicMaterial({ color: cssVarColor('--accent-cyan', '#00ddff') }),
        );
        dxDot.position.copy(dxVec);
        s.overlayGroup.add(dxDot);
        s.stationMarkers.push(dxDot);
      }
    }
    // themeTick: DE/DX marker materials are built from CSS variables.
    // lowMem: scene rebuild — repopulate the fresh overlay group.
    s.requestRender?.();
    // lowMem: scene rebuild — repopulate the fresh overlay group.
  }, [markers, arcs, lat0, lon0, dxLocation, themeTick, showDeDxMarkers, isDarkBackdrop, lowMem]);

  // Relay mode draws only the relay satellite (the rest are one click away
  // in the layout's candidate list) and always shows its footprint.
  const globeSatellites = useMemo(
    () => (relaySatName ? (satellites || []).filter((sat) => sat.name === relaySatName) : satellites),
    [satellites, relaySatName],
  );
  const isSatSelected = (name) => selectedSats.includes(name) || name === relaySatName;

  // ── Satellites ───────────────────────────────────────────
  // Rendered from the same position/track data the Leaflet layer consumes, so
  // both projections agree. The one thing 3D adds for free is honesty about
  // altitude: dots sit at the satellite's true height above the sphere, with a
  // faint nadir line down to the ground point the tracks are drawn through.
  useEffect(() => {
    const s = gl.current;
    if (!s.satGroup) return;

    while (s.satGroup.children.length) {
      const child = s.satGroup.children.pop();
      // Model groups carry no root geometry/material of their own — their
      // nested meshes share session-cached template resources that must
      // survive this teardown, and these optional-chained disposes skip them.
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose?.();
    }
    s.satData = [];
    s.satModels = [];
    s.satDotSizes = null; // the size attribute above was just disposed
    // Invalidate any in-flight ISS glb swap on every rebuild path, including
    // the disabled/empty early return below — a late .then must never add to
    // a group that has since been cleared.
    s.satModelToken = (s.satModelToken || 0) + 1;

    if (!satellitesEnabled || !globeSatellites?.length) return;

    const accentCyan = cssVarColor('--accent-cyan', '#00ddff');
    const accentGreen = cssVarColor('--accent-green', '#00ff88');
    const accentAmber = cssVarColor('--accent-amber', '#ffb432');
    const blending = isDarkBackdrop ? THREE.AdditiveBlending : THREE.NormalBlending;
    const sats = globeSatellites.filter((sat) => Number.isFinite(sat?.lat) && Number.isFinite(sat?.lon));
    if (!sats.length) return;

    // Dots at true altitude, constant screen size like the spot markers.
    const positions = new Float32Array(sats.length * 3);
    const colors = new Float32Array(sats.length * 3);
    const sizes = new Float32Array(sats.length);
    const v = new THREE.Vector3();
    const c = new THREE.Color();

    sats.forEach((sat, i) => {
      const altR = 1 + (Number.isFinite(sat.alt) ? sat.alt : 0) / 6371;
      latLonToVec3(sat.lat, sat.lon, EARTH_R * Math.max(altR, MARKER_ALT), v);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      c.set(sat.color || accentCyan);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      sizes[i] = isSatSelected(sat.name) ? 13 : 8;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    // renderFrame zeroes a dot's size while its 3D model is visible so the
    // dot doesn't sit on top of the mesh; it restores from this copy.
    s.satDotSizes = { attr: geo.getAttribute('size'), base: sizes.slice() };

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: s.dotTexture },
        uPixelRatio: { value: s.renderer?.getPixelRatio?.() ?? 1 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_PointSize = size * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.5) discard;
          gl_FragColor = vec4(vColor, t.a);
        // Same transform the spot-dot shader this was copied from applies:
        // THREE.Color.set() yields linear values, so without it satellite
        // dots render in a different colour space from the rest.
        #include <colorspace_fragment>
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.name = 'sats';
    points.frustumCulled = false;
    s.satGroup.add(points);
    s.satData = sats;

    // ── 3D models — an LOD layer above the dots ────────────────────
    // Dots stay the raycast/interaction surface at every distance; models
    // fade in when the camera is near (or the bird is selected) and hold a
    // constant apparent size in renderFrame, like the station markers. The
    // ISS gets NASA's real model (lazy 2 MB glb, cubesat stand-in until it
    // arrives); everything else gets a procedural archetype. Skipped in
    // low-memory mode, where the dots are the whole story.
    const modelToken = s.satModelToken;
    if (!lowMem) {
      // Sun-following light rig: the Lambert model materials are the only
      // lit objects in the scene, so this touches nothing else. Rebuilt with
      // the group every 5 s, which also tracks the moving sun for free.
      const lightRig = new THREE.Group();
      lightRig.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.copy(s.sunWorld || new THREE.Vector3(1, 0.4, 0.6)).multiplyScalar(10);
      lightRig.add(sun);
      s.satGroup.add(lightRig);

      const placeModel = (obj, sat) => {
        const altR = Math.max(1 + (Number.isFinite(sat.alt) ? sat.alt : 0) / 6371, MARKER_ALT);
        const pos = latLonToVec3(sat.lat, sat.lon, EARTH_R * altR);
        obj.position.copy(pos);
        // Orient along the orbit: nose toward travel, belly toward the earth.
        let forward = null;
        if (Array.isArray(sat.track) && sat.track.length > 2) {
          const mid = Math.floor(sat.track.length / 2);
          const next = Math.min(mid + 1, sat.track.length - 1);
          const a = latLonToVec3(sat.track[mid][0], sat.track[mid][1], EARTH_R * altR);
          const b = latLonToVec3(sat.track[next][0], sat.track[next][1], EARTH_R * altR);
          forward = b.sub(a);
        }
        if (!forward || forward.lengthSq() < 1e-10) {
          forward = new THREE.Vector3(0, 1, 0).cross(pos);
        }
        obj.up.copy(pos).normalize();
        obj.lookAt(pos.clone().add(forward.normalize()));
        obj.visible = false; // renderFrame owns visibility via the LOD gate
        obj.userData.satSelected = isSatSelected(sat.name);
        s.satGroup.add(obj);
        s.satModels.push(obj);
      };

      sats.forEach((sat) => {
        const kind = classifySatellite(sat.name);
        placeModel(getArchetypeTemplate(kind === 'iss' ? 'cubesat' : kind).clone(), sat);
        if (kind !== 'iss') return;
        // Swap the stand-in for NASA's model when the glb lands. The token
        // guards against a 5 s rebuild (or scene teardown) racing the load.
        const standIn = s.satModels[s.satModels.length - 1];
        loadIssTemplate().then((tpl) => {
          if (!tpl || s.satModelToken !== modelToken || !s.satGroup) return;
          const real = tpl.clone();
          real.position.copy(standIn.position);
          real.quaternion.copy(standIn.quaternion);
          real.userData.satSelected = standIn.userData.satSelected;
          real.visible = false;
          const idx = s.satModels.indexOf(standIn);
          if (idx >= 0) s.satModels[idx] = real;
          s.satGroup.remove(standIn);
          s.satGroup.add(real);
          s.requestRender?.();
        });
      });
    }

    sats.forEach((sat) => {
      const isSelected = isSatSelected(sat.name);
      const altR = Math.max(1 + (Number.isFinite(sat.alt) ? sat.alt : 0) / 6371, MARKER_ALT);

      // Nadir line — makes the altitude legible against the ground track.
      const satPos = latLonToVec3(sat.lat, sat.lon, EARTH_R * altR);
      const ground = latLonToVec3(sat.lat, sat.lon, EARTH_R * 1.002);
      const nadirGeo = new THREE.BufferGeometry().setFromPoints([satPos, ground]);
      s.satGroup.add(
        new THREE.Line(
          nadirGeo,
          new THREE.LineBasicMaterial({
            color: sat.color || accentCyan,
            transparent: true,
            opacity: isSelected ? 0.5 : 0.2,
            depthWrite: false,
          }),
        ),
      );

      // Orbit track: past half solid (fading in toward now), future half
      // dashed amber — the same reading as the flat map's track + lead track.
      // Drawn at the satellite's current altitude rather than on the surface,
      // so it reads as the orbit itself. The data is a ground track, so this
      // is exact for circular orbits and a close approximation otherwise.
      if (Array.isArray(sat.track) && sat.track.length > 2) {
        const mid = Math.floor(sat.track.length / 2);
        const toVec = (pt) => latLonToVec3(pt[0], pt[1], EARTH_R * altR);

        const pastPts = sat.track.slice(0, mid + 1).map(toVec);
        const pastGeo = new THREE.BufferGeometry().setFromPoints(pastPts);
        const fade = new Float32Array(pastPts.length * 3);
        const base = new THREE.Color(isSelected ? '#ffffff' : accentCyan);
        for (let i = 0; i < pastPts.length; i++) {
          const k = (i / (pastPts.length - 1)) * 0.9 + 0.1;
          fade[i * 3] = base.r * k;
          fade[i * 3 + 1] = base.g * k;
          fade[i * 3 + 2] = base.b * k;
        }
        pastGeo.setAttribute('color', new THREE.BufferAttribute(fade, 3));
        s.satGroup.add(
          new THREE.Line(
            pastGeo,
            new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: isSelected ? 0.9 : 0.25,
              blending,
              depthWrite: false,
            }),
          ),
        );

        const leadPts = sat.track.slice(mid).map(toVec);
        const leadGeo = new THREE.BufferGeometry().setFromPoints(leadPts);
        const lead = new THREE.Line(
          leadGeo,
          new THREE.LineDashedMaterial({
            color: isSelected ? accentAmber : accentCyan,
            dashSize: 0.025,
            gapSize: 0.035,
            transparent: true,
            opacity: isSelected ? 0.85 : 0.2,
            depthWrite: false,
          }),
        );
        lead.computeLineDistances();
        s.satGroup.add(lead);
      }

      // Footprint ring for selected globeSatellites — green when workable from DE.
      if (isSelected && Number.isFinite(sat.footprintRadius) && sat.footprintRadius > 0) {
        const ringPts = footprintRingPoints(sat.lat, sat.lon, sat.footprintRadius / 6371, EARTH_R * 1.003);
        const footprintColor = sat.isVisible ? accentGreen : accentCyan;

        // Cone from the satellite to that ring, so the footprint reads as a
        // volume rather than a circle that happens to sit near a dot.
        //
        // DoubleSide is deliberate: seeing the far wall through the near one is
        // what gives it depth. depthWrite stays off so it never occludes the
        // globe, the ground track or the satellite itself — the cone is a hint,
        // not an object, and at low opacity a depth-writing mesh would punch a
        // hole in whatever it covers.
        s.satGroup.add(
          new THREE.Mesh(
            footprintConeGeometry(satPos, ringPts),
            new THREE.MeshBasicMaterial({
              color: footprintColor,
              transparent: true,
              opacity: 0.1,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        );

        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
        s.satGroup.add(
          new THREE.LineLoop(
            ringGeo,
            new THREE.LineBasicMaterial({
              color: footprintColor,
              transparent: true,
              opacity: 0.8,
              depthWrite: false,
            }),
          ),
        );
      }
    });
    // lowMem: scene rebuild — repopulate the fresh satellite group.
    s.requestRender?.();
  }, [globeSatellites, satellitesEnabled, selectedSats, themeTick, isDarkBackdrop, lowMem, relaySatName]);

  // ── Pointer interaction: hover tooltip + click ───────────
  useEffect(() => {
    const s = gl.current;
    const el = s.renderer?.domElement;
    if (!el) return undefined;

    const toPointer = (ev) => {
      const rect = el.getBoundingClientRect();
      s.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      return rect;
    };

    // Dots render at a constant pixel size, so a fixed world-space pick radius
    // is wrong at both ends of the zoom range: a few px zoomed out (visible
    // dots unclickable, clicks fall through and retarget DX), tens of px
    // zoomed in (grabs neighbours). Recompute per event from the pixel size.
    const setPickRadius = () => {
      const h = el.clientHeight || 1;
      const worldPerPixel = (2 * s.camera.position.length() * Math.tan((s.camera.fov * Math.PI) / 360)) / h;
      s.raycaster.params.Points.threshold = 7 * worldPerPixel;
    };

    // Distinguish a click from the tail of an orbit drag.
    let downAt = null;

    const onDown = (ev) => {
      downAt = { x: ev.clientX, y: ev.clientY };
      el.style.cursor = 'grabbing';
    };

    const onMove = (ev) => {
      kickIdleTimer();
      const rect = toPointer(ev);
      s.raycaster.setFromCamera(s.pointer, s.camera);
      setPickRadius();

      // Anything farther than the sphere's surface is on the far side of the
      // globe — without this cut, hidden markers steal hovers and clicks
      // straight through the planet.
      const earthHits = s.raycaster.intersectObject(s.earth, false);
      const horizon = (earthHits.length ? earthHits[0].distance : Infinity) + 1e-4;
      const nearest = (hits) => hits.find((h) => h.distance <= horizon);

      // Satellites sit above the surface, so test them before the spot cloud.
      const satsObj = s.satGroup?.children.find((c) => c.name === 'sats');
      const satHit = nearest(satsObj ? s.raycaster.intersectObject(satsObj, false) : []);
      if (satHit && s.satData?.[satHit.index]) {
        const sat = s.satData[satHit.index];
        el.style.cursor = 'pointer';
        setTooltip({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          label: sat.name,
          kind: '🛰',
          detail: [
            Number.isFinite(sat.alt) ? `${Math.round(sat.alt)} km` : null,
            sat.isVisible ? `az ${sat.azimuth}° · el ${sat.elevation}°` : null,
            sat.mode && sat.mode !== 'Unknown' ? sat.mode : null,
          ]
            .filter(Boolean)
            .join(' · '),
          color: sat.color || '#00ddff',
        });
        return;
      }

      const spots = s.overlayGroup?.children.find((c) => c.name === 'spots');
      const spotHit = nearest(spots ? s.raycaster.intersectObject(spots, false) : []);

      if (spotHit && s.markerData[spotHit.index]) {
        const m = s.markerData[spotHit.index];
        el.style.cursor = 'pointer';
        setTooltip({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          label: m.label,
          kind: m.kind,
          detail: m.detail,
          color: m.color,
        });
        return;
      }

      el.style.cursor = downAt ? 'grabbing' : 'grab';
      setTooltip(null);
    };

    const onUp = (ev) => {
      el.style.cursor = 'grab';
      const start = downAt;
      downAt = null;
      if (!start) return;
      const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (moved > 4) return; // it was a drag, not a click

      toPointer(ev);
      s.raycaster.setFromCamera(s.pointer, s.camera);
      setPickRadius();

      // Far-side cut, mirroring the hover path: only accept hits in front of
      // the sphere's surface.
      const earthHits = s.raycaster.intersectObject(s.earth, false);
      const horizon = (earthHits.length ? earthHits[0].distance : Infinity) + 1e-4;
      const nearest = (hits) => hits.find((h) => h.distance <= horizon);

      // Clicking a satellite toggles its selection (footprint + bright track),
      // the same gesture as the Leaflet layer — it does not set DX.
      const satsObj = s.satGroup?.children.find((c) => c.name === 'sats');
      const satHit = nearest(satsObj ? s.raycaster.intersectObject(satsObj, false) : []);
      if (satHit && s.satData?.[satHit.index]) {
        toggleSatSelection(s.satData[satHit.index].name);
        return;
      }

      // A spot under the cursor wins over the globe surface.
      const spots = s.overlayGroup?.children.find((c) => c.name === 'spots');
      const spotHit = nearest(spots ? s.raycaster.intersectObject(spots, false) : []);
      if (spotHit && s.markerData[spotHit.index]) {
        const m = s.markerData[spotHit.index];
        if (onSpotClick) onSpotClick(m.raw);
        else if (onDXChange && !dxLocked) onDXChange({ lat: m.lat, lon: m.lon });
        return;
      }

      if (earthHits.length && onDXChange && !dxLocked) {
        const { lat, lon } = vec3ToLatLon(earthHits[0].point);
        onDXChange({ lat, lon });
      }
    };

    const onLeave = () => {
      setTooltip(null);
      downAt = null;
      el.style.cursor = 'grab';
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    };
    // lowMem: scene rebuild — rebind the pointer handlers to the new canvas.
  }, [onDXChange, dxLocked, onSpotClick, markers, toggleSatSelection, kickIdleTimer, lowMem]);

  // ── View helpers ─────────────────────────────────────────
  const centerOn = useCallback((lat, lon) => {
    const s = gl.current;
    if (!s.camera || !s.controls) return;
    let dist = s.camera.position.length();
    // EME framing orbits the Earth–Moon midpoint; centring on a station means
    // "look at Earth again", so drop back to an Earth-centred orbit first.
    if (s.controls.target.lengthSq() > 0) {
      s.controls.target.set(0, 0, 0);
      dist = DEFAULT_CAM_DISTANCE;
    }
    latLonToVec3(lat, lon, dist, s.camera.position);
    s.controls.update();
    s.requestRender?.();
  }, []);

  // deLocation first arrives as the config default (N0CALL @ 41.5, -73) and is
  // replaced when the operator's real QTH loads. Latching onto the first finite
  // value therefore parks the globe over the wrong continent, so keep following
  // the QTH until the operator takes control of the view.
  useEffect(() => {
    const s = gl.current;
    if (!s.camera || !s.controls || !hasDE || userMovedRef.current) return;
    latLonToVec3(lat0, lon0, DEFAULT_CAM_DISTANCE, s.camera.position);
    s.controls.update();
    s.requestRender?.();
  }, [hasDE, lat0, lon0]);

  const btnStyle = {
    background: 'var(--bg-panel)',
    color: 'var(--accent-cyan)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    width: '30px',
    height: '24px',
    padding: 0,
    fontSize: '10px',
    fontFamily: 'var(--font-mono)',
    // Flex centring so the SVG icons sit dead centre, same as the text labels.
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };

  // The Retro theme forces `padding: 4px 12px !important` on every button,
  // which leaves a 6px content box inside a 30px border-box — enough to squash
  // a flex-item icon down to ~5px wide. Refusing to shrink keeps the icon at
  // its real size; it simply overflows into the padding, still centred.
  const iconStyle = { flexShrink: 0 };

  // Thrown during render (not in the effect) so the boundary above catches it.
  if (initError) throw initError;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
          borderRadius: '8px',
          // Backdrop follows the active theme (white on Light, grey on Retro),
          // with a theme-agnostic vignette over it for a little depth. The
          // WebGL canvas is alpha:true, so this shows through behind the globe.
          background:
            'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.12) 75%), var(--bg-panel)',
          overflow: 'hidden',
        }}
      />

      {/* Texture loading progress */}
      {textureLoading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'var(--accent-cyan)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            background: 'var(--bg-panel)',
            padding: '6px 12px',
            borderRadius: '4px',
            pointerEvents: 'none',
          }}
        >
          {t('map.loadingTiles', 'Loading globe')} {Math.round(textureProgress * 100)}%
        </div>
      )}

      {/* Christmas easter egg status line — see the Santa effect above */}
      {santaText && !hideUi && (
        <div
          style={{
            position: 'absolute',
            top: '48px',
            right: '10px',
            zIndex: 1100,
            maxWidth: 'calc(100% - 120px)', // leave the control column clear
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '5px 10px',
            pointerEvents: 'none',
          }}
          title={t('santa.title', 'Santa tracker')}
        >
          🎅 {santaText}
        </div>
      )}

      {/* Controls. The column itself survives hideUi so the eye button stays
          as the un-hide affordance — the same pattern as the flat map, where
          everything hides except the eye toggle. */}
      {(!hideUi || onToggleHideUi) && (
        <div
          style={{
            position: 'absolute',
            top: narrowPanel ? CONTROLS_TOP_NARROW : CONTROLS_TOP_WIDE,
            left: '10px',
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            // Keep buttons at their own width so the readout below can be wider
            // without stretching them.
            alignItems: 'flex-start',
            gap: '5px',
          }}
        >
          {onToggleHideUi && (
            <button
              style={{
                ...btnStyle,
                border: hideUi ? '1px solid var(--accent-cyan)' : btnStyle.border,
              }}
              onClick={onToggleHideUi}
              title={hideUi ? t('app.mapUi.show') : t('app.mapUi.hide')}
            >
              {hideUi ? <LiEye size={22} style={iconStyle} /> : <LiEyeOff size={22} style={iconStyle} />}
            </button>
          )}
          {!hideUi && (
            <>
              <button style={btnStyle} onClick={() => centerOn(lat0, lon0)} title="Center on your QTH">
                DE
              </button>
              {dxLocation && (
                <button style={btnStyle} onClick={() => centerOn(dxLocation.lat, dxLocation.lon)} title="Center on DX">
                  DX
                </button>
              )}
              <button
                style={{
                  ...btnStyle,
                  color: autoRotate ? 'var(--bg-primary)' : 'var(--accent-cyan)',
                  background: autoRotate ? 'var(--accent-cyan)' : btnStyle.background,
                }}
                onClick={() => setAutoRotate((v) => !v)}
                title={autoRotate ? 'Auto-rotate on — turns after 30 s idle' : 'Auto-rotate off'}
              >
                <LiRotate size={22} style={iconStyle} />
              </button>

              {/* Night overlay darkness — shares state with the flat map's slider */}
              {onNightDarknessChange && (
                <div
                  title="Adjust night overlay darkness"
                  style={{
                    marginTop: '4px',
                    width: '30px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '5px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    textAlign: 'center',
                  }}
                >
                  <span>{nightDarkness}%</span>
                  <input
                    type="range"
                    min="0"
                    max="90"
                    value={nightDarkness}
                    onChange={(e) => onNightDarknessChange(parseInt(e.target.value, 10))}
                    style={{
                      cursor: 'pointer',
                      margin: 0,
                      writingMode: 'vertical-lr',
                      WebkitAppearance: 'slider-vertical',
                      transform: 'rotate(180deg)',
                    }}
                  />
                </div>
              )}

              {suppressedLayers.length > 0 && (
                <div
                  title={suppressedLayers.join(', ')}
                  style={{
                    marginTop: '4px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-color)',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    cursor: 'help',
                  }}
                >
                  {suppressedLayers.length} map layer{suppressedLayers.length !== 1 ? 's' : ''} 2D-only
                </div>
              )}

              {/* Usage hint only. The DE/DX figures that used to sit here duplicate
              the DE and DX side panels, and as an opaque box on top of the
              globe they cost more than they gave. This disappears for good once
              the operator has actually used the controls. */}
              {!hasInteracted && (
                <div
                  style={{
                    marginTop: '4px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    background: 'var(--bg-panel)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                    lineHeight: 1.5,
                    whiteSpace: 'nowrap',
                    opacity: 0.75,
                  }}
                >
                  drag to rotate · scroll to zoom · click to set DX
                </div>
              )}
            </>
          )}
        </div>
      )}

      {satellitesEnabled && !hideUi && (
        <SatelliteInfoPanel
          satellites={satellites}
          selected={selectedSats}
          allUnits={allUnits}
          config={config}
          onDeselect={toggleSatSelection}
          onClearAll={clearSatSelection}
        />
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: `${tooltip.x + 14}px`,
            top: `${tooltip.y + 14}px`,
            background: 'var(--bg-panel)',
            border: `1px solid ${tooltip.color}`,
            borderRadius: '4px',
            padding: '4px 8px',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            pointerEvents: 'none',
            zIndex: 1200,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: tooltip.color, fontWeight: 'bold' }}>
            {tooltip.kind} · {tooltip.label}
          </div>
          {tooltip.detail && <div style={{ opacity: 0.8 }}>{tooltip.detail}</div>}
        </div>
      )}
    </div>
  );
}
