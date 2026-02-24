import { useState, useEffect, useRef } from 'react';
import { makeDraggable } from "./makeDraggable.js";

/**
 * Gray Line Propagation Overlay Plugin v1.0.1
 *
 * Features:
 * - Real-time solar terminator (day/night boundary)
 * - Twilight zones (civil, nautical, astronomical)
 * - Animated update every minute
 * - Enhanced propagation zone highlighting
 * - Color-coded by propagation potential
 * - Minimizable control panel
 * - Corrected sine wave calculation (v1.0.1)
 * - Analytical quadratic solver eliminates twilight line gaps (v1.0.3)
 *
 * Use Case: Identify optimal times for long-distance DX contacts
 * The gray line provides enhanced HF propagation for several hours
 */

export const metadata = {
  id: 'grayline',
  name: 'plugins.layers.grayline.name',
  description: 'plugins.layers.grayline.description',
  icon: '🌅',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.5,
  version: '1.0.3',
};

// Solar calculations based on astronomical algorithms
function calculateSolarPosition(date) {
  const JD = dateToJulianDate(date);
  const T = (JD - 2451545.0) / 36525.0; // Julian centuries since J2000.0

  // Mean longitude of the sun
  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;

  // Mean anomaly
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
  const MRad = (M * Math.PI) / 180;

  // Equation of center
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(MRad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * MRad) +
    0.000289 * Math.sin(3 * MRad);

  // True longitude
  const trueLon = L0 + C;

  // Apparent longitude
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLon - 0.00569 - 0.00478 * Math.sin((omega * Math.PI) / 180);

  // Obliquity of ecliptic
  const epsilon = 23.439291 - 0.0130042 * T;
  const epsilonRad = (epsilon * Math.PI) / 180;
  const lambdaRad = (lambda * Math.PI) / 180;

  // Solar declination
  const declination = (Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad)) * 180) / Math.PI;

  // Solar right ascension
  const RA = (Math.atan2(Math.cos(epsilonRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)) * 180) / Math.PI;

  return { declination, rightAscension: RA };
}

function dateToJulianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Calculate solar hour angle for a given longitude at a specific time
function calculateHourAngle(date, longitude) {
  const JD = dateToJulianDate(date);
  const T = (JD - 2451545.0) / 36525.0;

  // Greenwich Mean Sidereal Time
  const GMST = (280.46061837 + 360.98564736629 * (JD - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360;

  const { rightAscension } = calculateSolarPosition(date);

  // Local hour angle
  const hourAngle = (GMST + longitude - rightAscension + 360) % 360;

  return hourAngle;
}

// Calculate solar altitude for a given position and time
function calculateSolarAltitude(date, latitude, longitude) {
  const { declination } = calculateSolarPosition(date);
  const hourAngle = calculateHourAngle(date, longitude);

  const latRad = (latitude * Math.PI) / 180;
  const decRad = (declination * Math.PI) / 180;
  const haRad = (hourAngle * Math.PI) / 180;

  const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = (Math.asin(sinAlt) * 180) / Math.PI;

  return altitude;
}

// Unwrap longitude values to be continuous (no 360° jumps) and create world copies
// This replaces the old splitAtDateLine approach, which broke when map center was past ±180°
function unwrapAndCopyLine(points) {
  if (points.length < 2) return [points];

  // Step 1: Unwrap longitudes so they're continuous
  const unwrapped = points.map((p) => [...p]);
  for (let i = 1; i < unwrapped.length; i++) {
    while (unwrapped[i][1] - unwrapped[i - 1][1] > 180) unwrapped[i][1] -= 360;
    while (unwrapped[i][1] - unwrapped[i - 1][1] < -180) unwrapped[i][1] += 360;
  }

  // Step 2: Create 3 world copies so lines render past the dateline
  const copies = [];
  for (const offset of [-360, 0, 360]) {
    copies.push(unwrapped.map(([lat, lon]) => [lat, lon + offset]));
  }

  return copies;
}

// Unwrap and copy a polygon (upper + lower bounds creating a closed shape)
function unwrapAndCopyPolygon(upperPoints, lowerPoints) {
  if (upperPoints.length < 2 || lowerPoints.length < 2) return [];

  // Unwrap both lines
  const upperUnwrapped = upperPoints.map((p) => [...p]);
  for (let i = 1; i < upperUnwrapped.length; i++) {
    while (upperUnwrapped[i][1] - upperUnwrapped[i - 1][1] > 180) upperUnwrapped[i][1] -= 360;
    while (upperUnwrapped[i][1] - upperUnwrapped[i - 1][1] < -180) upperUnwrapped[i][1] += 360;
  }

  const lowerUnwrapped = lowerPoints.map((p) => [...p]);
  for (let i = 1; i < lowerUnwrapped.length; i++) {
    while (lowerUnwrapped[i][1] - lowerUnwrapped[i - 1][1] > 180) lowerUnwrapped[i][1] -= 360;
    while (lowerUnwrapped[i][1] - lowerUnwrapped[i - 1][1] < -180) lowerUnwrapped[i][1] += 360;
  }

  // Combine into closed polygon ring
  const baseRing = [...upperUnwrapped, ...lowerUnwrapped.slice().reverse()];

  // Create 3 world copies
  const copies = [];
  for (const offset of [-360, 0, 360]) {
    copies.push(baseRing.map(([lat, lon]) => [lat, lon + offset]));
  }

  return copies;
}

// Generate terminator line for a specific solar altitude
// Uses half-angle substitution (t = tan(lat/2)) to get an analytical quadratic solution.
// This eliminates gaps from Newton-Raphson convergence failures in v1.0.1.
function generateTerminatorLine(date, solarAltitude = 0, numPoints = 360) {
  const points = [];
  const { declination } = calculateSolarPosition(date);
  const decRad = (declination * Math.PI) / 180;
  const sinDec = Math.sin(decRad);
  const cosDec = Math.cos(decRad);
  const sinAlt = Math.sin((solarAltitude * Math.PI) / 180);

  for (let i = 0; i <= numPoints; i++) {
    const lon = (i / numPoints) * 360 - 180;
    const hourAngle = calculateHourAngle(date, lon);
    const haRad = (hourAngle * Math.PI) / 180;
    const cosHA = Math.cos(haRad);

    // Solve: sin(lat)*sinDec + cos(lat)*cosDec*cosHA = sinAlt
    // Substituting t = tan(lat/2), sin = 2t/(1+t²), cos = (1-t²)/(1+t²):
    //   (C+B)t² - 2At + (C-B) = 0
    // where A = sinDec, B = cosDec*cosHA, C = sinAlt
    const A = sinDec;
    const B = cosDec * cosHA;
    const C = sinAlt;
    const qa = C + B;
    const qb = -2 * A;
    const qc = C - B;

    let lat;

    if (Math.abs(qa) < 1e-10) {
      // Linear case (B ≈ -C): solve qb*t + qc = 0
      if (Math.abs(qb) < 1e-10) continue;
      lat = 2 * Math.atan(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc < -1e-10) continue; // No real solution at this longitude

      const sqrtDisc = Math.sqrt(Math.max(0, disc));
      const t1 = (-qb + sqrtDisc) / (2 * qa);
      const t2 = (-qb - sqrtDisc) / (2 * qa);
      const lat1 = 2 * Math.atan(t1);
      const lat2 = 2 * Math.atan(t2);

      // Pick the root in valid latitude range [-π/2, π/2]
      // One root traces the main S-curve, the other is typically out of range
      const v1 = Math.abs(lat1) <= Math.PI / 2 + 0.01;
      const v2 = Math.abs(lat2) <= Math.PI / 2 + 0.01;

      if (v1 && v2) {
        lat = Math.abs(lat1) < Math.abs(lat2) ? lat1 : lat2;
      } else if (v1) {
        lat = lat1;
      } else if (v2) {
        lat = lat2;
      } else {
        continue;
      }
    }

    const latDeg = (lat * 180) / Math.PI;
    if (isFinite(latDeg) && Math.abs(latDeg) <= 85) {
      points.push([latDeg, lon]);
    }
  }

  return points;
}

// Make control panel draggable and minimizable

function addMinimizeToggle(element, storageKey) {
  if (!element) return;

  const minimizeKey = storageKey + '-minimized';
  const header = element.querySelector('div:first-child');
  if (!header) return;

  const content = Array.from(element.children).slice(1);
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'grayline-panel-content';
  content.forEach((child) => contentWrapper.appendChild(child));
  element.appendChild(contentWrapper);

  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'grayline-minimize-btn';
  minimizeBtn.innerHTML = '▼';
  minimizeBtn.style.cssText = `
    float: right;
    cursor: pointer;
    user-select: none;
    padding: 0 4px;
    margin: -2px -4px 0 0;
    font-size: 10px;
    opacity: 0.7;
    transition: opacity 0.2s;
  `;
  minimizeBtn.title = 'Minimize/Maximize';

  minimizeBtn.addEventListener('mouseenter', () => {
    minimizeBtn.style.opacity = '1';
  });
  minimizeBtn.addEventListener('mouseleave', () => {
    minimizeBtn.style.opacity = '0.7';
  });

  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.appendChild(minimizeBtn);

  const isMinimized = localStorage.getItem(minimizeKey) === 'true';
  if (isMinimized) {
    contentWrapper.style.display = 'none';
    minimizeBtn.innerHTML = '▶';
    element.style.cursor = 'pointer';
  }

  const toggle = (e) => {
    if (e && e.ctrlKey) return;

    const isCurrentlyMinimized = contentWrapper.style.display === 'none';

    if (isCurrentlyMinimized) {
      contentWrapper.style.display = 'block';
      minimizeBtn.innerHTML = '▼';
      element.style.cursor = 'default';
      localStorage.setItem(minimizeKey, 'false');
    } else {
      contentWrapper.style.display = 'none';
      minimizeBtn.innerHTML = '▶';
      element.style.cursor = 'pointer';
      localStorage.setItem(minimizeKey, 'true');
    }
  };

  header.addEventListener('click', (e) => {
    if (e.target === header || e.target.tagName === 'DIV') {
      toggle(e);
    }
  });

  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(e);
  });
}

