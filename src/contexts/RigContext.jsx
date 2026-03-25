import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getModeFromFreq, mapModeToRig } from '../utils/bandPlan.js';

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

export const RigProvider = ({ children, rigConfig }) => {
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

  // Construct URL from config or default
  const rigUrl = buildRigUrl(rigConfig);

  // Cloud relay mode: if a cloudRelaySession is configured, route state/commands
  // through the OHC server instead of connecting directly to rig-bridge.
  const cloudRelaySession = rigConfig?.cloudRelaySession?.trim() || '';
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

    // ── Cloud Relay Mode: poll server-side relay state ──
    if (isCloudRelay) {
      let pollInterval = null;
      let active = true;

      const pollRelayState = async () => {
        if (!active) return;
        try {
          const res = await fetch(`/api/rig-bridge/relay/state?session=${encodeURIComponent(cloudRelaySession)}`);
          if (res.ok) {
            const data = await res.json();
            setRigState((prev) => ({
              ...prev,
              connected: data.relayActive && data.connected,
              freq: data.freq || prev.freq,
              mode: data.mode || prev.mode,
              ptt: data.ptt ?? prev.ptt,
              width: data.width || prev.width,
              lastUpdate: Date.now(),
            }));
            if (data.relayActive) {
              setError(null);
            } else {
              setError('not-reachable');
            }
          }
        } catch (e) {
          // Server not reachable
        }
      };

      pollRelayState();
      pollInterval = setInterval(pollRelayState, 1000); // Poll every 1s for responsive updates

      return () => {
        active = false;
        if (pollInterval) clearInterval(pollInterval);
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
    setFreq,
    setMode,
    setPTT,
    tuneTo,
  };

  return <RigContext.Provider value={value}>{children}</RigContext.Provider>;
};
