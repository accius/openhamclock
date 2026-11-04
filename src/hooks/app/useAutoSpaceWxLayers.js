/**
 * useAutoSpaceWxLayers — "Auto space-weather layer" (Settings → Map Layers).
 *
 * While enabled, polls /api/swpc/activity every 5 minutes and switches the
 * Aurora and D-RAP map layers on when something is actually happening
 * (aurora peak ≥ 50 %, D-RAP ≥ 25 MHz) and off again when it is over
 * (< 25 % / < 15 MHz) — the hysteresis lives in utils/autoSpaceWx.js.
 *
 * Any layer the user toggles by hand (Settings, shortcut key, command
 * palette) while this is enabled becomes "pinned" for the session and is
 * left alone from then on. Toggles are applied through the same
 * window.hamclockLayerControls bridge the keyboard shortcuts use, so the
 * map, Settings and the globe all follow.
 */
import { useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch.js';
import { decideAutoLayers, activityMetrics, AUTO_SPACE_WX_LAYERS } from '../../utils/autoSpaceWx.js';

const POLL_MS = 5 * 60 * 1000;

export default function useAutoSpaceWxLayers(enabled) {
  const pinnedRef = useRef(new Set());
  const applyingRef = useRef(false);
  const autoOnRef = useRef(new Set()); // layers we switched on, to undo when the setting goes off

  // Learn which layers the user pins by hand (toggles not made by us).
  useEffect(() => {
    if (!enabled) return undefined;
    const onToggle = (e) => {
      const id = e?.detail?.id;
      if (!id || applyingRef.current || !AUTO_SPACE_WX_LAYERS.includes(id)) return;
      pinnedRef.current.add(id);
      autoOnRef.current.delete(id);
    };
    window.addEventListener('openhamclock-layer-toggle', onToggle);
    return () => window.removeEventListener('openhamclock-layer-toggle', onToggle);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      // Setting switched off: release pins and turn off what we turned on.
      pinnedRef.current = new Set();
      const ctl = window.hamclockLayerControls;
      if (ctl && autoOnRef.current.size) {
        applyingRef.current = true;
        try {
          for (const id of autoOnRef.current) ctl.toggleLayer(id, false);
        } finally {
          applyingRef.current = false;
        }
      }
      autoOnRef.current = new Set();
      return undefined;
    }

    let cancelled = false;

    const apply = (payload) => {
      const ctl = window.hamclockLayerControls;
      if (!ctl?.layers || typeof ctl.toggleLayer !== 'function') return;
      const current = {};
      for (const id of AUTO_SPACE_WX_LAYERS) {
        current[id] = !!ctl.layers.find((l) => l.id === id)?.enabled;
      }
      const toggles = decideAutoLayers(activityMetrics(payload), current, pinnedRef.current);
      if (!toggles.length) return;
      applyingRef.current = true;
      try {
        for (const { id, enabled: want } of toggles) {
          ctl.toggleLayer(id, want);
          if (want) autoOnRef.current.add(id);
          else autoOnRef.current.delete(id);
          console.info(`[AutoSpaceWx] ${want ? 'enabled' : 'disabled'} ${id} layer`);
        }
      } finally {
        applyingRef.current = false;
      }
    };

    const poll = async () => {
      try {
        const res = await apiFetch('/api/swpc/activity');
        if (!res?.ok || cancelled) return;
        apply(await res.json());
      } catch (err) {
        console.debug('[AutoSpaceWx] poll failed:', err?.message);
      }
    };

    // The layer bridge is created by WorldMap after mount — give it a moment.
    const first = setTimeout(poll, 4000);
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled]);
}
