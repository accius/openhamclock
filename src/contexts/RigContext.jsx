import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getModeFromFreq, mapModeToRig } from '../utils/bandPlan.js';
import { isRelayConfigured, setRelayConfigured, setRelaySessionId } from '../utils/relaySession.js';

// Default config
// Default config (fallback)
const DEFAULT_RIG_URL = 'http://localhost:5555';

const RigContext = createContext(null);

const buildRigUrl = (rigConfig) => {
  const host = rigConfig?.host?.trim();
  if (!host) return DEFAULT_RIG_URL;

  const rawPort = String(rigConfig?.port ?? '').trim();
  if (rawPort === '0') return host;

  const parsedPort = parseInt(rawPort, 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5555;
  return `${host}:${port}`;
};

export const useRig = () => {
  const context = useContext(RigContext);
  if (!context) {
    throw new Error('useRig must be used within a RigProvider');
  }
  return context;
};

/**
 * One-time upgrade migration: if the server config still carries a
 * cloudRelaySession from an older version that saved it there, copy it into
 * localStorage and set the configured flag so RigContext enters cloud relay
 * mode without the user having to re-click "Connect Cloud Relay".
 * Called synchronously at the top of RigProvider so it runs before any state
 * is derived from localStorage.
 */
function _migrateCloudRelaySession(rigConfig) {
  const serverSession = rigConfig?.cloudRelaySession?.trim();
  if (!serverSession || !/^[a-z0-9]{8,32}$/.test(serverSession)) return;
  try {
    // Only migrate if localStorage doesn't already have a configured session
    if (!isRelayConfigured() || !localStorage.getItem('ohc-relay-session')) {
      setRelaySessionId(serverSession);
      setRelayConfigured(true);
    }
  } catch {}
}

export const RigProvider = ({ children, rigConfig }) => {
  // Upgrade path: migrate session from server config to localStorage on first render.
  // After migration, isRelayConfigured() + localStorage['ohc-relay-session'] are
  // the authoritative source — the server config value is no longer used.
  _migrateCloudRelaySession(rigConfig);
  const [rigState, setRigState] = useState({
    connected: false,
    freq: 0,
    mode: '',
    ptt: false,
    width: 0,
    lastUpdate: 0,
  });

  const [error, setError] = useState(null);
  const [rigBridgeStatus, setRigBridgeStatus] = useState(null); // health check result

  // Optimistic rollback for cloud relay mode:
  // confirmedRelayState holds the last freq/mode values confirmed by the server
  // via SSE. optimisticTimers holds setTimeout handles that revert a pending
  // optimistic update if no SSE confirmation arrives within OPTIMISTIC_TIMEOUT.
  const confirmedRelayState = useRef({ freq: 0, mode: '' });
  const optimisticTimers = useRef({});
  const OPTIMISTIC_TIMEOUT = 3000;

  // Construct URL from config or default
  const rigUrl = buildRigUrl(rigConfig);

  // Cloud relay mode: read session from localStorage (per-browser, per-user).
  // isRelayConfigured() is true only when the user explicitly clicked
  // "Connect Cloud Relay" — it is NOT set by the auto-generated session that
  // useMeshCom/useWsjtx create for data isolation. This prevents local-only
  // users from accidentally entering cloud relay mode.
  const cloudRelaySession = isRelayConfigured()
    ? (() => {
        try {
          return localStorage.getItem('ohc-relay-session') || '';
        } catch {
          return '';
        }
      })()
    : '';
  const isCloudRelay = !!cloudRelaySession;

  // Build auth headers — only set when a token is configured
  const apiToken = rigConfig?.apiToken?.trim() || '';
  const rigHeaders = {
    'Content-Type': 'application/json',
    ...(apiToken ? { 'X-RigBridge-Token': apiToken } : {}),
  };

  // Server-side health check proxy — avoids CORS, diagnoses connection issues
  const checkRigBridgeHealth = useCallback(async () => {
    try {
      const host = rigConfig?.host?.trim() || 'http://localhost';
      const port = rigConfig?.port || 5555;
      const res = await fetch(`/api/rig-bridge/status?host=${encodeURIComponent(host)}&port=${port}`);
      if (res.ok) {
        const status = await res.json();
        setRigBridgeStatus(status);
        if (status.reachable && status.auth === 'enabled' && !apiToken) {
          setError('needs-token');
        } else if (!status.reachable) {
          setError('not-reachable');
        }
      }
    } catch (e) {
      // Server-side proxy not available (cloud instance, etc.)
    }
  }, [rigConfig, apiToken]);

  // Connect to rig state — SSE for local, polling for cloud relay
  useEffect(() => {
    if (rigConfig && !rigConfig.enabled) {
      setRigState((prev) => ({ ...prev, connected: false }));
      return;
    }

    // ── Cloud Relay Mode: SSE stream from server ──
    if (isCloudRelay) {
      let eventSource = null;
      let retryTimeout = null;
      let retryDelay = 3000;
      const MAX_RETRY_DELAY = 60000;
      let active = true;
      // Fallback poll — only fires if SSE is down for >10s
      let fallbackInterval = null;

      const applyRelayState = (data) => {
        // Track the last confirmed values from the server — used for rollback
        if (data.freq) confirmedRelayState.current.freq = data.freq;
        if (data.mode) confirmedRelayState.current.mode = data.mode;

        // Cancel any pending rollback timers — confirmation arrived in time
        if (data.freq && optimisticTimers.current.freq) {
          clearTimeout(optimisticTimers.current.freq);
          delete optimisticTimers.current.freq;
        }
        if (data.mode && optimisticTimers.current.mode) {
          clearTimeout(optimisticTimers.current.mode);
          delete optimisticTimers.current.mode;
        }

        setRigState((prev) => ({
          ...prev,
          connected: data.relayActive && data.connected,
          freq: data.freq || prev.freq,
          mode: data.mode || prev.mode,
          ptt: data.ptt ?? prev.ptt,
          width: data.width || prev.width,
          lastUpdate: Date.now(),
        }));
        setError(data.relayActive ? null : 'not-reachable');
      };

      const connectSSE = () => {
        if (!active) return;
        eventSource = new EventSource(`/api/rig-bridge/relay/stream?session=${encodeURIComponent(cloudRelaySession)}`);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'state') {
              applyRelayState(data);
            } else if (data.type === 'plugin' || data.type === 'plugin-init') {
              // Forward plugin data (decodes, APRS, MeshCom, …) as a window event
              // so individual hooks can subscribe without coupling to RigContext —
              // same dispatch used by the local/direct SSE path below.
              window.dispatchEvent(new CustomEvent('rig-plugin-data', { detail: data }));
            }
          } catch (e) {
            console.error('[RigContext] Failed to parse relay SSE message', e);
          }
        };

        eventSource.onopen = () => {
          retryDelay = 3000;
          // Cancel fallback poll — SSE is live
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          // Start a fallback poll so updates aren't completely lost while SSE reconnects.
          // The poll stops itself after repeated failures (server unreachable) so it
          // doesn't spam the browser console — SSE retry will recover when the server
          // comes back.
          if (!fallbackInterval && active) {
            let fallbackFailures = 0;
            fallbackInterval = setInterval(async () => {
              if (!active) return;
              try {
                const res = await fetch(`/api/rig-bridge/relay/state?session=${encodeURIComponent(cloudRelaySession)}`);
                if (res.ok) {
                  fallbackFailures = 0;
                  applyRelayState({ relayActive: true, ...(await res.json()) });
                } else {
                  // Non-2xx: server is up but erroring — count as failure
                  fallbackFailures++;
                }
              } catch (e) {
                // Network error — server unreachable
                fallbackFailures++;
              }
              // After 3 failures, stop the fallback poll to avoid console spam.
              // The SSE retry loop will reconnect when the server is back.
              if (fallbackFailures >= 3 && fallbackInterval) {
                clearInterval(fallbackInterval);
                fallbackInterval = null;
              }
            }, 5000);
          }
          if (active) {
            retryTimeout = setTimeout(connectSSE, retryDelay);
            retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
          }
        };
      };

      connectSSE();

      return () => {
        active = false;
        if (eventSource) eventSource.close();
        if (retryTimeout) clearTimeout(retryTimeout);
        if (fallbackInterval) clearInterval(fallbackInterval);
        // Cancel any pending rollback timers
        Object.values(optimisticTimers.current).forEach(clearTimeout);
        optimisticTimers.current = {};
      };
    }

    // ── Local Mode: SSE stream to rig-bridge ──
    let eventSource = null;
    let retryTimeout = null;
    let retryDelay = 5000;
    const MAX_RETRY_DELAY = 300000;
    let failCount = 0;

    const connectSSE = () => {
      const url = buildRigUrl(rigConfig);
      eventSource = new EventSource(`${url}/stream`);

      eventSource.onopen = () => {
        setError(null);
        retryDelay = 5000;
        failCount = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'init') {
            setRigState((prev) => ({
              ...prev,
              connected: data.connected,
              freq: data.freq,
              mode: data.mode,
              width: data.width,
              ptt: data.ptt,
              lastUpdate: Date.now(),
            }));
          } else if (data.type === 'update') {
            setRigState((prev) => ({
              ...prev,
              [data.prop]: data.value,
              lastUpdate: Date.now(),
            }));
          } else if (data.type === 'plugin' || data.type === 'plugin-init') {
            // Forward plugin data (decodes, status, APRS, QSOs) as a window
            // event so individual hooks can subscribe without coupling to RigContext.
            window.dispatchEvent(new CustomEvent('rig-plugin-data', { detail: data }));
          }
        } catch (e) {
          console.error('[RigContext] Failed to parse SSE message', e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setRigState((prev) => ({ ...prev, connected: false }));
        setError('Connection lost');
        failCount++;

        if (failCount === 1) {
          console.warn(`[RigContext] rig-bridge not reachable at ${url} — will retry with backoff`);
          checkRigBridgeHealth();
        }

        retryTimeout = setTimeout(connectSSE, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      };
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [rigConfig, isCloudRelay, cloudRelaySession]);

  // Helper: send a command via cloud relay or directly to rig-bridge
  const sendCommand = useCallback(
    async (type, payload) => {
      if (isCloudRelay) {
        // Route through OHC server relay
        try {
          await fetch(`/api/rig-bridge/relay/command?session=${encodeURIComponent(cloudRelaySession)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, payload }),
          });
        } catch (err) {
          console.error(`[RigContext] Cloud relay command failed:`, err);
        }
        return null; // No status code in relay mode
      }
      return null; // Caller handles direct mode
    },
    [isCloudRelay, cloudRelaySession],
  );

  // Command: Set Frequency
  const setFreq = useCallback(
    async (freq) => {
      if (!rigConfig?.enabled) return;
      if (isCloudRelay) {
        // Optimistic update — reflect the change immediately before the relay round-trip
        setRigState((prev) => ({ ...prev, freq, lastUpdate: Date.now() }));
        // Schedule rollback: if SSE doesn't confirm within OPTIMISTIC_TIMEOUT,
        // revert to the last value the server reported (avoids stuck stale display).
        if (optimisticTimers.current.freq) clearTimeout(optimisticTimers.current.freq);
        optimisticTimers.current.freq = setTimeout(() => {
          delete optimisticTimers.current.freq;
          const fallback = confirmedRelayState.current.freq;
          if (fallback) setRigState((prev) => ({ ...prev, freq: fallback }));
        }, OPTIMISTIC_TIMEOUT);
        sendCommand('setFreq', { freq, tune: rigConfig.tuneEnabled });
        return;
      }
      try {
        const res = await fetch(`${rigUrl}/freq`, {
          method: 'POST',
          headers: rigHeaders,
          body: JSON.stringify({ freq, tune: rigConfig.tuneEnabled }),
        });
        if (res.status === 401) {
          setError('unauthorized');
          return;
        }
        if (res.status === 503) {
          setError('no-plugin');
          return;
        }
        if (error === 'no-plugin') setError(null);
      } catch (err) {
        console.error('Failed to set freq:', err);
      }
    },
    [rigUrl, rigConfig, rigHeaders, isCloudRelay, sendCommand],
  );

  // Command: Set Mode
  const setMode = useCallback(
    async (mode) => {
      if (!rigConfig?.enabled) return;
      if (isCloudRelay) {
        // Optimistic update — reflect the change immediately before the relay round-trip
        setRigState((prev) => ({ ...prev, mode, lastUpdate: Date.now() }));
        // Schedule rollback: if SSE doesn't confirm within OPTIMISTIC_TIMEOUT, revert.
        if (optimisticTimers.current.mode) clearTimeout(optimisticTimers.current.mode);
        optimisticTimers.current.mode = setTimeout(() => {
          delete optimisticTimers.current.mode;
          const fallback = confirmedRelayState.current.mode;
          if (fallback) setRigState((prev) => ({ ...prev, mode: fallback }));
        }, OPTIMISTIC_TIMEOUT);
        sendCommand('setMode', { mode });
        return;
      }
      try {
        const res = await fetch(`${rigUrl}/mode`, {
          method: 'POST',
          headers: rigHeaders,
          body: JSON.stringify({ mode }),
        });
        if (res.status === 401) {
          setError('unauthorized');
          return;
        }
        if (res.status === 503) {
          setError('no-plugin');
          return;
        }
        if (error === 'no-plugin') setError(null);
      } catch (err) {
        console.error('Failed to set mode:', err);
      }
    },
    [rigUrl, rigConfig, rigHeaders, isCloudRelay, sendCommand],
  );

  // Command: PTT
  const setPTT = useCallback(
    async (enabled) => {
      if (!rigConfig?.enabled) return;
      setRigState((prev) => ({ ...prev, ptt: enabled }));

      if (isCloudRelay) {
        sendCommand('setPTT', { ptt: enabled });
        return;
      }
      try {
        const res = await fetch(`${rigUrl}/ptt`, {
          method: 'POST',
          headers: rigHeaders,
          body: JSON.stringify({ ptt: enabled }),
        });
        if (res.status === 401) {
          setError('unauthorized');
          setRigState((prev) => ({ ...prev, ptt: !enabled }));
          return;
        }
        if (res.status === 403) {
          setError('ptt-disabled');
          setRigState((prev) => ({ ...prev, ptt: !enabled }));
          return;
        }
        if (res.status === 503) {
          setError('no-plugin');
          setRigState((prev) => ({ ...prev, ptt: !enabled }));
          return;
        }
        if (error === 'ptt-disabled' || error === 'no-plugin') setError(null);
      } catch (err) {
        console.error('Failed to set PTT:', err);
      }
    },
    [rigUrl, rigConfig, rigHeaders, error, isCloudRelay, sendCommand],
  );

  // Helper: Tune To Frequency (Centralized Logic)
  const tuneTo = useCallback(
    (freqInput, modeInput = null) => {
      // Removed strict connected check to match direct setFreq behavior
      // if (!rigState.connected) {
      //    console.warn('Cannot tune: Rig not connected');
      //    return;
      // }

      if (!freqInput) return;

      // Handle spot object (recursive call)
      if (typeof freqInput === 'object' && freqInput !== null) {
        const spot = freqInput;
        let f;

        // WSJT-X decodes have dialFrequency (VFO frequency)
        // The freq field is just the audio delta offset, not part of the tune frequency
        if (spot.dialFrequency) {
          f = spot.dialFrequency; // Use dial frequency directly
        } else {
          // For other spot types (DX Cluster, POTA, etc.)
          f = spot.freq || spot.freqMHz;
        }

        const m = spot.mode || modeInput;
        if (f) {
          tuneTo(f, m);
        }
        return;
      }

      let hz = 0;
      // Handle number
      if (typeof freqInput === 'number') {
        // If small number (< 1000), assume MHz -> Hz
        // If medium number (< 100000), assume kHz -> Hz
        // If large number (> 100000), assume Hz
        if (freqInput < 1000) hz = freqInput * 1000000;
        else if (freqInput < 100000) hz = freqInput * 1000;
        else hz = freqInput;
      }
      // Handle string
      else if (typeof freqInput === 'string') {
        // Remove non-numeric chars except dot
        const clean = freqInput.replace(/[^\d.]/g, '');
        const val = parseFloat(clean);
        if (isNaN(val)) return;

        // Heuristic: If string contains "MHz", treat as MHz
        if (freqInput.toLowerCase().includes('mhz')) {
          hz = val * 1000000;
        }
        // If string contains "kHz", treat as kHz
        else if (freqInput.toLowerCase().includes('khz')) {
          hz = val * 1000;
        }
        // Otherwise use magnitude heuristic
        else {
          if (val < 1000) hz = val * 1000000;
          else if (val < 100000) hz = val * 1000;
          else hz = val;
        }
      }

      if (hz > 0) {
        // console.log(`[RigContext] Tuning to ${hz} Hz`);
        setFreq(hz);

        // Only switch mode when autoMode is enabled (default: on).
        // When off, only the frequency changes — the radio keeps its current mode.
        if (rigConfig?.autoMode !== false) {
          // Determine mode: use spot mode if provided, otherwise look up from band plan
          let targetMode = modeInput || getModeFromFreq(hz);

          // Map generic modes (DATA, SSB) to rig-specific forms (DATA-USB, USB/LSB).
          // CW passes through unchanged — rig-listener handles the radio-specific command.
          targetMode = mapModeToRig(targetMode, hz);

          if (targetMode && targetMode !== rigState.mode) {
            // console.log(`[RigContext] Setting Mode to ${targetMode}`);
            setMode(targetMode);
          }
        }
      }
    },
    [rigState.mode, rigConfig, setFreq, setMode],
  );

  const value = {
    ...rigState,
    enabled: rigConfig?.enabled,
    tuneEnabled: rigConfig?.tuneEnabled,
    error,
    rigBridgeStatus,
    // Expose routing info so consumers (e.g. MeshComPanel) can choose
    // between direct rig-bridge requests and OHC server proxying.
    rigUrl,
    isCloudRelay,
    setFreq,
    setMode,
    setPTT,
    tuneTo,
  };

  return <RigContext.Provider value={value}>{children}</RigContext.Provider>;
};
