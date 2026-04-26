import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';
import Orbit from '../../utils/orbit.js';

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
    location: {
      lat: 0.0,
      lon: 0.0,
      stationAlt: 100,
    },
    satellite: {
      minElev: 5,
    },
  },
};

export const useLayer = ({ map, enabled, satellites, setSatellites, opacity, config, allUnits }) => {
  const layerGroupRef = useRef(null);
  const winListenersRef = useRef(null); // Store window event listener references for cleanup
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

  // Helper to format seconds from now into a string representation e.g. "00:12:34"
  const formatSecsFromNow = (secsFromNow) => {
    return secsFromNow > 3600
      ? `${String(Math.floor(secsFromNow / 3600)).padStart(2, '0')}:${String(Math.floor((secsFromNow % 3600) / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
      : secsFromNow > 60
        ? `00:${String(Math.floor(secsFromNow / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
        : `00:00:${String(secsFromNow).padStart(2, '0')}`;
  };

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
      if (win) {
        // Clean up listeners before removing window
        if (winListenersRef.current) {
          const { mouseDownHandler, mouseMoveHandler, mouseUpHandler, wheelHandler, propagationHandler } =
            winListenersRef.current;
          win.removeEventListener('mousedown', mouseDownHandler);
          window.removeEventListener('mousemove', mouseMoveHandler, { capture: true });
          window.removeEventListener('mouseup', mouseUpHandler, { capture: true });
          win.removeEventListener('wheel', wheelHandler);
          win.removeEventListener('mousemove', propagationHandler.mousemove);
          win.removeEventListener('mousedown', propagationHandler.mousedown);
          win.removeEventListener('mouseup', propagationHandler.mouseup);
          winListenersRef.current = null;
        }
        win.remove();
      }
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
        color: 'var(--accent-cyan)',
        borderRadius: '4px',
        border: '1px solid var(--accent-cyan)',
        zIndex: '1000',
        fontFamily: 'monospace',
        pointerEvents: 'auto',
        boxShadow: '0 0 15px rgba(0, 0, 0, 0.7)',
        cursor: 'default',
        overflow: 'hidden',
      });
      container.appendChild(win);

      let isDragging = false;

      const handleMouseDown = (e) => {
        if (e.button !== 0) return;
        if (!e.target.closest('.sat-data-window-title')) return;
        if (e.target.closest('button')) return;

        isDragging = true;
        win.style.cursor = 'move';
        if (map.dragging) map.dragging.disable();
        e.preventDefault();
        e.stopPropagation();
      };

      const handleMouseMove = (e) => {
        if (!isDragging) return;

        const rect = container.getBoundingClientRect();
        const x = rect.right - e.clientX;
        const y = e.clientY - rect.top;

        win.style.right = `${x - 10}px`;
        win.style.top = `${y - 10}px`;
      };

      const handleMouseUp = () => {
        if (!isDragging) return;

        isDragging = false;
        win.style.cursor = 'default';
        if (map.dragging) map.dragging.enable();

        setWinPos({
          top: parseInt(win.style.top),
          right: parseInt(win.style.right),
        });
      };

      win.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove, { capture: true });
      window.addEventListener('mouseup', handleMouseUp, { capture: true });

      // Named functions for preventing map event capture
      const handleWheelPropagation = (e) => {
        e.stopPropagation();
      };
      const handleMouseDownPropagation = (e) => {
        e.stopPropagation();
      };
      const handleMouseMovePropagation = (e) => {
        e.stopPropagation();
      };
      const handleMouseUpPropagation = (e) => {
        e.stopPropagation();
      };

      // Prevent map from capturing events on the window
      win.addEventListener('wheel', handleWheelPropagation);
      win.addEventListener('mousedown', handleMouseDownPropagation);
      win.addEventListener('mousemove', handleMouseMovePropagation);
      win.addEventListener('mouseup', handleMouseUpPropagation);

      // Store all listener references for cleanup
      winListenersRef.current = {
        mouseDownHandler: handleMouseDown,
        mouseMoveHandler: handleMouseMove,
        mouseUpHandler: handleMouseUp,
        wheelHandler: handleWheelPropagation,
        propagationHandler: {
          mousedown: handleMouseDownPropagation,
          mousemove: handleMouseMovePropagation,
          mouseup: handleMouseUpPropagation,
        },
      };
    }

    win.style.top = `${winPos.top}px`;
    win.style.right = `${winPos.right}px`;

    const activeSats = satellites.filter((s) => selectedSats.includes(s.name));

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
        manageButtonEvents: true,
      });
      return;
    }

    win.style.maxHeight = 'calc(100% - 80px)';
    win.style.overflowY = 'auto';

    win.innerHTML =
      titleBar +
      `<div class="sat-data-window-content">` +
      clearAllBtn +
      `<div style="padding: 0 12px 8px;">` +
      activeSats
        .map((sat) => {
          const isVisible = sat.isVisible === true;
          const isAboveHorizon = sat.elevation >= 0;

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

          const nextPassStartTimes = sat.nextPassStartTimes || [];

          let nextPassSecsFromNow = null;
          let nextPassEndingSecsFromNow = null;
          nextPassStartTimes.forEach((startTime, i) => {
            const secsFromNow = Math.floor((new Date(startTime) - new Date()) / 1000);
            const secsEndingFromNow = Math.floor((new Date(sat.nextPassEndTimes?.[i]) - new Date()) / 1000);
            if (secsEndingFromNow > 0 && nextPassSecsFromNow === null) {
              nextPassSecsFromNow = secsFromNow;
              nextPassEndingSecsFromNow = secsEndingFromNow;
            }
          });

          const attrEscape = (s) =>
            String(s ?? '')
              .replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;');

          return `
          <div class="sat-card" style="border-bottom: 1px solid var(--border-color); margin-bottom: 10px; padding-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color: var(--text-primary); font-size: 14px;">${sat.name}</strong>
            <button
              class="sat-toggle"
              data-action="toggle-satellite"
              data-sat-name="${sat.name}"
              style="background:none; border:none; color: var(--accent-red); cursor:pointer; font-weight:bold; font-size:20px; padding: 0 5px;">
              ✕
            </button>
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
              <td align="right" style="padding: 0 2px;">
                ${
                  isVisible
                    ? `${t('station.settings.satellites.visible')}`
                    : isAboveHorizon
                      ? `${t('station.settings.satellites.belowMinElev')}`
                      : `${t('station.settings.satellites.belowHorizon')}`
                }
              </td>
            </tr>

            ${
              !isVisible && nextPassSecsFromNow !== null
                ? `
                <tr style="background-color: var(--bg-primary); color: var(--text-secondary);">
                  <td style="padding: 0 2px;">Next Pass:</td>
                  <td align="right" style="padding: 0 2px;">${formatSecsFromNow(nextPassSecsFromNow)}</td>
                </tr>
                `
                : ``
            }

            ${
              isVisible && nextPassEndingSecsFromNow !== null
                ? `
                <tr style="background-color: var(--accent-green); color: #000;">
                  <td style="padding: 0 2px;">Ending:</td>
                  <td align="right" style="padding: 0 2px;">${formatSecsFromNow(nextPassEndingSecsFromNow)}</td>
                </tr>
                `
                : ``
            }

            <!-- section 3: miscellaneous satellite information -->
            <tr style="background-color: var(--bg-secondary); color: var(--text-muted);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.mode')}:</td>
              <td align="right" style="padding: 0 2px;">${attrEscape(sat.mode || 'N/A')}</td>
            </tr>
            ${sat.downlink ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.downlink')}:</td><td align="right" style="padding: 0 2px;">${attrEscape(sat.downlink)}</td></tr>` : ''}
            ${sat.uplink ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.uplink')}:</td><td align="right" style="padding: 0 2px;">${attrEscape(sat.uplink)}</td></tr>` : ''}
            ${sat.tone ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.tone')}:</td><td align="right" style="padding: 0 2px;">${attrEscape(sat.tone)}</td></tr>` : ''}

            <tr><td colSpan="2">
              <button
                class="sat-open-predict"
                data-action="open-predict"
                data-sat-name="${attrEscape(sat.name)}"
                data-tle1="${attrEscape(sat.tle1)}"
                data-tle2="${attrEscape(sat.tle2)}"
                style="
                  width: 100%;
                  padding: 2px 0;
                  min-height: 0;
                  background: var(--bg-primary);
                  border: 1px solid var(--accent-red);
                  border-radius: 3px;
                  color: var(--accent-red);
                  font-size: 10px;
                  font-weight: bold;
                  text-align: center;
                  cursor: pointer;">PREDICT</button>
            </td></tr>

            </table>

            ${sat.notes ? `<div style="font-size:9px; color: var(--text-muted); margin-top:4px; font-style:italic;">${attrEscape(sat.notes)}</div>` : ''}
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
      manageButtonEvents: true,
    });
  };

  const renderSatellites = () => {
    if (!layerGroupRef.current || !map) return;
    layerGroupRef.current.clearLayers();
    if (!satellites || satellites.length === 0) return;

    const globalOpacity = opacity !== undefined ? opacity : 1.0;
    const accentCyan = getComputedStyle(document.documentElement).getPropertyValue('--accent-cyan').trim();
    const accentGreen = getComputedStyle(document.documentElement).getPropertyValue('--accent-green').trim();
    const accentAmber = getComputedStyle(document.documentElement).getPropertyValue('--accent-amber').trim();

    satellites.forEach((sat) => {
      const isSelected = selectedSats.includes(sat.name);

      if (isSelected && config?.showFootprints !== false && sat.alt) {
        const EARTH_RADIUS = 6371;
        const centralAngle = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + sat.alt));
        const footprintRadiusMeters = centralAngle * EARTH_RADIUS * 1000;
        const footColor = sat.isVisible === true ? accentGreen : accentCyan;

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
                color: accentCyan,
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
              color: accentCyan,
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
              color: accentAmber,
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
      if (win) {
        // Clean up listeners before removing window
        if (winListenersRef.current) {
          const { mouseDownHandler, mouseMoveHandler, mouseUpHandler, wheelHandler, propagationHandler } =
            winListenersRef.current;
          win.removeEventListener('mousedown', mouseDownHandler);
          window.removeEventListener('mousemove', mouseMoveHandler, { capture: true });
          window.removeEventListener('mouseup', mouseUpHandler, { capture: true });
          win.removeEventListener('wheel', wheelHandler);
          win.removeEventListener('mousemove', propagationHandler.mousemove);
          win.removeEventListener('mousedown', propagationHandler.mousedown);
          win.removeEventListener('mouseup', propagationHandler.mouseup);
          winListenersRef.current = null;
        }
        win.remove();
      }
    }
  }, [enabled, map, config]);

  useEffect(() => {
    if (enabled) renderSatellites();
  }, [satellites, selectedSats, allUnits, opacity, config, winMinimized]);

  // Delegated click handling for window buttons
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();

    const handleClick = (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl || !container.contains(actionEl)) return;

      const action = actionEl.dataset.action;

      if (action === 'open-predict') {
        e.stopPropagation();
        e.preventDefault();
        const name = actionEl.dataset.satName;
        const tle1 = actionEl.dataset.tle1;
        const tle2 = actionEl.dataset.tle2;
        if (name && tle1 && tle2 && window.openSatellitePredict) {
          window.openSatellitePredict(name, tle1, tle2);
        }
        return;
      }

      if (action === 'clear-all-satellites') {
        e.stopPropagation();
        e.preventDefault();
        sessionStorage.removeItem('selected_satellites');
        window.location.reload();
        return;
      }

      if (action === 'toggle-satellite') {
        e.stopPropagation();
        e.preventDefault();
        const name = actionEl.dataset.satName;
        if (name) toggleSatellite(name);
        return;
      }
    };

    container.addEventListener('click', handleClick, true); // Use capture phase
    return () => container.removeEventListener('click', handleClick, true);
  }, [map, toggleSatellite, satellites]);

  // Expose satellite prediction panel function
  useEffect(() => {
    const openSatellitePredict = (satName, tle1, tle2) => {
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
        latitude: config?.location?.lat || 0.0,
        longitude: config?.location?.lon || 0.0,
        height: config?.location?.stationAlt || 100, // above sea level [m]
      };

      const startDate = new Date(); // from now
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // until 7 days from now
      const minElevation = config?.satellite?.minElev || 5;
      const maxPasses = 25;
      const passes = orbit.computePassesElevation(groundStation, startDate, endDate, minElevation, maxPasses);

      const modalId = 'satellite-predict-modal';

      // Function to generate modal content
      const generateModalContent = (currentPasses) => {
        return `
          <div style="text-align: center; margin-bottom: 16px; border-bottom: 2px solid var(--accent-red); padding-bottom: 12px;">
            <h2 style="margin: 0; color: var(--accent-cyan); font-size: 24px;">🛰 ${satName}</h2>
            <p style="margin: 8px 0 0 0; color: var(--text-muted); font-size: 12px;">Satellite Prediction Details</p>
          </div>

          <div style="margin-top: 16px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid var(--text-muted);">
              <thead>
                <tr style="background: var(--bg-secondary); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">Start</th>
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">Apex</th>
                  <th colspan="2" style="border-right: 3px double var(--text-muted); padding: 4px;">End</th>
                  <th style="padding: 4px;">Duration</th>
                </tr>
                <tr style="background: var(--bg-secondary); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Local Time</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">From Now</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">Az [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Local Time</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Az [°]</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">El [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">Local Time</th>
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
                    const formatLocalTime = (ts) => {
                      const d = new Date(ts);
                      const pad = (n) => String(n).padStart(2, '0');
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    };
                    const startTime = formatLocalTime(pass.start);
                    const apexTime = formatLocalTime(pass.apex);
                    const endTime = formatLocalTime(pass.end);
                    const secsFromNow = Math.floor((pass.start - new Date()) / 1000);

                    const isVisibleNow = secsFromNow <= 0 && new Date() < new Date(pass.end);
                    const isPast = secsFromNow <= 0 && new Date() > new Date(pass.end);

                    if (isPast) {
                      return ``; // skip past passes
                    }

                    const timeFromNow = isVisibleNow
                      ? 'VISIBLE'
                      : secsFromNow > 3600
                        ? `+${String(Math.floor(secsFromNow / 3600)).padStart(2, '0')}:${String(Math.floor((secsFromNow % 3600) / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                        : secsFromNow > 60
                          ? `+00:${String(Math.floor(secsFromNow / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                          : `+00:00:${String(secsFromNow).padStart(2, '0')}`;

                    return `<tr style="background: var(--bg-tertiary); text-align: center; border-bottom: 1px solid var(--text-muted);">
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
            <button
              class="sat-predict-close"
              data-action="close-predict-modal"
              style="
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
        background: var(--bg-primary);
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
        min-width: 50vw;
        max-width: 95vw;
        min-height: 25vh;
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

      // Named function so it can be removed later
      const handleModalClick = (e) => {
        if (e.target === modal) {
          closeModal();
        }
      };

      const currentStartDate = new Date();
      const currentEndDate = new Date(currentStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
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

      const closeModal = () => {
        // Clean up all event listeners before removing modal
        content.removeEventListener('click', handleContentClick);
        modal.removeEventListener('click', handleModalClick);
        document.removeEventListener('keydown', handleKeyDown);

        modal.remove();
        if (window.satellitePredictInterval) {
          clearInterval(window.satellitePredictInterval);
        }
      };

      // Use event delegation for close button so it works after HTML regeneration
      const handleContentClick = (e) => {
        if (e.target.matches('[data-action="close-predict-modal"]')) {
          closeModal();
        }
      };

      if (window.satellitePredictInterval) {
        clearInterval(window.satellitePredictInterval);
      }

      window.satellitePredictInterval = setInterval(updatePasses, 1000); // one second

      // Close on backdrop click
      modal.addEventListener('click', handleModalClick);

      // Close on Escape key
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          closeModal();
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // Wire close button using event delegation (one listener for all updates)
      content.addEventListener('click', handleContentClick);
    };

    // expose for other callers if needed
    window.openSatellitePredict = openSatellitePredict;

    // Cleanup: remove the global reference when effect re-runs or component unmounts
    return () => {
      delete window.openSatellitePredict;
    };
  }, [satellites, config]);

  return null;
};
