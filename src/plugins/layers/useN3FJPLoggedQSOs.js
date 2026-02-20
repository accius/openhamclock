import { useEffect, useState, useRef } from 'react';

export const metadata = {
  id: 'n3fjp_logged_qsos',
  name: 'Logged QSOs (N3FJP)',
  description: 'Shows recently logged QSOs sent from the N3FJP bridge.',
  icon: '🗺️',
  category: 'overlay',
  localOnly: true,
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '0.2.0',
};

const POLL_MS = 2000;

// --- User settings (persisted) ---
const STORAGE_MINUTES_KEY = 'n3fjp_display_minutes';
const STORAGE_COLOR_KEY = 'n3fjp_line_color';

// Make control draggable with CTRL+drag
// Registry so a second call for the same storageKey cancels the previous listeners.
const _makeDraggableControllers = {};

function makeDraggable(element, storageKey, skipPositionLoad = false) {
  if (!element) return;

  // Cancel any previous listener set attached to this storageKey (e.g. after layout change)
  if (_makeDraggableControllers[storageKey]) {
    _makeDraggableControllers[storageKey].abort();
  }
  const controller = new AbortController();
  const signal = controller.signal;
  _makeDraggableControllers[storageKey] = controller;

  // Load saved position
  if (!skipPositionLoad) {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        element.style.position = 'fixed';
        if (data.topPercent !== undefined && data.leftPercent !== undefined) {
          element.style.top = data.topPercent + '%';
          element.style.left = data.leftPercent + '%';
        } else {
          element.style.top = (data.top / window.innerHeight) * 100 + '%';
          element.style.left = (data.left / window.innerWidth) * 100 + '%';
        }
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.transform = 'none';
      } catch (e) {}
    } else {
      const rect = element.getBoundingClientRect();
      element.style.position = 'fixed';
      element.style.top = rect.top + 'px';
      element.style.left = rect.left + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    }
  }

  element.title = 'Hold CTRL and drag to reposition';

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  const updateCursor = (e) => {
    element.style.cursor = e.ctrlKey ? 'grab' : 'default';
  };

  element.addEventListener('mouseenter', updateCursor, { signal });
  element.addEventListener('mousemove', updateCursor, { signal });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Control') updateCursor(e);
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Control') updateCursor(e);
    },
    { signal },
  );

  element.addEventListener(
    'mousedown',
    function (e) {
      if (!e.ctrlKey) return;
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = element.offsetLeft;
      startTop = element.offsetTop;
      element.style.cursor = 'grabbing';
      element.style.opacity = '0.8';
      e.preventDefault();
    },
    { signal },
  );

  document.addEventListener(
    'mousemove',
    function (e) {
      if (!isDragging) return;
      element.style.left = startLeft + (e.clientX - startX) + 'px';
      element.style.top = startTop + (e.clientY - startY) + 'px';
    },
    { signal },
  );

  document.addEventListener(
    'mouseup',
    function (e) {
      if (!isDragging) return;
      isDragging = false;
      element.style.opacity = '1';
      updateCursor(e);
      const topPercent = (element.offsetTop / window.innerHeight) * 100;
      const leftPercent = (element.offsetLeft / window.innerWidth) * 100;
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          topPercent,
          leftPercent,
          top: element.offsetTop,
          left: element.offsetLeft,
        }),
      );
    },
    { signal },
  );
}

// Add minimize/maximize toggle
function addMinimizeToggle(element, storageKey) {
  if (!element) return;

  const minimizeKey = storageKey + '-minimized';
  const header = element.firstElementChild;
  if (!header) return;

  // Wrap content
  const content = Array.from(element.children).slice(1);
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'n3fjp-panel-content';
  content.forEach((child) => contentWrapper.appendChild(child));
  element.appendChild(contentWrapper);

  // Add minimize button
  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'n3fjp-minimize-btn';
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

  // Load saved state
  const isMinimized = localStorage.getItem(minimizeKey) === 'true';
  if (isMinimized) {
    contentWrapper.style.display = 'none';
    minimizeBtn.innerHTML = '▶';
    element.style.cursor = 'pointer';
  }

  // Toggle function
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

  minimizeBtn.addEventListener('click', toggle);
  header.addEventListener('click', (e) => {
    if (e.target !== minimizeBtn) toggle(e);
  });
}

