/**
 * usePSKReporter Hook
 * Fetches PSKReporter data via Server-Sent Events (SSE) for real-time updates.
 *
 * The server maintains a single MQTT connection to mqtt.pskreporter.info and
 * relays spots to clients via SSE, batched every 15 seconds.
 *
 * On connect:
 *   1. Opens SSE stream to /api/pskreporter/stream/:callsign
 *   2. Receives recent spots (up to 500) in the initial 'connected' event
 *   3. Receives batched live spots every 10 seconds via default message events
 *
 * Spot format (from server):
 *   sender, senderGrid, receiver, receiverGrid
 *   freq, freqMHz, band, mode, snr, timestamp, age
 *   lat, lon, direction ('tx' | 'rx')
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';

// Deduplicate spots: keep the most recent report per unique callsign + band combination
function deduplicateSpots(spots, maxSpots) {
  const seen = new Map();
  for (const spot of spots) {
    const key = `${spot.sender}|${spot.receiver}|${spot.band}`;
    const existing = seen.get(key);
    if (!existing || spot.timestamp > existing.timestamp) {
      seen.set(key, spot);
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxSpots);
}

export const usePSKReporter = (callsign, options = {}) => {
  const { minutes = 30, enabled = true, maxSpots = 500, filterMode = 'call', gridSquare = '' } = options;

  // In grid mode, the identifier is the grid square; in call mode, the callsign
  const identifier = filterMode === 'grid' && gridSquare ? gridSquare.toUpperCase() : callsign;

  const [txReports, setTxReports] = useState([]);
  const [rxReports, setRxReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [source, setSource] = useState('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);

  const txReportsRef = useRef([]);
  const rxReportsRef = useRef([]);
  const mountedRef = useRef(true);
  const eventSourceRef = useRef(null);

  // Clean old spots
  const cleanOldSpots = useCallback(
    (spots, maxAgeMinutes) => {
      const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
      return spots.filter((s) => s.timestamp > cutoff).slice(0, maxSpots);
    },
    [maxSpots],
  );

  // Process an array of spots (from SSE batch or initial payload)
  const processSpots = useCallback(
    (spots) => {
      if (!mountedRef.current || !spots || spots.length === 0) return;

      // In call mode we filter by callsign; in grid mode the server already filtered
      const upperIdentifier = identifier?.toUpperCase();
      if (!upperIdentifier) return;

      let txChanged = false;
      let rxChanged = false;

      for (const spot of spots) {
        const now = Date.now();
        spot.age = spot.timestamp ? Math.floor((now - spot.timestamp) / 60000) : 0;

        if (spot.direction === 'tx') {
          txReportsRef.current = deduplicateSpots([spot, ...txReportsRef.current], maxSpots);
          txChanged = true;
        } else if (spot.direction === 'rx') {
          rxReportsRef.current = deduplicateSpots([spot, ...rxReportsRef.current], maxSpots);
          rxChanged = true;
        }
      }

      if (txChanged) {
        setTxReports(cleanOldSpots([...txReportsRef.current], minutes));
      }
      if (rxChanged) {
        setRxReports(cleanOldSpots([...rxReportsRef.current], minutes));
      }
      if (txChanged || rxChanged) {
        setLastUpdate(new Date());
      }
    },
    [identifier, minutes, maxSpots, cleanOldSpots],
  );

  // Connect to SSE stream
  useEffect(() => {
    mountedRef.current = true;

    // Disable check: App.jsx sets enabled=false when prerequisites are missing
    // For grid mode: enabled = !!locator, for call mode: enabled = callsign !== 'N0CALL'
    if (!enabled || !identifier) {
      setTxReports([]);
      setRxReports([]);
      setLoading(false);
      setSource('disabled');
      setConnected(false);
      return;
    }

    const upperIdentifier = identifier.toUpperCase();

    // Clear old data on reconnect
    txReportsRef.current = [];
    rxReportsRef.current = [];
    setTxReports([]);
    setRxReports([]);
    setLoading(true);
    setError(null);
    setSource('connecting');

    const modeLabel = filterMode === 'grid' ? `grid ${upperIdentifier}` : upperIdentifier;
    console.info(`[PSKReporter SSE] Connecting for ${modeLabel}...`);

    const typeParam = filterMode === 'grid' ? '?type=grid' : '';
    const url = `/api/pskreporter/stream/${encodeURIComponent(upperIdentifier)}${typeParam}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Initial connection event with recent spots from server buffer
    es.addEventListener('connected', (e) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data);
        console.info(
          `[PSKReporter SSE] Connected! MQTT ${data.mqttConnected ? 'up' : 'pending'}, ${data.recentSpots?.length || 0} recent spots`,
        );
        setConnected(true);
        setLoading(false);
        setSource('sse');
        setError(null);

        // Process any recent spots the server already had buffered
        if (data.recentSpots?.length > 0) {
          processSpots(data.recentSpots);
        }
      } catch (err) {
        console.warn('[PSKReporter SSE] Error parsing connected event:', err.message);
      }
    });

    // Batched spots arrive as default 'message' events every 10 seconds
    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const spots = JSON.parse(e.data);
        if (Array.isArray(spots) && spots.length > 0) {
          processSpots(spots);
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      if (es.readyState === EventSource.CLOSED) {
        console.debug('[PSKReporter SSE] Connection closed');
        setConnected(false);
        setSource('disconnected');
        setError('Stream closed');
      } else if (es.readyState === EventSource.CONNECTING) {
        setSource('reconnecting');
      }
    };

    return () => {
      mountedRef.current = false;
      if (es) {
        console.debug('[PSKReporter SSE] Cleaning up...');
        es.close();
      }
    };
  }, [callsign, identifier, filterMode, gridSquare, enabled, reconnectKey, processSpots]);

  // Periodically clean old spots and update ages
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const now = Date.now();

      setTxReports((prev) =>
        prev
          .map((r) => ({
            ...r,
            age: Math.floor((now - r.timestamp) / 60000),
          }))
          .filter((r) => r.age <= minutes),
      );

      setRxReports((prev) =>
        prev
          .map((r) => ({
            ...r,
            age: Math.floor((now - r.timestamp) / 60000),
          }))
          .filter((r) => r.age <= minutes),
      );
    }, 30000);

    return () => clearInterval(interval);
  }, [enabled, minutes]);

  // Manual refresh
  const refresh = useCallback(() => {
    console.debug('[PSKReporter] Manual refresh requested');

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnected(false);
    setLoading(true);
    setSource('reconnecting');
    setError(null);
    setReconnectKey((k) => k + 1);
  }, []);

  // Reconnect SSE when tab becomes visible if connection was lost (browser throttling)
  useVisibilityRefresh(() => {
    if (!enabled) return;
    const es = eventSourceRef.current;
    if (!es || es.readyState === EventSource.CLOSED) {
      console.debug('[PSKReporter] Tab visible — reconnecting SSE');
      refresh();
    }
  }, 5000);

  return {
    txReports,
    txCount: txReports.length,
    rxReports,
    rxCount: rxReports.length,
    loading,
    error,
    connected,
    source,
    lastUpdate,
    refresh,
    filterMode,
    identifier,
  };
};

export default usePSKReporter;
