/**
 * usePSKReporter Hook
 * Fetches PSKReporter data via HTTP backfill + MQTT WebSocket for real-time updates
 * 
 * On connect: fetches historical spots via /api/pskreporter/http/:callsign
 * Then subscribes to MQTT for real-time updates going forward
 * 
 * MQTT message format (from mqtt.pskreporter.info):
 *   sc = sender call, rc = receiver call
 *   sl = sender locator, rl = receiver locator
 *   sa = sender ADIF country code, ra = receiver ADIF country code
 *   f = frequency, md = mode, rp = report (SNR), t = timestamp
 *   b = band, sq = sequence number
 * 
 * Topic format: pskr/filter/v2/{band}/{mode}/{sendercall}/{receivercall}/{senderlocator}/{receiverlocator}/{sendercountry}/{receivercountry}
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import mqtt from 'mqtt';

// Convert grid square to lat/lon
function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  
  const g = grid.toUpperCase();
  const lon = (g.charCodeAt(0) - 65) * 20 - 180;
  const lat = (g.charCodeAt(1) - 65) * 10 - 90;
  const lonMin = parseInt(g[2]) * 2;
  const latMin = parseInt(g[3]) * 1;
  
  let finalLon = lon + lonMin + 1;
  let finalLat = lat + latMin + 0.5;
  
  if (grid.length >= 6) {
    const lonSec = (g.charCodeAt(4) - 65) * (2/24);
    const latSec = (g.charCodeAt(5) - 65) * (1/24);
    finalLon = lon + lonMin + lonSec + (1/24);
    finalLat = lat + latMin + latSec + (0.5/24);
  }
  
  return { lat: finalLat, lon: finalLon };
}

// Get band name from frequency in Hz
function getBandFromHz(freqHz) {
  const freqMHz = freqHz / 1000000;
  if (freqMHz >= 1.8 && freqMHz <= 2) return '160m';
  if (freqMHz >= 3.5 && freqMHz <= 4) return '80m';
  if (freqMHz >= 5.3 && freqMHz <= 5.4) return '60m';
  if (freqMHz >= 7 && freqMHz <= 7.3) return '40m';
  if (freqMHz >= 10.1 && freqMHz <= 10.15) return '30m';
  if (freqMHz >= 14 && freqMHz <= 14.35) return '20m';
  if (freqMHz >= 18.068 && freqMHz <= 18.168) return '17m';
  if (freqMHz >= 21 && freqMHz <= 21.45) return '15m';
  if (freqMHz >= 24.89 && freqMHz <= 24.99) return '12m';
  if (freqMHz >= 28 && freqMHz <= 29.7) return '10m';
  if (freqMHz >= 50 && freqMHz <= 54) return '6m';
  if (freqMHz >= 144 && freqMHz <= 148) return '2m';
  if (freqMHz >= 420 && freqMHz <= 450) return '70cm';
  return 'Unknown';
}

// Deduplicate spots: keep the most recent report per unique callsign + band combination
function deduplicateSpots(spots, maxSpots) {
  const seen = new Map();
  for (const spot of spots) {
    // Key by the remote station's callsign + band (not freq, since FT8 drifts)
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
  const {
    minutes = 30,           // Time window to keep spots (was 15)
    enabled = true,         // Enable/disable fetching
    maxSpots = 500          // Max spots to keep (was 100)
  } = options;

  const [txReports, setTxReports] = useState([]);
  const [rxReports, setRxReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [source, setSource] = useState('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);
  
  const clientRef = useRef(null);
  const txReportsRef = useRef([]);
  const rxReportsRef = useRef([]);
  const mountedRef = useRef(true);
  const httpLoadedRef = useRef(false);

  // Clean old spots (older than specified minutes)
  const cleanOldSpots = useCallback((spots, maxAgeMinutes) => {
    const cutoff = Date.now() - (maxAgeMinutes * 60 * 1000);
    return spots.filter(s => s.timestamp > cutoff).slice(0, maxSpots);
  }, [maxSpots]);

  // Handle minutes changing: re-clean existing spots immediately
  useEffect(() => {
    setTxReports(prev => cleanOldSpots(prev, minutes));
    setRxReports(prev => cleanOldSpots(prev, minutes));
  }, [minutes, cleanOldSpots]);

  // Fetch historical spots via HTTP API on initial connect
  const fetchHistorical = useCallback(async (upperCallsign) => {
    if (!mountedRef.current) return;
    
    try {
      console.log(`[PSKReporter HTTP] Fetching historical spots for ${upperCallsign}...`);
      
      const [txRes, rxRes] = await Promise.allSettled([
        fetch(`/api/pskreporter/http/${encodeURIComponent(upperCallsign)}?minutes=${minutes}&direction=tx`),
        fetch(`/api/pskreporter/http/${encodeURIComponent(upperCallsign)}?minutes=${minutes}&direction=rx`)
      ]);
      
      let txCount = 0, rxCount = 0;
      
      if (txRes.status === 'fulfilled' && txRes.value.ok) {
        const data = await txRes.value.json();
        if (data.reports?.length > 0 && mountedRef.current) {
          const now = Date.now();
          const reports = data.reports.map(r => ({
            ...r,
            age: r.timestamp ? Math.floor((now - r.timestamp) / 60000) : 0
          }));
          txReportsRef.current = deduplicateSpots([...reports, ...txReportsRef.current], maxSpots);
          setTxReports(cleanOldSpots([...txReportsRef.current], minutes));
          txCount = reports.length;
        }
      }
      
      if (rxRes.status === 'fulfilled' && rxRes.value.ok) {
        const data = await rxRes.value.json();
        if (data.reports?.length > 0 && mountedRef.current) {
          const now = Date.now();
          const reports = data.reports.map(r => ({
            ...r,
            age: r.timestamp ? Math.floor((now - r.timestamp) / 60000) : 0
          }));
          rxReportsRef.current = deduplicateSpots([...reports, ...rxReportsRef.current], maxSpots);
          setRxReports(cleanOldSpots([...rxReportsRef.current], minutes));
          rxCount = reports.length;
        }
      }
      
      if (txCount > 0 || rxCount > 0) {
        console.log(`[PSKReporter HTTP] Loaded ${txCount} TX + ${rxCount} RX historical spots`);
        setLastUpdate(new Date());
      } else {
        console.log('[PSKReporter HTTP] No historical spots found (may be cached/rate-limited)');
      }
      
      httpLoadedRef.current = true;
    } catch (err) {
      console.warn('[PSKReporter HTTP] Historical fetch failed (MQTT still active):', err.message);
    }
  }, [minutes, maxSpots, cleanOldSpots]);

  // Process incoming MQTT message
  const processMessage = useCallback((topic, message) => {
    if (!mountedRef.current) return;
    
    try {
      const data = JSON.parse(message.toString());
      
      const {
        sc: senderCallsign,
        sl: senderLocator,
        rc: receiverCallsign,
        rl: receiverLocator,
        f: frequency,
        md: mode,
        rp: snr,
        t: timestamp,
        b: band
      } = data;

      if (!senderCallsign || !receiverCallsign) return;

      const senderLoc = gridToLatLon(senderLocator);
      const receiverLoc = gridToLatLon(receiverLocator);
      const freq = parseInt(frequency) || 0;
      const now = Date.now();
      
      const report = {
        sender: senderCallsign,
        senderGrid: senderLocator,
        receiver: receiverCallsign,
        receiverGrid: receiverLocator,
        freq,
        freqMHz: freq ? (freq / 1000000).toFixed(3) : '?',
        band: band || getBandFromHz(freq),
        mode: mode || 'Unknown',
        snr: snr !== undefined ? parseInt(snr) : null,
        timestamp: timestamp ? timestamp * 1000 : now,
        age: 0,
        lat: null,
        lon: null
      };

      const upperCallsign = callsign?.toUpperCase();
      if (!upperCallsign) return;
      
      // If I'm the sender, this is a TX report (someone heard me)
      if (senderCallsign.toUpperCase() === upperCallsign) {
        report.lat = receiverLoc?.lat;
        report.lon = receiverLoc?.lon;
        
        txReportsRef.current = deduplicateSpots(
          [report, ...txReportsRef.current], maxSpots
        );
        
        setTxReports(cleanOldSpots([...txReportsRef.current], minutes));
        setLastUpdate(new Date());
      }
      
      // If I'm the receiver, this is an RX report (I heard someone)
      if (receiverCallsign.toUpperCase() === upperCallsign) {
        report.lat = senderLoc?.lat;
        report.lon = senderLoc?.lon;
        
        rxReportsRef.current = deduplicateSpots(
          [report, ...rxReportsRef.current], maxSpots
        );
        
        setRxReports(cleanOldSpots([...rxReportsRef.current], minutes));
        setLastUpdate(new Date());
      }
      
    } catch (err) {
      // Silently ignore parse errors
    }
  }, [callsign, minutes, maxSpots, cleanOldSpots]);

  // Connect to MQTT
  useEffect(() => {
    mountedRef.current = true;
    
    if (!callsign || callsign === 'N0CALL' || !enabled) {
      setTxReports([]);
      setRxReports([]);
      setLoading(false);
      setSource('disabled');
      setConnected(false);
      return;
    }

    const upperCallsign = callsign.toUpperCase();
    
    // Clear old data on reconnect
    txReportsRef.current = [];
    rxReportsRef.current = [];
    httpLoadedRef.current = false;
    setTxReports([]);
    setRxReports([]);
    setLoading(true);
    setError(null);
    setSource('connecting');

    console.log(`[PSKReporter MQTT] Connecting for ${upperCallsign}...`);

    const client = mqtt.connect('wss://mqtt.pskreporter.info:1886/mqtt', {
      clientId: `ohc_${upperCallsign}_${Math.random().toString(16).substr(2, 8)}`,
      clean: true,
      connectTimeout: 30000,
      reconnectPeriod: 5000,  // Retry every 5 seconds
      keepalive: 60
    });

    clientRef.current = client;

    client.on('connect', () => {
      if (!mountedRef.current) return;
      
      console.log('[PSKReporter MQTT] Connected!');
      setConnected(true);
      setLoading(false);
      setSource('mqtt');
      setError(null);

      // TX: Subscribe where we are the sender (being heard by others)
      const txTopic = `pskr/filter/v2/+/+/${upperCallsign}/#`;
      client.subscribe(txTopic, { qos: 0 }, (err) => {
        if (err) {
          console.error('[PSKReporter MQTT] TX subscribe error:', err);
        } else {
          console.log(`[PSKReporter MQTT] Subscribed TX: ${txTopic}`);
        }
      });

      // RX: Subscribe where we are the receiver (hearing others)
      const rxTopic = `pskr/filter/v2/+/+/+/${upperCallsign}/#`;
      client.subscribe(rxTopic, { qos: 0 }, (err) => {
        if (err) {
          console.error('[PSKReporter MQTT] RX subscribe error:', err);
        } else {
          console.log(`[PSKReporter MQTT] Subscribed RX: ${rxTopic}`);
        }
      });

      // Fetch historical spots to backfill what happened before we connected
      if (!httpLoadedRef.current) {
        fetchHistorical(upperCallsign);
      }
    });

    client.on('message', processMessage);

    client.on('error', (err) => {
      if (!mountedRef.current) return;
      console.error('[PSKReporter MQTT] Error:', err.message);
      setError(err.message);
    });

    client.on('close', () => {
      if (!mountedRef.current) return;
      console.log('[PSKReporter MQTT] Disconnected');
      setConnected(false);
      setSource('disconnected');
    });

    client.on('offline', () => {
      if (!mountedRef.current) return;
      console.log('[PSKReporter MQTT] Offline');
      setConnected(false);
      setSource('offline');
    });

    client.on('reconnect', () => {
      if (!mountedRef.current) return;
      console.log('[PSKReporter MQTT] Reconnecting...');
      setSource('reconnecting');
      setError(null);
    });

    return () => {
      mountedRef.current = false;
      if (client) {
        console.log('[PSKReporter MQTT] Cleaning up...');
        client.end(true);
      }
    };
  }, [callsign, enabled, reconnectKey, processMessage, fetchHistorical]);

  // Periodically clean old spots and update ages
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      
      setTxReports(prev => prev.map(r => ({
        ...r,
        age: Math.floor((now - r.timestamp) / 60000)
      })).filter(r => r.age <= minutes));
      
      setRxReports(prev => prev.map(r => ({
        ...r,
        age: Math.floor((now - r.timestamp) / 60000)
      })).filter(r => r.age <= minutes));
      
    }, 30000);
    
    return () => clearInterval(interval);
  }, [enabled, minutes]);

  // Manual refresh - force full reconnect + HTTP refetch
  const refresh = useCallback(() => {
    console.log('[PSKReporter] Manual refresh requested');
    
    if (clientRef.current) {
      clientRef.current.end(true);
      clientRef.current = null;
    }
    
    httpLoadedRef.current = false;
    setConnected(false);
    setLoading(true);
    setSource('reconnecting');
    setError(null);
    setReconnectKey(k => k + 1);
  }, []);

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
    refresh
  };
};

export default usePSKReporter;
