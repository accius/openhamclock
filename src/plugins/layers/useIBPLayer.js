/**
 * IBP Beacon Map Layer Plugin
 *
 * Shows all 18 NCDXF/IARU International Beacon Project stations on the map.
 * The currently-transmitting beacon on each band is highlighted with a
 * pulsing ring and the band label.  Great-circle arcs connect the operator's
 * QTH to each active beacon.  No network requests — the schedule is
 * fully deterministic.
 *
 * Reference: https://www.ncdxf.org/beacon/beaconschedule.html
 */
import { useEffect, useRef, useState } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { getGreatCirclePoints, replicatePath, replicatePoint } from '../../utils/geo.js';
import { DEFAULT_BAND_COLORS } from '../../utils/bandColors.js';
import {
  IBP_BEACONS,
  IBP_BANDS,
  getCurrentSlot,
  getSecondsRemainingInSlot,
  SLOT_SECONDS,
  CYCLE_SECONDS,
} from '../../utils/ibp.js';
import { useRig } from '../../contexts/RigContext.jsx';
import { makeDraggable } from './makeDraggable.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';

export const metadata = {
  id: 'ibp',
  name: 'plugins.layers.ibp.name',
  description: 'plugins.layers.ibp.description',
  icon: '📡',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.85,
  version: '1.0.0',
};

