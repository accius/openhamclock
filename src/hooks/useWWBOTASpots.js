/**
 * useWWBOTASpots Hook
 * Fetches World Wide BOTA (Bunker On The Air) spots via Server-Sent Events (SSE)
 *
 * Connects to http://api.wwbota.org/spots/ SSE stream for real-time updates
 * Handles spot data with frequency, callsign, bunker reference, and coordinates
 */
import { useState, useEffect, useRef } from 'react';
import { WGS84ToMaidenhead } from '@hamset/maidenhead-locator';
import { getBandFromFreq } from '../utils';

export const useWWBOTASpots = () => {
  // Helper to filter out spots older than 1 hour
  const filterRecentSpots = (spots) => {
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    return spots.filter((s) => {
      if (!s.isoTime) return true;
      const sDate = new Date(s.isoTime);
      return now - sDate.getTime() <= oneHourMs;
    });
  };
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const connectWWBOTA = () => {
      // Check if EventSource is supported
      if (typeof EventSource === 'undefined') {
        console.warn('[WWBOTA] Server-Sent Events not supported');
        setLoading(false);
        return;
      }

      try {
        // Connect to WWBOTA API with age parameter to get recent spots
        const url = new URL('https://api.wwbota.org/spots/');
        url.searchParams.set('age', '1'); // Last 1 hour

        console.log(`[WWBOTA] Attempting to connect to: ${url.toString()}`);

        const es = new EventSource(url.toString());

        // Connection opened successfully
        es.addEventListener('open', () => {
          console.log('[WWBOTA] SSE connection opened successfully');
          if (isMounted) {
            setLoading(false);
            setConnected(true);
            // Filter out any old spots on reconnect
            setData((prevData) => filterRecentSpots(prevData));
          }
        });

        // Receive spots on message events
        es.addEventListener('message', (event) => {
          if (!isMounted) return;

          try {
            // Parse the spot data
            const spot = JSON.parse(event.data);

            // Update data with new spot
            setData((prevData) => {
              // Check if spot already exists (by call)
              const existingIndex = prevData.findIndex((s) => s.call === spot.call);

              // Filter and process the spot
              const call = spot.call || '';
              // Extract all references and format with grouped prefixes
              let refs = '';
              if (spot.references && spot.references.length > 0) {
                const refList = spot.references.map((r) => r.reference).filter(Boolean);
                if (refList.length > 0) {
                  // Split each reference into prefix (before last number) and suffix (the number)
                  const groups = new Map();
                  for (const ref of refList) {
                    // Extract prefix (everything before the last number sequence) and suffix (last number)
                    const match = ref.match(/^B\/(.*?)-(\d+)$/);
                    if (match) {
                      const [, prefix, suffix] = match;
                      if (!groups.has(prefix)) {
                        groups.set(prefix, []);
                      }
                      groups.get(prefix).push(suffix);
                    } else {
                      // No number at end, treat whole thing as prefix
                      if (!groups.has(ref)) {
                        groups.set(ref, []);
                      }
                    }
                  }

                  // Format each group: prefix followed by comma-separated numbers
                  const formatted = Array.from(groups.entries()).map(([prefix, suffixes]) => {
                    if (suffixes.length === 0) {
                      return prefix;
                    }
                    return `B/${prefix}-${suffixes.join(',')}`;
                  });
                  refs = formatted.join(',');
                }
              }
              const freq = spot.freq ? spot.freq.toString() : '';
              const mode = spot.mode || '';
              const spotter = spot.spotter || '';
              const comment = spot.comment || '';
              const time = spot.time || new Date().toISOString();
              const name =
                (spot.references[0].name || '') +
                (spot.references.length > 1 ? ` (+${spot.references.length - 1})` : '');

              // Parse coordinates from bunker references if available
              // WWBOTA API provides lat/lon in the spot object - use first reference's coordinates
              const bunker = spot.references[0];
              const lat = bunker.lat !== undefined ? parseFloat(bunker.lat) : null;
              const lon = bunker.long !== undefined ? parseFloat(bunker.long) : null;

              const newSpot = {
                call,
                ref: refs,
                freq,
                band: getBandFromFreq(freq),
                mode,
                spotter,
                name: name,
                remarks: comment
                  .replace(
                    /\b(B\/(?:[0-9][A-Z][0-9A-Z]*|[A-Z][0-9A-Z]*))(?:- ?| -?)?([0-9]{4}(?:(?:[ \/-]|, ?)[0-9]{4})*)\b/gi,
                    '',
                  )
                  .replace(/^,+/, '')
                  .replace(/,+$/, '')
                  .trim(),
                lat,
                lon,
                time: time ? time.substring(11, 16) + 'z' : '', // Extract HH:MM from ISO string
                isoTime: time, // Store the original ISO time
                type: spot.type || 'Live', // Live, QRT, or Test
                grid: WGS84ToMaidenhead({ lat: lat, lng: lon }),
              };

              // Skip QRT spots
              if (spot.type === 'QRT') {
                // Remove this call and filter out old spots
                return filterRecentSpots(prevData.filter((s) => s.call !== newSpot.call));
              }

              // Add or update spot
              let updatedData;
              if (existingIndex >= 0) {
                updatedData = [...prevData];
                updatedData[existingIndex] = newSpot;
              } else {
                updatedData = [newSpot, ...prevData];
              }

              // Remove any spots older than 1 hour
              const filtered = filterRecentSpots(updatedData);

              // Limit to 100 spots
              return filtered.slice(0, 100);
            });

            // Update lastUpdated when new spot arrives
            setLastUpdated(Date.now());
            console.log('[WWBOTA] Spot processed and data updated');
          } catch (err) {
            console.error('[WWBOTA] Failed to parse spot:', err, 'Raw event data:', event.data);
          }
        });

        // Handle errors
        es.addEventListener('error', (event) => {
          console.error('[WWBOTA] SSE error event:', event);

          if (isMounted) {
            setConnected(false);
          }

          if (es.readyState === EventSource.CLOSED) {
            console.log('[WWBOTA] SSE connection closed, will reconnect in 5 seconds');
            es.close();
            if (isMounted) {
              // Reconnect after 5 seconds
              reconnectTimeoutRef.current = setTimeout(() => {
                if (isMounted) {
                  console.log('[WWBOTA] Attempting to reconnect...');
                  connectWWBOTA();
                }
              }, 5000);
            }
          }
        });

        if (isMounted) {
          eventSourceRef.current = es;
        }
      } catch (err) {
        console.error('[WWBOTA] Connection error:', err);
        setLoading(false);

        // Retry connection after 5 seconds
        if (isMounted) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) {
              console.log('[WWBOTA] Retrying connection after error...');
              connectWWBOTA();
            }
          }, 5000);
        }
      }
    };

    connectWWBOTA();

    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    data,
    loading,
    lastUpdated,
    connected,
  };
};
