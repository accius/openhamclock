import { useEffect, useRef } from 'react';
import { parseAdif } from '../../utils/adif.js';
import { getLogsyncConfig, getLogsyncState } from '../../utils/logsyncConfig.js';
import { syncWavelogQsos } from '../../utils/logsync.js';

/**
 * Keep Wavelog pull sync event-driven.
 *
 * MQTT is handled by the server. The browser receives only a lightweight
 * SSE notification and then uses the normal incremental Wavelog pull.
 */
export default function useWavelogSync() {
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    const config = getLogsyncConfig();

    if (
      !config?.wavelog?.pullEnabled ||
      !config?.wavelog?.url ||
      !config?.wavelog?.apiKey ||
      !(config?.wavelog?.pullStationIds || []).length
    ) {
      return undefined;
    }

    let stopped = false;

    const runSync = async () => {
      if (stopped) return;

      if (syncingRef.current) {
        pendingRef.current = true;
        return;
      }

      syncingRef.current = true;

      try {
        do {
          pendingRef.current = false;

          try {
            await syncWavelogQsos({ parseAdif });
          } catch (err) {
            console.warn('Wavelog event sync failed:', err);
          }
        } while (!stopped && pendingRef.current);
      } finally {
        syncingRef.current = false;
      }
    };

    const state = getLogsyncState();
    const hasCursor = Object.prototype.hasOwnProperty.call(state, 'wavelogLastFetchedId');

    const eventSource = new EventSource('/api/logsync/wavelog/events');

    // Catch up whenever the SSE connection is established or re-established.
    // Do not initialize a brand-new log automatically: the first historical
    // import remains an explicit user action via Sync now.
    eventSource.addEventListener('connected', () => {
      if (hasCursor) void runSync();
    });

    eventSource.addEventListener('qso', () => {
      void runSync();
    });

    eventSource.onerror = () => {
      // EventSource reconnects automatically. The server's next "connected"
      // event runs an incremental catch-up for anything missed while offline.
    };

    return () => {
      stopped = true;
      pendingRef.current = false;
      eventSource.close();
    };
  }, []);
}
