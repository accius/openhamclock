import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as satellite from 'satellite.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
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

export const useLayer = ({ map, enabled, satellites, setSatellites, opacity, config, allUnits }) => {
  const layerGroupRef = useRef(null);
  const { t } = useTranslation();

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
        latitude: satellite.degreesToRadians(config?.lat ?? 0.0),
        longitude: satellite.degreesToRadians(config?.lon ?? 0.0),
        height: (config?.stationAlt ?? 100) / 1000, // above sea level [km], stationAlt is [m], defaults to 100m
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
            isVisible = el >= (config?.satellite?.minElev ?? 5.0); // visible only if above minimum elevation
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
        backgroundColor: 'var(--bg-primary)',
        color: 'rgba(0, 255, 255, 1)',
        borderRadius: '4px',
        border: '1px solid rgba(0, 255, 255, 1)',
        zIndex: '1000',
        fontFamily: 'monospace',
        pointerEvents: 'auto',
        boxShadow: '0 0 15px rgba(0, 0, 0, 0.7)',
        cursor: 'default',
        overflow: 'hidden',
      });
      container.appendChild(win);

      let isDragging = false;

      // This panel predates the shared Leaflet control widgets and is positioned
      // relative to the map container using top/right, so it keeps its own drag
      // logic instead of makeDraggable()'s fixed-position viewport model.
      win.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (!e.target.closest('.sat-data-window-title')) return;
        if (e.target.closest('button')) return;
        isDragging = true;
        win.style.cursor = 'move';
        if (map.dragging) map.dragging.disable();
        e.preventDefault();
        e.stopPropagation();
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
      <div class="sat-data-window-title" style="display:flex; justify-content:space-between; align-items:center;
                  cursor:grab; user-select:none;
                  padding: 8px 10px; border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary);">
        <span data-drag-handle="true" style="font-family: 'JetBrains Mono', monospace; font-size:13px; font-weight:700; color: var(--accent-blue); letter-spacing:0.05em;">
          🛰 ${activeSats.length} ${activeSats.length !== 1 ? t('station.settings.satellites.name_plural') : t('station.settings.satellites.name')}
        </span>
        <button class="sat-data-window-minimize"
                onclick="window.__satWinToggleMinimize()"
                title="${winMinimized ? 'Expand' : 'Minimize'}"
          style="background:none; border:none; color: var(--text-secondary); cursor:pointer;
                       font-size:10px; line-height:1; padding:2px 4px; margin:0;">
          ${winMinimized ? '▶' : '▼'}
        </button>
      </div>
    `;

    if (winMinimized) {
      win.style.maxHeight = '';
      win.style.overflowY = 'hidden';
      win.innerHTML = `${titleBar}<div class="sat-data-window-content"></div>`;
      addMinimizeToggle(win, 'sat-data-window', {
        contentClassName: 'sat-data-window-content',
        buttonClassName: 'sat-data-window-minimize',
        getIsMinimized: () => winMinimized,
        onToggle: setWinMinimized,
        persist: false,
        manageButtonEvents: false,
      });
      return;
    }

    win.style.maxHeight = 'calc(100% - 80px)';
    win.style.overflowY = 'auto';

    const clearAllBtn = `
      <div style="margin: 10px 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 5px;">
        <button onclick="sessionStorage.removeItem('selected_satellites'); window.location.reload();"
          style="background: var(--bg-primary); border: 1px solid var(--accent-red); color: var(--accent-red); cursor: pointer;
                       padding: 4px 10px; font-size: 10px; border-radius: 3px; font-weight: bold; width: 100%;">
          ${t('station.settings.satellites.clearFootprints')}
        </button>
        <span style="font-size: 9px; color: var(--text-muted);">${t('station.settings.satellites.dragTitle')}</span>
      </div>
    `;

    win.innerHTML =
      titleBar +
      `<div class="sat-data-window-content">` +
      clearAllBtn +
      `<div style="padding: 0 12px 8px;">` +
      activeSats
        .map((sat) => {
          const isVisible = sat.isVisible === true;

          const isMetric = allUnits.dist === 'metric';
          const distanceUnitsStr = isMetric ? 'km' : 'miles';
          const speedUnitsStr = isMetric ? 'km/h' : 'mph';
          const rangeRateUnitsStr = isMetric ? 'km/s' : 'miles/s';
          const km_to_miles_factor = 0.621371;

          let speed = Math.round((sat.speedKmH || 0) * (isMetric ? 1 : km_to_miles_factor));
          let speedStr = `${speed.toLocaleString()} ${speedUnitsStr}`;
          speedStr = `${sat.speedKmH ? speedStr : 'N/A'}`;

          let altitude = Math.round(sat.alt * (isMetric ? 1 : km_to_miles_factor));
          let altitudeStr = `${altitude.toLocaleString()} ${distanceUnitsStr}`;

          return `
        <div class="sat-card" style="border-bottom: 1px solid rgba(0, 68, 68, 1); margin-bottom: 10px; padding-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color: var(--text-primary); font-size: 14px;">${sat.name}</strong>
            <button onclick="window.toggleSat('${sat.name}')" 
                    style="background:none; border:none; color: var(--accent-red); cursor:pointer; font-weight:bold; font-size:20px; padding: 0 5px;">✕</button>
          </div>
          <table style="width:100%; font-size:11px; border-collapse: collapse;">

            <!-- section 1: satellite position and motion -->
            <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.latitude')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.lat.toFixed(2)}°</td>
            </tr>
            <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.longitude')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.lon.toFixed(2)}°</td>
            </tr>
            <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.altitude')}:</td>
              <td align="right" style="padding: 0 2px;">${altitudeStr}</td>
            </tr>
            <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.speed')}:</td>
              <td align="right" style="padding: 0 2px;">${speedStr}</td>
            </tr>

            <!-- section 2: relative location and visibility -->
            <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
              <td style="padding: 0 2px;">${t('station.settings.satellites.azimuth_elevation')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.azimuth}° / ${sat.elevation}°</td>
            </tr>

            ${
              isVisible
                ? `
              <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.range')}:</td>
                <td align="right" style="padding: 0 2px;">${(sat.range * (isMetric ? 1 : km_to_miles_factor)).toFixed(0)} ${distanceUnitsStr}</td>
              </tr>
              <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.rangeRate')}:</td>
                <td align="right" style="padding: 0 2px;">${(sat.rangeRate * (isMetric ? 1 : km_to_miles_factor)).toFixed(2)} ${rangeRateUnitsStr}</td>
              </tr>
              <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.dopplerFactor')}:</td>
                <td align="right" style="padding: 0 2px;">${sat.dopplerFactor.toFixed(7)}</td>
              </tr>
            `
                : ``
            }

            <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
              <td style="padding: 0 2px;">${t('station.settings.satellites.status')}:</td>
              <td align="right" style="padding: 0 2px;">${isVisible ? `${t('station.settings.satellites.visible')}` : `${t('station.settings.satellites.belowHorizon')}`}</td>
            </tr>

            <!-- section 3: miscellaneous satellite information -->
            <tr style="background-color: var(--bg-secondary); color: var(--text-muted);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.mode')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.mode || 'N/A'}</td>
            </tr>
            ${sat.downlink ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.downlink')}:</td><td align="right" style="padding: 0 2px;">${sat.downlink}</td></tr>` : ''}
            ${sat.uplink ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.uplink')}:</td><td align="right" style="padding: 0 2px;">${sat.uplink}</td></tr>` : ''}
            ${sat.tone ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.tone')}:</td><td align="right" style="padding: 0 2px;">${sat.tone}</td></tr>` : ''}

            </table>

            ${sat.notes ? `<div style="font-size:9px; color: var(--text-muted); margin-top:4px; font-style:italic;">${sat.notes}</div>` : ''}
        </div>
      `;
        })
        .join('') +
      `</div></div>`;

    addMinimizeToggle(win, 'sat-data-window', {
      contentClassName: 'sat-data-window-content',
      buttonClassName: 'sat-data-window-minimize',
      getIsMinimized: () => winMinimized,
      onToggle: setWinMinimized,
      persist: false,
      manageButtonEvents: false,
    });
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
        const footColor = sat.isVisible === true ? 'rgba(0, 255, 0, 1)' : 'rgba(0, 255, 255, 1)';

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
                color: 'rgba(0, 255, 255, 1)',
                weight: 6,
                opacity: fade * 0.3 * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
              window.L.polyline([coords[i], coords[i + 1]], {
                color: 'rgba(255, 255, 255, 1)',
                weight: 2,
                opacity: fade * globalOpacity,
                lineCap: 'round',
                interactive: false,
              }).addTo(layerGroupRef.current);
            }
          } else {
            window.L.polyline(coords, {
              color: 'rgba(0, 255, 255, 1)',
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
              color: 'rgba(255, 255, 0, 1)',
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
                     <div style="font-size:${isSelected ? '32px' : '22px'}; filter:${isSelected ? 'drop-shadow(0 0 10px rgba(0, 255, 255, 1))' : 'none'}; cursor: pointer;">🛰</div>
                     <div class="sat-label" style="${isSelected ? 'color: rgba(255, 255, 255, 1); font-weight: bold;' : ''}">${sat.name}</div>
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
  }, [satellites, selectedSats, allUnits, opacity, config, winMinimized]);

  return null;
};
