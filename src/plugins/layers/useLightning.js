import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';
import { lzwDecode, subscribeStrikes } from '../../utils/lightningFeed.js';

// Lightning Detection Plugin - Real-time lightning strike visualization
// Data source: Blitzortung.org WebSocket API (shared feed, utils/lightningFeed.js)
// Update: Real-time, batched once a second

export const metadata = {
  id: 'lightning',
  name: 'plugins.layers.lightning.name',
  description: 'plugins.layers.lightning.description',
  icon: '⚡️',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '2.0.1',
};

// LZW decoding and the Blitzortung socket live in utils/lightningFeed.js —
// one reference-counted stream shared with the 3D globe overlay and the
// lightning guard. lzwDecode stays re-exported here for older imports.
export { lzwDecode };

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Calculate the distance in both km and miles, returning both
  const Rkm = 6371.14; // Earth radius in km
  const Rmiles = 3963.1; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return { km: Rkm * c, miles: Rmiles * c };
}

// Strike age colors (fading over time)
function getStrikeColor(ageMinutes) {
  if (ageMinutes < 1) return '#FFD700'; // Gold (fresh, <1 min)
  if (ageMinutes < 5) return '#FFA500'; // Orange (recent, <5 min)
  if (ageMinutes < 15) return '#FF6B6B'; // Red (aging, <15 min)
  if (ageMinutes < 30) return '#CD5C5C'; // Dark red (old, <30 min)
  return '#8B4513'; // Brown (very old, >30 min)
}

