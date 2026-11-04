/**
 * History Playback layer — scrub through the last 24 hours of DX spots.
 *
 * "What was 10m doing at 1800Z?" — the server records the cluster flow into
 * a rolling 24h ring (server/routes/history.js). Transport state, fetching,
 * and the control UI live in services/historyPlaybackStore.js, shared with
 * the 3D globe's overlay path so both projections scrub the same timeline;
 * this layer wraps the control in an L.Control and draws the window's spot
 * paths on the flat map, colored by band, fading older spots.
 *
 * Data starts accumulating when the server boots, so a fresh install only
 * has history back to its own start — the control shows the earliest
 * available time.
 */
import { useEffect, useRef, useState } from 'react';
import { getGreatCirclePoints, replicatePath } from '../../utils/geo.js';
import { getBandColorForFreq } from '../../utils/bandColors.js';
import { makeDraggable } from './makeDraggable.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { MAX_DRAWN, acquire, release, subscribe, buildTransportControl } from '../../services/historyPlaybackStore.js';

export const metadata = {
  id: 'history-playback',
  name: 'History Playback',
  description: 'Replay the last 24 hours of DX spots with a time scrubber',
  icon: '⏪',
  category: 'activity',
  defaultEnabled: false,
  defaultOpacity: 0.8,
  version: '1.1.0',
};

const utcHHMM = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}z`;
};

export function useLayer({ enabled = false, opacity = 0.8, map = null }) {
  const [result, setResult] = useState(null);
  const layerRef = useRef(null);
  const controlRef = useRef(null);

  // Store lifecycle + result mirror
  useEffect(() => {
    if (!enabled) return undefined;
    acquire();
    const unsub = subscribe((snap) => setResult(snap.result));
    return () => {
      unsub();
      release();
      setResult(null);
    };
  }, [enabled]);

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = window.L;
    if (!map || !L) return undefined;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !result?.spots?.length) return undefined;

    const group = L.layerGroup();
    const { from, to } = result;
    const span = Math.max(1, to - from);
    const drawn = result.spots.slice(-MAX_DRAWN);

    for (const s of drawn) {
      if (s.dxLat == null || s.dxLon == null) continue;
      const color = getBandColorForFreq(s.freq);
      // Newer spots within the window draw stronger
      const age = Math.max(0, Math.min(1, (s.timestamp - from) / span));
      const alpha = opacity * (0.45 + 0.55 * age);

      if (s.spotterLat != null && s.spotterLon != null) {
        const arc = getGreatCirclePoints(s.spotterLat, s.spotterLon, s.dxLat, s.dxLon, 24);
        for (const copy of replicatePath(arc)) {
          group.addLayer(L.polyline(copy, { color, weight: 1.6, opacity: alpha, interactive: false }));
        }
      }
      const dot = L.circleMarker([s.dxLat, s.dxLon], {
        radius: 4,
        fillColor: color,
        color: '#000',
        weight: 0.5,
        opacity: alpha,
        fillOpacity: alpha,
      });
      dot.bindTooltip(`${s.dxCall} · ${s.freq} · ${utcHHMM(s.timestamp)}`, { direction: 'top' });
      group.addLayer(dot);
    }

    group.addTo(map);
    layerRef.current = group;
    return undefined;
  }, [map, enabled, result, opacity]);

  // ── Transport control (shared DOM, Leaflet-positioned here) ───────────────
  useEffect(() => {
    const L = window.L;
    if (!enabled || !map || !L || controlRef.current) return undefined;

    let disposeControl = null;
    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const wrapper = L.DomUtil.create('div', 'panel-wrapper');
        const { el, dispose } = buildTransportControl(document);
        disposeControl = dispose;
        wrapper.appendChild(el);
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
        return wrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const container = controlRef.current?.getContainer()?.querySelector('.history-playback-control');
        if (!container) return;
        const saved = localStorage.getItem('history-playback-panel-position');
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
        makeDraggable(container, 'history-playback-panel-position', { snap: 5 });
        addMinimizeToggle(container, 'history-playback-panel-position', {
          contentClassName: 'history-panel-content',
          buttonClassName: 'history-minimize-btn',
        });
      }),
    );

    return () => {
      disposeControl?.();
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, enabled]);

  // Cleanup drawn layer when disabled
  useEffect(() => {
    if (enabled) return undefined;
    if (layerRef.current && map) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    return undefined;
  }, [enabled, map]);

  return null;
}

export default { metadata, useLayer };
