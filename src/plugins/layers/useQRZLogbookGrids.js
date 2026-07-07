import { useEffect, useRef, useState } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';
import { maidenheadToBoundingBox } from '../../utils/geo.js';

export const metadata = {
  id: 'qrz_worked_grids',
  name: 'Worked Grids (QRZ Logbook)',
  description: 'Heatmap of grid squares worked in your QRZ logbook. Unconfirmed grids get a dark border.',
  icon: '🔲',
  category: 'overlay',
  localOnly: true, // Uses the server's QRZ Logbook key — one logbook per install
  defaultEnabled: false,
  defaultOpacity: 0.55,
  version: '0.1.0',
};

const POLL_MS = 10 * 60 * 1000; // Server caches for 30 min — no point polling harder

// ─── Tweakables ───────────────────────────────────────────────────────────────
// Colors come from per-theme CSS variables in src/styles/themes.css
// (--grid-heat-cold/mid/hot, --grid-unconfirmed-fill/border, hex only).
// The constants below are fallbacks for themes that don't define them.

// Heat gradient stops: t=0 is the coldest grid (1 QSO), t=1 the hottest.
export const HEAT_GRADIENT = [
  { t: 0.0, color: '#142342' },
  { t: 0.5, color: '#5805bb' },
  { t: 1.0, color: '#9001c2' },
];

// Unconfirmed grids render a flat fill (no heat) with an outline, so missing
// confirmations stand out no matter how many QSOs are in the grid.
// Confirmed grids get the heat gradient and render clean.
export const UNCONFIRMED_FILL = '#3a3a3a';
export const UNCONFIRMED_BORDER = { color: '#0a0a0a', weight: 1.5, opacity: 0.9 };

// Resolve the active theme's grid colors, falling back to the constants above
export function resolvePalette() {
  const styles = getComputedStyle(document.documentElement);
  const v = (name, fallback) => {
    const val = styles.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(val) ? val : fallback;
  };
  return {
    stops: [
      { t: 0.0, color: v('--grid-heat-cold', HEAT_GRADIENT[0].color) },
      { t: 0.5, color: v('--grid-heat-mid', HEAT_GRADIENT[1].color) },
      { t: 1.0, color: v('--grid-heat-hot', HEAT_GRADIENT[2].color) },
    ],
    unconfirmedFill: v('--grid-unconfirmed-fill', UNCONFIRMED_FILL),
    unconfirmedBorder: { ...UNCONFIRMED_BORDER, color: v('--grid-unconfirmed-border', UNCONFIRMED_BORDER.color) },
  };
}

// Log scale keeps the home grid from washing out the rest of the map.
export const heatScale = (count, maxCount) => Math.log(count + 1) / Math.log(maxCount + 1);

// Linear interpolation between gradient stops → '#rrggbb'
export function heatColor(t, stops = HEAT_GRADIENT) {
  const clamped = Math.max(0, Math.min(1, t));
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].t && clamped <= stops[i + 1].t) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper.t - lower.t || 1;
  const f = (clamped - lower.t) / span;
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = hex(lower.color);
  const [r2, g2, b2] = hex(upper.color);
  const mix = (a, b) => Math.round(a + (b - a) * f);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function colorForGrid(gridStats, maxCount, palette = null) {
  if (!gridStats.confirmedCount) return palette?.unconfirmedFill ?? UNCONFIRMED_FILL;
  return heatColor(heatScale(gridStats.qsoCount, maxCount), palette?.stops);
}
// ──────────────────────────────────────────────────────────────────────────────

