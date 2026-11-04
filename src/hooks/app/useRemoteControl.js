/**
 * useRemoteControl — browser half of the remote-control API (docs/API.md).
 *
 * When enabled (Settings → Station → Remote control; default on for local
 * installs) the display:
 *   • subscribes to GET /api/control/stream?target=<controlId>&secret=… (SSE)
 *     and applies each `command` event through the app's own setters;
 *   • POSTs its state (+ pairing secret) to /api/control/report every 30 s
 *     and whenever the reported fields change (debounced), so the phone
 *     remote can render the right buttons;
 *   • answers `capture` commands with a PNG frame (utils/captureFrame.js).
 *
 * The pairing secret (utils/remoteControl.js getControlSecret) is what lets
 * the phone remote command this display without the server's API_WRITE_KEY.
 * A 403 from the server means another browser already paired this id —
 * surfaced as remoteStatus 'rejected' (Settings → "New id" fixes it).
 *
 * Features owned elsewhere are reached through window events so this hook
 * never needs those components' internals:
 *   ohc:set-mapview {projection?, basemap?, night?}  → WorldMap
 *   ohc:select-satellite {names}                     → satellites layer
 *   openhamclock:add-panel / openhamclock:remove-panel {panelId} → DockableApp
 *   ohc:stopwatch {action, minutes}                   → StopwatchPanel
 *   ohc:set-time {offsetMs} / ohc:set-alarm {...}     → dispatched for other packages
 *   ohc:set-title → utils/sessionFlags titleOverride  → Header
 */
import { useEffect, useRef, useState } from 'react';
import {
  getControlId,
  getControlSecret,
  displayQuery,
  CONTROL_ID_CHANGED_EVENT,
  buildStateReport,
  stateFingerprint,
  readMapSettings,
  readRigRelaySession,
  panelsFromLayoutJson,
  resolveDxTarget,
  REPORT_INTERVAL_MS,
  REPORT_DEBOUNCE_MS,
} from '../../utils/remoteControl.js';
import { getAllFlags, setFlag } from '../../utils/sessionFlags.js';
import { latLonToMaidenhead } from '../../utils/geo.js';
import { activatePreset, getActiveLayout } from '../../store/layoutStore.js';
import { uploadFrame } from '../../utils/captureFrame.js';

const dispatch = (name, detail) => {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* ignore */
  }
};

