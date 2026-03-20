import { useState, useEffect, useRef } from 'react';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';

/**
 * Gray Line Propagation Overlay Plugin v1.1.0
 *
 * Features:
 * - Real-time solar terminator (day/night boundary)
 * - Twilight zones (civil, nautical, astronomical)
 * - Enhanced propagation zone (±5° band around terminator)
 * - Animated update every minute
 * - Minimizable control panel
 *
 * v1.1.0 — Complete rewrite of terminator math:
 *   - Removed 85° latitude cap that broke rendering near equinoxes
 *   - Enhanced DX zone now uses latitude offset (not solar altitude lines)
 *   - Pre-computes solar position once per frame (was per-point)
 *   - Splits lines at gaps to prevent jagged cross-globe connections
 */

export const metadata = {
  id: 'grayline',
  name: 'plugins.layers.grayline.name',
  description: 'plugins.layers.grayline.description',
  icon: '🌅',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.5,
  version: '1.1.0',
};

const PI = Math.PI;
const RAD = PI / 180;
const DEG = 180 / PI;

function dateToJulianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Pre-compute all solar constants needed for a given time (called once per render)
function computeSolarConstants(date) {
  const JD = dateToJulianDate(date);
  const T = (JD - 2451545.0) / 36525.0;

  // Solar position
  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
  const MRad = M * RAD;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(MRad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * MRad) +
    0.000289 * Math.sin(3 * MRad);
  const trueLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = (trueLon - 0.00569 - 0.00478 * Math.sin(omega * RAD)) * RAD;
  const epsilon = (23.439291 - 0.0130042 * T) * RAD;

  const sinEps = Math.sin(epsilon);
  const cosEps = Math.cos(epsilon);
  const sinLam = Math.sin(lambda);
  const cosLam = Math.cos(lambda);

  const declination = Math.asin(sinEps * sinLam);
  const rightAscension = Math.atan2(cosEps * sinLam, cosLam);

  // Greenwich Mean Sidereal Time (radians)
  const GMST =
    ((280.46061837 + 360.98564736629 * (JD - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360) * RAD;

  return {
    sinDec: Math.sin(declination),
    cosDec: Math.cos(declination),
    decDeg: declination * DEG,
    // HA offset: haRad = GMST - RA + longitude_rad
    haBase: GMST - rightAscension,
  };
}

// Compute hour angle in radians for a given longitude (degrees)
function hourAngleRad(solar, lonDeg) {
  return solar.haBase + lonDeg * RAD;
}

/**
 * Generate the base terminator line (solar altitude = 0°).
 * This always has a solution at every longitude: lat = atan(-cosHA / tanDec).
 * Returns a continuous array of [lat, lon] points.
 */
function generateBaseTerminator(solar, numPoints = 360) {
  const { sinDec, cosDec } = solar;
  const tanDec = sinDec / cosDec;

  // Near equinox (small declination) the terminator is nearly a meridian and
  // latitude flips pole-to-pole over a very narrow longitude band. Increase
  // resolution so the transition renders smoothly instead of as a square wave.
  const absDeclDeg = Math.abs(Math.asin(sinDec) * DEG);
  const effectivePoints = absDeclDeg < 2 ? Math.max(numPoints, 720) : numPoints;

  const points = [];

  for (let i = 0; i <= effectivePoints; i++) {
    const lon = (i / effectivePoints) * 360 - 180;
    const haRad = hourAngleRad(solar, lon);
    const cosHA = Math.cos(haRad);

    let latRad;
    if (Math.abs(tanDec) < 1e-14) {
      // Near equinox edge case: terminator is nearly a meridian
      latRad = cosHA > 0 ? -PI / 2 + 0.001 : PI / 2 - 0.001;
    } else {
      latRad = Math.atan(-cosHA / tanDec);
    }

    const lat = latRad * DEG;
    // Clamp to Mercator-safe range but don't filter — the terminator reaches polar latitudes
    points.push([Math.max(-89.9, Math.min(89.9, lat)), lon]);
  }

  return points;
}

/**
 * Generate a terminator line for a non-zero solar altitude.
 * Uses the quadratic half-angle method. Returns an array of [lat, lon] points.
 * Points are split into segments at gaps (where no solution exists).
 */
function generateOffsetTerminator(solar, solarAltitude, numPoints = 360) {
  const { sinDec, cosDec } = solar;
  const sinAlt = Math.sin(solarAltitude * RAD);

  // Pre-compute the base terminator at each longitude for root selection
  const tanDec = sinDec / cosDec;

  const allPoints = [];

  for (let i = 0; i <= numPoints; i++) {
    const lon = (i / numPoints) * 360 - 180;
    const haRad = hourAngleRad(solar, lon);
    const cosHA = Math.cos(haRad);

    const A = sinDec;
    const B = cosDec * cosHA;
    const C = sinAlt;
    const qa = C + B;
    const qb = -2 * A;
    const qc = C - B;

    let lat;

    if (Math.abs(qa) < 1e-10) {
      if (Math.abs(qb) < 1e-10) {
        allPoints.push(null);
        continue;
      }
      lat = 2 * Math.atan(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc < -1e-10) {
        allPoints.push(null);
        continue;
      }

      const sqrtDisc = Math.sqrt(Math.max(0, disc));
      const t1 = (-qb + sqrtDisc) / (2 * qa);
      const t2 = (-qb - sqrtDisc) / (2 * qa);
      const lat1 = 2 * Math.atan(t1);
      const lat2 = 2 * Math.atan(t2);

      const v1 = Math.abs(lat1) <= PI / 2 + 0.01;
      const v2 = Math.abs(lat2) <= PI / 2 + 0.01;

      if (v1 && v2) {
        // Pick root closest to base terminator at this longitude
        let baseLat;
        if (Math.abs(tanDec) < 1e-10) {
          baseLat = cosHA > 0 ? -PI / 2 : PI / 2;
        } else {
          baseLat = Math.atan(-cosHA / tanDec);
        }
        lat = Math.abs(lat1 - baseLat) <= Math.abs(lat2 - baseLat) ? lat1 : lat2;
      } else if (v1) {
        lat = lat1;
      } else if (v2) {
        lat = lat2;
      } else {
        allPoints.push(null);
        continue;
      }
    }

    const latDeg = lat * DEG;
    if (isFinite(latDeg)) {
      allPoints.push([Math.max(-89.9, Math.min(89.9, latDeg)), lon]);
    } else {
      allPoints.push(null);
    }
  }

  return allPoints;
}

/**
 * Split an array (with nulls for gaps) into continuous segments.
 * Also splits at large latitude jumps (> threshold) to prevent jagged connections.
 */
function splitIntoSegments(pointsWithNulls, maxLatJump = 30) {
  const segments = [];
  let current = [];

  for (const pt of pointsWithNulls) {
    if (pt === null) {
      if (current.length >= 2) segments.push(current);
      current = [];
      continue;
    }
    // Check for discontinuity
    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (Math.abs(pt[0] - prev[0]) > maxLatJump) {
        if (current.length >= 2) segments.push(current);
        current = [];
      }
    }
    current.push(pt);
  }
  if (current.length >= 2) segments.push(current);

  return segments;
}

// Unwrap longitude values to be continuous and create world copies
function unwrapAndCopyLine(points) {
  if (points.length < 2) return [points];

  const unwrapped = points.map((p) => [...p]);
  for (let i = 1; i < unwrapped.length; i++) {
    while (unwrapped[i][1] - unwrapped[i - 1][1] > 180) unwrapped[i][1] -= 360;
    while (unwrapped[i][1] - unwrapped[i - 1][1] < -180) unwrapped[i][1] += 360;
  }

  const copies = [];
  for (const offset of [-360, 0, 360]) {
    copies.push(unwrapped.map(([lat, lon]) => [lat, lon + offset]));
  }
  return copies;
}

// Create a polygon ring from an upper and lower boundary (same longitudes, matched pairs)
function unwrapAndCopyPolygon(upperPoints, lowerPoints) {
  if (upperPoints.length < 2 || lowerPoints.length < 2) return [];

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

  const baseRing = [...upperUnwrapped, ...lowerUnwrapped.slice().reverse()];

  const copies = [];
  for (const offset of [-360, 0, 360]) {
    copies.push(baseRing.map(([lat, lon]) => [lat, lon + offset]));
  }
  return copies;
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
    const updateTime = () => setCurrentTime(new Date());
    updateTime();
    updateIntervalRef.current = setInterval(updateTime, 60000);
    return () => {
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    };
  }, [enabled]);

  // Create control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const GrayLineControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const container = L.DomUtil.create('div', 'grayline-control', panelWrapper);

        const now = new Date();
        const timeStr = now.toUTCString();

        container.innerHTML = `
          <div class="floating-panel-header">🌅 Gray Line</div>

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

        return panelWrapper;
      },
    });

    const control = new GrayLineControl();
    map.addControl(control);
    controlRef.current = control;

    setTimeout(() => {
      const container = document.querySelector('.grayline-control');
      if (container) {
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

        makeDraggable(container, 'grayline-position', { snap: 5 });
        addMinimizeToggle(container, 'grayline-position', {
          contentClassName: 'grayline-panel-content',
          buttonClassName: 'grayline-minimize-btn',
        });
      }

      const twilightCheck = document.getElementById('grayline-twilight');
      const enhancedCheck = document.getElementById('grayline-enhanced');
      const twilightOpacitySlider = document.getElementById('grayline-twilight-opacity');
      const twilightOpacityValue = document.getElementById('twilight-opacity-value');

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

    // Pre-compute solar constants once for this render
    const solar = computeSolarConstants(currentTime);

    // Main terminator (solar altitude = 0°) — always continuous, no gaps
    const terminator = generateBaseTerminator(solar, 360);
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

    // Enhanced DX zone (±5° latitude band around terminator)
    // Uses latitude offset from the base terminator — always produces matched, continuous
    // boundary lines regardless of season/declination. This avoids the issue where solar
    // altitude offset lines (+5° and -5°) end up on opposite sides of the globe near equinoxes.
    if (showEnhancedZone) {
      const BAND_WIDTH = 5; // degrees latitude
      const upperBound = terminator.map(([lat, lon]) => [Math.min(lat + BAND_WIDTH, 89.9), lon]);
      const lowerBound = terminator.map(([lat, lon]) => [Math.max(lat - BAND_WIDTH, -89.9), lon]);

      const polygonCopies = unwrapAndCopyPolygon(upperBound, lowerBound);

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
            ±${BAND_WIDTH}° from terminator<br>
            Ideal for long-distance contacts
          </div>
        `);
        enhancedPoly.addTo(map);
        newLayers.push(enhancedPoly);
      }
    }

    // Twilight zones — use quadratic solver, split at gaps to avoid jagged connections
    if (showTwilight) {
      const twilightDefs = [
        {
          alt: -6,
          color: '#4488ff',
          weight: 2,
          opMul: 0.6,
          name: 'Civil Twilight',
          icon: '🌆',
          desc: 'Good propagation conditions',
        },
        {
          alt: -12,
          color: '#6666ff',
          weight: 1.5,
          opMul: 0.4,
          name: 'Nautical Twilight',
          icon: '🌃',
          desc: 'Moderate propagation',
        },
        {
          alt: -18,
          color: '#8888ff',
          weight: 1,
          opMul: 0.3,
          name: 'Astronomical Twilight',
          icon: '🌌',
          desc: 'Transition to night propagation',
        },
      ];

      for (const tw of twilightDefs) {
        const rawPoints = generateOffsetTerminator(solar, tw.alt, 360);
        const segments = splitIntoSegments(rawPoints);

        for (const seg of segments) {
          const copies = unwrapAndCopyLine(seg);
          copies.forEach((copy) => {
            const line = L.polyline(copy, {
              color: tw.color,
              weight: tw.weight,
              opacity: twilightOpacity * tw.opMul,
              dashArray: tw.weight >= 2 ? '5, 5' : tw.weight >= 1.5 ? '3, 3' : '2, 2',
            });
            line.bindPopup(`
              <div style="font-family: 'JetBrains Mono', monospace;">
                <b>${tw.icon} ${tw.name}</b><br>
                Sun altitude: ${tw.alt}°<br>
                ${tw.desc}
              </div>
            `);
            line.addTo(map);
            newLayers.push(line);
          });
        }
      }
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
      } catch (e) {}
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
