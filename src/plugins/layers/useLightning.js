import { useState, useEffect, useRef } from 'react';
import { makeDraggable } from "./makeDraggable.js";

// Lightning Detection Plugin - Real-time lightning strike visualization
// Data source: Blitzortung.org WebSocket API
// Update: Real-time via WebSocket

export const metadata = {
  id: 'lightning',
  name: 'plugins.layers.lightning.name',
  description: 'plugins.layers.lightning.description',
  icon: '⚡',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '2.0.0',
};

// LZW decompression - Blitzortung uses LZW compression for WebSocket data
function lzwDecode(compressed) {
  const dict = {};
  const data = compressed.split('');
  let currChar = data[0];
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;
  let phrase;

  for (let i = 1; i < data.length; i++) {
    const currCode = data[i].charCodeAt(0);
    if (currCode < 256) {
      phrase = data[i];
    } else {
      phrase = dict[currCode] ? dict[currCode] : oldPhrase + currChar;
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }

  return out.join('');
}

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2, unit = 'km') {
  const R = unit === 'km' ? 6371.14 : 3963.1; // Earth radius in km or miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Strike age colors (fading over time)
function getStrikeColor(ageMinutes) {
  if (ageMinutes < 1) return '#FFD700'; // Gold (fresh, <1 min)
  if (ageMinutes < 5) return '#FFA500'; // Orange (recent, <5 min)
  if (ageMinutes < 15) return '#FF6B6B'; // Red (aging, <15 min)
  if (ageMinutes < 30) return '#CD5C5C'; // Dark red (old, <30 min)
  return '#8B4513'; // Brown (very old, >30 min)
}

// Make control draggable with CTRL+drag
// Registry so a second call for the same storageKey cancels the previous listeners.

// Add minimize/maximize toggle
function addMinimizeToggle(element, storageKey) {
  if (!element) return;

  const minimizeKey = storageKey + '-minimized';
  const header = element.firstElementChild;
  if (!header) return;

  // Wrap content
  const content = Array.from(element.children).slice(1);
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'lightning-panel-content';
  content.forEach((child) => contentWrapper.appendChild(child));
  element.appendChild(contentWrapper);

  // Add minimize button
  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'lightning-minimize-btn';
  minimizeBtn.innerHTML = '▼';
  minimizeBtn.style.cssText = `
    float: right;
    cursor: pointer;
    user-select: none;
    padding: 0 4px;
    margin: -2px -4px 0 0;
    font-size: 10px;
    opacity: 0.7;
    transition: opacity 0.2s;
  `;
  minimizeBtn.title = 'Minimize/Maximize';

  minimizeBtn.addEventListener('mouseenter', () => {
    minimizeBtn.style.opacity = '1';
  });
  minimizeBtn.addEventListener('mouseleave', () => {
    minimizeBtn.style.opacity = '0.7';
  });

  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.appendChild(minimizeBtn);

  // Load saved state
  const isMinimized = localStorage.getItem(minimizeKey) === 'true';
  if (isMinimized) {
    contentWrapper.style.display = 'none';
    minimizeBtn.innerHTML = '▶';
    element.style.cursor = 'pointer';
  }

  // Toggle function
  const toggle = (e) => {
    if (e && e.ctrlKey) return;

    const isCurrentlyMinimized = contentWrapper.style.display === 'none';

    if (isCurrentlyMinimized) {
      contentWrapper.style.display = 'block';
      minimizeBtn.innerHTML = '▼';
      element.style.cursor = 'default';
      localStorage.setItem(minimizeKey, 'false');
    } else {
      contentWrapper.style.display = 'none';
      minimizeBtn.innerHTML = '▶';
      element.style.cursor = 'pointer';
      localStorage.setItem(minimizeKey, 'true');
    }
  };

  minimizeBtn.addEventListener('click', toggle);
  header.addEventListener('click', (e) => {
    if (e.target === minimizeBtn || e.target.parentElement === minimizeBtn) {
      return;
    }
    toggle(e);
  });
}

export function useLayer({ enabled = false, opacity = 0.9, map = null, lowMemoryMode = false }) {
  const [strikeMarkers, setStrikeMarkers] = useState([]);
  const [lightningData, setLightningData] = useState([]);
  const [statsControl, setStatsControl] = useState(null);
  const proximityControlRef = useRef(null); // Use ref instead of state to avoid re-renders
  const [wsKey, setWsKey] = useState(null);
  const [thunderCircles, setThunderCircles] = useState([]);
  const wsRef = useRef(null); // Single WebSocket connection
  const reconnectTimerRef = useRef(null);
  const strikesBufferRef = useRef([]);
  const previousStrikeIds = useRef(new Set());
  const currentServerIndexRef = useRef(0); // Track which server we're using
  const connectionAttemptsRef = useRef(0); // Track connection attempts

  // Low memory mode limits
  const MAX_STRIKES = lowMemoryMode ? 100 : 500;
  const STRIKE_RETENTION_MS = lowMemoryMode ? 60000 : 300000; // 1 min vs 5 min

  // Fetch WebSocket key from Blitzortung (fallback to 111)
  useEffect(() => {
    if (enabled && !wsKey) {
      console.log('[Lightning] Using WebSocket key 111 (Blitzortung standard)');
      setWsKey(111); // Standard Blitzortung key
    }
  }, [enabled, wsKey]);

  // Connect to Blitzortung WebSocket with fallback servers
  useEffect(() => {
    if (!enabled || !wsKey) return;

    // Available Blitzortung WebSocket servers (tested and verified online)
    // ws3, ws4, ws5, ws6, ws9, ws10 have certificate issues as of 2026-02
    const servers = [
      'wss://ws8.blitzortung.org', // Primary (most reliable)
      'wss://ws7.blitzortung.org', // Backup 1
      'wss://ws2.blitzortung.org', // Backup 2
      'wss://ws1.blitzortung.org', // Backup 3
    ];

    const connectWebSocket = () => {
      try {
        const serverUrl = servers[currentServerIndexRef.current];
        console.log(`[Lightning] Connecting to ${serverUrl} (attempt ${connectionAttemptsRef.current + 1})...`);

        const ws = new WebSocket(serverUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log(`[Lightning] Connected to ${serverUrl}, sending key:`, wsKey);
          ws.send(JSON.stringify({ a: wsKey }));
          connectionAttemptsRef.current = 0; // Reset attempts on success
        };

        ws.onmessage = (event) => {
          try {
            // Decompress LZW-compressed data
            const decompressed = lzwDecode(event.data);
            const data = JSON.parse(decompressed);

            // Parse lightning strike data
            // Format: { time: timestamp, lat: latitude, lon: longitude, alt: altitude, pol: polarity, mds: signal }
            if (data.time && data.lat && data.lon) {
              const strike = {
                id: `strike_${data.time}_${data.lat}_${data.lon}`,
                lat: parseFloat(data.lat),
                lon: parseFloat(data.lon),
                timestamp: parseInt(data.time),
                age: (Date.now() - parseInt(data.time)) / 1000,
                intensity: Math.abs(data.pol || 0),
                polarity: (data.pol || 0) >= 0 ? 'positive' : 'negative',
                altitude: data.alt || 0,
                signal: data.mds || 0,
              };

              // Add to buffer
              strikesBufferRef.current.push(strike);

              // Keep only strikes within retention window
              const cutoffTime = Date.now() - STRIKE_RETENTION_MS;
              strikesBufferRef.current = strikesBufferRef.current
                .filter((s) => s.timestamp > cutoffTime)
                .slice(-MAX_STRIKES); // Keep only most recent MAX_STRIKES

              // Update state every second to batch updates
              if (!reconnectTimerRef.current) {
                reconnectTimerRef.current = setTimeout(() => {
                  setLightningData([...strikesBufferRef.current]);
                  reconnectTimerRef.current = null;
                }, 1000);
              }
            }
          } catch (err) {
            console.error('[Lightning] Error parsing WebSocket message:', err);
          }
        };

        ws.onerror = (error) => {
          console.error(`[Lightning] WebSocket error on ${servers[currentServerIndexRef.current]}:`, error);
          connectionAttemptsRef.current++;

          // Try next server if this one fails
          if (connectionAttemptsRef.current >= 3) {
            console.log(`[Lightning] Failed to connect after 3 attempts, trying next server...`);
            currentServerIndexRef.current = (currentServerIndexRef.current + 1) % servers.length;
            connectionAttemptsRef.current = 0;
          }
        };

        ws.onclose = () => {
          const serverUrl = servers[currentServerIndexRef.current];
          console.log(`[Lightning] WebSocket closed for ${serverUrl}`);
          wsRef.current = null;

          // Increment connection attempts
          connectionAttemptsRef.current++;

          // Try next server if too many failed attempts on current server
          if (connectionAttemptsRef.current >= 3) {
            console.log(`[Lightning] Too many failures on ${serverUrl}, rotating to next server...`);
            currentServerIndexRef.current = (currentServerIndexRef.current + 1) % servers.length;
            connectionAttemptsRef.current = 0;
          }

          // Reconnect after 5 seconds if still enabled
          if (enabled) {
            console.log(`[Lightning] Reconnecting to ${servers[currentServerIndexRef.current]} in 5s...`);
            setTimeout(connectWebSocket, 5000);
          }
        };
      } catch (err) {
        console.error(`[Lightning] Error connecting to ${servers[currentServerIndexRef.current]}:`, err);
        connectionAttemptsRef.current++;

        // Try next server on connection error
        if (connectionAttemptsRef.current >= 3) {
          console.log(`[Lightning] Too many connection errors, trying next server...`);
          currentServerIndexRef.current = (currentServerIndexRef.current + 1) % servers.length;
          connectionAttemptsRef.current = 0;
        }

        // Retry after 10 seconds
        if (enabled) {
          setTimeout(connectWebSocket, 10000);
        }
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        console.log('[Lightning] Closing WebSocket connection');
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [enabled, wsKey]);

  // Render strike markers with animation
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    strikeMarkers.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch (e) {
        // Already removed
      }
    });
    setStrikeMarkers([]);

    if (!enabled || lightningData.length === 0) return;

    const newMarkers = [];
    const currentStrikeIds = new Set();

    lightningData.forEach((strike) => {
      const { id, lat, lon, timestamp, age, intensity, polarity } = strike;

      currentStrikeIds.add(id);
      const ageMinutes = age / 60;

      // Only animate NEW strikes (not seen before)
      const isNewStrike = !previousStrikeIds.current.has(id);

      // Calculate marker size based on intensity
      const baseRadius = 4;
      const intensityFactor = Math.min(intensity / 100, 2);
      const radius = baseRadius + intensityFactor * 3;

      // Strike marker with pulsing animation for new strikes
      // Use divIcon with lightning bolt instead of circleMarker
      const icon = L.divIcon({
        html: `
          <div class="lightning-marker ${isNewStrike ? 'lightning-strike-new' : ''}" style="
            position: relative;
            width: 24px;
            height: 24px;
          ">
            <div class="lightning-bolt" style="
              font-size: ${isNewStrike ? '24px' : '18px'};
              line-height: 1;
              text-align: center;
              filter: drop-shadow(0 0 ${isNewStrike ? '6px' : '3px'} ${getStrikeColor(ageMinutes)});
              transform: ${isNewStrike ? 'scale(1.2)' : 'scale(1)'};
              transition: all 0.3s ease;
            ">⚡</div>
            ${
              isNewStrike
                ? `
              <div class="lightning-shockwave" style="
                position: absolute;
                top: 50%;
                left: 50%;
                width: 10px;
                height: 10px;
                margin: -5px 0 0 -5px;
                border: 2px solid ${polarity === 'positive' ? '#FFD700' : '#87CEEB'};
                border-radius: 50%;
                opacity: 0;
                animation: shockwave-expand 2s ease-out;
              "></div>
            `
                : ''
            }
          </div>
        `,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lon], {
        icon: icon,
        opacity: isNewStrike ? 1 : 0.6 * opacity,
      });

      // Popup with strike details
      const ageStr = ageMinutes < 1 ? `${Math.round(age)}s ago` : `${Math.round(ageMinutes)}m ago`;

      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
          <strong>⚡ Lightning Strike</strong><br>
          <strong>Time:</strong> ${ageStr}<br>
          <strong>Polarity:</strong> ${polarity === 'positive' ? '+' : '-'} ${Math.round(intensity)} kA<br>
          <strong>Location:</strong> ${lat.toFixed(3)}°, ${lon.toFixed(3)}°
        </div>
      `);

      marker.addTo(map);
      newMarkers.push(marker);
    });

    // Update previous strike IDs
    previousStrikeIds.current = currentStrikeIds;
    setStrikeMarkers(newMarkers);
  }, [map, enabled, lightningData, opacity]);

  // Thunder front circles at high zoom (speed of sound visualization)
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old thunder circles
    thunderCircles.forEach((circle) => {
      try {
        map.removeLayer(circle);
      } catch (e) {}
    });
    setThunderCircles([]);

    if (!enabled || !map) return;

    const zoom = map.getZoom();
    if (zoom < 8) return; // Only show at high zoom levels

    const now = Date.now();
    const newCircles = [];

    // Only show thunder fronts for very recent strikes (last 2 minutes)
    const recentStrikes = lightningData.filter((strike) => {
      const ageSeconds = (now - strike.timestamp) / 1000;
      return ageSeconds < 120; // 2 minutes
    });

    recentStrikes.forEach((strike) => {
      const ageSeconds = (now - strike.timestamp) / 1000;

      // Speed of sound: ~343 m/s = ~0.343 km/s
      // Calculate radius in meters based on age
      const radiusMeters = ageSeconds * 343;

      // Fade out over time
      const opacity = Math.max(0, 1 - ageSeconds / 120);

      if (opacity > 0.05) {
        const circle = L.circle([strike.lat, strike.lon], {
          radius: radiusMeters,
          color: '#ffffff',
          fillColor: 'transparent',
          weight: 1,
          opacity: opacity * 0.3,
          interactive: false,
        });

        circle.addTo(map);
        newCircles.push(circle);
      }
    });

    setThunderCircles(newCircles);
  }, [map, enabled, lightningData]);

  // Add CSS for pulse and shockwave animations
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const styleId = 'lightning-pulse-animation';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes lightning-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.5); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shockwave-expand {
          0% {
            width: 10px;
            height: 10px;
            margin: -5px 0 0 -5px;
            opacity: 1;
          }
          100% {
            width: 60px;
            height: 60px;
            margin: -30px 0 0 -30px;
            opacity: 0;
          }
        }
        .lightning-strike-pulse {
          animation: lightning-pulse 1s ease-out;
        }
        .lightning-strike-new .lightning-bolt {
          animation: lightning-pulse 1s ease-out infinite;
        }
        .lightning-marker {
          cursor: pointer;
        }
        .lightning-marker:hover .lightning-bolt {
          transform: scale(1.3);
          filter: brightness(1.3);
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Create stats panel control
  useEffect(() => {
    if (!map || typeof L === 'undefined') {
      console.log('[Lightning] Cannot create stats panel - map or Leaflet not available');
      return;
    }
    if (!enabled) {
      console.log('[Lightning] Stats panel not created - plugin not enabled');
      return;
    }
    if (statsControl) {
      console.log('[Lightning] Stats panel already created');
      return; // Already created
    }

    console.log('[Lightning] Creating stats panel control...');

    const StatsControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        console.log('[Lightning] StatsControl onAdd called');
        const div = L.DomUtil.create('div', 'lightning-stats');
        div.style.cssText = `
          background: var(--bg-panel);
          padding: 10px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-primary);
          min-width: 180px;
        `;
        div.innerHTML = `
          <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">⚡ Lightning Activity</div>
          <div style="opacity: 0.7; font-size: 10px;">Connecting...</div>
        `;

        // Prevent map interaction
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        console.log('[Lightning] Stats panel div created');
        return div;
      },
    });

    const control = new StatsControl();
    map.addControl(control);
    console.log('[Lightning] Stats control added to map');
    setStatsControl(control);

    // Make draggable and add minimize toggle after a short delay
    setTimeout(() => {
      const container = document.querySelector('.lightning-stats');
      if (container) {
        console.log('[Lightning] Found stats panel container, making draggable...');
        // Apply saved position IMMEDIATELY before making draggable
        const saved = localStorage.getItem('lightning-stats-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            console.log('[Lightning] Applied saved position:', { top, left });
          } catch (e) {
            console.error('[Lightning] Error applying saved position:', e);
          }
        }

        makeDraggable(container, 'lightning-stats-position');
        addMinimizeToggle(container, 'lightning-stats-position');
        console.log('[Lightning] Stats panel is now draggable with minimize toggle');
      } else {
        console.error('[Lightning] Could not find .lightning-stats container');
      }
    }, 150);

    return () => {
      if (control && map) {
        try {
          console.log('[Lightning] Removing stats control from map');
          map.removeControl(control);
        } catch (e) {
          console.warn('[Lightning] Error removing stats control:', e);
        }
      }
    };
  }, [map, enabled]); // Remove statsControl from dependencies to avoid re-creation loop

  // Update stats panel content
  useEffect(() => {
    if (!statsControl) return;

    const div = document.querySelector('.lightning-stats');
    if (!div) return;

    if (!enabled || lightningData.length === 0) {
      return; // Don't hide, just don't update
    }

    const now = Date.now();
    const oneMinAgo = now - 60 * 1000;
    const fiveMinAgo = now - 5 * 60 * 1000;

    const fresh = lightningData.filter((s) => s.timestamp > oneMinAgo).length;
    const recent = lightningData.filter((s) => s.timestamp > fiveMinAgo && s.timestamp <= oneMinAgo).length;
    const total = lightningData.length;

    const avgIntensity = lightningData.reduce((sum, s) => sum + s.intensity, 0) / total;
    const positiveStrikes = lightningData.filter((s) => s.polarity === 'positive').length;
    const negativeStrikes = total - positiveStrikes;

    console.log('[Lightning] Stats panel updated:', { fresh, recent, total });

    const contentHTML = `
      <table style="width: 100%; font-size: 11px;">
        <tr><td>Fresh (&lt;1 min):</td><td style="text-align: right; color: var(--accent-amber);">${fresh}</td></tr>
        <tr><td>Recent (&lt;5 min):</td><td style="text-align: right; color: var(--accent-amber-dim);">${recent}</td></tr>
        <tr><td>Total (30 min):</td><td style="text-align: right; color: var(--accent-red);">${total}</td></tr>
        <tr><td colspan="2" style="padding-top: 8px; border-top: 1px solid var(--border-color);"></td></tr>
        <tr><td>Avg Intensity:</td><td style="text-align: right;">${avgIntensity.toFixed(1)} kA</td></tr>
        <tr><td>Positive:</td><td style="text-align: right; color: var(--accent-amber);">+${positiveStrikes}</td></tr>
        <tr><td>Negative:</td><td style="text-align: right; color: var(--accent-cyan);">-${negativeStrikes}</td></tr>
      </table>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); font-size: 9px; color: var(--text-muted); text-align: center;">
        Real-time via Blitzortung.org
      </div>
    `;

    // Check if minimize toggle has been added (content is wrapped)
    const contentWrapper = div.querySelector('.lightning-panel-content');
    if (contentWrapper) {
      // Update only the content wrapper to preserve header and minimize button
      contentWrapper.innerHTML = contentHTML;
    } else {
      // Initial render before minimize toggle is added
      const children = Array.from(div.children);
      // Remove all children except the header (first child)
      children.slice(1).forEach((child) => child.remove());
      // Add new content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = contentHTML;
      Array.from(tempDiv.children).forEach((child) => div.appendChild(child));
    }
  }, [statsControl, enabled, lightningData]);

  // Proximity detection and alerts (30km radius)
  useEffect(() => {
    if (!enabled) return;

    // Get config from localStorage
    let config;
    try {
      const stored = localStorage.getItem('openhamclock_config');
      if (!stored) return;
      config = JSON.parse(stored);
    } catch (e) {
      return;
    }

    const stationLat = config.location?.lat || config.latitude;
    const stationLon = config.location?.lon || config.longitude;

    if (!stationLat || !stationLon || lightningData.length === 0) return;

    const ALERT_RADIUS_KM = 30;
    const now = Date.now();
    const ONE_MINUTE_AGO = now - 60000;

    // Check for new strikes within 30km in the last minute
    const nearbyNewStrikes = lightningData.filter((strike) => {
      if (strike.timestamp < ONE_MINUTE_AGO) return false;

      const distance = calculateDistance(stationLat, stationLon, strike.lat, strike.lon, 'km');
      return distance <= ALERT_RADIUS_KM;
    });

    // Flash the stats panel red if there are nearby strikes
    const panel = document.querySelector('.lightning-stats');
    if (panel) {
      if (nearbyNewStrikes.length > 0) {
        // Flash red for nearby strikes
        panel.style.border = '2px solid #ff0000';
        panel.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
        panel.style.transition = 'all 0.3s ease';

        // Play alert sound if available
        try {
          const audio = new Audio(
            'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRAEKT6Ln77BcGAU+ltryxnMnBSp+y/HajDkHGWi77eWdTQ0MUKfj8LZjHAY4kdfy',
          );
          audio.volume = 0.3;
          audio.play().catch(() => {}); // Ignore errors if audio fails
        } catch (e) {}
      } else {
        // No nearby strikes - restore normal appearance
        panel.style.border = '1px solid var(--border-color)';
        panel.style.boxShadow = 'none';
      }
    }
  }, [enabled, lightningData]);

  // Create proximity panel control (30km radius)
  useEffect(() => {
    console.log(
      '[Lightning] Proximity effect triggered - enabled:',
      enabled,
      'map:',
      !!map,
      'proximityControl:',
      !!proximityControlRef.current,
    );

    if (!map || typeof L === 'undefined') {
      console.log('[Lightning] Proximity: No map or Leaflet');
      return;
    }
    if (!enabled) {
      console.log('[Lightning] Proximity: Not enabled');
      return;
    }
    if (proximityControlRef.current) {
      console.log('[Lightning] Proximity: Already exists, skipping');
      return; // Already created
    }

    console.log('[Lightning] Proximity: Getting station config from localStorage...');

    // Get config from localStorage directly (more reliable than window.hamclockConfig)
    let config;
    try {
      const stored = localStorage.getItem('openhamclock_config');
      if (stored) {
        config = JSON.parse(stored);
        console.log('[Lightning] Proximity: Config loaded from localStorage');
      } else {
        console.log('[Lightning] Proximity: No config in localStorage, setting retry timer');
        const retryTimer = setTimeout(() => {
          console.log('[Lightning] Proximity: Retry timer fired, triggering re-render');
          setLightningData((prev) => [...prev]); // Trigger re-render
        }, 2000);
        return () => clearTimeout(retryTimer);
      }
    } catch (e) {
      console.error('[Lightning] Proximity: Error reading config:', e);
      return;
    }

    const stationLat = config.location?.lat || config.latitude;
    const stationLon = config.location?.lon || config.longitude;

    console.log('[Lightning] Proximity: Station location:', { stationLat, stationLon });

    if (!stationLat || !stationLon) {
      console.log('[Lightning] Proximity: No station location - aborting');
      return;
    }

    console.log('[Lightning] Proximity: ALL CHECKS PASSED - Creating panel now!');

    const ProximityControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        const div = L.DomUtil.create('div', 'lightning-proximity');
        div.style.cssText = `
          background: var(--bg-panel);
          padding: 10px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-primary);
          min-width: 200px;
          max-width: 280px;
        `;
        div.innerHTML = `
          <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">📍 Nearby Strikes (30km)</div>
          <div style="opacity: 0.7; font-size: 10px;">No recent strikes</div>
        `;

        // Prevent map interaction
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        return div;
      },
    });

    const control = new ProximityControl();
    console.log('[Lightning] Proximity: ProximityControl instance created');
    map.addControl(control);
    console.log('[Lightning] Proximity: Control added to map');

    // Make draggable and add minimize toggle - retry until found
    let retries = 0;
    const maxRetries = 20; // Try for up to 2 seconds
    const retryInterval = setInterval(() => {
      retries++;
      console.log(
        `[Lightning] Proximity: Looking for .lightning-proximity container... (attempt ${retries}/${maxRetries})`,
      );
      const container = document.querySelector('.lightning-proximity');
      if (container) {
        clearInterval(retryInterval);
        console.log('[Lightning] Proximity: Container found! Making draggable...');

        // Default to CENTER of screen (not corner!)
        container.style.position = 'fixed';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.style.zIndex = '1001'; // Ensure it's on top

        console.log('[Lightning] Proximity: Panel positioned at center of screen');

        // Try to load saved position (but validate it's on-screen)
        const saved = localStorage.getItem('lightning-proximity-position');
        let positionLoaded = false;
        if (saved) {
          try {
            const data = JSON.parse(saved);

            // Check if saved as percentage (new format) or pixels (old format)
            if (data.topPercent !== undefined && data.leftPercent !== undefined) {
              // Use percentage-based positioning (scales with zoom)
              container.style.top = data.topPercent + '%';
              container.style.left = data.leftPercent + '%';
              container.style.transform = 'none';
              positionLoaded = true;
              console.log('[Lightning] Proximity: Applied saved position (percentage):', {
                topPercent: data.topPercent,
                leftPercent: data.leftPercent,
              });
            } else if (data.top !== undefined && data.left !== undefined) {
              // Legacy pixel format - validate and convert to percentage
              if (
                data.top >= 0 &&
                data.top < window.innerHeight - 100 &&
                data.left >= 0 &&
                data.left < window.innerWidth - 200
              ) {
                const topPercent = (data.top / window.innerHeight) * 100;
                const leftPercent = (data.left / window.innerWidth) * 100;
                container.style.top = topPercent + '%';
                container.style.left = leftPercent + '%';
                container.style.transform = 'none';
                positionLoaded = true;
                console.log('[Lightning] Proximity: Converted pixel to percentage:', { topPercent, leftPercent });
              } else {
                console.log('[Lightning] Proximity: Saved pixel position off-screen, using center');
                localStorage.removeItem('lightning-proximity-position');
              }
            }
          } catch (e) {
            console.error('[Lightning] Proximity: Error applying saved position:', e);
          }
        }

        // Make draggable - pass flag to skip position loading since we already did it
        makeDraggable(container, 'lightning-proximity-position', positionLoaded);
        addMinimizeToggle(container, 'lightning-proximity-position');
        console.log('[Lightning] Proximity: Panel is now draggable and minimizable');

        // IMPORTANT: Set ref AFTER setup is complete
        proximityControlRef.current = control;
        console.log('[Lightning] Proximity: Ref updated with control');
      } else if (retries >= maxRetries) {
        clearInterval(retryInterval);
        console.error('[Lightning] Proximity: Container NOT FOUND after 20 retries!');
        // Still set ref even if container not found to prevent infinite recreation
        proximityControlRef.current = control;
      }
    }, 100);

    return () => {
      clearInterval(retryInterval);
      if (control && map) {
        try {
          map.removeControl(control);
        } catch (e) {}
      }
    };
  }, [map, enabled]); // No state dependency - using ref instead

  // Update proximity panel content
  useEffect(() => {
    if (!proximityControlRef.current) return;

    const div = document.querySelector('.lightning-proximity');
    if (!div) return;

    if (!enabled || lightningData.length === 0) return;

    // Get config from localStorage
    let config;
    try {
      const stored = localStorage.getItem('openhamclock_config');
      if (!stored) return;
      config = JSON.parse(stored);
    } catch (e) {
      return;
    }

    const stationLat = config.location?.lat || config.latitude;
    const stationLon = config.location?.lon || config.longitude;

    if (!stationLat || !stationLon) return;

    const PROXIMITY_RADIUS_KM = 30;
    const now = Date.now();

    // Find all strikes within 30km
    const nearbyStrikes = lightningData
      .map((strike) => {
        const distance = calculateDistance(stationLat, stationLon, strike.lat, strike.lon, 'km');
        return { ...strike, distance };
      })
      .filter((strike) => strike.distance <= PROXIMITY_RADIUS_KM)
      .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)

    let contentHTML = '';

    if (nearbyStrikes.length === 0) {
      contentHTML = `
        <div style="opacity: 0.7; font-size: 10px; text-align: center; padding: 10px 0;">
          ✅ No strikes within 30km<br>
          <span style="font-size: 9px; color: var(--text-muted);">All clear</span>
        </div>
      `;
    } else {
      const closestStrike = nearbyStrikes[0];
      const ageMinutes = Math.floor((now - closestStrike.timestamp) / 60000);
      const ageSeconds = Math.floor((now - closestStrike.timestamp) / 1000);
      const ageStr = ageMinutes > 0 ? `${ageMinutes}m ago` : `${ageSeconds}s ago`;

      contentHTML = `
        <div style="margin-bottom: 8px; padding: 8px; background: rgba(255,0,0,0.1); border-left: 3px solid var(--accent-red); border-radius: 4px;">
          <div style="font-weight: bold; color: var(--accent-red); margin-bottom: 4px;">
            ⚡ ${nearbyStrikes.length} strike${nearbyStrikes.length > 1 ? 's' : ''} detected
          </div>
          <div style="font-size: 10px;">
            <strong>Closest:</strong> ${closestStrike.distance.toFixed(1)} km<br>
            <strong>Time:</strong> ${ageStr}<br>
            <strong>Polarity:</strong> ${closestStrike.polarity === 'positive' ? '+' : '-'} ${Math.round(closestStrike.intensity)} kA
          </div>
        </div>
        <div style="font-size: 9px; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px;">
          <strong>All Nearby Strikes:</strong><br>
          <div style="max-height: 150px; overflow-y: auto; margin-top: 4px;">
            ${nearbyStrikes
              .slice(0, 10)
              .map((strike, idx) => {
                const age = Math.floor((now - strike.timestamp) / 1000);
                const timeStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
                return `
                <div style="padding: 2px 0; border-bottom: 1px dotted var(--border-color);">
                  ${idx + 1}. ${strike.distance.toFixed(1)} km • ${timeStr} • ${strike.polarity === 'positive' ? '+' : '-'}${Math.round(strike.intensity)} kA
                </div>
              `;
              })
              .join('')}
            ${nearbyStrikes.length > 10 ? `<div style="padding: 4px 0; opacity: 0.6;">+${nearbyStrikes.length - 10} more...</div>` : ''}
          </div>
        </div>
      `;
    }

    const contentWrapper = div.querySelector('.lightning-panel-content');
    if (contentWrapper) {
      contentWrapper.innerHTML = contentHTML;
    } else {
      const children = Array.from(div.children);
      children.slice(1).forEach((child) => child.remove());
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = contentHTML;
      Array.from(tempDiv.children).forEach((child) => div.appendChild(child));
    }
  }, [enabled, lightningData]); // No proximityControl dependency - using ref

  return null; // Plugin-only - no data export
}
