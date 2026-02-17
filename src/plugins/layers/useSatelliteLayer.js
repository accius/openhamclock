// Satellite tracking
import { useEffect, useRef, useState } from 'react';
import * as satellite from 'satellite.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';

export const metadata = {
  id: 'satellites',
  name: 'Satellite Tracks',
  description: 'Real-time satellite positions with separate floating data window',
  icon: '🛰',
  category: 'satellites',
  defaultEnabled: true,
  defaultOpacity: 1.0,
  config: {
    leadTimeMins: 45, // This creates the "Future" slider
    tailTimeMins: 15, // This creates the "Past" slider
    showTracks: true,
    showFootprints: true,
  }
};

export const useLayer = ({ map, enabled, satellites, setSatellites, opacity, config, units }) => { 
  const [pinnedSatName, setPinnedSatName] = useState(null);
  const layerGroupRef = useRef(null);

  // Injection of UI styles for the Info Window, Labels, and Blinking
  useEffect(() => {
    const styleId = 'sat-layer-ui-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes satBlink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
        .sat-visible-blink { animation: satBlink 1s infinite !important; color: #00ff00 !important; font-weight: bold; }
        .sat-data-window {
          position: absolute;
          top: 45px; /* Moved down by ~35px from previous version */
          right: 15px;
          z-index: 2000;
          background: rgba(10, 10, 10, 0.9);
          border: 1.5px solid #00ffff;
          border-radius: 6px;
          padding: 14px;
          color: white;
          font-family: 'JetBrains Mono', monospace;
          min-width: 210px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 255, 255, 0.2);
          pointer-events: auto;
        }
        .sat-close-btn {
          cursor: pointer;
          color: #ff4444;
          font-size: 18px;
          font-weight: bold;
          line-height: 1;
          padding: 2px 6px;
        }
        .sat-close-btn:hover { color: #ff0000; }
        .sat-label {
          color: #00ffff;
          font-size: 11px;
          font-weight: bold;
          text-shadow: 1px 1px 2px black;
          white-space: nowrap;
          margin-top: 2px;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

	const fetchSatellites = async () => {
		try {
		  const response = await fetch('/api/satellites/tle');
		  const data = await response.json();
		  
		  const satArray = Object.keys(data).map(name => {
			const satData = data[name];
			const leadTrack = [];
			
			// Only calculate lead tracks if we have TLE lines
			if (satData.line1 && satData.line2) {
			  const satrec = satellite.twoline2satrec(satData.line1, satData.line2);
			  const now = new Date();
			  const minutesToPredict = config?.leadTimeMins || 45;
			  const stepSize = 2; // Calculate a point every 2 minutes

			  for (let i = 0; i <= minutesToPredict; i += stepSize) {
				const futureTime = new Date(now.getTime() + i * 60000);
				const posVel = satellite.propagate(satrec, futureTime);
				
				if (posVel.position) {
				  const gmst = satellite.gstime(futureTime);
				  const geodetic = satellite.eciToGeodetic(posVel.position, gmst);
				  leadTrack.push([
					satellite.degreesLat(geodetic.latitude),
					satellite.degreesLong(geodetic.longitude)
				  ]);
				}
			  }
			}

			return { 
			  name, 
			  ...satData,
			  leadTrack // Add the calculated future points here
			};
		  });

		  if (setSatellites) setSatellites(satArray);
		} catch (error) {
		  console.error('Failed to fetch and propagate satellites:', error);
		}
	  };
// +++ Track and Footprint Engine +++ 
// +++ Track and Footprint Engine +++ 
const renderSatellites = () => {
  if (!layerGroupRef.current || !map) return;
  layerGroupRef.current.clearLayers();
  if (!satellites || satellites.length === 0) return;

  const globalOpacity = opacity !== undefined ? opacity : 1.0;

  // EVERY piece of logic must be inside this forEach loop
  satellites.forEach(sat => {
    const isPinned = pinnedSatName === sat.name;

    // 1. FOOTPRINTS - Now inside the loop to see 'sat' and 'isPinned'
    if (isPinned && config?.showFootprints !== false && sat.alt) {
      const EARTH_RADIUS = 6371; 
      const centralAngle = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + sat.alt));
      const footprintRadiusMeters = centralAngle * EARTH_RADIUS * 1000;
      
      // Determine color based on visibility flag
      const footColor = sat.visible === true ? '#00ff00' : '#00ffff';  

      replicatePoint(sat.lat, sat.lon).forEach((pos) => {
        window.L.circle(pos, {
          radius: footprintRadiusMeters,
          color: footColor,
          weight: 2,
          opacity: globalOpacity,
          fillColor: footColor,
          fillOpacity: globalOpacity * 0.2,
          interactive: false
        }).addTo(layerGroupRef.current);
      });
    }

    // 2. TRACKS (Tail & Lead) - Also inside the loop
    if (config?.showTracks !== false) {
      if (sat.track) {
        const pathCoords = sat.track.map(p => [p[0], p[1]]);
        replicatePath(pathCoords).forEach(coords => {
          if (isPinned) {
            for (let i = 0; i < coords.length - 1; i++) {
              const fade = (i / coords.length);
              window.L.polyline([coords[i], coords[i+1]], { 
                color: '#00ffff', weight: 6, opacity: fade * 0.3 * globalOpacity, lineCap: 'round', interactive: false 
              }).addTo(layerGroupRef.current);
              window.L.polyline([coords[i], coords[i+1]], { 
                color: '#ffffff', weight: 2, opacity: fade * globalOpacity, lineCap: 'round', interactive: false 
              }).addTo(layerGroupRef.current);
            }
          } else {
            window.L.polyline(coords, { 
              color: '#00ffff', weight: 1, opacity: 0.15 * globalOpacity, dashArray: '5, 10', interactive: false 
            }).addTo(layerGroupRef.current);
          }
        });
      }

      // Bright Yellow Lead Track
      if (isPinned && sat.leadTrack && sat.leadTrack.length > 0) {
        const leadCoords = sat.leadTrack.map(p => [p[0], p[1]]);
        replicatePath(leadCoords).forEach(lCoords => {
          window.L.polyline(lCoords, {
            color: '#ffff00', weight: 3, opacity: 0.8 * globalOpacity, dashArray: '8, 12', lineCap: 'round', interactive: false
          }).addTo(layerGroupRef.current);
        });
      }
    }

    // 3. MARKERS
    replicatePoint(sat.lat, sat.lon).forEach((pos) => {
      const marker = window.L.marker(pos, { 
        icon: window.L.divIcon({
          className: 'sat-marker',
          html: `<div style="display:flex; flex-direction:column; align-items:center; opacity: ${globalOpacity};">
                   <div style="font-size:${isPinned ? '32px' : '22px'}; filter:${isPinned ? 'drop-shadow(0 0 10px #00ffff)' : 'none'}; cursor: pointer;">🛰</div>
                   <div class="sat-label" style="${isPinned ? 'color: #ffffff;' : ''}">${sat.name}</div>
                 </div>`,
          iconSize: [80, 50],
          iconAnchor: [40, 25]
        }),
        zIndexOffset: isPinned ? 10000 : 1000
      });

      marker.on('click', (e) => {
        window.L.DomEvent.stopPropagation(e);
        setPinnedSatName(sat.name === pinnedSatName ? null : sat.name);
      });

      marker.addTo(layerGroupRef.current);
    });
  });

  updateInfoWindow();
};

  const updateInfoWindow = () => {
    const sat = satellites.find(s => s.name === pinnedSatName);
    const container = map.getContainer();
    
    let win = container.querySelector('.sat-data-window');
    
    if (!sat) {
      if (win) win.remove();
      return;
    }

    if (!win) {
      win = document.createElement('div');
      win.className = 'sat-data-window';
      container.appendChild(win);
    }

    const isImp = units === 'imperial';
    const distUnit = isImp ? ' mi' : ' km';
    const conv = isImp ? 0.621371 : 1;

    win.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
        <b style="color:#00ffff; font-size:16px; letter-spacing: 0.5px;">⛊ ${sat.name}</b>
        <span class="sat-close-btn" title="Close Window">×</span>
      </div>
      <div style="height: 1px; background: linear-gradient(90deg, #00ffff 0%, transparent 100%); margin-bottom: 10px;"></div>
      <table style="width:100%; border-collapse:collapse; font-size: 13px;">
        <tr><td style="color:#888;">Alt:</td><td align="right"><b>${Math.round(sat.alt * conv).toLocaleString()}${distUnit}</b></td></tr>
        <tr><td style="color:#888;">Az:</td><td align="right">${Math.round(sat.azimuth)}°</td></tr>
        <tr><td style="color:#888;">El:</td><td align="right">${Math.round(sat.elevation)}°</td></tr>
        <tr><td style="color:#888;">Range:</td><td align="right">${Math.round(sat.range * conv).toLocaleString()}${distUnit}</b></td></tr>
        <tr><td style="color:#888;">Mode:</td><td align="right"><b style="color:#aaa;">${sat.mode || 'N/A'}</b></td></tr>
        <tr><td style="color:#888;">Status:</td><td align="right">${sat.visible ? '<span class="sat-visible-blink">Visible</span>' : '<span style="color:#666;">Below Horiz</span>'}</td></tr>
      </table>
    `;
    
    // Close button logic
    win.querySelector('.sat-close-btn').onclick = (e) => {
      e.stopPropagation();
      setPinnedSatName(null);
    };
  };

  useEffect(() => {
    if (!map) return;
    if (!layerGroupRef.current) layerGroupRef.current = window.L.layerGroup().addTo(map);
    
    if (enabled) {
      fetchSatellites();
      const interval = setInterval(fetchSatellites, 60000);
      return () => clearInterval(interval);
    } else {
      layerGroupRef.current.clearLayers();
      const win = map.getContainer().querySelector('.sat-data-window');
      if (win) win.remove();
    }
  }, [enabled, map]);

	useEffect(() => {
	if (enabled) renderSatellites();
	}, [satellites, pinnedSatName, units, opacity, config]);

	  return null;
	};