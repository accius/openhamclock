/**
 * Launch Sites Map Layer Plugin
 *
 * Launch pads with an upcoming launch (Launch Library 2 via
 * /api/space-launches, 30-minute server cache) as rocket markers. The
 * popup lists every launch scheduled from that pad with a T-0 countdown
 * and a "Set DX" button. Markers pulse amber inside the last two hours
 * before a launch.
 *
 * Flat (Mercator/azimuthal) map only — the 3D globe draws no plugin
 * markers; the Space Launches panel covers it there.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { replicatePoint } from '../../utils/geo.js';
import { apiFetch } from '../../utils/apiFetch.js';

export const metadata = {
  id: 'launch-sites',
  name: 'plugins.layers.launchSites.name',
  description: 'plugins.layers.launchSites.description',
  icon: '🚀',
  category: 'overlay',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

const REFRESH_MS = 30 * 60 * 1000; // matches the server cache — never poll LL2 faster
const REDRAW_MS = 60 * 1000; // countdowns in popups/tooltips

const countdown = (netIso, now) => {
  const ms = Date.parse(netIso) - now;
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? 'T+' : 'T-';
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const p = (n) => String(n).padStart(2, '0');
  return `${sign}${d > 0 ? `${d}d ` : ''}${p(h)}:${p(m)}`;
};

/** Group launches per pad, dropping those without coordinates. */
export function groupByPad(launches) {
  const pads = new Map();
  for (const l of launches) {
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) continue;
    const key = l.padId != null ? `pad-${l.padId}` : `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
    let entry = pads.get(key);
    if (!entry) {
      entry = { key, pad: l.pad, location: l.location, lat: l.lat, lon: l.lon, launches: [] };
      pads.set(key, entry);
    }
    entry.launches.push(l);
  }
  return [...pads.values()].map((p) => ({
    ...p,
    launches: p.launches.sort((a, b) => Date.parse(a.net) - Date.parse(b.net)),
  }));
}

function popupHtml(pad, now) {
  const rows = pad.launches
    .slice(0, 5)
    .map(
      (l) => `
      <tr>
        <td style="padding:1px 6px 1px 0;color:var(--text-primary);font-weight:600;">${esc(l.name)}</td>
        <td style="padding:1px 0;color:var(--accent-amber);white-space:nowrap;">${esc(countdown(l.net, now))}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0 0 4px;color:var(--text-muted);font-size:9px;">${esc(l.provider || '')}${l.status ? ` · ${esc(l.status)}` : ''} · ${esc(l.net.slice(0, 16).replace('T', ' '))}z</td>
      </tr>`,
    )
    .join('');
  return `
    <div style="font-family:var(--font-mono);font-size:11px;min-width:220px;max-width:280px;">
      <div style="font-weight:700;font-size:12px;margin-bottom:2px;">🚀 ${esc(pad.pad || 'Launch pad')}</div>
      <div style="color:var(--text-muted);font-size:10px;margin-bottom:6px;">${esc(pad.location || '')}</div>
      <table style="border-collapse:collapse;font-size:10px;width:100%;">${rows}</table>
      <button type="button" data-setdx="1" aria-label="Set DX to this launch pad" style="margin-top:6px;width:100%;padding:3px 6px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);font-size:10px;cursor:pointer;">Set DX here</button>
    </div>`;
}

export function useLayer({ enabled = false, opacity = 0.9, map = null, onDXChange = null }) {
  const [launches, setLaunches] = useState([]);
  const [tick, setTick] = useState(0);
  const layersRef = useRef([]);
  const onDXChangeRef = useRef(onDXChange);
  onDXChangeRef.current = onDXChange;

  const fetchLaunches = useCallback(async () => {
    try {
      const res = await apiFetch('/api/space-launches');
      if (!res?.ok) return;
      const data = await res.json();
      setLaunches(Array.isArray(data.launches) ? data.launches : []);
    } catch (err) {
      console.debug('[LaunchSites] fetch error:', err?.message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    fetchLaunches();
    const id = setInterval(fetchLaunches, REFRESH_MS);
    const redraw = setInterval(() => setTick((t) => t + 1), REDRAW_MS);
    return () => {
      clearInterval(id);
      clearInterval(redraw);
    };
  }, [enabled, fetchLaunches]);

  // Text view broadcast (#1002): the pad list with next launch.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('mapdata:launch-sites', {
        detail: enabled ? { enabled: true, pads: groupByPad(launches) } : { enabled: false },
      }),
    );
  }, [enabled, launches]);
  useEffect(
    () => () => window.dispatchEvent(new CustomEvent('mapdata:launch-sites', { detail: { enabled: false } })),
    [],
  );

  useEffect(() => {
    if (!map || typeof L === 'undefined') return undefined;

    layersRef.current.forEach((l) => {
      try {
        map.removeLayer(l);
      } catch (_) {}
    });
    layersRef.current = [];

    if (!enabled || launches.length === 0) return undefined;

    const now = Date.now();
    const group = L.layerGroup();
    const pads = groupByPad(launches).filter((p) => p.launches.some((l) => Date.parse(l.net) > now - 6 * 3600e3));

    pads.forEach((pad) => {
      const next = pad.launches.find((l) => Date.parse(l.net) > now) || pad.launches[0];
      const ms = Date.parse(next.net) - now;
      const soon = ms > -1800e3 && ms < 2 * 3600e3;
      const color = soon ? '#fbbf24' : 'var(--accent-cyan, #22d3ee)';
      const icon = L.divIcon({
        className: 'ohc-launch-site-icon',
        html: `<div style="font-size:${soon ? 20 : 16}px;line-height:16px;filter:drop-shadow(0 0 2px #000);opacity:${opacity};" title="${esc(pad.pad || '')}">🚀</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 16],
        popupAnchor: [0, -14],
      });

      replicatePoint(pad.lat, pad.lon).forEach(([lat, lon]) => {
        const marker = L.marker([lat, lon], { icon, opacity, keyboard: true, zIndexOffset: soon ? 500 : 0 });
        marker.bindTooltip(`${esc(pad.pad || 'Pad')} · ${esc(countdown(next.net, now))}`, {
          direction: 'top',
          offset: [0, -12],
          className: 'ohc-launch-site-tooltip',
        });
        marker.bindPopup(popupHtml(pad, now), { maxWidth: 300 });
        marker.on('popupopen', (e) => {
          const el = e.popup?.getElement?.();
          const btn = el?.querySelector?.('[data-setdx]');
          if (btn) {
            btn.onclick = () => {
              onDXChangeRef.current?.({ lat: pad.lat, lon: pad.lon, callsign: null, label: pad.pad });
              marker.closePopup();
            };
          }
        });
        // Ring under the rocket so the pad reads on busy basemaps
        const ring = L.circleMarker([lat, lon], {
          radius: soon ? 9 : 6,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: opacity * 0.25,
          opacity,
          interactive: false,
        });
        group.addLayer(ring);
        group.addLayer(marker);
      });
    });

    group.addTo(map);
    layersRef.current = [group];

    return () => {
      try {
        map.removeLayer(group);
      } catch (_) {}
      layersRef.current = [];
    };
  }, [map, enabled, launches, opacity, tick]);

  return { layer: layersRef.current[0] || null, count: launches.length, refresh: fetchLaunches };
}
