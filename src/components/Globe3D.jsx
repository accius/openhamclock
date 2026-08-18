/**
 * Globe3D Component
 * WebGL globe (three.js) rendering the station's world view on a real sphere.
 *
 * Unlike the Mercator and azimuthal views this one is not backed by Leaflet, so
 * great circles are drawn as true 3D arcs (slerp between unit vectors) and the
 * day/night terminator is a shader on the sphere rather than a canvas overlay.
 *
 * Consequence: Leaflet-bound plugin layers (satellites, aurora, lightning) are
 * not available here — WorldMap suppresses them while this projection is active.
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getBandColor, getBandFromFreq } from '../utils/callsign.js';
import { getSunPosition } from '../utils/geo.js';
import { MAP_STYLES } from '../utils/config.js';
import { buildGlobeTexture, chooseGlobeTileZoom } from '../utils/globeTexture.js';
// Project icon set — exists because bare glyphs/emoji render inconsistently
// (or as tofu) depending on the platform's font coverage.
import { IconRefresh, IconQth } from './Icons.jsx';

const DEG = Math.PI / 180;
const EARTH_R = 1;
const DEFAULT_CAM_DISTANCE = 3.2;
// Altitude of every overlay above the sphere, as a multiple of EARTH_R.
// Markers and arc endpoints share it so arcs start exactly at the dot.
const MARKER_ALT = 1.012;
// Below this panel width WorldMap's projection toggle wraps across the top of
// the map, so the globe's own controls have to move out from under it.
const NARROW_PANEL_PX = 480;
const CONTROLS_TOP_WIDE = '10px';
const CONTROLS_TOP_NARROW = '52px';
const AUTOROTATE_KEY = 'ohc_globe_autorotate';
const AUTOROTATE_SPEED = 0.6;

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
 * Activity-type marker palette.
 *
 * Deliberately not themed: these identify what a spot *is*, and a POTA marker
 * has to read identically in Flat, Azimuthal and 3D. WorldMap and AzimuthalMap
 * use these same values, so re-theming them here would desynchronise the
 * projections. Band colours are centralised in bandColors.js for the same
 * reason. Station accents (DE/DX) and all UI chrome do follow the theme.
 */
const ACTIVITY_COLORS = {
  pota: '#44cc44',
  wwff: '#22bb88',
  sota: '#ddaa33',
  wwbota: '#cc66dd',
  pskRx: '#ff44aa',
  pskTx: '#aa66ff',
  wsjtx: '#00ddff',
  bandFallback: '#ffcc00',
};