export function useLayer({ enabled = false, opacity = 0.55, map = null }) {
  const [data, setData] = useState(null); // { grids, gridCount, confirmedGrids, ... }
  const [error, setError] = useState(null); // 'not-configured' | message | null
  const [themeTick, setThemeTick] = useState(0); // Bumped on theme change → redraw with new palette
  const layersRef = useRef([]);
  const controlRef = useRef(null);

  // Redraw when the theme changes (data-theme attribute or custom-theme inline
  // styles on <html>). Debounced — the custom theme editor fires a mutation per
  // picker drag frame, and redrawing hundreds of rectangles each frame would lag.
  useEffect(() => {
    if (!enabled) return;
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setThemeTick((t) => t + 1), 200);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [enabled]);

  // Fetch grid aggregates while enabled
  useEffect(() => {
    if (!enabled) return;

    let alive = true;

    const fetchGrids = async () => {
      try {
        const resp = await fetch('/api/qrz-logbook/grids');
        if (!alive) return;
        if (resp.status === 503) {
          setError('not-configured');
          setData(null);
          return;
        }
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          setError(body.error || `HTTP ${resp.status}`);
          return;
        }
        const body = await resp.json();
        setData(body);
        setError(null);
      } catch {
        // Transient network error — keep whatever we have
      }
    };

    fetchGrids();
    const interval = setInterval(fetchGrids, POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled]);

  // Draw grid rectangles
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    layersRef.current = [];

    if (!enabled || !data?.grids?.length) return;

    // Heat is scaled against confirmed grids only — unconfirmed ones render flat gray
    const confirmedCounts = data.grids.filter((g) => g.confirmedCount > 0).map((g) => g.qsoCount);
    const maxCount = confirmedCounts.length ? Math.max(...confirmedCounts) : 1;
    const palette = resolvePalette();
    const newLayers = [];

    for (const g of data.grids) {
      const bbox = maidenheadToBoundingBox(g.grid);
      if (!bbox) continue;

      const confirmed = g.confirmedCount > 0;
      const fill = colorForGrid(g, maxCount, palette);

      const rect = L.rectangle(bbox, {
        fillColor: fill,
        fillOpacity: opacity,
        stroke: !confirmed,
        color: palette.unconfirmedBorder.color,
        weight: palette.unconfirmedBorder.weight,
        opacity: palette.unconfirmedBorder.opacity,
      }).addTo(map);

      const bandsLine = Object.entries(g.bands || {})
        .sort((a, b) => b[1] - a[1])
        .map(([band, n]) => `${esc(band)}: ${n}`)
        .join(' · ');

      // State/province when known, falling back to country
      const location = g.state ? (g.country ? `${g.state}, ${g.country}` : g.state) : g.country;

      const headerHtml = `<b>${esc(g.grid)}</b>${location ? ` — ${esc(location)}` : ''}<br/>
          QSOs: ${g.qsoCount} (${g.confirmedCount} confirmed)<br/>
          ${bandsLine || ''}`;
      const popupHtml = (listHtml) =>
        `<div style="font-family: var(--font-mono);">${headerHtml}<div style="margin-top: 6px;">${listHtml}</div></div>`;

      rect.bindPopup(popupHtml('<span style="opacity: 0.7;">Loading QSOs…</span>'), { maxWidth: 620 });

      // Fetch this grid's QSO list only when its popup actually opens.
      // setContent (not DOM mutation) — Leaflet re-renders popups from their
      // content string on update, so direct DOM edits get wiped.
      rect.on('popupopen', async (e) => {
        const popup = e.popup;
        const fillList = (html) => popup.setContent(popupHtml(html));
        try {
          const resp = await fetch(`/api/qrz-logbook/grid/${encodeURIComponent(g.grid)}/qsos?limit=100`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const d = await resp.json();
          if (!d.qsos?.length) return fillList('');

          // Ellipsized cell for free-text fields (name/city can be very long)
          const clip = (value, maxWidth) =>
            `<td style="max-width: ${maxWidth}px; overflow: hidden; text-overflow: ellipsis;" title="${esc(value)}">${esc(value)}</td>`;

          const rows = d.qsos
            .map(
              (q) => `<tr>
                <td><b>${esc(q.call)}</b></td>
                <td>${esc(q.date)}</td>
                <td>${q.time ? esc(q.time) + 'z' : ''}</td>
                ${clip(q.city, 110)}
                <td>${esc(q.rstSent)}</td>
                <td>${esc(q.rstRcvd)}</td>
                <td style="text-align: right;">${esc(q.freq)}</td>
                <td>${esc(q.mode)}</td>
                ${clip(q.name, 130)}
                <td>${q.confirmed ? '✅' : '⬜'}</td>
              </tr>`,
            )
            .join('');
          const more =
            d.total > d.qsos.length
              ? `<div style="opacity: 0.6; font-size: 10px; margin-top: 2px;">showing ${d.qsos.length} of ${d.total}</div>`
              : '';
          fillList(`
            <style>
              .qrz-qso-table { border-collapse: collapse; font-size: 10px; white-space: nowrap; }
              .qrz-qso-table th, .qrz-qso-table td { padding: 2px 6px; text-align: left; }
              .qrz-qso-table th {
                position: sticky; top: 0; background: var(--bg-panel);
                color: var(--text-muted); font-weight: 600; text-transform: uppercase;
                font-size: 9px; letter-spacing: 0.5px;
              }
              .qrz-qso-table tbody tr { border-top: 1px solid var(--border-color); }
            </style>
            <div style="max-height: 200px; overflow: auto;">
              <table class="qrz-qso-table">
                <thead><tr>
                  <th>Call</th><th>Date</th><th>Time</th><th>City</th>
                  <th>Sent</th><th>Rcvd</th><th>Freq</th><th>Mode</th><th>Name</th><th>QSL</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>${more}`);
        } catch {
          fillList('<span style="opacity: 0.6;">Could not load QSO list</span>');
        }
      });

      newLayers.push(rect);
    }

    layersRef.current = newLayers;

    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
      layersRef.current = [];
    };
  }, [enabled, data, map, opacity, themeTick]);

  // Legend / status control
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    if (controlRef.current) {
      try {
        map.removeControl(controlRef.current);
      } catch {}
      controlRef.current = null;
    }

    if (!enabled) return;

    const palette = resolvePalette();
    const gradientCss = palette.stops.map((s) => `${s.color} ${Math.round(s.t * 100)}%`).join(', ');

    let body;
    if (error === 'not-configured') {
      body = `<div style="max-width: 190px;">
        Add your QRZ Logbook API key in <b>Settings</b> to enable this layer.
      </div>`;
    } else if (error) {
      body = `<div style="max-width: 190px; color: var(--accent-amber);">${esc(error)}</div>`;
    } else if (!data) {
      body = `<div>Loading logbook…</div>`;
    } else {
      body = `
        <div style="display: grid; gap: 4px;">
          <div>Grids: <span style="color: var(--accent-cyan);">${data.gridCount ?? 0}</span>
            (<span style="color: var(--accent-green);">${data.confirmedGrids ?? 0}</span> confirmed)</div>
          <div>QSOs: <span style="color: var(--accent-amber);">${data.qsosWithGrid ?? 0}</span> with grid</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>1</span>
            <div style="flex: 1; height: 8px; border-radius: 2px; background: linear-gradient(90deg, ${gradientCss});"></div>
            <span>max</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 14px; height: 10px; background: ${palette.unconfirmedFill}; border: ${palette.unconfirmedBorder.weight}px solid ${palette.unconfirmedBorder.color};"></span>
            <span style="opacity: 0.8;">unconfirmed</span>
          </div>
        </div>`;
    }

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'qrz-grids-control', panelWrapper);
        div.innerHTML = `
          <div class="floating-panel-header">🔲 Worked Grids</div>
          <div class="qrz-grids-panel-content">${body}</div>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return panelWrapper;
      },
    });

    controlRef.current = new Control();
    map.addControl(controlRef.current);

    setTimeout(() => {
      const container = document.querySelector('.qrz-grids-control');
      if (container) {
        const saved = localStorage.getItem('qrz-grids-position');
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
        makeDraggable(container, 'qrz-grids-position', { snap: 5 });
        addMinimizeToggle(container, 'qrz-grids-position', {
          contentClassName: 'qrz-grids-panel-content',
          buttonClassName: 'qrz-grids-minimize-btn',
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
  }, [enabled, map, data, error, themeTick]);

  return {
    gridCount: data?.gridCount || 0,
    confirmedGrids: data?.confirmedGrids || 0,
  };
}
