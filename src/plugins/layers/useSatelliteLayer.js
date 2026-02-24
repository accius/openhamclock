import { useEffect, useRef, useState } from 'react';
import * as satellite from 'satellite.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';

export const metadata = {
  id: 'satellites',
  name: 'Satellite Tracks',
  description: 'Real-time satellite positions with glow tracks and narrow info card',
  icon: '🛰',
  category: 'satellites',
  defaultEnabled: true,
  defaultOpacity: 1.0,
  config: {
    leadTimeMins: 45,
    tailTimeMins: 15,
    showTracks: true,
    showFootprints: true,
  },
};

export const useLayer = ({ map, enabled, satellites, setSatellites, opacity, config, units }) => {
  const layerGroupRef = useRef(null);

  // 1. Multi-select state (Wipes on browser close)
  const [selectedSats, setSelectedSats] = useState(() => {
    const saved = sessionStorage.getItem('selected_satellites');
    return saved ? JSON.parse(saved) : [];
  });
  const [winPos, setWinPos] = useState({ top: 50, right: 10 });
  const [winMinimized, setWinMinimized] = useState(false);

  // Sync selection to session storage
  useEffect(() => {
    sessionStorage.setItem('selected_satellites', JSON.stringify(selectedSats));
  }, [selectedSats]);

  const toggleSatellite = (name) => {
    setSelectedSats((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  useEffect(() => {
    window.toggleSat = (name) => toggleSatellite(name);
  }, [selectedSats]);

  // 2. Inject Styles (Narrower, more transparent, and blinking status)
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
          z-index: 9999 !important;
          background: rgba(10, 10, 10, 0.75) !important; /* Increased transparency */
          backdrop-filter: blur(4px); /* Modern glass effect */
          border: 1px solid #00ffff;
          border-radius: 4px;
          padding: 8px 10px;
          color: white;
          font-family: 'JetBrains Mono', monospace;
          min-width: 180px; /* Narrower to take up less space */
          max-width: 180px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.7);
          pointer-events: auto;
        }
        
        .sat-close-btn { cursor: pointer; color: #ff4444; font-size: 16px; font-weight: bold; }
        .sat-label { color: #00ffff; font-size: 10px; font-weight: bold; text-shadow: 1px 1px 2px black; white-space: nowrap; margin-top: 2px; }
        
        .sat-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
        .sat-mini-table td { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const fetchSatellites = async () => {
    try {
      const response = await fetch('/api/satellites/tle');
      const data = await response.json();

      const observerGd = {
        latitude: satellite.degreesToRadians(config?.lat || 43.44),
        longitude: satellite.degreesToRadians(config?.lon || -88.63),
        height: (config?.alt || 260) / 1000,
      };

      const satArray = Object.keys(data).map((name) => {
        const satData = data[name];
        let isVisible = false;
        let az = 0,
          el = 0,
          range = 0,
          alt = 0,
          lat = 0,
          lon = 0;
        const leadTrack = [];

        if (satData.line1 && satData.line2) {
          const satrec = satellite.twoline2satrec(satData.line1, satData.line2);
          const now = new Date();
          const pV = satellite.propagate(satrec, now);
          const gmst = satellite.gstime(now);

          if (pV.position) {
            const pGd = satellite.eciToGeodetic(pV.position, gmst);
            const pEcf = satellite.eciToEcf(pV.position, gmst);
            const look = satellite.ecfToLookAngles(observerGd, pEcf);

            az = satellite.radiansToDegrees(look.azimuth);
            el = satellite.radiansToDegrees(look.elevation);
            range = look.rangeSat;
            isVisible = el > 0;
            lat = satellite.degreesLat(pGd.latitude);
            lon = satellite.degreesLong(pGd.longitude);
            alt = pGd.height;
          }

          const minutes = config?.leadTimeMins || 45;
          for (let i = 0; i <= minutes; i += 2) {
            const fT = new Date(now.getTime() + i * 60000);
            const p = satellite.propagate(satrec, fT);
            if (p.position) {
              const g = satellite.eciToGeodetic(p.position, satellite.gstime(fT));
              leadTrack.push([satellite.degreesLat(g.latitude), satellite.degreesLong(g.longitude)]);
            }
          }
        }

        return { ...satData, name, lat, lon, alt, visible: isVisible, azimuth: az, elevation: el, range, leadTrack };
      });

      if (setSatellites) setSatellites(satArray);
    } catch (error) {
      console.error('Failed to fetch satellites:', error);
    }
  };

  const updateInfoWindow = () => {
    const container = map.getContainer();
    let win = container.querySelector('#sat-data-window');

    if (!selectedSats || selectedSats.length === 0) {
      if (win) win.remove();
      return;
    }

    if (!win) {
      win = document.createElement('div');
      win.id = 'sat-data-window';
      win.className = 'sat-data-window leaflet-bar';
      container.appendChild(win);

      let isDragging = false;
      win.onmousedown = (e) => {
        if (e.ctrlKey) {
          isDragging = true;
          win.style.cursor = 'move';
          if (map.dragging) map.dragging.disable();
          e.preventDefault();
          e.stopPropagation();
        }
      };

      window.onmousemove = (e) => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        win.style.right = `${rect.right - e.clientX - 10}px`;
        win.style.top = `${e.clientY - rect.top - 10}px`;
      };

      window.onmouseup = () => {
        if (isDragging) {
          isDragging = false;
          win.style.cursor = 'default';
          if (map.dragging) map.dragging.enable();
          setWinPos({ top: parseInt(win.style.top), right: parseInt(win.style.right) });
        }
      };
    }

    win.style.top = `${winPos.top}px`;
    win.style.right = `${winPos.right}px`;
    window.__satWinToggleMinimize = () => setWinMinimized((prev) => !prev);

    const activeSats = satellites.filter((s) => selectedSats.includes(s.name));

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #00ffff; padding-bottom:3px; margin-bottom:5px;">
        <span style="font-size:10px; color:#00ffff; font-weight:bold;">🛰 ${activeSats.length} SATS</span>
        <button onclick="window.__satWinToggleMinimize()" style="background:none; border:none; color:#00ffff; cursor:pointer; font-size:12px;">${winMinimized ? '▲' : '▼'}</button>
      </div>
    `;

    if (!winMinimized) {
      activeSats.forEach((sat) => {
        const isVisible = sat.visible === true;
        const conv = units === 'imperial' ? 0.621371 : 1;
        const distUnit = units === 'imperial' ? ' mi' : ' km';

        html += `
          <div style="margin-bottom:8px; border-bottom: 1px solid rgba(0,255,255,0.1); padding-bottom:5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
              <strong style="color:#ffffff; font-size: 12px;">${sat.name}</strong>
              <span style="color:#ff4444; cursor:pointer; font-weight:bold; font-size:16px;" onclick="window.toggleSat('${sat.name}')">✕</span>
            </div>
            <table class="sat-mini-table">
              <tr><td>Az/El</td><td align="right">${Math.round(sat.azimuth)}° / ${Math.round(sat.elevation)}°</td></tr>
              <tr><td>Range</td><td align="right">${Math.round(sat.range * conv).toLocaleString()}${distUnit}</td></tr>
              <tr><td>Mode</td><td align="right" style="color:#ffa500;">${sat.mode || 'N/A'}</td></tr>
              <tr><td>Status</td><td align="right" class="${isVisible ? 'sat-visible-blink' : ''}">
                ${isVisible ? 'Visible' : '<span style="color:#666;">Pass</span>'}
              </td></tr>
            </table>
          </div>
        `;
      });
      html += `<div style="text-align:center; font-size:9px; color:#666; margin-top:5px;">Ctrl+Drag to move</div>`;
    }

    win.innerHTML = html;
  };

  const renderSatellites = () => {
    if (!layerGroupRef.current || !map) return;
    layerGroupRef.current.clearLayers();
    if (!satellites || satellites.length === 0) return;

    const globalOpacity = opacity !== undefined ? opacity : 1.0;

    satellites.forEach((sat) => {
      const isSelected = selectedSats.includes(sat.name);

      if (isSelected && config?.showFootprints !== false && sat.alt) {
        const R = 6371;
        const radiusMeters = Math.acos(R / (R + sat.alt)) * R * 1000;
        const footColor = sat.visible === true ? '#00ff00' : '#00ffff';
        replicatePoint(sat.lat, sat.lon).forEach((pos) => {
          window.L.circle(pos, {
            radius: radiusMeters,
            color: footColor,
            weight: 2,
            opacity: globalOpacity,
            fillColor: footColor,
            fillOpacity: globalOpacity * 0.15,
            interactive: false,
          }).addTo(layerGroupRef.current);
        });
      }

      if (config?.showTracks !== false && sat.track) {
        replicatePath(sat.track.map((p) => [p[0], p[1]])).forEach((coords) => {
          if (isSelected) {
            for (let i = 0; i < coords.length - 1; i++) {
              const fade = i / coords.length;
              window.L.polyline([coords[i], coords[i + 1]], {
                color: '#00ffff',
                weight: 6,
                opacity: fade * 0.3 * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
              window.L.polyline([coords[i], coords[i + 1]], {
                color: '#ffffff',
                weight: 2,
                opacity: fade * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
            }
          } else {
            window.L.polyline(coords, {
              color: '#00ffff',
              weight: 1,
              opacity: 0.15 * globalOpacity,
              dashArray: '5, 10',
              interactive: false,
            }).addTo(layerGroupRef.current);
          }
        });

        if (isSelected && sat.leadTrack && sat.leadTrack.length > 0) {
          replicatePath(sat.leadTrack.map((p) => [p[0], p[1]])).forEach((lCoords) => {
            window.L.polyline(lCoords, {
              color: '#ffff00',
              weight: 3,
              opacity: 0.8 * globalOpacity,
              dashArray: '8, 12',
              lineCap: 'round',
              interactive: false,
            }).addTo(layerGroupRef.current);
          });
        }
      }

      replicatePoint(sat.lat, sat.lon).forEach((pos) => {
        const marker = window.L.marker(pos, {
          icon: window.L.divIcon({
            className: 'sat-marker',
            html: `<div style="display:flex; flex-direction:column; align-items:center; opacity: ${globalOpacity};">
                     <div style="font-size:${isSelected ? '32px' : '22px'}; filter:${isSelected ? 'drop-shadow(0 0 10px #00ffff)' : 'none'}; cursor: pointer;">🛰</div>
                     <div class="sat-label" style="${isSelected ? 'color: #ffffff; font-weight: bold;' : ''}">${sat.name}</div>
                   </div>`,
            iconSize: [80, 50],
            iconAnchor: [40, 25],
          }),
          zIndexOffset: isSelected ? 10000 : 1000,
        });
        marker.on('click', (e) => {
          window.L.DomEvent.stopPropagation(e);
          toggleSatellite(sat.name);
        });
        marker.addTo(layerGroupRef.current);
      });
    });

    updateInfoWindow();
  };

  useEffect(() => {
    if (!map) return;
    if (!layerGroupRef.current) layerGroupRef.current = window.L.layerGroup().addTo(map);

    if (enabled) {
      fetchSatellites();
      const interval = setInterval(fetchSatellites, 5000);
      return () => clearInterval(interval);
    } else {
      layerGroupRef.current.clearLayers();
      const win = document.getElementById('sat-data-window');
      if (win) win.remove();
    }
  }, [enabled, map, config]);

  useEffect(() => {
    if (enabled) renderSatellites();
  }, [satellites, selectedSats, units, opacity, config, winMinimized]);

  return null;
};
