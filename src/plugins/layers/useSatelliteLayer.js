import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';
import Orbit from '../../utils/orbit.js';
import dayjs from 'dayjs';
import useAppConfig from '../../hooks/app/useAppConfig.js';

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
  const { config: globalConfig } = useAppConfig();

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

      const satArray = Object.keys(data).map((name) => {
        const satData = data[name];

        return {
          ...satData,
          name,
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
        color: 'rgba(0, 255, 255, 1)',
        borderRadius: '4px',
        border: '1px solid rgba(0, 255, 255, 1)',
        zIndex: '1000',
        fontFamily: 'monospace',
        pointerEvents: 'auto',
        boxShadow: '0 0 15px rgba(0,0,0,0.7)',
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

      // Prevent map from capturing events on the window
      win.addEventListener('wheel', (e) => {
        e.stopPropagation();
      });
      win.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      win.addEventListener('mousemove', (e) => {
        e.stopPropagation();
      });
      win.addEventListener('mouseup', (e) => {
        e.stopPropagation();
      });
    }

    win.style.top = `${winPos.top}px`;
    win.style.right = `${winPos.right}px`;

    const activeSats = satellites.filter((s) => selectedSats.includes(s.name));

    // Expose minimize toggle so the inline onclick can reach it
    window.__satWinToggleMinimize = () => setWinMinimized((prev) => !prev);

    const titleBar = `
      <div class="sat-data-window-title" style="display:flex; justify-content:space-between; align-items:center;
                  cursor:grab; user-select:none;
                  padding: 8px 10px; border-bottom: 1px solid rgba(0, 68, 68, 1); background: rgba(0,40,40,0.6);">
        <span data-drag-handle="true" style="font-family: 'JetBrains Mono', monospace; font-size:13px; font-weight:700; color: rgba(0, 187, 255, 1); letter-spacing:0.05em;">
          🛰 ${activeSats.length} ${activeSats.length !== 1 ? t('station.settings.satellites.name_plural') : t('station.settings.satellites.name')}
        </span>
        <button class="sat-data-window-minimize"
                onclick="window.__satWinToggleMinimize()"
                title="${winMinimized ? 'Expand' : 'Minimize'}"
                style="background:none; border:none; color: rgba(136, 136, 136, 1); cursor:pointer;
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
                style="background: rgba(68, 0, 0, 1); border: 1px solid rgba(255, 68, 68, 1); color: rgba(255, 68, 68, 1); cursor: pointer;
                       padding: 4px 10px; font-size: 10px; border-radius: 3px; font-weight: bold; width: 100%;">
          ${t('station.settings.satellites.clearFootprints')}
        </button>
        <span style="font-size: 9px; color: rgba(136, 136, 136, 1);">${t('station.settings.satellites.dragTitle')}</span>
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
            <button onclick="openSatellitePredict('${sat.name}', '${sat.tle1}', '${sat.tle2}')"
                    style="background: rgba(68, 0, 0, 1); border: 1px solid rgba(255, 68, 68, 1); padding: 3px 3px; border-radius: 3px; cursor: pointer;">
              <strong style="color: rgba(255, 255, 255, 1); font-size: 14px;">${sat.name}</strong>
            </button>
            <button onclick="window.toggleSat('${sat.name}')" 
                    style="background:none; border:none; color: rgba(255, 68, 68, 1); cursor:pointer; font-weight:bold; font-size:20px; padding: 0 5px;">✕</button>
          </div>
          <table style="width:100%; font-size:11px; border-collapse: collapse;">

            <!-- section 1: satellite position and motion -->
            <tr style="background-color: rgba(48, 33, 21, .8);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.latitude')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.lat.toFixed(2)}°</td>
            </tr>
            <tr style="background-color: rgba(48, 33, 21, .8);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.longitude')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.lon.toFixed(2)}°</td>
            </tr>
            <tr style="background-color: rgba(48, 33, 21, .8);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.altitude')}:</td>
              <td align="right" style="padding: 0 2px;">${altitudeStr}</td>
            </tr>
            <tr style="background-color: rgba(48, 33, 21, .8);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.speed')}:</td>
              <td align="right" style="padding: 0 2px;">${speedStr}</td>
            </tr>

            <!-- section 2: relative location and visibility -->
            <tr style="background-color: ${isVisible ? 'rgba(0, 248, 0, .5)' : 'rgba(37, 46, 23, .8)'}; color: ${isVisible ? 'rgba(0, 0, 0, 1)' : 'rgba(136, 136, 136, 1)'};">
              <td style="padding: 0 2px;">${t('station.settings.satellites.azimuth_elevation')}:</td>
              <td align="right" style="padding: 0 2px;">${sat.azimuth}° / ${sat.elevation}°</td>
            </tr>

            ${
              isVisible
                ? `
              <tr style="background-color: ${isVisible ? 'rgba(0, 248, 0, .5)' : 'rgba(37, 46, 23, .8)'}; color: ${isVisible ? 'rgba(0, 0, 0, 1)' : 'rgba(136, 136, 136, 1)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.range')}:</td>
                <td align="right" style="padding: 0 2px;">${(sat.range * (isMetric ? 1 : km_to_miles_factor)).toFixed(0)} ${distanceUnitsStr}</td>
              </tr>
              <tr style="background-color: ${isVisible ? 'rgba(0, 248, 0, .5)' : 'rgba(37, 46, 23, .8)'}; color: ${isVisible ? 'rgba(0, 0, 0, 1)' : 'rgba(136, 136, 136, 1)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.rangeRate')}:</td>
                <td align="right" style="padding: 0 2px;">${(sat.rangeRate * (isMetric ? 1 : km_to_miles_factor)).toFixed(2)} ${rangeRateUnitsStr}</td>
              </tr>
              <tr style="background-color: ${isVisible ? 'rgba(0, 248, 0, .5)' : 'rgba(37, 46, 23, .8)'}; color: ${isVisible ? 'rgba(0, 0, 0, 1)' : 'rgba(136, 136, 136, 1)'};">
                <td style="padding: 0 2px;">${t('station.settings.satellites.dopplerFactor')}:</td>
                <td align="right" style="padding: 0 2px;">${sat.dopplerFactor.toFixed(7)}</td>
              </tr>
            `
                : ``
            }

            <tr style="background-color: ${isVisible ? 'rgba(0, 248, 0, .5)' : 'rgba(37, 46, 23, .8)'}; color: ${isVisible ? 'rgba(0, 0, 0, 1)' : 'rgba(136, 136, 136, 1)'};">
              <td style="padding: 0 2px;">${t('station.settings.satellites.status')}:</td>
              <td align="right" style="padding: 0 2px;">${isVisible ? `${t('station.settings.satellites.visible')}` : `${t('station.settings.satellites.belowHorizon')}`}</td>
            </tr>

            <!-- section 3: miscellaneous satellite information -->
            <tr style="background-color: rgba(35, 59, 70, .8); color: rgba(136, 136, 136, 1);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.mode')}:</td>
              <td align="right" style="color: rgba(255, 170, 0, 1); padding: 0 2px;">${sat.mode || 'N/A'}</td>
            </tr>
            ${sat.downlink ? `<tr style="background-color: rgba(35, 59, 70, .8); color: rgba(136, 136, 136, 1);"><td style="padding: 0 2px;">${t('station.settings.satellites.downlink')}:</td><td align="right" style="color: rgba(0, 255, 204, 1); padding: 0 2px;">${sat.downlink}</td></tr>` : ''}
            ${sat.uplink ? `<tr style="background-color: rgba(35, 59, 70, .8); color: rgba(136, 136, 136, 1);"><td>${t('station.settings.satellites.uplink')}:</td><td align="right" style="color: rgba(255, 204, 0, 1);">${sat.uplink}</td></tr>` : ''}
            ${sat.tone ? `<tr style="background-color: rgba(35, 59, 70, .8); color: rgba(136, 136, 136, 1);"><td>${t('station.settings.satellites.tone')}:</td><td align="right">${sat.tone}</td></tr>` : ''}

            </table>

            ${sat.notes ? `<div style="font-size:9px; color: rgba(102, 102, 102, 1); margin-top:4px; font-style:italic;">${sat.notes}</div>` : ''}
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

  /********************************************************************************************/
  // Expose satellite prediction panel function
  useEffect(() => {
    window.openSatellitePredict = (satName, tle1, tle2) => {
      if (!satName || !satellites) return;

      // Find the satellite data
      const sat = satellites.find((s) => s.name === satName);
      if (!sat) {
        alert(`Satellite ${satName} not found`);
        return;
      }

      const orbit = new Orbit(sat.name, `${sat.name}\n${tle1}\n${tle2}`);
      orbit.error && console.warn('Satellite orbit error:', orbit.error);

      const groundStation = {
        latitude: globalConfig.location.lat,
        longitude: globalConfig.location.lon,
        height: globalConfig.location.stationAlt, // above sea level [m]
      };

      const startDate = dayjs().toDate(); // from now
      const endDate = dayjs(startDate).add(7, 'day').toDate(); // until 7 days from now
      const minElevation = globalConfig.satellite.minElev;
      const maxPasses = 25;
      const passes = orbit.computePassesElevation(groundStation, startDate, endDate, minElevation, maxPasses);

      // Function to generate modal content
      const generateModalContent = (currentPasses) => {
        return `
          <div style="text-align: center; margin-bottom: 16px; border-bottom: 2px solid var(--accent-red); padding-bottom: 12px;">
            <h2 style="margin: 0; color: var(--accent-red); font-size: 24px;">🛰 ${satName}</h2>
            <p style="margin: 8px 0 0 0; color: var(--text-muted); font-size: 12px;">Satellite Prediction Details</p>
          </div>

          <div style="margin-top: 16px;">
            <h3 style="margin: 0 0 8px 0; color: var(--accent-red); font-size: 18px;">Upcoming Passes</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid var(--text-muted);">
              <thead>
                <tr style="background: rgba(0,0,0,0.3); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">Start</th>
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">Apex</th>
                  <th colspan="2" style="border-right: 3px double var(--text-muted); padding: 4px;">End</th>
                  <th style="padding: 4px;">Duration</th>
                </tr>
                <tr style="background: rgba(0,0,0,0.3); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Time</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">From Now</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">Az [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Time</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Az [°]</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">El [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Time</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">Az [°]</th>
                  <th style="padding: 4px;">[mins]</th>
                </tr>
              </thead>
              <tbody>
                ${currentPasses
                  .map((pass) => {
                    const azimuthStart = pass.azimuthStart.toFixed(0);
                    const azimuthApex = pass.azimuthApex.toFixed(0);
                    const azimuthEnd = pass.azimuthEnd.toFixed(0);
                    const maxElevation = pass.maxElevation.toFixed(0);
                    const durationMins = (pass.duration / 60000).toFixed(1);
                    const startTime = dayjs(pass.start).format('YYYY-MM-DD HH:mm:ss');
                    const apexTime = dayjs(pass.apex).format('YYYY-MM-DD HH:mm:ss');
                    const endTime = dayjs(pass.end).format('YYYY-MM-DD HH:mm:ss');
                    const secsFromNow = dayjs(pass.start).diff(dayjs(), 'second');

                    const isActive = secsFromNow <= 0 && dayjs().isBefore(dayjs(pass.end));
                    const isPast = secsFromNow <= 0 && dayjs().isAfter(dayjs(pass.end));

                    if (isPast) {
                      return ``; // skip past passes
                    }

                    const timeFromNow = isActive
                      ? 'ACTIVE'
                      : secsFromNow > 3600
                        ? `${String(Math.floor(secsFromNow / 3600)).padStart(2, '0')}:${String(Math.floor((secsFromNow % 3600) / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                        : secsFromNow > 60
                          ? `00:${String(Math.floor(secsFromNow / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                          : `00:00:${String(secsFromNow).padStart(2, '0')}`;

                    return `<tr style="background: rgba(0,0,0,0.1); text-align: center; border-bottom: 1px solid var(--text-muted);">
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${startTime}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${timeFromNow}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${azimuthStart}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${apexTime}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${azimuthApex}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${maxElevation}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${endTime}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${azimuthEnd}</td>
                    <td style="padding: 4px;">${durationMins}</td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>

          <div style="text-align: center; margin-top: 16px;">
            <button onclick="document.getElementById('${modalId}').remove(); clearInterval(window.satellitePredictInterval);" style="
              background: var(--accent-cyan);
              border: 1px solid var(--accent-cyan);
              color: var(--bg-primary);
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-weight: bold;
              font-size: 12px;
            ">
              Close
            </button>
          </div>
        `;
      };

      // Create a modal overlay
      const modalId = 'satellite-predict-modal';
      let modal = document.getElementById(modalId);

      if (modal) {
        modal.remove();
      }

      // Create modal elements
      modal = document.createElement('div');
      modal.id = modalId;
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;

      const content = document.createElement('div');
      content.style.cssText = `
        background: var(--bg-primary);
        border: 2px solid var(--accent-red);
        border-radius: 8px;
        padding: 20px;
        max-width: 95vw;
        width: 50vw;
        max-height: 90vh;
        overflow-y: auto;
        overflow-x: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        font-family: 'JetBrains Mono', monospace;
        color: var(--text-primary);
      `;

      content.innerHTML = generateModalContent(passes);

      modal.appendChild(content);
      document.body.appendChild(modal);

      const currentStartDate = dayjs().toDate();
      const currentEndDate = dayjs(currentStartDate).add(7, 'day').toDate();
      const currentPasses = orbit.computePassesElevation(
        groundStation,
        currentStartDate,
        currentEndDate,
        minElevation,
        maxPasses,
      );

      // update modal every second, satellite data currentPasses is not updated unless modal is reopened,
      // or if satellite layer is updated for instance if TLE data changes
      const updatePasses = () => {
        content.innerHTML = generateModalContent(currentPasses);
      };

      if (window.satellitePredictInterval) {
        clearInterval(window.satellitePredictInterval);
      }

      window.satellitePredictInterval = setInterval(updatePasses, 1000); // one second

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
          clearInterval(window.satellitePredictInterval);
        }
      });

      // Close on Enter or Escape key
      const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          modal.remove();
          clearInterval(window.satellitePredictInterval);
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
    };
  }, [satellites, globalConfig]);
  /********************************************************************************************/

  return null;
};
