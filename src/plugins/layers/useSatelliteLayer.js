import { useEffect, useRef, useState } from 'react';
import * as satellite from 'satellite.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';
import satConfig from '../../satellites/satconfig.json';
export const metadata = {
  id: 'satellites',
  name: 'Satellite Tracks',
  description: 'Real-time satellite positions with telemetry and blinking status',
  icon: '🛰',
  category: 'satellites',
  defaultEnabled: true,
  defaultOpacity: 1.0,
  config: {
    leadTimeMins: 20,
    tailTimeMins: 45,
    showTracks: true,
    showFootprints: true,
  },
};

export const useLayer = ({ map, enabled, opacity, config, units }) => {
  const layerGroupRef = useRef(null);
  const [satellites, setSatellites] = useState([]);

  const [selectedSats, setSelectedSats] = useState(() => {
    const saved = sessionStorage.getItem('selected_satellites');
    return saved ? JSON.parse(saved) : [];
  });
  const [winPos, setWinPos] = useState({ top: 50, right: 10 });
  const [winMinimized, setWinMinimized] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('selected_satellites', JSON.stringify(selectedSats));
  }, [selectedSats]);

  const toggleSatellite = (name) => {
    setSelectedSats((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const clearAllSats = () => setSelectedSats([]);

  useEffect(() => {
    window.toggleSat = (name) => toggleSatellite(name);
    window.clearAllSats = () => clearAllSats();
    return () => {
      delete window.toggleSat;
      delete window.clearAllSats;
    };
  }, []);

  useEffect(() => {
    const styleId = 'sat-layer-ui-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes satGreenBlink { 0% { opacity: 1; color: #00ff00; } 50% { opacity: 0.3; color: #004400; } 100% { opacity: 1; color: #00ff00; } }
        .sat-visible-blink { animation: satGreenBlink 1s infinite !important; font-weight: bold; text-shadow: 0 0 4px rgba(0,255,0,0.5); }
        
        .sat-data-window {
          position: absolute;
          z-index: 9999 !important;
          background: rgba(10, 10, 10, 0.45) !important;
          backdrop-filter: blur(8px);
          border: 1px solid rgba(0, 255, 255, 0.3);
          border-radius: 4px;
          padding: 6px 8px;
          color: white;
          font-family: 'JetBrains Mono', monospace;
          min-width: 140px;
          max-width: 155px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.7);
          pointer-events: auto;
        }
        
        .sat-mini-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
        .sat-mini-table td { padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .sat-label-cell { color: #00ffff; }
        .sat-val { text-align: right; color: #fff; }

        .sat-clear-btn {
          width: 100%;
          background: rgba(255, 68, 68, 0.1);
          border: 1px solid #ff4444;
          color: #ff4444;
          cursor: pointer;
          padding: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          font-weight: bold;
          border-radius: 2px;
          text-transform: uppercase;
          margin-top: 5px;
        }
        .sat-label { color: #00ffff; font-size: 10px; font-weight: bold; text-shadow: 1px 1px 2px black; white-space: nowrap; margin-top: 2px; }
      `;
      document.head.appendChild(style);
    }
    return () => document.getElementById(styleId)?.remove();
  }, []);
  const fetchSatellites = async () => {
    try {
      const tleResponse = await fetch('/api/satellites/tle');
      const tleData = await tleResponse.json();
      const observerGd = {
        latitude: satellite.degreesToRadians(config?.lat || 43.44),
        longitude: satellite.degreesToRadians(config?.lon || -88.63),
        height: (config?.alt || 260) / 1000,
      };

      const satArray = Object.keys(tleData)
        .map((tleName) => {
          try {
            const satData = tleData[tleName];
            const cleanTleName = tleName.trim();

            // 1. NORAD ID — server puts it directly on the object as satData.norad
            //    Fall back to parsing tle1 if needed as server.js outputs
            const noradInt = satData.norad
              ? parseInt(satData.norad, 10)
              : satData.tle1
                ? parseInt(satData.tle1.substring(2, 7).trim(), 10)
                : NaN;
            const noradStr = isNaN(noradInt) ? '' : String(noradInt);

            // 2. Lookup in satconfig.json by NORAD ID
            let extra = noradStr ? satConfig[noradStr] || null : null;

            // 3. Fallback: name match — skip non-object section header keys
            if (!extra) {
              extra =
                Object.values(satConfig).find(
                  (s) => s && typeof s === 'object' && s.name && s.name.toUpperCase() === cleanTleName.toUpperCase(),
                ) || null;
              if (!extra) {
                console.warn('[SAT] No config match — TLE name: "' + cleanTleName + '", NORAD: ' + noradStr);
              }
              extra = extra || {};
            }

            const displayName = extra.name || cleanTleName;
            let isVisible = false,
              az = 0,
              el = 0,
              range = 0,
              alt = 0,
              lat = 0,
              lon = 0,
              speedKmh = 0;
            const leadTrack = [];
            const track = [];

            if (satData.tle1 && satData.tle2) {
              try {
                const satrec = satellite.twoline2satrec(satData.tle1, satData.tle2);
                const now = new Date();
                const pAndV = satellite.propagate(satrec, now);
                const gmst = satellite.gstime(now);

                if (pAndV.position) {
                  const posGd = satellite.eciToGeodetic(pAndV.position, gmst);
                  const posEcf = satellite.eciToEcf(pAndV.position, gmst);
                  const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);

                  az = satellite.radiansToDegrees(lookAngles.azimuth);
                  el = satellite.radiansToDegrees(lookAngles.elevation);
                  range = lookAngles.rangeSat;
                  isVisible = el > 0;

                  // FIX: Use radiansToDegrees (NOT degreesLat/Long)
                  lat = satellite.radiansToDegrees(posGd.latitude);
                  lon = satellite.radiansToDegrees(posGd.longitude);
                  alt = posGd.height;

                  // Speed from ECI velocity vector (km/s → km/h)
                  if (pAndV.velocity) {
                    const v = pAndV.velocity;
                    const speedKms = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                    speedKmh = speedKms * 3600;
                  }
                }

                const minutes = config?.leadTimeMins || 20;
                for (let i = 0; i <= minutes; i += 2) {
                  const futureTime = new Date(now.getTime() + i * 60000);
                  const propagation = satellite.propagate(satrec, futureTime);
                  if (propagation.position) {
                    const geodetic = satellite.eciToGeodetic(propagation.position, satellite.gstime(futureTime));
                    leadTrack.push([
                      satellite.radiansToDegrees(geodetic.latitude),
                      satellite.radiansToDegrees(geodetic.longitude),
                    ]);
                  }
                }
                // Tail track — past positions (glowing trail)
                const tailMins = config?.tailTimeMins || 45;
                for (let i = tailMins; i >= 0; i -= 2) {
                  const pastTime = new Date(now.getTime() - i * 60000);
                  const propagation = satellite.propagate(satrec, pastTime);
                  if (propagation.position) {
                    const geodetic = satellite.eciToGeodetic(propagation.position, satellite.gstime(pastTime));
                    track.push([
                      satellite.radiansToDegrees(geodetic.latitude),
                      satellite.radiansToDegrees(geodetic.longitude),
                    ]);
                  }
                }
              } catch (e) {
                /* bad TLE — skip silently */
              }
            }

            // Build clean object — explicit fields last so they always win over spreads
            const satObj = {
              ...satData,
              ...extra,
              name: displayName,
              // Ensure lat/lon/alt are always numbers
              lat: typeof lat === 'number' ? lat : 0,
              lon: typeof lon === 'number' ? lon : 0,
              alt: typeof alt === 'number' ? alt : 0,
              visible: isVisible,
              azimuth: typeof az === 'number' ? az : 0,
              elevation: typeof el === 'number' ? el : 0,
              range,
              speedKmh,
              leadTrack,
              track,
              // Radio fields — always strings, never undefined
              mode: extra.mode || satData.mode || 'N/A',
              frequency: String(extra.frequency || satData.frequency || ''),
              downlink: String(extra.downlink || satData.downlink || ''),
              uplink: String(extra.uplink || satData.uplink || ''),
              tone: String(extra.tone || satData.tone || ''),
              armTone: String(extra.armTone || satData.armTone || ''),
              hrptFrequency: String(extra.hrptFrequency || satData.hrptFrequency || ''),
              grbFrequency: String(extra.grbFrequency || satData.grbFrequency || ''),
              sdFrequency: String(extra.sdFrequency || satData.sdFrequency || ''),
            };
            return satObj;
          } catch (mapErr) {
            return null;
          }
        })
        .filter(Boolean);

      setSatellites(satArray);
    } catch (error) {
      console.error('Critical layer error:', error);
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
        <span style="font-size:9px; color:#00ffff; font-weight:bold;">🛰 ${activeSats.length} SATS</span>
        <button onclick="window.__satWinToggleMinimize()" style="background:none; border:none; color:#00ffff; cursor:pointer; font-size:12px;">${winMinimized ? '▲' : '▼'}</button>
      </div>
    `;

    if (!winMinimized) {
      html += `<button class="sat-clear-btn" onclick="window.clearAllSats()">Clear All</button>`;
      activeSats.forEach((sat) => {
        const conv = units === 'imperial' ? 0.621371 : 1;
        const distUnit = units === 'imperial' ? ' mi' : ' km';

        // Only render a table row if the value is a non-empty primitive
        const row = (label, val) => {
          if (val === null || val === undefined || typeof val === 'function' || typeof val === 'object') return '';
          const v = String(val).trim();
          if (!v) return '';
          return `<tr><td class="sat-label-cell">${label}</td><td class="sat-val">${v}</td></tr>`;
        };
        // Guard lat/lon in case something slipped through
        const safeLat = typeof sat.lat === 'number' ? sat.lat : 0;
        const safeLon = typeof sat.lon === 'number' ? sat.lon : 0;
        const safeAlt = typeof sat.alt === 'number' ? sat.alt : 0;
        const safeAz = typeof sat.azimuth === 'number' ? sat.azimuth : 0;
        const safeEl = typeof sat.elevation === 'number' ? sat.elevation : 0;

        html += `
          <div style="margin-bottom:8px; border-bottom: 1px solid rgba(0,255,255,0.1); padding-bottom:5px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:#00ffff; font-size: 11px;">${sat.name}</strong>
              <span style="color:#ff4444; cursor:pointer; font-weight:bold; font-size:14px;" onclick="window.toggleSat('${sat.name}')">✕</span>
            </div>
            <table class="sat-mini-table">
              <tr><td class="sat-label-cell">Lat</td><td class="sat-val">${safeLat.toFixed(2)}°</td></tr>
              <tr><td class="sat-label-cell">Lon</td><td class="sat-val">${safeLon.toFixed(2)}°</td></tr>
              <tr><td class="sat-label-cell">Speed</td><td class="sat-val">${sat.speedKmh ? Math.round(sat.speedKmh).toLocaleString() + ' km/h / ' + Math.round(sat.speedKmh * 0.621371).toLocaleString() + ' mph' : 'N/A'}</td></tr>
              <tr><td class="sat-label-cell">Alt</td><td class="sat-val">${Math.round(safeAlt * conv)}${distUnit}</td></tr>
              <tr><td class="sat-label-cell">Az/El</td><td class="sat-val">${Math.round(safeAz)}° / ${Math.round(safeEl)}°</td></tr>
              ${row('Mode', sat.mode)}
              ${row('Freq', sat.frequency)}
              ${row('HRPT', sat.hrptFrequency)}
              ${row('Downlink', sat.downlink)}
              ${row('Uplink', sat.uplink)}
              ${row('Tone', sat.tone)}
              ${row('Arm Tone', sat.armTone)}
              ${row('GRB Freq', sat.grbFrequency)}
              ${row('SD Freq', sat.sdFrequency)}
              <tr><td class="sat-label-cell">Status</td><td class="sat-val ${sat.visible ? 'sat-visible-blink' : ''}">
                ${sat.visible ? 'VISIBLE' : '<span style="color:#888;">Below Horizon</span>'}
              </td></tr>
            </table>
          </div>
        `;
      });
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
            for (let i = 0; i < lCoords.length - 1; i++) {
              // Fade out as we go further into the future (1 = near satellite, 0 = far ahead)
              const fade = 1 - i / lCoords.length;
              // Wide fuzzy red glow
              window.L.polyline([lCoords[i], lCoords[i + 1]], {
                color: '#ff2200',
                weight: 6,
                opacity: fade * 0.25 * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
              // Thin bright red core
              window.L.polyline([lCoords[i], lCoords[i + 1]], {
                color: '#ff6644',
                weight: 1.5,
                opacity: fade * 0.6 * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
            }
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