export function useLayer({ enabled = false, opacity = 0.9, map = null }) {
  const [layersRef, setLayersRef] = useState([]);
  const [qsos, setQsos] = useState([]);
  const [retentionMinutes, setRetentionMinutes] = useState(15);

  const lastOpenDxCallRef = useRef(null);
  const suppressReopenRef = useRef(false);

  const [displayMinutes, setDisplayMinutes] = useState(() => {
    const v = parseInt(localStorage.getItem(STORAGE_MINUTES_KEY) || '15', 10);
    return Number.isFinite(v) ? v : 15;
  });

  const [lineColor, setLineColor] = useState(() => {
    return localStorage.getItem(STORAGE_COLOR_KEY) || '#3388ff'; // Leaflet default blue-ish
  });

  // Poll the server for QSOs
  useEffect(() => {
    if (!enabled) return;

    let alive = true;

    const fetchQsos = async () => {
      try {
        const resp = await fetch('/api/n3fjp/qsos');
        if (!resp.ok) return;
        const data = await resp.json();

        if (!alive) return;
        setRetentionMinutes(Number(data?.retention_minutes || 15));
        setQsos(Array.isArray(data?.qsos) ? data.qsos : []);
      } catch {
        // silent
      }
    };

    fetchQsos();
    const interval = setInterval(fetchQsos, POLL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled]);

  /// React to Integrations panel changes (display window + color)
  useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      try {
        const m = parseInt(localStorage.getItem(STORAGE_MINUTES_KEY) || '15', 10);
        if (Number.isFinite(m)) setDisplayMinutes(m);
      } catch {}
      try {
        const c = localStorage.getItem(STORAGE_COLOR_KEY) || '#3388ff';
        setLineColor(c);
      } catch {}
    };

    sync();
    window.addEventListener('ohc-n3fjp-config-changed', sync);
    return () => window.removeEventListener('ohc-n3fjp-config-changed', sync);
  }, [enabled]);

  // Draw markers/lines whenever qsos changes
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // --- Preserve open popup across redraws ---
    // Use our own ref as the source of truth (map._popup can be fickle during redraws)
    const openDxCall = !suppressReopenRef.current && lastOpenDxCallRef.current ? lastOpenDxCallRef.current : null;

    // Remove old layers
    layersRef.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    setLayersRef([]);

    if (!enabled || !qsos.length) return;

    // ---- CLIENT-SIDE FILTER: Show only QSOs newer than X minutes ----
    const cutoff = Date.now() - displayMinutes * 60 * 1000;
    const recent = qsos.filter((q) => {
      const t = Date.parse(q.ts_utc || q.ts || '');
      return !Number.isNaN(t) && t >= cutoff;
    });

    // If nothing recent, we're done
    if (!recent.length) return;

    // Read station position from OpenHamClock config (if present)
    let station = null;

    try {
      const raw = localStorage.getItem('openhamclock_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        const lat = cfg?.location?.lat;
        const lon = cfg?.location?.lon;
        if (typeof lat === 'number' && typeof lon === 'number') {
          station = { lat, lon };
        }
      }
    } catch {}

    // ✅ Fallback to Maidenhead if lat/lon missing
    if (!station) {
      try {
        const raw = localStorage.getItem('openhamclock_config');
        if (raw) {
          const cfg = JSON.parse(raw);
          const grid = cfg?.station?.locator;
          if (grid && grid.length >= 4) {
            const { lat, lon } = maidenheadToLatLon(grid);
            station = { lat, lon };
          }
        }
      } catch {}
    }

    const newLayers = [];

    // Optional: show station marker
    if (station) {
      const stMarker = L.circleMarker([station.lat, station.lon], {
        radius: 5,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);
      stMarker.bindPopup('<b>Station</b>');
      newLayers.push(stMarker);
    }

    // Plot each QSO using qso.lat/qso.lon
    recent.forEach((q) => {
      const lat = q.lat;
      const lon = q.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') return;

      const dxCall = (q.dx_call || '').trim() || '(unknown)';
      const mode = q.mode || '';
      // Convert integer kHz (e.g. 14230) to MHz string (e.g. 14.230)
      let freqMhz = '';
      if (typeof q.freq_khz === 'number' && Number.isFinite(q.freq_khz) && q.freq_khz > 0) {
        freqMhz = (q.freq_khz / 1000).toFixed(3);
      }
      const ts = q.ts_utc || '';

      const dxMarker = L.circleMarker([lat, lon], {
        radius: 6,
        opacity,
        fillOpacity: Math.min(1, opacity * 0.8),
      }).addTo(map);

      // Tag marker so we can re-open its popup after a redraw
      dxMarker.__dxCall = dxCall;
      // User intent: keep THIS call's popup open across redraws
      dxMarker.on('click', () => {
        lastOpenDxCallRef.current = dxCall;
        suppressReopenRef.current = false;
      });

      dxMarker.on('popupclose', () => {
        // If the marker was removed from the map (our redraw does this every POLL_MS),
        // Leaflet will close the popup. That's NOT a user close.
        if (!map || !map.hasLayer(dxMarker)) return;

        // This is a real user close (clicked X or clicked map/another marker)
        if (lastOpenDxCallRef.current === dxCall) {
          suppressReopenRef.current = true;
          lastOpenDxCallRef.current = null;
        }
      });

      dxMarker.bindPopup(
        `<div style="font-family: JetBrains Mono, monospace;">
          <b>${dxCall}</b><br/>
          ${mode ? `Mode: ${mode}<br/>` : ''}
          ${freqMhz ? `Freq: ${freqMhz} MHz<br/>` : ''} 
          ${ts ? `Time: ${ts}<br/>` : ''}
          ${q.dx_country ? `Country: ${q.dx_country}<br/>` : ''}
          ${q.loc_source ? `Loc: ${q.loc_source}<br/>` : ''}
          ${q.dx_grid ? `Grid: ${q.dx_grid}<br/>` : ''}
          <span style="opacity:0.7;">Retention: ${retentionMinutes} min</span>
        </div>`,
      );

      newLayers.push(dxMarker);

      // If this was the popup that was open before redraw, re-open it now
      if (!suppressReopenRef.current && openDxCall && dxCall === openDxCall) {
        setTimeout(() => {
          try {
            dxMarker.openPopup();
          } catch {}
        }, 0);
      }

      // Draw line from station -> DX if we have station coords
      if (station) {
        const line = L.polyline(
          [
            [station.lat, station.lon],
            [lat, lon],
          ],
          { opacity, color: lineColor },
        ).addTo(map);
        newLayers.push(line);
      }
    });

    setLayersRef(newLayers);

    // Cleanup
    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
    };
  }, [enabled, qsos, map, opacity, retentionMinutes, displayMinutes, lineColor]);

  return {
    qsoCount: qsos.length,
    retentionMinutes,
  };
}
