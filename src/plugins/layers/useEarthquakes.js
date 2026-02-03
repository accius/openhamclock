import { useState, useEffect, useRef } from 'react';

//Scaled markers - Bigger circles for stronger quakes
//Color-coded by magnitude:
//Yellow: M2.5-3 (minor)
//Orange: M3-4 (light)
//Deep Orange: M4-5 (moderate)
//Red: M5-6 (strong)
//Dark Red: M6-7 (major)
//Very Dark Red: M7+ (great)

export const metadata = {
  id: 'earthquakes',
  name: 'Earthquakes',
  description: 'Live USGS earthquake data (all earthquakes from last hour) with animated detection',
  icon: '🌋',
  category: 'geology',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.2.0'
};

export function useLayer({ enabled = false, opacity = 0.9, map = null }) {
  const [markersRef, setMarkersRef] = useState([]);
  const [earthquakeData, setEarthquakeData] = useState([]);
  const previousQuakeIds = useRef(new Set());
  const isFirstLoad = useRef(true);

  // Fetch earthquake data
  useEffect(() => {
    if (!enabled) return;

    const fetchEarthquakes = async () => {
      try {
        // USGS GeoJSON feed - All earthquakes from last hour
        const response = await fetch(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
          //'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'
        );
        const data = await response.json();
        console.log('Earthquakes fetched:', data.features?.length || 0, 'quakes');
        setEarthquakeData(data.features || []);
      } catch (err) {
        console.error('Earthquake data fetch error:', err);
      }
    };

    fetchEarthquakes();
    // Refresh every 5 minutes
    const interval = setInterval(fetchEarthquakes, 300000);
    //const interval = setInterval(fetchEarthquakes, 60000);

    return () => clearInterval(interval);
  }, [enabled]);

  // Add/remove markers with animation for new quakes
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    markersRef.forEach(marker => {
      try {
        map.removeLayer(marker);
      } catch (e) {
        // Already removed
      }
    });
    setMarkersRef([]);

    if (!enabled || earthquakeData.length === 0) {
      console.log('Earthquakes: enabled=', enabled, 'data count=', earthquakeData.length);
      return;
    }

    const newMarkers = [];
    const currentQuakeIds = new Set();

    earthquakeData.forEach(quake => {
      const coords = quake.geometry.coordinates;
      const props = quake.properties;
      const mag = props.mag;
      const lat = coords[1];
      const lon = coords[0];
      const depth = coords[2];
      const quakeId = quake.id;

      currentQuakeIds.add(quakeId);

      // Skip if invalid coordinates
      if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

      // Check if this is a new earthquake (but not on first load)
      const isNew = !isFirstLoad.current && !previousQuakeIds.current.has(quakeId);

      // Calculate marker size based on magnitude (larger = stronger earthquake)
      // M1-2: 16px, M3: 20px, M4: 24px, M5: 28px, M6: 32px, M7+: 40px
      const size = Math.min(Math.max(mag * 6, 16), 40);

      // Color based on magnitude (gets redder with stronger quakes)
      let color;
      if (mag < 2) color = '#90EE90'; // Light green - micro
      else if (mag < 3) color = '#FFEB3B'; // Yellow - minor
      else if (mag < 4) color = '#FFA500'; // Orange - light
      else if (mag < 5) color = '#FF6600'; // Deep orange - moderate
      else if (mag < 6) color = '#FF3300'; // Red - strong
      else if (mag < 7) color = '#CC0000'; // Dark red - major
      else color = '#8B0000'; // Very dark red - great

      // Create earthquake icon with visible shake/wave symbol
      const waveIcon = `
        <svg width="${size*0.8}" height="${size*0.8}" viewBox="0 0 32 32" style="fill: white; stroke: white; stroke-width: 1;">
          <path d="M16 4 L13 12 L10 8 L8 16 L6 12 L4 20 M16 4 L19 12 L22 8 L24 16 L26 12 L28 20" stroke-width="2" fill="none"/>
          <circle cx="16" cy="16" r="3" fill="white"/>
          <path d="M16 22 L14 26 L18 26 Z" fill="white"/>
        </svg>
      `;
      
      const icon = L.divIcon({
        className: 'earthquake-icon',
        html: `<div style="
          background-color: ${color}; 
          color: white; 
          width: ${size}px; 
          height: ${size}px; 
          border-radius: 50%; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          font-weight: bold;
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        ">${waveIcon}</div>`,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      });
      
      console.log('Creating earthquake marker:', quakeId, 'M' + mag.toFixed(1), 'at', lat, lon, 'size:', size + 'px', 'color:', color);
      const circle = L.marker([lat, lon], { 
        icon, 
        opacity,
        zIndexOffset: 10000 // Ensure markers appear on top
      });

      // Add to map first
      circle.addTo(map);

      // Add pulsing animation for new earthquakes ONLY
      if (isNew) {
        // Wait for DOM element to be created, then add animation class
        setTimeout(() => {
          try {
            const iconElement = circle.getElement();
            if (iconElement) {
              const iconDiv = iconElement.querySelector('div');
              if (iconDiv) {
                iconDiv.classList.add('earthquake-pulse-new');
                
                // Remove animation class after it completes (0.8s)
                setTimeout(() => {
                  try {
                    iconDiv.classList.remove('earthquake-pulse-new');
                  } catch (e) {}
                }, 800);
              }
            }
          } catch (e) {
            console.warn('Could not animate earthquake marker:', e);
          }
        }, 10);
        
        // Create pulsing ring effect
        const pulseRing = L.circle([lat, lon], {
          radius: 50000, // 50km radius in meters
          fillColor: color,
          fillOpacity: 0,
          color: color,
          weight: 3,
          opacity: 0.8,
          className: 'earthquake-pulse-ring'
        });
        
        pulseRing.addTo(map);
        
        // Remove pulse ring after animation completes
        setTimeout(() => {
          try {
            map.removeLayer(pulseRing);
          } catch (e) {}
        }, 3000);
      }

      // Format time
      const time = new Date(props.time);
      const timeStr = time.toLocaleString();
      const ageMinutes = Math.floor((Date.now() - props.time) / 60000);
      const ageStr = ageMinutes < 60 
        ? `${ageMinutes} min ago` 
        : `${Math.floor(ageMinutes / 60)} hr ago`;

      // Add popup with details
      circle.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 200px;">
          <div style="font-size: 16px; font-weight: bold; color: ${color}; margin-bottom: 8px;">
            ${isNew ? '🆕 ' : ''}M${mag.toFixed(1)} ${props.type === 'earthquake' ? '🌋' : '⚡'}
          </div>
          <table style="font-size: 12px; width: 100%;">
            <tr><td><b>Location:</b></td><td>${props.place || 'Unknown'}</td></tr>
            <tr><td><b>Time:</b></td><td>${timeStr}</td></tr>
            <tr><td><b>Age:</b></td><td>${ageStr}</td></tr>
            <tr><td><b>Depth:</b></td><td>${depth.toFixed(1)} km</td></tr>
            <tr><td><b>Magnitude:</b></td><td>${mag.toFixed(1)}</td></tr>
            <tr><td><b>Status:</b></td><td>${props.status || 'automatic'}</td></tr>
            ${props.tsunami ? '<tr><td colspan="2" style="color: red; font-weight: bold;">⚠️ TSUNAMI WARNING</td></tr>' : ''}
          </table>
          ${props.url ? `<a href="${props.url}" target="_blank" style="color: #00aaff; font-size: 11px;">View Details →</a>` : ''}
        </div>
      `);

      // Already added to map above (before animation)
      newMarkers.push(circle);
    });

    // Update previous quake IDs for next comparison
    previousQuakeIds.current = currentQuakeIds;
    
    // After first load, allow animations for new quakes
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
    }

    console.log('Earthquakes: Created', newMarkers.length, 'markers on map');
    setMarkersRef(newMarkers);

    return () => {
      newMarkers.forEach(marker => {
        try {
          map.removeLayer(marker);
        } catch (e) {
          // Already removed
        }
      });
    };
  }, [enabled, earthquakeData, map, opacity]);

  return {
    markers: markersRef,
    earthquakeCount: earthquakeData.length
  };
}