// Same sessionStorage key the Leaflet satellite layer uses, so a satellite
// selected in Flat mode stays selected when switching to 3D and back.
const SAT_SELECTED_KEY = 'selected_satellites';

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
  uniform vec3 uSunDir;         // in view space
  uniform float uNightDarkness; // 0..1, same meaning as the flat map's overlay opacity
  uniform float uBrightness;    // lift for dark basemaps
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec3 tex = texture2D(uMap, vUv).rgb * uBrightness;
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
  showWSJTX,
  onSpotClick,
  callsign,
  showDeDxMarkers = true,
  satellites,
  satellitesEnabled = true,
  hideUi = false,
  tileStyle = 'dark',
  lowMemoryMode = false,
  nightDarkness = 60,
  onNightDarknessChange,
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const gl = useRef({}); // three.js objects, kept off React state
  // Mirrors the nightDarkness prop so a scene rebuild seeds the shader uniform
  // with the current value instead of snapping back to the material default.
  const nightDarknessRef = useRef(nightDarkness);
  // Same reason: a rebuilt OrbitControls starts with autoRotate off, and the
  // toggle's effect will not re-run because the state did not change.
  const autoRotateRef = useRef(true);
  const [textureLoading, setTextureLoading] = useState(true);
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
  const [panelWidth, setPanelWidth] = useState(0);
  // Satellite selection, shared with the Leaflet layer via sessionStorage.
  const [selectedSats, setSelectedSats] = useState(readSelectedSats);
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
          color: getBandColor(parseFloat(p.freq)) || ACTIVITY_COLORS.bandFallback,
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
          color: isRx ? ACTIVITY_COLORS.pskRx : ACTIVITY_COLORS.pskTx,
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
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
        const band = normalizeBandKey(s.band) || bandFromAnyFrequency(s.freq);
        if (!bandPassesMapFilter(band)) return;
        out.push({
          lat: s.lat,
          lon: s.lon,
          color: ACTIVITY_COLORS.wsjtx,
          size: 8,
          kind: 'WSJT-X',
          label: s.dxCall || s.call || s.callsign || 'WSJT-X',
          detail: [band, s.mode, s.snr != null ? `${s.snr} dB` : null].filter(Boolean).join(' · '),
          raw: s,
        });
      });
    }

    return out;
  }, [
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
          color: getBandColor(parseFloat(p.freq)) || ACTIVITY_COLORS.bandFallback,
          opacity: 0.62,
        });
      });
    }

    if (Number.isFinite(dxLocation?.lat) && Number.isFinite(dxLocation?.lon)) {
      out.push({
        from: [lat0, lon0],
        to: [dxLocation.lat, dxLocation.lon],
        color: cssVarColor('--accent-cyan', '#00ddff'),
        opacity: 1,
      });
    }

    return out;
    // themeTick: the DE→DX arc colour is read from a CSS variable.
  }, [dxPaths, showDXPaths, bandPassesMapFilter, dxLocation, lat0, lon0, themeTick]);

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
    controls.maxDistance = 8;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = AUTOROTATE_SPEED;
    // Fires on pointer-down / wheel, i.e. genuine user gestures — programmatic
    // controls.update() calls do not trigger it.
    controls.addEventListener('start', () => {
      userMovedRef.current = true;
      setHasInteracted(true);
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

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.02;
    const pointer = new THREE.Vector2();

    gl.current = {
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
      raycaster,
      pointer,
      dotTexture: makeDotTexture(),
      markerData: [],
      disposables: [],
    };

    // ── Render loop ────────────────────────────────────────
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = gl.current;
      if (!s.renderer) return;
      s.controls.update();
      // Counter-scale the station markers so they hold a constant apparent
      // size, matching the spot dots instead of swelling as you zoom in.
      if (s.stationMarkers?.length) {
        const k = s.camera.position.length() / DEFAULT_CAM_DISTANCE;
        for (let i = 0; i < s.stationMarkers.length; i++) s.stationMarkers[i].scale.setScalar(k);
      }
      // Sun direction is fixed in world space; convert to view space per frame.
      if (s.sunWorld) {
        s.earthMat.uniforms.uSunDir.value.copy(s.sunWorld).transformDirection(s.camera.matrixWorldInverse);
      }
      s.renderer.render(s.scene, s.camera);
    };
    tick();

    // ── Resize ─────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // On a narrow panel WorldMap's projection toggle spans the full width and
      // would sit on top of our control column, so the column drops below it.
      setPanelWidth(w);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      const s = gl.current;
      s.disposables?.forEach((d) => d.dispose?.());
      earth.geometry.dispose();
      earthMat.uniforms.uMap.value?.dispose?.();
      earthMat.dispose();
      atmosphere.geometry.dispose();
      atmosphere.material.dispose();
      if (stars) {
        stars.geometry.dispose();
        stars.material.dispose();
      }
      s.dotTexture?.dispose?.();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      gl.current = {};
    };
  }, [lowMem]);

  // ── Night overlay darkness ───────────────────────────────
  useEffect(() => {
    nightDarknessRef.current = nightDarkness;
    const s = gl.current;
    if (!s.earthMat) return;
    s.earthMat.uniforms.uNightDarkness.value = THREE.MathUtils.clamp(nightDarkness / 100, 0, 1);
  }, [nightDarkness]);

  // ── Starfield / atmosphere follow the backdrop ───────────
  useEffect(() => {
    const s = gl.current;
    if (s.stars) s.stars.visible = isDarkBackdrop;
    if (s.atmosphere) s.atmosphere.visible = isDarkBackdrop;
  }, [isDarkBackdrop]);

  // ── Auto-rotate toggle ───────────────────────────────────
  useEffect(() => {
    const s = gl.current;
    if (!s.controls) return;
    autoRotateRef.current = autoRotate;
    s.controls.autoRotate = autoRotate;
    // ~90s per revolution once damping is taken into account: visibly turning
    // without being distracting on a dashboard left running all day.
    s.controls.autoRotateSpeed = AUTOROTATE_SPEED;
    try {
      localStorage.setItem(AUTOROTATE_KEY, String(autoRotate));
    } catch {}
  }, [autoRotate]);

  // ── Texture: rebuild when the map style changes ──────────
  useEffect(() => {
    const style = MAP_STYLES[tileStyle]?.url ? tileStyle : 'dark';
    const template = MAP_STYLES[style].url;
    if (!template) return undefined;

    const ac = new AbortController();
    setTextureLoading(true);
    setTextureProgress(0);

    buildGlobeTexture({
      tileUrlTemplate: template,
      tileZoom: chooseGlobeTileZoom({ lowMemory: lowMem, pixelRatio: window.devicePixelRatio || 1 }),
      // Countries ships transparent overlay tiles; flat mode paints this same
      // blue behind them via the map div's background.
      baseColor: MAP_STYLES[style].countriesOverlay ? '#4a90d9' : undefined,
      onProgress: (p) => setTextureProgress(p),
      signal: ac.signal,
    })
      .then(({ canvas, meanLuma }) => {
        if (ac.signal.aborted) return;
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
        setTextureLoading(false);
      })
      .catch((e) => {
        if (!ac.signal.aborted) {
          console.warn('[Globe3D] texture build failed:', e);
          setTextureLoading(false);
        }
      });

    return () => ac.abort();
  }, [tileStyle, lowMem]);

  // ── Terminator: track the subsolar point ─────────────────
  useEffect(() => {
    const update = () => {
      const s = gl.current;
      if (!s.earthMat) return;
      const sun = getSunPosition(new Date());
      s.sunWorld = latLonToVec3(sun.lat, sun.lon, 1).normalize();
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

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
  }, [markers, arcs, lat0, lon0, dxLocation, themeTick, showDeDxMarkers, isDarkBackdrop]);

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
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose?.();
    }
    s.satData = [];

    if (!satellitesEnabled || !satellites?.length) return;

    const accentCyan = cssVarColor('--accent-cyan', '#00ddff');
    const accentGreen = cssVarColor('--accent-green', '#00ff88');
    const accentAmber = cssVarColor('--accent-amber', '#ffb432');
    const blending = isDarkBackdrop ? THREE.AdditiveBlending : THREE.NormalBlending;
    const sats = satellites.filter((sat) => Number.isFinite(sat?.lat) && Number.isFinite(sat?.lon));
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
      sizes[i] = selectedSats.includes(sat.name) ? 13 : 8;
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

    sats.forEach((sat) => {
      const isSelected = selectedSats.includes(sat.name);
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

      // Ground track: past half solid (fading in toward now), future half
      // dashed amber — the same reading as the flat map's track + lead track.
      if (Array.isArray(sat.track) && sat.track.length > 2) {
        const mid = Math.floor(sat.track.length / 2);
        const toVec = (pt) => latLonToVec3(pt[0], pt[1], EARTH_R * 1.004);

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

      // Footprint ring for selected satellites — green when workable from DE.
      if (isSelected && Number.isFinite(sat.footprintRadius) && sat.footprintRadius > 0) {
        const ringPts = footprintRingPoints(sat.lat, sat.lon, sat.footprintRadius / 6371, EARTH_R * 1.003);
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
        s.satGroup.add(
          new THREE.LineLoop(
            ringGeo,
            new THREE.LineBasicMaterial({
              color: sat.isVisible ? accentGreen : accentCyan,
              transparent: true,
              opacity: 0.8,
              depthWrite: false,
            }),
          ),
        );
      }
    });
  }, [satellites, satellitesEnabled, selectedSats, themeTick, isDarkBackdrop]);

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

    // Distinguish a click from the tail of an orbit drag.
    let downAt = null;

    const onDown = (ev) => {
      downAt = { x: ev.clientX, y: ev.clientY };
      el.style.cursor = 'grabbing';
    };

    const onMove = (ev) => {
      const rect = toPointer(ev);
      s.raycaster.setFromCamera(s.pointer, s.camera);

      // Satellites sit above the surface, so test them before the spot cloud.
      const satsObj = s.satGroup?.children.find((c) => c.name === 'sats');
      const satHits = satsObj ? s.raycaster.intersectObject(satsObj, false) : [];
      if (satHits.length && s.satData?.[satHits[0].index]) {
        const sat = s.satData[satHits[0].index];
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
      const hits = spots ? s.raycaster.intersectObject(spots, false) : [];

      if (hits.length && s.markerData[hits[0].index]) {
        const m = s.markerData[hits[0].index];
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

      // Clicking a satellite toggles its selection (footprint + bright track),
      // the same gesture as the Leaflet layer — it does not set DX.
      const satsObj = s.satGroup?.children.find((c) => c.name === 'sats');
      const satHits = satsObj ? s.raycaster.intersectObject(satsObj, false) : [];
      if (satHits.length && s.satData?.[satHits[0].index]) {
        toggleSatSelection(s.satData[satHits[0].index].name);
        return;
      }

      // A spot under the cursor wins over the globe surface.
      const spots = s.overlayGroup?.children.find((c) => c.name === 'spots');
      const spotHits = spots ? s.raycaster.intersectObject(spots, false) : [];
      if (spotHits.length && s.markerData[spotHits[0].index]) {
        const m = s.markerData[spotHits[0].index];
        if (onSpotClick) onSpotClick(m.raw);
        else if (onDXChange && !dxLocked) onDXChange({ lat: m.lat, lon: m.lon });
        return;
      }

      const earthHits = s.raycaster.intersectObject(s.earth, false);
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
  }, [onDXChange, dxLocked, onSpotClick, markers, toggleSatSelection]);

  // ── View helpers ─────────────────────────────────────────
  const centerOn = useCallback((lat, lon) => {
    const s = gl.current;
    if (!s.camera || !s.controls) return;
    const dist = s.camera.position.length();
    latLonToVec3(lat, lon, dist, s.camera.position);
    s.controls.update();
  }, []);

  // Reset returns to the default distance looking straight down on the
  // operator's QTH — the same view the globe opens with.
  const resetView = useCallback(() => {
    const s = gl.current;
    if (!s.camera || !s.controls) return;
    const { has, lat, lon } = deRef.current;
    if (has) latLonToVec3(lat, lon, DEFAULT_CAM_DISTANCE, s.camera.position);
    else s.camera.position.set(0, 0, DEFAULT_CAM_DISTANCE);
    s.controls.update();
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

      {/* Controls */}
      {!hideUi && (
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
          <button style={btnStyle} onClick={() => centerOn(lat0, lon0)} title="Center on your QTH">
            DE
          </button>
          {dxLocation && (
            <button style={btnStyle} onClick={() => centerOn(dxLocation.lat, dxLocation.lon)} title="Center on DX">
              DX
            </button>
          )}
          <button style={btnStyle} onClick={resetView} title="Reset view to your QTH">
            <IconQth size={15} style={iconStyle} />
          </button>
          <button
            style={{
              ...btnStyle,
              color: autoRotate ? 'var(--bg-primary)' : 'var(--accent-cyan)',
              background: autoRotate ? 'var(--accent-cyan)' : btnStyle.background,
            }}
            onClick={() => setAutoRotate((v) => !v)}
            title={autoRotate ? 'Stop auto-rotate' : 'Auto-rotate'}
          >
            <IconRefresh size={15} style={iconStyle} />
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
        </div>
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
