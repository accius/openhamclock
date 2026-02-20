import { useEffect, useRef, useState } from 'react';
import * as satellite from 'satellite.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';

export const metadata = {
  id: 'satellites',
  name: 'Satellite Tracks',
  description: 'Real-time satellite positions with multi-select footprints',
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

  // Sync to session storage
  useEffect(() => {
    sessionStorage.setItem('selected_satellites', JSON.stringify(selectedSats));
  }, [selectedSats]);

  // Helper to add/remove satellites from the active view
  const toggleSatellite = (name) => {
    setSelectedSats((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  // Bridge to the popup window HTML
  useEffect(() => {
    window.toggleSat = (name) => toggleSatellite(name);
  }, [selectedSats]);

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
          range = 0;
        const leadTrack = [];

        if (satData.line1 && satData.line2) {
          const satrec = satellite.twoline2satrec(satData.line1, satData.line2);
          const now = new Date();
          const positionAndVelocity = satellite.propagate(satrec, now);
          const gmst = satellite.gstime(now);

          if (positionAndVelocity.position) {
            const positionEcf = satellite.eciToEcf(positionAndVelocity.position, gmst);
            const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

            az = lookAngles.azimuth * (180 / Math.PI);
            el = lookAngles.elevation * (180 / Math.PI);
            range = lookAngles.rangeSat;
            isVisible = el > 0;
          }

          const minutesToPredict = config?.leadTimeMins || 45;
          for (let i = 0; i <= minutesToPredict; i += 2) {
            const futureTime = new Date(now.getTime() + i * 60000);
            const posVel = satellite.propagate(satrec, futureTime);
            if (posVel.position) {
              const fGmst = satellite.gstime(futureTime);
              const geodetic = satellite.eciToGeodetic(posVel.position, fGmst);
              leadTrack.push([satellite.degreesLat(geodetic.latitude), satellite.degreesLong(geodetic.longitude)]);
            }
          }
        }

        return {
          ...satData,
          name,
          visible: isVisible,
          azimuth: az,
          elevation: el,
          range: range,
          leadTrack,
        };
      });

      if (setSatellites) setSatellites(satArray);
    } catch (error) {
      console.error('Failed to fetch satellites:', error);
    }
  };

  const updateInfoWindow = () => {
    const winId = 'sat-data-window';
    const container = map.getContainer();
    let win = container.querySelector(`#${winId}`);

    if (!selectedSats || selectedSats.length === 0) {
      if (win) win.remove();
      return;
    }

    if (!win) {
      win = document.createElement('div');
      win.id = winId;
      win.className = 'sat-data-window leaflet-bar';
      Object.assign(win.style, {
        position: 'absolute',
        width: '260px',
        backgroundColor: 'rgba(0, 15, 15, 0.95)',
        color: '#00ffff',
        borderRadius: '4px',
        border: '1px solid #00ffff',
        zIndex: '1000',
        fontFamily: 'monospace',
        pointerEvents: 'auto',
        boxShadow: '0 0 15px rgba(0,0,0,0.7)',
        cursor: 'default',
        overflow: 'hidden',
      });
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
        const x = rect.right - e.clientX;
        const y = e.clientY - rect.top;
        win.style.right = `${x - 10}px`;
        win.style.top = `${y - 10}px`;
      };

      window.onmouseup = () => {
        if (isDragging) {
          isDragging = false;
          win.style.cursor = 'default';
          if (map.dragging) map.dragging.enable();
          setWinPos({
            top: parseInt(win.style.top),
            right: parseInt(win.style.right),
          });
        }
      };
    }

    win.style.top = `${winPos.top}px`;
    win.style.right = `${winPos.right}px`;

    const activeSats = satellites.filter((s) => selectedSats.includes(s.name));

    // Expose minimize toggle so the inline onclick can reach it
    window.__satWinToggleMinimize = () => setWinMinimized((prev) => !prev);

    const titleBar = `
      <div style="display:flex; justify-content:space-between; align-items:center;
                  padding: 8px 10px; border-bottom: 1px solid #004444; background: rgba(0,40,40,0.6);">
        <span style="font-size:11px; color:#00ffff; letter-spacing:0.05em;">
          🛰 ${activeSats.length} SAT${activeSats.length !== 1 ? 'S' : ''}
        </span>
        <button onclick="window.__satWinToggleMinimize()"
                title="${winMinimized ? 'Expand' : 'Minimize'}"
                style="background:none; border:1px solid #004444; color:#00cccc; cursor:pointer;
                       font-size:13px; line-height:1; padding:1px 6px; border-radius:3px;">
          ${winMinimized ? '▲' : '▼'}
        </button>
      </div>
    `;

    if (winMinimized) {
      win.style.maxHeight = '';
      win.style.overflowY = 'hidden';
      win.innerHTML = titleBar;
      return;
    }

    win.style.maxHeight = 'calc(100% - 80px)';
    win.style.overflowY = 'auto';

    const clearAllBtn = `
      <div style="margin: 10px 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 5px;">
        <button onclick="sessionStorage.removeItem('selected_satellites'); window.location.reload();"
                style="background: #440000; border: 1px solid #ff4444; color: #ff4444; cursor: pointer;
                       padding: 4px 10px; font-size: 10px; border-radius: 3px; font-weight: bold; width: 100%;">
          CLEAR ALL FOOTPRINTS
        </button>
        <span style="font-size: 9px; color: #888;">Ctrl + Drag to move</span>
      </div>
    `;

    win.innerHTML =
      titleBar +
      clearAllBtn +
      `<div style="padding: 0 12px 8px;">` +
      activeSats
        .map((sat) => {
          const isVisible = sat.visible === true;
          const isImp = units === 'imperial';
          const conv = isImp ? 0.621371 : 1;
          const distUnit = isImp ? ' mi' : ' km';

          return `
        <div class="sat-card" style="border-bottom: 1px solid #004444; margin-bottom: 10px; padding-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color:#ffffff; font-size: 14px;">${sat.name}</strong>
            <button onclick="window.toggleSat('${sat.name}')" 
                    style="background:none; border:none; color:#ff4444; cursor:pointer; font-weight:bold; font-size:20px; padding: 0 5px;">✕</button>
          </div>
          <table style="width:100%; font-size:11px; border-collapse: collapse;">
            <tr><td style="color:#888;">Az/El:</td><td align="right">${Math.round(sat.azimuth)}° / ${Math.round(sat.elevation)}°</td></tr>
            <tr><td style="color:#888;">Range:</td><td align="right">${Math.round(sat.range * conv).toLocaleString()}${distUnit}</td></tr>
            <tr><td style="color:#888;">Mode:</td><td align="right" style="color:#ffa500;">${sat.mode || 'N/A'}</td></tr>
            <tr><td style="color:#888;">Status:</td>
                <td align="right" class="${isVisible ? 'sat-visible-blink' : ''}">
                  ${isVisible ? 'Visible' : '<span style="color:#666;">Below Horiz</span>'}
                </td>
            </tr>
          </table>
        </div>
      `;
        })
        .join('') +
      `</div>`;
  };

  const renderSatellites = () => {
    if (!layerGroupRef.current || !map) return;
    layerGroupRef.current.clearLayers();
    if (!satellites || satellites.length === 0) return;

    const globalOpacity = opacity !== undefined ? opacity : 1.0;

    satellites.forEach((sat) => {
      const isSelected = selectedSats.includes(sat.name);

      if (isSelected && config?.showFootprints !== false && sat.alt) {
        const EARTH_RADIUS = 6371;
        const centralAngle = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + sat.alt));
        const footprintRadiusMeters = centralAngle * EARTH_RADIUS * 1000;
        const footColor = sat.visible === true ? '#00ff00' : '#00ffff';

        replicatePoint(sat.lat, sat.lon).forEach((pos) => {
          window.L.circle(pos, {
            radius: footprintRadiusMeters,
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
        const pathCoords = sat.track.map((p) => [p[0], p[1]]);
        replicatePath(pathCoords).forEach((coords) => {
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
          const leadCoords = sat.leadTrack.map((p) => [p[0], p[1]]);
          replicatePath(leadCoords).forEach((lCoords) => {
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