const lookupCallsign = async (call) => {
  try {
    const res = await fetch(`/api/callsign/${encodeURIComponent(call)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Number.isFinite(data?.lat) && Number.isFinite(data?.lon)
      ? { lat: data.lat, lon: data.lon, grid: data.grid }
      : null;
  } catch {
    return null;
  }
};

export default function useRemoteControl({
  enabled,
  config,
  onSaveConfig,
  dxLocation,
  dxCallsign,
  setDxLocation,
  setDxCallsign,
  satellites = [],
}) {
  // Latest values for the SSE callback (which lives across renders).
  const ref = useRef({});
  ref.current = { config, onSaveConfig, dxLocation, dxCallsign, setDxLocation, setDxCallsign, satellites };

  // Settings → "New id" rotates id + secret; re-subscribe under the new pair.
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const bump = () => setGeneration((g) => g + 1);
    window.addEventListener(CONTROL_ID_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CONTROL_ID_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setFlag('remoteStatus', 'off');
      return undefined;
    }
    const controlId = getControlId();
    const controlSecret = getControlSecret();
    let es = null;
    let closed = false;
    let rejected = false; // another browser holds this id — stop hammering the server
    let retryTimer = null;
    let retryMs = 2000;

    // ── Command application ───────────────────────────────────────────
    const apply = async (cmd) => {
      const { config: cfg, onSaveConfig: save, setDxLocation: setDx, setDxCallsign: setDxCall } = ref.current;
      const p = cmd.params || {};
      switch (cmd.type) {
        case 'de': {
          const grid = p.grid || latLonToMaidenhead({ lat: p.lat, lon: p.lon }, 6);
          save({
            ...cfg,
            location: { ...(cfg.location || {}), lat: p.lat, lon: p.lon },
            locator: grid,
            ...(p.call ? { callsign: p.call } : {}),
          });
          break;
        }
        case 'dx': {
          const target = await resolveDxTarget(p, lookupCallsign);
          if (!target) break;
          setDx?.({ lat: target.lat, lon: target.lon });
          setDxCall?.(target.callsign || null);
          break;
        }
        case 'layout': {
          const [base, preset] = String(p.layout).split('#');
          if (base === 'dockable' && preset) {
            try {
              activatePreset(preset);
            } catch {
              /* unknown preset — still switch to dockable */
            }
          }
          if (cfg.layout !== base) save({ ...cfg, layout: base });
          else if (preset) dispatch('openhamclock:dock-preset-activated', { presetId: preset });
          break;
        }
        case 'theme':
          save({ ...cfg, theme: p.theme });
          break;
        case 'panels': {
          for (const id of p.remove || []) dispatch('openhamclock:remove-panel', { panelId: id });
          for (const id of p.add || []) dispatch('openhamclock:add-panel', { panelId: id });
          if (p.focus) dispatch('openhamclock:add-panel', { panelId: p.focus });
          break;
        }
        case 'mapview': {
          const view = {};
          if (p.projection) view.projection = p.projection;
          if (p.basemap) view.basemap = p.basemap;
          if (typeof p.night === 'boolean') view.night = p.night;
          if (Object.keys(view).length) dispatch('ohc:set-mapview', view);
          const lc = window.hamclockLayerControls;
          if (lc?.toggleLayer) {
            for (const [id, on] of Object.entries(p.layers || {})) lc.toggleLayer(id, !!on);
            if (typeof p.grid === 'boolean') lc.toggleLayer('maidenhead', p.grid);
          }
          break;
        }
        case 'satellite': {
          const names = p.name ? [p.name] : [];
          if (p.name) window.hamclockLayerControls?.toggleLayer?.('satellites', true);
          dispatch('ohc:select-satellite', { names });
          break;
        }
        case 'time':
          setFlag('timeOffsetMs', p.offsetMs || 0);
          dispatch('ohc:set-time', { offsetMs: p.offsetMs || 0 });
          break;
        case 'title':
          setFlag(
            'titleOverride',
            p.text || p.fg || p.bg ? { text: p.text || null, fg: p.fg || null, bg: p.bg || null } : null,
          );
          dispatch('ohc:set-title', p);
          break;
        case 'alarm':
          dispatch('ohc:set-alarm', p);
          break;
        case 'stopwatch':
          dispatch('ohc:stopwatch', p);
          break;
        case 'touch': {
          const el = document.elementFromPoint(p.x, p.y);
          if (el) {
            const init = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, view: window };
            el.dispatchEvent(new MouseEvent('mousedown', init));
            el.dispatchEvent(new MouseEvent('mouseup', init));
            el.dispatchEvent(new MouseEvent('click', init));
          }
          break;
        }
        case 'capture':
          await uploadFrame(controlId, controlSecret);
          break;
        default:
          break;
      }
    };

    // ── SSE subscription ──────────────────────────────────────────────
    const connect = () => {
      if (closed || rejected) return;
      setFlag('remoteStatus', 'connecting');
      es = new EventSource(`/api/control/stream?${displayQuery(controlId, controlSecret)}`);
      es.addEventListener('connected', () => {
        retryMs = 2000;
        setFlag('remoteStatus', 'connected');
      });
      es.addEventListener('command', (e) => {
        let cmd;
        try {
          cmd = JSON.parse(e.data);
        } catch {
          return;
        }
        apply(cmd).catch((err) => console.warn('[RemoteControl] command failed:', cmd?.type, err));
      });
      es.onerror = () => {
        if (!rejected) setFlag('remoteStatus', 'error');
        try {
          es.close();
        } catch {
          /* ignore */
        }
        es = null;
        if (!closed && !rejected) {
          retryTimer = setTimeout(connect, retryMs);
          retryMs = Math.min(60000, retryMs * 2);
        }
      };
    };
    connect();

    // ── State reporting ───────────────────────────────────────────────
    let lastFingerprint = '';
    let lastSent = 0;
    let debounceTimer = null;

    const collect = () => {
      const { config: cfg, dxLocation: dx, dxCallsign: dxCall, satellites: sats } = ref.current;
      let panels = [];
      if (cfg?.layout === 'dockable') {
        try {
          panels = panelsFromLayoutJson(getActiveLayout());
        } catch {
          /* ignore */
        }
      }
      return buildStateReport({
        config: cfg,
        dxLocation: dx,
        dxCallsign: dxCall,
        layers: window.hamclockLayerControls?.layers || [],
        panels,
        satellites: (sats || []).map((s) => s?.name).filter(Boolean),
        mapSettings: readMapSettings(),
        flags: getAllFlags(),
        rigRelaySession: readRigRelaySession(),
      });
    };

    const send = async (state) => {
      if (rejected) return;
      lastSent = Date.now();
      lastFingerprint = stateFingerprint(state);
      try {
        const res = await fetch('/api/control/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: controlId, secret: controlSecret, state }),
        });
        if (res.status === 403) {
          // This id is paired to a different secret (another browser claimed
          // it, or our secret was reset). Stop; Settings → "New id" recovers.
          rejected = true;
          setFlag('remoteStatus', 'rejected');
          try {
            es?.close();
          } catch {
            /* ignore */
          }
          es = null;
          if (retryTimer) clearTimeout(retryTimer);
        }
      } catch {
        /* server away — the next tick retries */
      }
    };

    const tick = () => {
      if (rejected) return;
      const state = collect();
      const fp = stateFingerprint(state);
      const due = Date.now() - lastSent >= REPORT_INTERVAL_MS;
      if (due) {
        send(state);
      } else if (fp !== lastFingerprint && !debounceTimer) {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          send(collect());
        }, REPORT_DEBOUNCE_MS);
      }
    };
    send(collect());
    const pollTimer = setInterval(tick, 2000);

    return () => {
      closed = true;
      clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      setFlag('remoteStatus', 'off');
    };
  }, [enabled, generation]);
}
