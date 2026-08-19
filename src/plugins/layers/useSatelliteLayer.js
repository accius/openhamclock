import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { replicatePoint, replicatePath } from '../../utils/geo.js';
import { openSatellitePredict as openSatellitePredictShared } from '../../utils/satellitePredict.js';

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
      const response = await fetch('/api/satellites/data');
      const { timestamp: newTimestamp, data } = await response.json();

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
      win.addEventListener('wheel', handleWheelPropagation, { passive: true });
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
      <div class="sat-data-window-title"
        style="display:flex; justify-content:space-between; align-items:center; cursor:grab; user-select:none; border-bottom:1px solid var(--border-color); background:var(--bg-tertiary);
          ${winMinimized ? `padding:2px 6px; width:fit-content; min-width:0; max-width:fit-content; height:fit-content; min-height:0; flex:none;` : `padding:8px 10px;`}">
        <span data-drag-handle="true" style="font-family:var(--font-mono); font-size:13px; font-weight:700; color:var(--accent-blue); letter-spacing:0.05em;">
          🛰 ${!winMinimized ? `${activeSats.length} ${activeSats.length !== 1 ? t('station.settings.satellites.name_plural') : t('station.settings.satellites.name')}` : ''}
        </span>
        <button class="sat-data-window-minimize" title="${winMinimized ? 'Expand' : 'Minimize'}" aria-label="${winMinimized ? 'Expand' : 'Minimize'}" aria-pressed="${winMinimized}" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:10px; line-height:1; padding:2px 4px; margin:0;">
          ${winMinimized ? '▶' : '▼'}
        </button>
      </div>`;

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

      // shrink to minimal size
      win.style.width = 'fit-content';
      win.style.minWidth = 'unset';
      win.style.maxWidth = 'fit-content';
      win.style.height = 'fit-content';
      win.style.minHeight = 'unset';

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

    // reset to default size constraints
    win.style.width = '260px';
    win.style.minWidth = '';
    win.style.maxWidth = '';
    win.style.height = '';
    win.style.minHeight = '';
    win.style.maxHeight = 'calc(100% - 80px)';
    win.style.overflowY = 'auto';

    // --- SAFE HELPERS ---------------------------------------------------------
    const safeNum = (v, digits = null) => {
      if (!Number.isFinite(v)) return '';
      return digits === null ? v : v.toFixed(digits);
    };

    const safeStr = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');

    const safeArr = (v) => (Array.isArray(v) ? v : []);
    // --------------------------------------------------------------------------

    win.innerHTML =
      titleBar +
      `<div class="sat-data-window-content">` +
      clearAllBtn +
      `<div style="padding: 0 12px 8px;">` +
      activeSats
        .map((satRaw) => {
          const sat = satRaw ?? {}; // ensure sat is always an object

          const isVisible = sat.isVisible === true;
          const isAboveHorizon = Number.isFinite(sat.elevation) && sat.elevation >= 0;

          const isMetric = allUnits.dist === 'metric';
          const distanceUnitsStr = isMetric ? 'km' : 'miles';
          const speedUnitsStr = isMetric ? 'km/h' : 'mph';
          const rangeRateUnitsStr = isMetric ? 'km/s' : 'miles/s';
          const km_to_miles_factor = 0.621371;

          const speedKmH = Number.isFinite(sat.speedKmH) ? sat.speedKmH : null;
          const speed = speedKmH !== null ? Math.round(speedKmH * (isMetric ? 1 : km_to_miles_factor)) : null;
          const speedStr = speed !== null ? `${speed.toLocaleString()} ${speedUnitsStr}` : 'N/A';

          const alt = Number.isFinite(sat.alt) ? sat.alt : null;
          const altitude = alt !== null ? Math.round(alt * (isMetric ? 1 : km_to_miles_factor)) : null;
          const altitudeStr = altitude !== null ? `${altitude.toLocaleString()} ${distanceUnitsStr}` : 'N/A';

          const nextPassStartTimes = safeArr(sat.nextPassStartTimes);
          const nextPassEndTimes = safeArr(sat.nextPassEndTimes);

          let nextPassSecsFromNow = null;
          let nextPassEndingSecsFromNow = null;
          nextPassStartTimes.forEach((startTime, i) => {
            const endTime = nextPassEndTimes[i];
            const secsFromNow = Number.isFinite(new Date(startTime).getTime())
              ? Math.floor((new Date(startTime) - new Date()) / 1000)
              : null;
            const secsEndingFromNow = Number.isFinite(new Date(endTime).getTime())
              ? Math.floor((new Date(endTime) - new Date()) / 1000)
              : null;
            if (secsEndingFromNow > 0 && nextPassSecsFromNow === null) {
              nextPassSecsFromNow = secsFromNow;
              nextPassEndingSecsFromNow = secsEndingFromNow;
            }
          });

          return `
      <div class="sat-card" style="border-bottom: 1px solid var(--border-color); margin-bottom: 10px; padding-bottom: 8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <strong style="color: var(--text-primary); font-size: 14px;">${safeStr(sat.name)}</strong>
        <button
          class="sat-toggle"
          data-action="toggle-satellite"
          data-sat-name="${safeStr(sat.name)}"
          style="background:none; border:none; color: var(--accent-red); cursor:pointer; font-weight:bold; font-size:20px; padding: 0 5px;">
          ✕
        </button>
      </div>

      <table style="width:100%; font-size:11px; border-collapse: collapse;">

        <!-- section 1: satellite position and motion -->
        <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
          <td style="padding: 0 2px;">${t('station.settings.satellites.latitude')}:</td>
          <td align="right" style="padding: 0 2px;">${safeNum(sat.lat, 2)}°</td>
        </tr>
        <tr style="background-color: var(--bg-tertiary); color: var(--text-secondary);">
          <td style="padding: 0 2px;">${t('station.settings.satellites.longitude')}:</td>
          <td align="right" style="padding: 0 2px;">${safeNum(sat.lon, 2)}°</td>
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
          <td align="right" style="padding: 0 2px;">${safeNum(sat.azimuth)}° / ${safeNum(sat.elevation)}°</td>
        </tr>

        ${
          isVisible
            ? `
          <tr style="background-color: var(--accent-green); color:#000;">
            <td style="padding: 0 2px;">${t('station.settings.satellites.range')}:</td>
            <td align="right" style="padding: 0 2px;">${safeNum(sat.range * (isMetric ? 1 : km_to_miles_factor), 0)} ${distanceUnitsStr}</td>
          </tr>
          <tr style="background-color: var(--accent-green); color:#000;">
            <td style="padding: 0 2px;">${t('station.settings.satellites.rangeRate')}:</td>
            <td align="right" style="padding: 0 2px;">${safeNum(sat.rangeRate * (isMetric ? 1 : km_to_miles_factor), 2)} ${rangeRateUnitsStr}</td>
          </tr>
          <tr style="background-color: var(--accent-green); color:#000;">
            <td style="padding: 0 2px;">${t('station.settings.satellites.dopplerFactor')}:</td>
            <td align="right" style="padding: 0 2px;">${safeNum(sat.dopplerFactor, 7)}</td>
          </tr>
        `
            : ``
        }

        <tr style="background-color: ${isVisible ? 'var(--accent-green)' : 'var(--bg-primary)'}; color: ${isVisible ? '#000' : 'var(--text-secondary)'};">
          <td style="padding: 0 2px;">${t('station.settings.satellites.status')}:</td>
          <td align="right" style="padding: 0 2px;">
            ${
              isVisible
                ? t('station.settings.satellites.visible')
                : isAboveHorizon
                  ? t('station.settings.satellites.belowMinElev')
                  : t('station.settings.satellites.belowHorizon')
            }
          </td>
        </tr>

        ${
          !isVisible && nextPassSecsFromNow !== null
            ? `
            <tr style="background-color: var(--bg-primary); color: var(--text-secondary);">
              <td style="padding: 0 2px;">${t('station.settings.satellites.nextPass')}:</td>
              <td align="right" style="padding: 0 2px;">${formatSecsFromNow(nextPassSecsFromNow)}</td>
            </tr>
            `
            : ``
        }

        ${
          isVisible && nextPassEndingSecsFromNow !== null
            ? `
            <tr style="background-color: var(--accent-green); color:#000;">
              <td style="padding: 0 2px;">Ending:</td>
              <td align="right" style="padding: 0 2px;">${formatSecsFromNow(nextPassEndingSecsFromNow)}</td>
            </tr>
            `
            : ``
        }

        <!-- section 3: miscellaneous satellite information -->
        <tr style="background-color: var(--bg-secondary); color: var(--text-muted);">
          <td style="padding: 0 2px;">${t('station.settings.satellites.mode')}:</td>
          <td align="right" style="padding: 0 2px;">${safeStr(sat.mode || 'N/A')}</td>
        </tr>
        ${
          sat.downlink
            ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.downlink')}:</td><td align="right" style="padding: 0 2px;">${safeStr(sat.downlink)}</td></tr>`
            : ''
        }
        ${
          sat.uplink
            ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.uplink')}:</td><td align="right" style="padding: 0 2px;">${safeStr(sat.uplink)}</td></tr>`
            : ''
        }
        ${
          sat.tone
            ? `<tr style="background-color: var(--bg-secondary); color: var(--text-muted);"><td style="padding: 0 2px;">${t('station.settings.satellites.tone')}:</td><td align="right" style="padding: 0 2px;">${safeStr(sat.tone)}</td></tr>`
            : ''
        }

        <tr><td colSpan="2">
          <button
            class="sat-open-predict"
            data-action="open-predict"
            data-sat-name="${safeStr(sat.name)}"
            data-omm="${safeStr(sat.omm ? JSON.stringify(sat.omm) : '')}"
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
              cursor: pointer;">${t('station.settings.satellites.predict')}</button>
        </td></tr>

      </table>

      ${
        sat.notes
          ? `<div style="font-size:9px; color: var(--text-muted); margin-top:4px; font-style:italic;">${safeStr(sat.notes)}</div>`
          : ''
      }

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

      const isSafeLatLon = (sat) => Number.isFinite(sat?.lat) && Number.isFinite(sat?.lon);

      if (isSafeLatLon(sat)) {
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
      }
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
        let omm = null;
        if (actionEl.dataset.omm) {
          try {
            omm = JSON.parse(actionEl.dataset.omm);
          } catch (err) {
            console.warn('Failed to parse satellite OMM data:', err);
          }
        }
        if (name && omm && window.openSatellitePredict) {
          window.openSatellitePredict(name, omm);
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
    // Shared with the 3D globe's telemetry window; see utils/satellitePredict.js.
    const openSatellitePredict = (satName, omm) => openSatellitePredictShared({ satName, omm, satellites, config, t });

    // expose for other callers if needed
    window.openSatellitePredict = openSatellitePredict;

    // Cleanup: remove the global reference when effect re-runs or component unmounts
    return () => {
      delete window.openSatellitePredict;
    };
  }, [satellites, config]);

  return null;
};