export function useLayer({ enabled = false, opacity = 0.9, map = null, lowMemoryMode = false, allUnits }) {
  const { t } = useTranslation();
  const [strikeMarkers, setStrikeMarkers] = useState([]);
  const [lightningData, setLightningData] = useState([]);
  const [statsControl, setStatsControl] = useState(null);
  const proximityControlRef = useRef(null); // Use ref instead of state to avoid re-renders
  const [thunderCircles, setThunderCircles] = useState([]);
  const strikesBufferRef = useRef([]);
  const previousStrikeIds = useRef(new Set());

  // Low memory mode limits
  const MAX_STRIKES = lowMemoryMode ? 100 : 500;
  const STRIKE_RETENTION_MS = 1800000; // 30 min

  const PROXIMITY_RADIUS_KM = 30;
  const PROXIMITY_RADIUS_MILES = PROXIMITY_RADIUS_KM * 0.621371;
  const isMetric = allUnits.dist === 'metric';
  const unitsStr = isMetric ? 'km' : 'miles';

  // Broadcast strikes to the text view panel (#1002). The map re-renders
  // every second; the text panel doesn't need more than one refresh per 5s,
  // so intermediate updates are skipped (the next state change past the
  // window carries the full buffer anyway).
  const lastTextBroadcastRef = useRef(0);
  useEffect(() => {
    if (!enabled) {
      window.dispatchEvent(new CustomEvent('mapdata:lightning', { detail: { enabled: false } }));
      return;
    }
    const now = Date.now();
    if (lightningData.length > 0 && now - lastTextBroadcastRef.current < 5000) return;
    lastTextBroadcastRef.current = now;
    window.dispatchEvent(new CustomEvent('mapdata:lightning', { detail: { enabled: true, strikes: lightningData } }));
  }, [enabled, lightningData]);
  useEffect(() => () => window.dispatchEvent(new CustomEvent('mapdata:lightning', { detail: { enabled: false } })), []);

  // Strikes from the shared Blitzortung feed (batched once a second there).
  // Keep the last 30 minutes, capped for low-memory mode.
  useEffect(() => {
    if (!enabled) return undefined;
    const unsubscribe = subscribeStrikes((batch) => {
      const cutoffTime = Date.now() - STRIKE_RETENTION_MS;
      strikesBufferRef.current = [...strikesBufferRef.current, ...batch]
        .filter((s) => s.timestamp > cutoffTime)
        .slice(-MAX_STRIKES);
      setLightningData([...strikesBufferRef.current]);
    });
    return unsubscribe;
  }, [enabled, MAX_STRIKES]);

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
    const now = Date.now();

    lightningData.forEach((strike) => {
      const { id, lat, lon, timestamp, intensity, polarity } = strike;

      currentStrikeIds.add(id);
      const ageSeconds = (now - timestamp) / 1000;
      const ageMinutes = ageSeconds / 60;

      // Only animate NEW strikes (not seen before)
      const isNewStrike = !previousStrikeIds.current.has(id);

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
      const ageStr = ageMinutes < 1 ? `${Math.round(ageSeconds)}s` : `${Math.round(ageMinutes)}min`;

      marker.bindPopup(`
        <div style="font-family: var(--font-mono); font-size: 12px;">
          <strong>⚡ ${t('plugins.layers.lightning.lightningStrike')}</strong><br>
          <strong>${t('plugins.layers.lightning.age')}:</strong> ${ageStr}<br>
          <strong>${t('plugins.layers.lightning.polarity')}:</strong> ${polarity === 'positive' ? '+' : '-'}${Math.round(intensity)}kA<br>
          <strong>${t('plugins.layers.lightning.location')}:</strong> ${lat.toFixed(3)}°, ${lon.toFixed(3)}°
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
      console.debug('[Lightning] Cannot create stats panel - map or Leaflet not available');
      return;
    }
    if (!enabled) {
      console.debug('[Lightning] Stats panel not created - plugin not enabled');
      return;
    }
    if (statsControl) {
      console.debug('[Lightning] Stats panel already created');
      return; // Already created
    }

    console.info('[Lightning] Creating stats panel control...');

    const StatsControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        console.debug('[Lightning] StatsControl onAdd called');
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'lightning-stats', panelWrapper);

        div.innerHTML = `
          <div class="floating-panel-header">⚡️ ${t('plugins.layers.lightning.name')}</div>
          <div style="opacity: 0.7; font-size: 10px;">Connecting...</div>
        `;

        // Prevent map interaction
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        console.debug('[Lightning] Stats panel div created');
        return panelWrapper;
      },
    });

    const control = new StatsControl();
    map.addControl(control);
    console.debug('[Lightning] Stats control added to map');
    setStatsControl(control);

    // Make draggable and add minimize toggle after a short delay
    setTimeout(() => {
      const container = document.querySelector('.lightning-stats');
      if (container) {
        console.debug('[Lightning] Found stats panel container, making draggable...');
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
            console.debug('[Lightning] Applied saved position:', { top, left });
          } catch (e) {
            console.error('[Lightning] Error applying saved position:', e);
          }
        }

        makeDraggable(container, 'lightning-stats-position', { snap: 5 });
        addMinimizeToggle(container, 'lightning-stats-position', {
          contentClassName: 'lightning-panel-content',
          buttonClassName: 'lightning-minimize-btn',
        });
        console.debug('[Lightning] Stats panel is now draggable with minimize toggle');
      } else {
        console.error('[Lightning] Could not find .lightning-stats container');
      }
    }, 150);

    return () => {
      if (control && map) {
        try {
          console.debug('[Lightning] Removing stats control from map');
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

    console.debug('[Lightning] Stats panel updated:', { fresh, recent, total });

    const contentHTML = `
      <table style="width: 100%; font-size: 11px;">
        <tr><td>${t('plugins.layers.lightning.fresh')}:</td><td style="text-align: right; color: var(--accent-amber);">${fresh}</td></tr>
        <tr><td>${t('plugins.layers.lightning.recent')}:</td><td style="text-align: right; color: var(--accent-amber-dim);">${recent}</td></tr>
        <tr><td>${t('plugins.layers.lightning.total')}:</td><td style="text-align: right; color: var(--accent-red);">${total}</td></tr>
        <tr><td colspan="2" style="padding-top: 8px; border-top: 1px solid var(--border-color);"></td></tr>
        <tr><td>${t('plugins.layers.lightning.avgIntensity')}:</td><td style="text-align: right;">${avgIntensity.toFixed(1)} kA</td></tr>
        <tr><td>${t('plugins.layers.lightning.positive')}:</td><td style="text-align: right; color: var(--accent-amber);">+${positiveStrikes}</td></tr>
        <tr><td>${t('plugins.layers.lightning.negative')}:</td><td style="text-align: right; color: var(--accent-cyan);">-${negativeStrikes}</td></tr>
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

  // Proximity detection and alerts (within radius PROXIMITY_RADIUS_KM)
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

    const stationLat = config.location?.lat ?? config.latitude;
    const stationLon = config.location?.lon ?? config.longitude;

    if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon) || lightningData.length === 0) return;

    const now = Date.now();
    const ONE_MINUTE_AGO = now - 60000;

    // Check for new strikes within radius of PROXIMITY_RADIUS_KM during the last minute
    const nearbyNewStrikes = lightningData.filter((strike) => {
      if (strike.timestamp < ONE_MINUTE_AGO) return false;

      const distance = calculateDistance(stationLat, stationLon, strike.lat, strike.lon);
      return distance.km <= PROXIMITY_RADIUS_KM;
    });

    // Flash the stats panel red if there are nearby strikes
    const panel = document.querySelector('.lightning-stats');
    if (panel) {
      if (nearbyNewStrikes.length > 0) {
        // Flash red for nearby strikes
        panel.style.border = '2px solid #ff0000';
        panel.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
        panel.style.transition = 'all 0.3s ease';

        // Sound, speech, notifications and the screen-reader announcement
        // come from the lightning guard (Settings → Alerts → Lightning guard),
        // which watches the same feed with or without this layer.
      } else {
        // No nearby strikes - restore normal appearance
        panel.style.border = '1px solid var(--border-color)';
        panel.style.boxShadow = 'none';
      }
    }
  }, [enabled, lightningData]);

  // Create proximity panel control (within radius of PROXIMITY_RADIUS_KM)
  useEffect(() => {
    console.debug(
      '[Lightning] Proximity effect triggered - enabled:',
      enabled,
      'map:',
      !!map,
      'proximityControl:',
      !!proximityControlRef.current,
    );

    if (!map || typeof L === 'undefined') {
      console.debug('[Lightning] Proximity: No map or Leaflet');
      return;
    }
    if (!enabled) {
      console.debug('[Lightning] Proximity: Not enabled');
      return;
    }
    if (proximityControlRef.current) {
      console.debug('[Lightning] Proximity: Already exists, skipping');
      return; // Already created
    }

    console.debug('[Lightning] Proximity: Getting station config from localStorage...');

    // Get config from localStorage directly (more reliable than window.hamclockConfig)
    let config;
    try {
      const stored = localStorage.getItem('openhamclock_config');
      if (stored) {
        config = JSON.parse(stored);
        console.info('[Lightning] Proximity: Config loaded from localStorage');
      } else {
        console.debug('[Lightning] Proximity: No config in localStorage, setting retry timer');
        const retryTimer = setTimeout(() => {
          console.debug('[Lightning] Proximity: Retry timer fired, triggering re-render');
          setLightningData((prev) => [...prev]); // Trigger re-render
        }, 2000);
        return () => clearTimeout(retryTimer);
      }
    } catch (e) {
      console.error('[Lightning] Proximity: Error reading config:', e);
      return;
    }

    const stationLat = config.location?.lat ?? config.latitude;
    const stationLon = config.location?.lon ?? config.longitude;

    console.debug('[Lightning] Proximity: Station location:', { stationLat, stationLon });

    if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) {
      console.warn('[Lightning] Proximity: No station location - aborting');
      return;
    }

    console.debug('[Lightning] Proximity: ALL CHECKS PASSED - Creating panel now!');

    const ProximityControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'lightning-proximity', panelWrapper);

        // Unfortunately, to fit both km and miles in the header we need to override the font size
        let distStr = isMetric ? ` (${PROXIMITY_RADIUS_KM} km)` : ` (${PROXIMITY_RADIUS_MILES.toFixed(1)} miles)`;
        div.innerHTML = `<div class="floating-panel-header" style="font-size: 11px">📍 ${t('plugins.layers.lightning.nearbyStrikes')}${distStr}</div><div style="opacity: 0.7; font-size: 10px; text-align: center;">No recent strikes</div>`;

        // Prevent map interaction
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        return panelWrapper;
      },
    });

    const control = new ProximityControl();
    console.debug('[Lightning] Proximity: ProximityControl instance created');
    map.addControl(control);
    console.debug('[Lightning] Proximity: Control added to map');

    // Make draggable and add minimize toggle - retry until found
    let retries = 0;
    const maxRetries = 20; // Try for up to 2 seconds
    const retryInterval = setInterval(() => {
      retries++;
      console.debug(
        `[Lightning] Proximity: Looking for .lightning-proximity container... (attempt ${retries}/${maxRetries})`,
      );
      const container = document.querySelector('.lightning-proximity');
      if (container) {
        clearInterval(retryInterval);
        console.debug('[Lightning] Proximity: Container found! Making draggable...');

        // Default to CENTER of screen (not corner!)
        container.style.position = 'fixed';
        container.style.top = '45%'; // NOTE: using 45% instead of 50% with transform: translateX/Y due to dragging issues
        container.style.left = '45%';
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.style.zIndex = '1001'; // Ensure it's on top

        console.debug('[Lightning] Proximity: Panel positioned at center of screen');

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
              console.debug('[Lightning] Proximity: Applied saved position (percentage):', {
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
                console.debug('[Lightning] Proximity: Converted pixel to percentage:', { topPercent, leftPercent });
              } else {
                console.debug('[Lightning] Proximity: Saved pixel position off-screen, using default');
                localStorage.removeItem('lightning-proximity-position');
              }
            }
          } catch (e) {
            console.error('[Lightning] Proximity: Error applying saved position:', e);
          }
        }

        // Make draggable - pass flag to skip position loading since we already did it
        makeDraggable(container, 'lightning-proximity-position', { skipPositionLoad: positionLoaded, snap: 5 });
        addMinimizeToggle(container, 'lightning-proximity-position', {
          contentClassName: 'lightning-panel-content',
          buttonClassName: 'lightning-minimize-btn',
        });
        console.debug('[Lightning] Proximity: Panel is now draggable and minimizable');

        // IMPORTANT: Set ref AFTER setup is complete
        proximityControlRef.current = control;
        console.debug('[Lightning] Proximity: Ref updated with control');
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

    const stationLat = config.location?.lat ?? config.latitude;
    const stationLon = config.location?.lon ?? config.longitude;

    if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) return;

    const now = Date.now();

    // Find all strikes within radius of PROXIMITY_RADIUS_KM
    const nearbyStrikes = lightningData
      .map((strike) => {
        const distance = calculateDistance(stationLat, stationLon, strike.lat, strike.lon, 'km');
        return { ...strike, distance };
      })
      .filter((strike) => strike.distance.km <= PROXIMITY_RADIUS_KM)
      .sort((a, b) => a.distance.km - b.distance.km); // Sort by distance (closest first)

    let contentHTML = '';

    if (nearbyStrikes.length === 0) {
      let distStr = isMetric ? ` ${PROXIMITY_RADIUS_KM} km` : ` ${PROXIMITY_RADIUS_MILES.toFixed(1)} miles`;
      contentHTML = `
        <div style="font-size: 10px; text-align: center;">
          ✅ ${t('plugins.layers.lightning.nearbyNoStrikes')}${distStr}<br/>
          <span style="font-size: 9px; color: var(--text-muted);">${t('plugins.layers.lightning.allClear')}</span>
        </div>
      `;
    } else {
      const closestStrike = nearbyStrikes[0];
      const ageMinutes = Math.floor((now - closestStrike.timestamp) / 60000);
      const ageSeconds = Math.floor((now - closestStrike.timestamp) / 1000);
      const ageStr = ageMinutes > 0 ? `${ageMinutes} min` : `${ageSeconds} s`;
      const closestStrikeDistance = isMetric ? closestStrike.distance.km : closestStrike.distance.miles;

      contentHTML = `
        <div role="alert" aria-live="assertive" style="margin-bottom: 8px; padding: 8px; background: rgba(255,0,0,0.1); border-left: 3px solid var(--accent-red); border-radius: 4px;">
          <div style="font-weight: bold; color: var(--accent-red); margin-bottom: 4px;">
            ⚡ ${t('plugins.layers.lightning.strikesDetected')}: ${nearbyStrikes.length}</div>
          <div style="font-size: 10px;">
            <strong>${t('plugins.layers.lightning.closest')}:</strong> ${closestStrikeDistance.toFixed(1)} ${unitsStr}<br>
            <strong>${t('plugins.layers.lightning.age')}:</strong> ${ageStr}<br>
            <strong>${t('plugins.layers.lightning.polarity')}:</strong> ${closestStrike.polarity === 'positive' ? '+' : '-'}${Math.round(closestStrike.intensity)} kA
          </div>
        </div>
        <div style="font-size: 9px; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px;">
          <strong>${t('plugins.layers.lightning.nearbyStrikes')}:</strong><br>
          <div style="max-height: 150px; overflow-y: auto; margin-top: 4px;">
            ${nearbyStrikes
              .slice(0, 10)
              .map((strike, idx) => {
                const age = Math.floor((now - strike.timestamp) / 1000);
                const timeStr = age < 60 ? `${age} s` : `${Math.floor(age / 60)} min`;
                const dist = (isMetric ? strike.distance.km : strike.distance.miles).toFixed(1);
                return `
                <div style="padding: 2px 0; border-bottom: 1px dotted var(--border-color);">
                  ${idx + 1}. ${dist} ${unitsStr} • ${timeStr} • ${strike.polarity === 'positive' ? '+' : '-'}${Math.round(strike.intensity)} kA
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
