import { useEffect, useRef } from 'react';
import { replicatePoint, replicatePath } from '../../utils/geo.js';

export const metadata = {
  id: 'satellites',
  name: 'Satellite Tracks',
  description: 'Real-time satellite positions, footprints, and predicted paths',
  icon: '🛰',
  category: 'satellites',
  defaultEnabled: true,
  defaultOpacity: 1.0,
  // Custom settings passed to the plugin
  config: {
    leadTimeMins: 45,
    tailTimeMins: 15,
	showTracks: true,
    showFootprints: true,
  }
};

export const useLayer = ({ map, enabled, satellites, opacity, config, units }) => { 
  const layerGroupRef = useRef(null);
		// --- FETCH SATELLITES ---
		 const fetchSatellites = async () => {
		try {
		  // Change the URL back to fixed 45 and 0
		  const response = await fetch('/api/satellites/positions?leadTimeMins=45&tailTimeMins=0');
		  const data = await response.json();
		  setSatellites(data);
		} catch (error) {
		  console.error('Failed to fetch satellites:', error);
		}
	  };
		  // --- END OF FETCH ---
  useEffect(() => {
    if (!map) return;
    const L = window.L;

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup();
    }

    if (enabled) {
      layerGroupRef.current.addTo(map);
      renderSatellites();
    } else {
      layerGroupRef.current.remove();
    }

    function renderSatellites() {
      layerGroupRef.current.clearLayers();
      if (!satellites || satellites.length === 0) return;

      satellites.forEach(sat => {
        // 1. Draw Path (Lead and Tail)
        if (config?.showTracks !== false && sat.track && sat.track.length > 0) {
		const pathCoords = sat.track.map(p => [p[0], p[1]]);
          replicatePath(pathCoords).forEach(coords => {
            L.polyline(coords, {
              color: '#00ffff',
              weight: 1,
              opacity: opacity * 0.5,
              dashArray: '5, 10'
            }).addTo(layerGroupRef.current);
          });
        }

        // 2. Draw Footprint (Visibility Circle)
        if (config?.showFootprints !== false && sat.footprintRadius) {
		replicatePoint(sat.lat, sat.lon).forEach(pos => {
            L.circle(pos, {
              radius: sat.footprintRadius * 1000, // km to meters
              color: '#FFFF00',
              weight: 1,
              fillColor: '#00ffff',
              fillOpacity: 0.1 * opacity,
              interactive: false
            }).addTo(layerGroupRef.current);
          });
        }
		
		// 3. Satellite Marker & Interactive Popup
		replicatePoint(sat.lat, sat.lon).forEach(pos => {
		  const satIcon = L.divIcon({
			className: 'sat-marker-container',
			html: `
			  <div style="display:flex; flex-direction:column; align-items:center;">
				<div style="font-size: 18px; line-height: 1; text-shadow: 0 0 5px ${sat.color || '#00ffff'};">🛰</div>
				<div style="color: ${sat.color || '#00ffff'}; font-size: 10px; font-family: monospace; text-shadow: 1px 1px 2px #000; margin-top: 1px; white-space: nowrap;">
				  ${sat.name}
				</div>
			  </div>`,
			iconSize: [0, 0],
			iconAnchor: [0, 0]
		  });

		  L.marker(pos, { icon: satIcon })
			.bindPopup(`
			  <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; min-width: 180px;">
				<b style="color: #008888;">⛊ ${sat.name}</b><br>
				<hr style="border: 0; border-top: 1px solid #eee; margin: 5px 0;">
				<table style="width: 100%; border-collapse: collapse;">
				  <tr><td>Alt:</td><td style="text-align:right"><b>${units === 'imperial' ? Math.round(sat.alt * 0.621371).toLocaleString() + ' mi' : Math.round(sat.alt).toLocaleString() + ' km'}</b></td></tr>
				  <tr><td>Az:</td><td style="text-align:right">${sat.azimuth}°</td></tr>
				  <tr><td>El:</td><td style="text-align:right">${sat.elevation}°</td></tr>
				  <tr><td>Range:</td><td style="text-align:right">${units === 'imperial' ? Math.round(sat.range * 0.621371).toLocaleString() + ' mi' : Math.round(sat.range).toLocaleString() + ' km'}</td></tr>
				  <tr><td>Mode:</td><td style="text-align:right"><b>${sat.mode || 'Unknown'}</b></td></tr>
				  <tr><td>Status:</td><td style="text-align:right">${sat.visible ? '<span style="color:green">Visible</span>' : '<span style="color:gray">Below Horiz</span>'}</td></tr>
				</table>
			  </div>
			`)
			.addTo(layerGroupRef.current);
		});
      });
    }

    // Update positions every minute or when satellite data changes
    const interval = setInterval(renderSatellites, 60000);
    return () => {
      clearInterval(interval);
      if (layerGroupRef.current) layerGroupRef.current.remove();
    };
  }, [map, enabled, satellites, opacity, units]);
};