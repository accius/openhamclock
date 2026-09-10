/**
 * Logged QSOs (API) layer — renders QSOs pushed by external logging apps via
 * the open REST API (POST /api/qso-layer, issue #1015). Sibling of the N3FJP
 * logged-QSOs layer, but logger-agnostic: anything that can send an HTTP POST
 * can put contacts on the map. See docs/API.md for the ingest contract.
 */
import { useEffect, useState } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { getGreatCirclePoints, replicatePath, maidenheadToLatLon } from '../../utils/geo.js';
import { makeCallLabel } from './callLabel.js';

export const metadata = {
  id: 'qso-api',
  name: 'Logged QSOs (API)',
  description:
    "QSOs pushed by any external logger through the open REST API (POST /api/qso-layer). Callsign labels follow the map's Calls toggle.",
  icon: '📖',
  category: 'amateur',
  localOnly: true,
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

const POLL_MS = 5000;
const DEFAULT_COLOR = '#00ccff';

// Sanitize CSS color values before they reach innerHTML (popup markup).
const sanitizeColor = (c, fallback = DEFAULT_COLOR) =>
  typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c) ? c : fallback;

// Read the DE station position from OpenHamClock config (lat/lon, falling
// back to the configured Maidenhead locator).
function readStationPosition() {
  try {
    const raw = localStorage.getItem('openhamclock_config');
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    const lat = cfg?.location?.lat;
    const lon = cfg?.location?.lon;
    if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
    const grid = cfg?.station?.locator;
    if (grid && grid.length >= 4) {
      const loc = maidenheadToLatLon(grid);
      if (loc) return { lat: loc.lat, lon: loc.lon };
    }
  } catch {
    // ignore — no station marker/paths without a position
  }
  return null;
}

export function useLayer({ enabled = false, opacity = 0.9, map = null, showLabels = true }) {
  const [qsos, setQsos] = useState([]);
  const [retentionMinutes, setRetentionMinutes] = useState(1440);

  // Poll the server for QSOs
  useEffect(() => {
    if (!enabled) return;

    let alive = true;

    const fetchQsos = async () => {
      try {
        const resp = await fetch('/api/qso-layer');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!alive) return;
        setRetentionMinutes(Number(data?.retention_minutes || 1440));
        setQsos(Array.isArray(data?.qsos) ? data.qsos : []);
      } catch {
        // silent — layer must never crash the map
      }
    };

    fetchQsos();
    const interval = setInterval(fetchQsos, POLL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled]);

  // Draw markers + great-circle paths whenever qsos change
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;
    if (!enabled || !qsos.length) return;

    const layers = [];
    const station = readStationPosition();

    qsos.forEach((q) => {
      if (typeof q.lat !== 'number' || typeof q.lon !== 'number') return;

      const color = sanitizeColor(q.color);
      const call = (q.call || '').trim() || '(unknown)';
      const freqStr = typeof q.freq === 'number' && Number.isFinite(q.freq) ? `${q.freq.toFixed(3)} MHz` : '';

      const marker = L.circleMarker([q.lat, q.lon], {
        radius: 6,
        color,
        fillColor: color,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-family: var(--font-mono);">
          <b>${esc(call)}</b><br/>
          ${q.band ? `Band: ${esc(q.band)}<br/>` : ''}
          ${q.mode ? `Mode: ${esc(q.mode)}<br/>` : ''}
          ${freqStr ? `Freq: ${esc(freqStr)}<br/>` : ''}
          ${q.grid ? `Grid: ${esc(q.grid)}<br/>` : ''}
          ${q.ts_utc ? `Time: ${esc(q.ts_utc)}<br/>` : ''}
          ${q.label ? `${esc(q.label)}<br/>` : ''}
          <span style="opacity:0.7;">via open API · retention ${retentionMinutes} min</span>
        </div>`,
      );
      layers.push(marker);

      // Callsign pill beside the dot (a dot alone says nothing about who was
      // worked). Honours the map's global Calls toggle like DX spot labels do.
      if (showLabels) {
        layers.push(makeCallLabel(L, [q.lat, q.lon], call, color, { opacity }).addTo(map));
      }

      // Great-circle path from DE to the worked station
      if (station) {
        const arcPoints = getGreatCirclePoints(station.lat, station.lon, q.lat, q.lon, 64);
        replicatePath(arcPoints).forEach((seg) => {
          if (seg.length < 2) return;
          const line = L.polyline(seg, { opacity, color, weight: 2 }).addTo(map);
          layers.push(line);
        });
      }
    });

    // Station marker (only when there is something plotted)
    if (station && layers.length) {
      const stMarker = L.circleMarker([station.lat, station.lon], {
        radius: 5,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);
      stMarker.bindPopup('<b>Station</b>');
      layers.push(stMarker);
    }

    return () => {
      layers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {
          // already removed
        }
      });
    };
  }, [enabled, qsos, map, opacity, retentionMinutes, showLabels]);

  return {
    qsoCount: qsos.length,
    retentionMinutes,
  };
}
