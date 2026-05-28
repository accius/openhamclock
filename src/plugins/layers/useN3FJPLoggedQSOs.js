import { useEffect, useState, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';
import { getGreatCirclePoints, replicatePath, maidenheadToLatLon } from '../../utils/geo.js';

export const metadata = {
  id: 'n3fjp_logged_qsos',
  name: 'Logged QSOs (N3FJP)',
  description: 'Shows recently logged QSOs (and live entry previews) from the N3FJP bridge.',
  icon: '🗺️',
  category: 'overlay',
  localOnly: true,
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '0.3.0',
};

const POLL_MS = 2000;

// --- User settings (persisted) ---
const STORAGE_MINUTES_KEY = 'n3fjp_display_minutes';
const STORAGE_COLOR_KEY = 'n3fjp_line_color';
const STORAGE_PREVIEW_COLOR_KEY = 'n3fjp_preview_line_color';

// Sanitize CSS color values from localStorage to prevent innerHTML injection
const sanitizeColor = (c, fallback = '#3388ff') => (/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c) ? c : fallback);

export function useLayer({ enabled = false, opacity = 0.9, map = null }) {
  const [layersRef, setLayersRef] = useState([]);
  const [qsos, setQsos] = useState([]);
  const [retentionMinutes, setRetentionMinutes] = useState(15);
  const controlRef = useRef(null);

  const lastOpenDxCallRef = useRef(null);
  const suppressReopenRef = useRef(false);
  // Tracks the last previewed call pushed to the DX target, so the crosshair is
  // nudged only when the typed call actually changes — not on every 2 s poll.
  const lastPreviewCallRef = useRef(null);

  const [displayMinutes, setDisplayMinutes] = useState(() => {
    const v = parseInt(localStorage.getItem(STORAGE_MINUTES_KEY) || '15', 10);
    return Number.isFinite(v) ? v : 15;
  });

  const [lineColor, setLineColor] = useState(() => {
    return sanitizeColor(localStorage.getItem(STORAGE_COLOR_KEY) || '#3388ff');
  });

  const [previewLineColor, setPreviewLineColor] = useState(() => {
    return sanitizeColor(localStorage.getItem(STORAGE_PREVIEW_COLOR_KEY) || '#ffaa00', '#ffaa00');
  });

  // Poll the server for QSOs
  useEffect(() => {
    if (!enabled) return;

    let alive = true;

    const fetchQsos = async () => {
      try {
        const resp = await fetch('/api/n3fjp/qsos');
        if (!resp.ok) return;
        const data = await resp.json();

        if (!alive) return;
        setRetentionMinutes(Number(data?.retention_minutes || 15));
        setQsos(Array.isArray(data?.qsos) ? data.qsos : []);
      } catch {
        // silent
      }
    };

    fetchQsos();
    const interval = setInterval(fetchQsos, POLL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled]);

  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    if (controlRef.current) {
      try {
        map.removeControl(controlRef.current);
      } catch {}
      controlRef.current = null;
    }

    if (!enabled) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'n3fjp-control', panelWrapper);

        div.innerHTML = `
        <div class="floating-panel-header">🗺️ N3FJP Logged QSOs</div>

          <div id="n3fjp-stats" style="display: grid; gap: 4px;">
            <div>QSOs: <span style="color: var(--accent-cyan);">${qsos.length}</span></div>
            <div>Display: <span style="color: var(--accent-amber);">${displayMinutes} min</span></div>
            <div>Retention: <span style="color: var(--accent-green);">${retentionMinutes} min</span></div>
            <div>Line: <span style="color: ${lineColor};">${lineColor}</span></div>
          </div>
        `;

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return panelWrapper;
      },
    });

    controlRef.current = new Control();
    map.addControl(controlRef.current);

    setTimeout(() => {
      const container = document.querySelector('.n3fjp-control');
      if (container) {
        const saved = localStorage.getItem('n3fjp-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch {}
        }

        makeDraggable(container, 'n3fjp-position', { snap: 5 });
        addMinimizeToggle(container, 'n3fjp-position', {
          contentClassName: 'n3fjp-panel-content',
          buttonClassName: 'n3fjp-minimize-btn',
        });
      }
    }, 150);

    return () => {
      if (controlRef.current) {
        try {
          map.removeControl(controlRef.current);
        } catch {}
        controlRef.current = null;
      }
    };
  }, [enabled, map]);

  useEffect(() => {
    const statsEl = document.getElementById('n3fjp-stats');
    if (!statsEl || !enabled) return;

    statsEl.innerHTML = `
      <div>QSOs: <span style="color: var(--accent-cyan);">${qsos.length}</span></div>
      <div>Display: <span style="color: var(--accent-amber);">${displayMinutes} min</span></div>
      <div>Retention: <span style="color: var(--accent-green);">${retentionMinutes} min</span></div>
      <div>Line: <span style="color: ${lineColor};">${lineColor}</span></div>
    `;
  }, [enabled, qsos.length, displayMinutes, retentionMinutes, lineColor]);

  /// React to Integrations panel changes (display window + color)
  useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      try {
        const m = parseInt(localStorage.getItem(STORAGE_MINUTES_KEY) || '15', 10);
        if (Number.isFinite(m)) setDisplayMinutes(m);
      } catch {}
      try {
        const c = sanitizeColor(localStorage.getItem(STORAGE_COLOR_KEY) || '#3388ff');
        setLineColor(c);
      } catch {}
      try {
        const pc = sanitizeColor(localStorage.getItem(STORAGE_PREVIEW_COLOR_KEY) || '#ffaa00', '#ffaa00');
        setPreviewLineColor(pc);
      } catch {}
    };

    sync();
    window.addEventListener('ohc-n3fjp-config-changed', sync);
    return () => window.removeEventListener('ohc-n3fjp-config-changed', sync);
  }, [enabled]);

  // Draw markers/lines whenever qsos changes
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // --- Preserve open popup across redraws ---
    // Use our own ref as the source of truth (map._popup can be fickle during redraws)
    const openDxCall = !suppressReopenRef.current && lastOpenDxCallRef.current ? lastOpenDxCallRef.current : null;

    // Remove old layers
    layersRef.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    setLayersRef([]);

    if (!enabled || !qsos.length) return;

    // ---- CLIENT-SIDE FILTER: recent logged QSOs + any live preview ----
    // Previews are transient "as you type" entries — always shown, never aged out.
    const cutoff = Date.now() - displayMinutes * 60 * 1000;
    const recent = qsos.filter((q) => {
      if (q.status === 'preview') return true;
      const t = Date.parse(q.ts_utc || q.ts || '');
      return !Number.isNaN(t) && t >= cutoff;
    });

    // ---- DX target coupling ----
    // While the operator is typing a call in N3FJP, nudge the app's DX target to
    // the previewed station so propagation + beam heading follow along. Emitted
    // on a dedicated channel; App.jsx listens and honours the DX Lock toggle.
    const preview = recent.find((q) => q.status === 'preview');
    if (preview && typeof preview.lat === 'number' && typeof preview.lon === 'number') {
      const previewCall = (preview.dx_call || '').trim().toUpperCase();
      if (previewCall && previewCall !== lastPreviewCallRef.current) {
        lastPreviewCallRef.current = previewCall;
        try {
          window.dispatchEvent(
            new CustomEvent('ohc-n3fjp-dx-target', {
              detail: {
                call: previewCall,
                grid: preview.dx_grid || '',
                lat: preview.lat,
                lon: preview.lon,
              },
            }),
          );
        } catch {}
      }
    } else if (!preview) {
      lastPreviewCallRef.current = null;
    }

    // If nothing recent, we're done
    if (!recent.length) return;

    // Read station position from OpenHamClock config (if present)
    let station = null;

    try {
      const raw = localStorage.getItem('openhamclock_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        const lat = cfg?.location?.lat;
        const lon = cfg?.location?.lon;
        if (typeof lat === 'number' && typeof lon === 'number') {
          station = { lat, lon };
        }
      }
    } catch {}

    // ✅ Fallback to Maidenhead if lat/lon missing
    if (!station) {
      try {
        const raw = localStorage.getItem('openhamclock_config');
        if (raw) {
          const cfg = JSON.parse(raw);
          const grid = cfg?.station?.locator;
          if (grid && grid.length >= 4) {
            const { lat, lon } = maidenheadToLatLon(grid);
            station = { lat, lon };
          }
        }
      } catch {}
    }

    const newLayers = [];

    // Optional: show station marker
    if (station) {
      const stMarker = L.circleMarker([station.lat, station.lon], {
        radius: 5,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);
      stMarker.bindPopup('<b>Station</b>');
      newLayers.push(stMarker);
    }

    // Plot each QSO using qso.lat/qso.lon
    recent.forEach((q) => {
      const lat = q.lat;
      const lon = q.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') return;

      const dxCall = (q.dx_call || '').trim() || '(unknown)';
      const mode = q.mode || '';
      const isPreview = q.status === 'preview';
      const color = isPreview ? previewLineColor : lineColor;
      // Convert integer kHz (e.g. 14230) to MHz string (e.g. 14.230)
      let freqMhz = '';
      if (typeof q.freq_khz === 'number' && Number.isFinite(q.freq_khz) && q.freq_khz > 0) {
        freqMhz = (q.freq_khz / 1000).toFixed(3);
      }
      const ts = q.ts_utc || '';

      const dxMarker = L.circleMarker([lat, lon], {
        radius: isPreview ? 7 : 6,
        color,
        fillColor: color,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);

      // Tag marker so we can re-open its popup after a redraw
      dxMarker.__dxCall = dxCall;
      // User intent: keep THIS call's popup open across redraws
      dxMarker.on('click', () => {
        lastOpenDxCallRef.current = dxCall;
        suppressReopenRef.current = false;
      });

      dxMarker.on('popupclose', () => {
        // If the marker was removed from the map (our redraw does this every POLL_MS),
        // Leaflet will close the popup. That's NOT a user close.
        if (!map || !map.hasLayer(dxMarker)) return;

        // This is a real user close (clicked X or clicked map/another marker)
        if (lastOpenDxCallRef.current === dxCall) {
          suppressReopenRef.current = true;
          lastOpenDxCallRef.current = null;
        }
      });

      dxMarker.bindPopup(
        `<div style="font-family: var(--font-mono);">
          <b>${esc(dxCall)}</b>${isPreview ? ' <span style="opacity:0.7;">(preview)</span>' : ''}<br/>
          ${mode ? `Mode: ${esc(mode)}<br/>` : ''}
          ${freqMhz ? `Freq: ${esc(freqMhz)} MHz<br/>` : ''}
          ${isPreview ? 'Typing in N3FJP…<br/>' : ts ? `Time: ${esc(ts)}<br/>` : ''}
          ${q.dx_country ? `Country: ${esc(q.dx_country)}<br/>` : ''}
          ${q.loc_source ? `Loc: ${esc(q.loc_source)}<br/>` : ''}
          ${q.dx_grid ? `Grid: ${esc(q.dx_grid)}<br/>` : ''}
          <span style="opacity:0.7;">Retention: ${retentionMinutes} min</span>
        </div>`,
      );

      newLayers.push(dxMarker);

      // If this was the popup that was open before redraw, re-open it now
      if (!suppressReopenRef.current && openDxCall && dxCall === openDxCall) {
        setTimeout(() => {
          try {
            dxMarker.openPopup();
          } catch {}
        }, 0);
      }

      // Draw great circle arc from station -> DX if we have station coords.
      // Preview arcs are dashed so a tentative contact reads differently from a
      // logged one at a glance, on top of the colour difference.
      if (station) {
        const arcPoints = getGreatCirclePoints(station.lat, station.lon, lat, lon, 64);
        const segments = replicatePath(arcPoints);
        segments.forEach((seg) => {
          if (seg.length < 2) return;
          const line = L.polyline(seg, {
            opacity,
            color,
            weight: 2,
            dashArray: isPreview ? '6 6' : null,
          }).addTo(map);
          newLayers.push(line);
        });
      }
    });

    setLayersRef(newLayers);

    // Cleanup
    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
    };
  }, [enabled, qsos, map, opacity, retentionMinutes, displayMinutes, lineColor, previewLineColor]);

  return {
    qsoCount: qsos.length,
    retentionMinutes,
  };
}
