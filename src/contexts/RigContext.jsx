import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { getModeFromFreq, mapModeToRig } from "../utils/bandPlan.js";

// Default config
// Default config (fallback)
const DEFAULT_RIG_URL = "http://localhost:5555";

const RigContext = createContext(null);

export const useRig = () => {
  const context = useContext(RigContext);
  if (!context) {
    throw new Error("useRig must be used within a RigProvider");
  }
  return context;
};

export const RigProvider = ({ children, rigConfig }) => {
  const [rigState, setRigState] = useState({
    connected: false,
    freq: 0,
    mode: "",
    ptt: false,
    width: 0,
    lastUpdate: 0,
  });

  const [error, setError] = useState(null);

  // Construct URL from config or default
  const rigUrl =
    rigConfig && rigConfig.host && rigConfig.port
      ? `${rigConfig.host}:${rigConfig.port}`
      : DEFAULT_RIG_URL;

  // Connect to SSE Stream
  useEffect(() => {
    if (rigConfig && !rigConfig.enabled) {
      setRigState((prev) => ({ ...prev, connected: false }));
      return;
    }

    let eventSource = null;
    let retryTimeout = null;

    const connectSSE = () => {
      // Construct URL from config or default
      const rigUrl =
        rigConfig && rigConfig.host && rigConfig.port
          ? `${rigConfig.host}:${rigConfig.port}`
          : DEFAULT_RIG_URL;

      // console.log('[RigContext] Connecting to SSE stream...', `${rigUrl}/stream`);
      eventSource = new EventSource(`${rigUrl}/stream`);

      eventSource.onopen = () => {
        // console.log('[RigContext] SSE Connected');
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "init") {
            setRigState((prev) => ({
              ...prev,
              connected: data.connected,
              freq: data.freq,
              mode: data.mode,
              width: data.width,
              ptt: data.ptt,
              lastUpdate: Date.now(),
            }));
          } else if (data.type === "update") {
            setRigState((prev) => ({
              ...prev,
              [data.prop]: data.value,
              lastUpdate: Date.now(),
            }));
          }
        } catch (e) {
          console.error("[RigContext] Failed to parse SSE message", e);
        }
      };

      eventSource.onerror = (err) => {
        // console.error('[RigContext] SSE Error', err);
        eventSource.close();
        setRigState((prev) => ({ ...prev, connected: false }));
        setError("Connection lost");

        // Retry in 5s
        retryTimeout = setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [rigConfig]);

  // Command: Set Frequency
  const setFreq = useCallback(
    async (freq) => {
      if (!rigConfig?.enabled) return;
      try {
        await fetch(`${rigUrl}/freq`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ freq, tune: rigConfig.tuneEnabled }),
        });
        // No need to poll, SSE will push update
      } catch (err) {
        console.error("Failed to set freq:", err);
      }
    },
    [rigUrl, rigConfig],
  );

  // Command: Set Mode
  const setMode = useCallback(
    async (mode) => {
      if (!rigConfig?.enabled) return;
      try {
        await fetch(`${rigUrl}/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        // SSE will push update
      } catch (err) {
        console.error("Failed to set mode:", err);
      }
    },
    [rigUrl, rigConfig],
  );

  // Command: PTT
  const setPTT = useCallback(
    async (enabled) => {
      if (!rigConfig?.enabled) return;
      // Optimistic update for immediate UI response
      setRigState((prev) => ({ ...prev, ptt: enabled }));

      try {
        await fetch(`${rigUrl}/ptt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ptt: enabled }),
        });
        // SSE will push update
      } catch (err) {
        console.error("Failed to set PTT:", err);
        // Revert optimistic update?
        // setRigState(prev => ({ ...prev, ptt: !enabled }));
      }
    },
    [rigUrl, rigConfig],
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
        const f = spot.freq || spot.freqMHz;
        const m = spot.mode || modeInput;
        if (f) {
          tuneTo(f, m);
        }
        return;
      }

      let hz = 0;
      // Handle number
      if (typeof freqInput === "number") {
        // If small number (< 1000), assume MHz -> Hz
        // If medium number (< 100000), assume kHz -> Hz
        // If large number (> 100000), assume Hz
        if (freqInput < 1000) hz = freqInput * 1000000;
        else if (freqInput < 100000) hz = freqInput * 1000;
        else hz = freqInput;
      }
      // Handle string
      else if (typeof freqInput === "string") {
        // Remove non-numeric chars except dot
        const clean = freqInput.replace(/[^\d.]/g, "");
        const val = parseFloat(clean);
        if (isNaN(val)) return;

        // Heuristic: If string contains "MHz", treat as MHz
        if (freqInput.toLowerCase().includes("mhz")) {
          hz = val * 1000000;
        }
        // If string contains "kHz", treat as kHz
        else if (freqInput.toLowerCase().includes("khz")) {
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

        // Determine mode: Use input if valid, otherwise auto-calculate
        let targetMode = modeInput || getModeFromFreq(hz);

        // Map generic modes (FT8, CW) to rig-specific modes (DATA-USB, CW-LSB)
        targetMode = mapModeToRig(targetMode, hz);

        if (targetMode && targetMode !== rigState.mode) {
          // console.log(`[RigContext] Setting Mode to ${targetMode}`);
          setMode(targetMode);
        }
      }
    },
    [rigState.mode, setFreq, setMode],
  );

  const value = {
    ...rigState,
    enabled: rigConfig?.enabled,
    tuneEnabled: rigConfig?.tuneEnabled,
    error,
    setFreq,
    setMode,
    setPTT,
    tuneTo,
  };

  return <RigContext.Provider value={value}>{children}</RigContext.Provider>;
};