/** Inject pulse-ring CSS once per page load. */
let _cssInjected = false;
function injectCSS() {
  if (_cssInjected || typeof document === 'undefined') return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ibp-pulse {
      0%   { transform: scale(1);   opacity: 0.9; }
      50%  { transform: scale(1.7); opacity: 0.3; }
      100% { transform: scale(1);   opacity: 0.9; }
    }
    .ibp-pulse-ring {
      border-radius: 50%;
      animation: ibp-pulse 2s ease-in-out infinite;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

/** Build the active-beacon divIcon for a given band colour. */
function activeIcon(color, label) {
  const size = 22;
  const html = `
    <div style="position:relative;width:${size}px;height:${size}px;">
      <div class="ibp-pulse-ring" style="
        position:absolute;inset:0;
        border: 2.5px solid ${color};
        background: transparent;
      "></div>
      <div style="
        position:absolute;inset:4px;
        border-radius:50%;
        background:${color};
        opacity:0.95;
      "></div>
      <div style="
        position:absolute;
        top:-14px;left:50%;transform:translateX(-50%);
        font-size:9px;font-weight:700;
        color:${color};
        white-space:nowrap;
        text-shadow:0 0 3px #000,0 0 3px #000;
        font-family:'JetBrains Mono',monospace;
        pointer-events:none;
      ">${esc(label)}</div>
    </div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 6],
  });
}

/** Build the popup HTML for a beacon marker. */
function buildPopup(beacon, activeBands, secondsLeft) {
  const activeLines = activeBands
    .map(
      (b) =>
        `<span style="color:${DEFAULT_BAND_COLORS[b.label] ?? 'var(--text-muted)'};font-weight:700;">${b.label} ${b.mhz.toFixed(3)} MHz</span>`,
    )
    .join('<br>');

  // Seconds until this beacon next appears on 14.100 — useful when inactive
  const slot = getCurrentSlot(new Date());
  const beaconIndex = IBP_BEACONS.indexOf(beacon);
  const slotsUntil = ((beaconIndex - slot + IBP_BEACONS.length) % IBP_BEACONS.length) * SLOT_SECONDS;
  const nextIn = slotsUntil === 0 ? secondsLeft : slotsUntil + secondsLeft;

  return `
    <div style="font-family:'JetBrains Mono',monospace;font-size:12px;min-width:170px;">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${esc(beacon.callsign)}</div>
      <div style="color:var(--text-muted);margin-bottom:4px;">${esc(beacon.location)}</div>
      <div style="color:var(--text-muted);font-size:10px;margin-bottom:6px;">Grid: ${esc(beacon.grid)}</div>
      ${
        activeBands.length > 0
          ? `<div style="margin-bottom:4px;">▶ Active now:<br>${activeLines}</div>
             <div style="font-size:10px;color:var(--text-muted);">Slot ends in ${secondsLeft}s</div>`
          : `<div style="color:var(--text-muted);font-size:10px;">Next on 14.100 in ~${nextIn}s</div>`
      }
    </div>`;
}

export function useLayer({ enabled = false, opacity = 0.85, map = null, deLat = null, deLon = null }) {
  const [slot, setSlot] = useState(() => getCurrentSlot(new Date()));
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsRemainingInSlot(new Date()));
  const [showPaths, setShowPaths] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [bandFilter, setBandFilter] = useState('all');

  const { enabled: rigEnabled, tuneTo } = useRig();
  const rigRef = useRef({ rigEnabled, tuneTo });
  rigRef.current = { rigEnabled, tuneTo };

  const layersRef = useRef([]);
  const controlRef = useRef(null);

  // State refs so the render effect can always read current values
  const showPathsRef = useRef(showPaths);
  const showInactiveRef = useRef(showInactive);
  const bandFilterRef = useRef(bandFilter);
  showPathsRef.current = showPaths;
  showInactiveRef.current = showInactive;
  bandFilterRef.current = bandFilter;

  // 1-second ticker — only updates slot state on boundary
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const now = new Date();
      setSlot(getCurrentSlot(now));
      setSecondsLeft(getSecondsRemainingInSlot(now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  // Render / re-render markers and arcs whenever slot, options or map change
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    injectCSS();

    // Clear previous layers
    layersRef.current.forEach((l) => {
      try {
        map.removeLayer(l);
      } catch (_) {}
    });
    layersRef.current = [];

    if (!enabled) return;

    const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);
    const de = hasDE ? { lat: deLat, lon: deLon } : null;

    // Resolve CSS variables for Leaflet SVG options (can't use var(--x) in JS object props)
    const cs = getComputedStyle(document.documentElement);
    const colorInactiveFill = cs.getPropertyValue('--text-muted').trim() || '#666';
    const colorInactiveStroke = cs.getPropertyValue('--border-color').trim() || '#999';

    // Build a lookup: beaconIndex → array of active bands
    const activeBandsByBeacon = new Map();
    const activeBands = IBP_BANDS.map((band) => {
      const idx = (slot + band.offset) % IBP_BEACONS.length;
      if (!activeBandsByBeacon.has(idx)) activeBandsByBeacon.set(idx, []);
      activeBandsByBeacon.get(idx).push(band);
      return { band, beaconIndex: idx };
    });

    // Filter by band if panel controls say so
    const visibleBands = bandFilter === 'all' ? activeBands : activeBands.filter((a) => a.band.label === bandFilter);

    // Draw great-circle arcs DE → each active beacon
    if (hasDE && showPaths) {
      visibleBands.forEach(({ band, beaconIndex }) => {
        const beacon = IBP_BEACONS[beaconIndex];
        const color = DEFAULT_BAND_COLORS[band.label] ?? '#aaa';
        const pts = getGreatCirclePoints(de.lat, de.lon, beacon.lat, beacon.lon, 80);
        replicatePath(pts).forEach((copy) => {
          const line = L.polyline(copy, {
            color,
            weight: 1.5,
            opacity: opacity * 0.6,
            dashArray: '6 5',
            smoothFactor: 1,
          });
          line.addTo(map);
          layersRef.current.push(line);
        });
      });
    }

    // Draw beacon markers
    IBP_BEACONS.forEach((beacon, idx) => {
      const beaconActiveBands = activeBandsByBeacon.get(idx) ?? [];
      const isActive =
        beaconActiveBands.length > 0 && (bandFilter === 'all' || beaconActiveBands.some((b) => b.label === bandFilter));

      if (!isActive && !showInactive) return;

      const popupHtml = buildPopup(beacon, beaconActiveBands, secondsLeft);

      if (isActive) {
        // One highlighted marker per active beacon (use colour of lowest band)
        const primaryBand = beaconActiveBands[0];
        const color = DEFAULT_BAND_COLORS[primaryBand.label] ?? '#aaa';
        const bandLabels = beaconActiveBands.map((b) => b.label).join('/');

        replicatePoint(beacon.lat, beacon.lon).forEach(([lat, lon]) => {
          const marker = L.marker([lat, lon], {
            icon: activeIcon(color, bandLabels),
            zIndexOffset: 500,
          });
          marker.bindPopup(popupHtml);
          marker.on('click', () => {
            if (rigRef.current.rigEnabled) rigRef.current.tuneTo(primaryBand.mhz, 'CW');
          });
          marker.addTo(map);
          layersRef.current.push(marker);
        });
      } else {
        // Inactive: small dim circle marker
        replicatePoint(beacon.lat, beacon.lon).forEach(([lat, lon]) => {
          const marker = L.circleMarker([lat, lon], {
            radius: 4,
            fillColor: colorInactiveFill,
            color: colorInactiveStroke,
            weight: 1,
            opacity: opacity * 0.5,
            fillOpacity: opacity * 0.35,
          });
          marker.bindPopup(popupHtml);
          marker.addTo(map);
          layersRef.current.push(marker);
        });
      }
    });
  }, [map, enabled, slot, showPaths, showInactive, bandFilter, opacity, deLat, deLon]);

  // Control panel — created once, stats updated separately
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const wrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'ibp-layer-control', wrapper);
        div.style.minWidth = '200px';
        div.innerHTML = `
          <div class="floating-panel-header">📡 IBP Beacons</div>
          <div id="ibp-countdown" style="
            font-family:'JetBrains Mono',monospace;
            font-size:11px;color:var(--text-secondary);
            margin-bottom:8px;
          ">Slot: — / ${SLOT_SECONDS}s</div>
          <div style="margin-bottom:6px;">
            <label style="font-size:11px;">Band:</label>
            <select id="ibp-band-select" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);padding:3px;font-size:11px;">
              <option value="all">All bands</option>
              ${IBP_BANDS.map((b) => `<option value="${b.label}">${b.label} – ${b.mhz.toFixed(3)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:4px;">
            <label style="font-size:11px;">
              <input type="checkbox" id="ibp-paths" ${showPaths ? 'checked' : ''}>
              Show paths to active beacons
            </label>
          </div>
          <div style="margin-bottom:6px;">
            <label style="font-size:11px;">
              <input type="checkbox" id="ibp-inactive" ${showInactive ? 'checked' : ''}>
              Show inactive stations
            </label>
          </div>
          <div style="font-size:9px;color:var(--text-muted);padding-top:6px;border-top:1px solid var(--border-color);">
            NCDXF / IARU • deterministic schedule
          </div>`;

        // Wire up event listeners directly — div is in-memory, no setTimeout needed
        const bandSel = div.querySelector('#ibp-band-select');
        const pathsCk = div.querySelector('#ibp-paths');
        const inactiveCk = div.querySelector('#ibp-inactive');

        if (bandSel) {
          bandSel.value = bandFilterRef.current;
          bandSel.addEventListener('change', (e) => setBandFilter(e.target.value));
        }
        if (pathsCk) pathsCk.addEventListener('change', (e) => setShowPaths(e.target.checked));
        if (inactiveCk) inactiveCk.addEventListener('change', (e) => setShowInactive(e.target.checked));

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return wrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    // Double-rAF: first frame Leaflet inserts the element, second frame it's painted
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const container = controlRef.current?.getContainer()?.querySelector('.ibp-layer-control');
        if (!container) return;
        const saved = localStorage.getItem('ibp-panel-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch (_) {}
        }
        makeDraggable(container, 'ibp-panel-position', { snap: 5 });
        addMinimizeToggle(container, 'ibp-panel-position', {
          contentClassName: 'ibp-panel-content',
          buttonClassName: 'ibp-minimize-btn',
        });
      }),
    );

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, enabled]);

  // Update countdown in control panel every second without full re-render
  useEffect(() => {
    if (!enabled || !controlRef.current) return;
    const el = controlRef.current.getContainer()?.querySelector('#ibp-countdown');
    if (!el) return;
    el.textContent = `Slot ${slot + 1}/18 — ${secondsLeft}s remaining`;
    // Colour the countdown amber in the last 3 seconds
    el.style.color = secondsLeft <= 3 ? 'var(--accent-amber)' : 'var(--text-secondary)';
  }, [enabled, slot, secondsLeft]);

  // Clean up on disable
  useEffect(() => {
    if (enabled) return;
    layersRef.current.forEach((l) => {
      try {
        map?.removeLayer(l);
      } catch (_) {}
    });
    layersRef.current = [];
    if (controlRef.current) {
      map?.removeControl(controlRef.current);
      controlRef.current = null;
    }
  }, [enabled, map]);

  return null;
}