export function useLayer({ enabled = false, opacity = 0.5, map = null }) {
  const [layers, setLayers] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTwilight, _setShowTwilight] = useState(() => {
    try {
      const v = localStorage.getItem('openhamclock_grayline_twilight');
      return v !== null ? v === 'true' : true;
    } catch {
      return true;
    }
  });
  const [showEnhancedZone, _setShowEnhancedZone] = useState(() => {
    try {
      const v = localStorage.getItem('openhamclock_grayline_enhanced');
      return v !== null ? v === 'true' : true;
    } catch {
      return true;
    }
  });
  const [twilightOpacity, _setTwilightOpacity] = useState(() => {
    try {
      const v = localStorage.getItem('openhamclock_grayline_twilightOpacity');
      return v !== null ? parseFloat(v) : 0.5;
    } catch {
      return 0.5;
    }
  });

  // Wrappers that persist to localStorage on change
  const setShowTwilight = (val) => {
    _setShowTwilight(val);
    try {
      localStorage.setItem('openhamclock_grayline_twilight', String(val));
    } catch {}
  };
  const setShowEnhancedZone = (val) => {
    _setShowEnhancedZone(val);
    try {
      localStorage.setItem('openhamclock_grayline_enhanced', String(val));
    } catch {}
  };
  const setTwilightOpacity = (val) => {
    _setTwilightOpacity(val);
    try {
      localStorage.setItem('openhamclock_grayline_twilightOpacity', String(val));
    } catch {}
  };

  const controlRef = useRef(null);
  const updateIntervalRef = useRef(null);

  // Update time every minute
  useEffect(() => {
    if (!enabled) return;

    const updateTime = () => {
      setCurrentTime(new Date());
    };

    updateTime(); // Initial update
    updateIntervalRef.current = setInterval(updateTime, 60000); // Every minute

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [enabled]);

  // Create control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const GrayLineControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'grayline-control');
        container.style.cssText = `
          background: var(--bg-panel);
          padding: 12px;
          border-radius: 5px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-primary);
          border: 1px solid var(--border-color);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          min-width: 200px;
        `;

        const now = new Date();
        const timeStr = now.toUTCString();

        container.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 8px; font-size: 12px;">🌅 Gray Line</div>
          
          <div style="margin-bottom: 8px; padding: 8px; background: var(--bg-tertiary); border-radius: 3px;">
            <div style="font-size: 9px; opacity: 0.7; margin-bottom: 2px;">UTC TIME</div>
            <div id="grayline-time" style="font-size: 10px; font-weight: bold;">${timeStr}</div>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="grayline-twilight" checked style="margin-right: 5px;" />
              <span>Show Twilight Zones</span>
            </label>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="grayline-enhanced" checked style="margin-right: 5px;" />
              <span>Enhanced DX Zone</span>
            </label>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: block; margin-bottom: 3px;">Twilight Opacity: <span id="twilight-opacity-value">50</span>%</label>
            <input type="range" id="grayline-twilight-opacity" min="20" max="100" value="50" step="5" style="width: 100%;" />
          </div>
          
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #555; font-size: 9px; opacity: 0.7;">
            <div>🌅 Gray line = enhanced HF propagation</div>
            <div style="margin-top: 4px;">Updates every minute</div>
          </div>
        `;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return container;
      },
    });

    const control = new GrayLineControl();
    map.addControl(control);
    controlRef.current = control;

    setTimeout(() => {
      const container = document.querySelector('.grayline-control');
      if (container) {
        // Apply saved position IMMEDIATELY before making draggable
        const saved = localStorage.getItem('grayline-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch (e) {}
        }

        makeDraggable(container, 'grayline-position');
        addMinimizeToggle(container, 'grayline-position');
      }

      // Add event listeners
      const twilightCheck = document.getElementById('grayline-twilight');
      const enhancedCheck = document.getElementById('grayline-enhanced');
      const twilightOpacitySlider = document.getElementById('grayline-twilight-opacity');
      const twilightOpacityValue = document.getElementById('twilight-opacity-value');

      // Sync DOM with persisted state (may differ from hardcoded HTML defaults)
      if (twilightCheck) twilightCheck.checked = showTwilight;
      if (enhancedCheck) enhancedCheck.checked = showEnhancedZone;
      if (twilightOpacitySlider) twilightOpacitySlider.value = Math.round(twilightOpacity * 100);
      if (twilightOpacityValue) twilightOpacityValue.textContent = Math.round(twilightOpacity * 100);

      if (twilightCheck) {
        twilightCheck.addEventListener('change', (e) => setShowTwilight(e.target.checked));
      }
      if (enhancedCheck) {
        enhancedCheck.addEventListener('change', (e) => setShowEnhancedZone(e.target.checked));
      }
      if (twilightOpacitySlider) {
        twilightOpacitySlider.addEventListener('input', (e) => {
          const value = parseInt(e.target.value) / 100;
          setTwilightOpacity(value);
          if (twilightOpacityValue) twilightOpacityValue.textContent = e.target.value;
        });
      }
    }, 150);
  }, [enabled, map]);

  // Update time display
  useEffect(() => {
    const timeElement = document.getElementById('grayline-time');
    if (timeElement && enabled) {
      timeElement.textContent = currentTime.toUTCString();
    }
  }, [currentTime, enabled]);

  // Render gray line and twilight zones
  useEffect(() => {
    if (!map || !enabled) return;

    // Clear old layers
    layers.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });

    const newLayers = [];

    // Main terminator (solar altitude = 0°)
    const terminator = generateTerminatorLine(currentTime, 0, 360);
    const terminatorCopies = unwrapAndCopyLine(terminator);

    terminatorCopies.forEach((segment) => {
      const terminatorLine = L.polyline(segment, {
        color: '#ff6600',
        weight: 3,
        opacity: opacity * 0.8,
        dashArray: '10, 5',
      });
      terminatorLine.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace;">
          <b>🌅 Solar Terminator</b><br>
          Sun altitude: 0°<br>
          Enhanced HF propagation zone<br>
          UTC: ${currentTime.toUTCString()}
        </div>
      `);
      terminatorLine.addTo(map);
      newLayers.push(terminatorLine);
    });

    // Enhanced DX zone (±5° from terminator)
    if (showEnhancedZone) {
      const enhancedUpper = generateTerminatorLine(currentTime, 5, 360);
      const enhancedLower = generateTerminatorLine(currentTime, -5, 360);

      // Only create polygon if we have valid points
      if (enhancedUpper.length > 2 && enhancedLower.length > 2) {
        const polygonCopies = unwrapAndCopyPolygon(enhancedUpper, enhancedLower);

        if (polygonCopies.length > 0) {
          const enhancedPoly = L.polygon(polygonCopies, {
            color: '#ffaa00',
            fillColor: '#ffaa00',
            fillOpacity: opacity * 0.15,
            weight: 1,
            opacity: opacity * 0.3,
          });
          enhancedPoly.bindPopup(`
            <div style="font-family: 'JetBrains Mono', monospace;">
              <b>⭐ Enhanced DX Zone</b><br>
              Best HF propagation window<br>
              ±5° from terminator<br>
              Ideal for long-distance contacts
            </div>
          `);
          enhancedPoly.addTo(map);
          newLayers.push(enhancedPoly);
        }
      }
    }

    // Twilight zones
    if (showTwilight) {
      // Civil twilight (sun altitude -6°)
      const civilTwilight = generateTerminatorLine(currentTime, -6, 360);
      const civilCopies = unwrapAndCopyLine(civilTwilight);

      civilCopies.forEach((segment) => {
        const civilLine = L.polyline(segment, {
          color: '#4488ff',
          weight: 2,
          opacity: twilightOpacity * 0.6,
          dashArray: '5, 5',
        });
        civilLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌆 Civil Twilight</b><br>
            Sun altitude: -6°<br>
            Good propagation conditions
          </div>
        `);
        civilLine.addTo(map);
        newLayers.push(civilLine);
      });

      // Nautical twilight (sun altitude -12°)
      const nauticalTwilight = generateTerminatorLine(currentTime, -12, 360);
      const nauticalCopies = unwrapAndCopyLine(nauticalTwilight);

      nauticalCopies.forEach((segment) => {
        const nauticalLine = L.polyline(segment, {
          color: '#6666ff',
          weight: 1.5,
          opacity: twilightOpacity * 0.4,
          dashArray: '3, 3',
        });
        nauticalLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌃 Nautical Twilight</b><br>
            Sun altitude: -12°<br>
            Moderate propagation
          </div>
        `);
        nauticalLine.addTo(map);
        newLayers.push(nauticalLine);
      });

      // Astronomical twilight (sun altitude -18°)
      const astroTwilight = generateTerminatorLine(currentTime, -18, 360);
      const astroCopies = unwrapAndCopyLine(astroTwilight);

      astroCopies.forEach((segment) => {
        const astroLine = L.polyline(segment, {
          color: '#8888ff',
          weight: 1,
          opacity: twilightOpacity * 0.3,
          dashArray: '2, 2',
        });
        astroLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌌 Astronomical Twilight</b><br>
            Sun altitude: -18°<br>
            Transition to night propagation
          </div>
        `);
        astroLine.addTo(map);
        newLayers.push(astroLine);
      });
    }

    setLayers(newLayers);

    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
    };
  }, [map, enabled, currentTime, opacity, showTwilight, showEnhancedZone, twilightOpacity]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled && map && controlRef.current) {
      try {
        map.removeControl(controlRef.current);
      } catch (e) {
        // Silently handle removal errors
      }
      controlRef.current = null;

      layers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      setLayers([]);
    }
  }, [enabled, map, layers]);

  return {
    layers,
    currentTime,
    showTwilight,
    showEnhancedZone,
  };
}
