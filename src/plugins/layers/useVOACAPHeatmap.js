import { useState, useEffect, useRef } from 'react';

/**
 * VOACAP-Style Propagation Heatmap Plugin v1.0.0
 * 
 * Shows color-coded propagation predictions from your DE location to
 * the entire world for a selected HF band — green (good), yellow 
 * (marginal), red (poor). Inspired by the original HamClock VOACAP overlay.
 * 
 * Data source: /api/propagation/heatmap (server-side, uses ITU-R P.533-style model)
 * Update interval: 5 minutes
 */

export const metadata = {
  id: 'voacap-heatmap',
  name: 'VOACAP Propagation Map',
  description: 'Color-coded HF propagation predictions from your station to the world',
  icon: '🌐',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.35,
  version: '1.0.0'
};

// HF bands: label, frequency in MHz
const BANDS = [
  { label: '160m', freq: 1.8 },
  { label: '80m',  freq: 3.5 },
  { label: '40m',  freq: 7 },
  { label: '30m',  freq: 10 },
  { label: '20m',  freq: 14 },
  { label: '17m',  freq: 18 },
  { label: '15m',  freq: 21 },
  { label: '12m',  freq: 24 },
  { label: '10m',  freq: 28 },
  { label: '6m',   freq: 50 }
];

// Reliability to color: red (0%) → yellow (50%) → green (100%)
function reliabilityColor(r) {
  if (r <= 0) return 'rgba(180,0,0,0.6)';
  if (r >= 99) return 'rgba(0,180,0,0.6)';

  let red, green;
  if (r < 50) {
    // Red → Yellow
    red = 180;
    green = Math.round((r / 50) * 180);
  } else {
    // Yellow → Green
    red = Math.round(((100 - r) / 50) * 180);
    green = 180;
  }
  return `rgba(${red},${green},0,0.6)`;
}

// Make control panel draggable with CTRL+drag
function makeDraggable(element, storageKey, skipPositionLoad = false) {
  if (!element) return;
  
  // Load saved position only if not already loaded
  if (!skipPositionLoad) {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        element.style.position = 'fixed';
        
        // Check if saved as percentage (new format) or pixels (old format)
        if (data.topPercent !== undefined && data.leftPercent !== undefined) {
          // Use percentage-based positioning (scales with zoom)
          element.style.top = data.topPercent + '%';
          element.style.left = data.leftPercent + '%';
        } else {
          // Legacy pixel format - convert to percentage
          const topPercent = (data.top / window.innerHeight) * 100;
          const leftPercent = (data.left / window.innerWidth) * 100;
          element.style.top = topPercent + '%';
          element.style.left = leftPercent + '%';
        }
        
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.transform = 'none';
      } catch (e) {}
    } else {
      // Convert from Leaflet control position to fixed
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
  
  element.addEventListener('mouseenter', updateCursor);
  element.addEventListener('mousemove', updateCursor);
  
  element.addEventListener('mousedown', (e) => {
    if (!e.ctrlKey) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(element.style.left) || 0;
    startTop = parseInt(element.style.top) || 0;
    element.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    element.style.left = (startLeft + dx) + 'px';
    element.style.top = (startTop + dy) + 'px';
  });
  
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    element.style.cursor = 'default';
    
    // Save position as percentage of viewport for zoom compatibility
    const topPercent = (element.offsetTop / window.innerHeight) * 100;
    const leftPercent = (element.offsetLeft / window.innerWidth) * 100;
    
    const position = {
      topPercent,
      leftPercent,
      // Keep pixel values for backward compatibility
      top: element.offsetTop,
      left: element.offsetLeft
    };
    localStorage.setItem(storageKey, JSON.stringify(position));
  });
}

// Minimize/maximize toggle
function addMinimizeToggle(container, storageKey) {
  if (!container) return;
  
  const contentWrapper = container.querySelector('.voacap-panel-content');
  const minimizeBtn = container.querySelector('.voacap-minimize-btn');
  if (!contentWrapper || !minimizeBtn) return;
  
  const minKey = storageKey + '-minimized';
  const isMinimized = localStorage.getItem(minKey) === 'true';
  
  if (isMinimized) {
    contentWrapper.style.display = 'none';
    minimizeBtn.textContent = '▶';
  }
  
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = contentWrapper.style.display === 'none';
    contentWrapper.style.display = hidden ? 'block' : 'none';
    minimizeBtn.textContent = hidden ? '▼' : '▶';
    localStorage.setItem(minKey, !hidden);
  });
}

export function useLayer({ map, enabled, opacity, callsign, locator }) {
  const [selectedBand, setSelectedBand] = useState(() => {
    const saved = localStorage.getItem('voacap-heatmap-band');
    return saved ? parseInt(saved) : 4; // Default: 20m (index 4)
  });
  const [gridSize, setGridSize] = useState(() => {
    const saved = localStorage.getItem('voacap-heatmap-grid');
    return saved ? parseInt(saved) : 10;
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(0);
  
  const layersRef = useRef([]);
  const controlRef = useRef(null);
  const intervalRef = useRef(null);
  
  // Parse DE location from locator grid square
  const deLocation = (() => {
    if (!locator || locator.length < 4) return null;
    const g = locator.toUpperCase();
    const lon = (g.charCodeAt(0) - 65) * 20 - 180;
    const lat = (g.charCodeAt(1) - 65) * 10 - 90;
    const lonMin = parseInt(g[2]) * 2;
    const latMin = parseInt(g[3]) * 1;
    return { lat: lat + latMin + 0.5, lon: lon + lonMin + 1 };
  })();
  
  // Fetch heatmap data
  useEffect(() => {
    if (!enabled || !deLocation) return;
    
    const fetchData = async () => {
      const band = BANDS[selectedBand];
      if (!band) return;
      
      setLoading(true);
      try {
        // Read propagation mode/power from config
        let propMode = 'SSB', propPower = 100;
        try {
          const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
          if (cfg.propagation?.mode) propMode = cfg.propagation.mode;
          if (cfg.propagation?.power) propPower = cfg.propagation.power;
        } catch (e) {}
        
        const url = `/api/propagation/heatmap?deLat=${deLocation.lat.toFixed(1)}&deLon=${deLocation.lon.toFixed(1)}&freq=${band.freq}&grid=${gridSize}&mode=${propMode}&power=${propPower}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          setData(json);
          setLastFetch(Date.now());
        }
      } catch (err) {
        console.error('[VOACAP Heatmap] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    intervalRef.current = setInterval(fetchData, 5 * 60 * 1000);
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, deLocation?.lat, deLocation?.lon, selectedBand, gridSize]);
  
  // Create control panel
  useEffect(() => {
    if (!map || !enabled) return;
    
    // Avoid duplicate controls
    if (controlRef.current) {
      try { map.removeControl(controlRef.current); } catch (e) {}
      controlRef.current = null;
    }
    
    const VOACAPControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'voacap-heatmap-control');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        
        const bandOptions = BANDS.map((b, i) =>
          `<option value="${i}" ${i === selectedBand ? 'selected' : ''}>${b.label} (${b.freq} MHz)</option>`
        ).join('');
        
        const gridOptions = [5, 10, 15, 20].map(g =>
          `<option value="${g}" ${g === gridSize ? 'selected' : ''}>${g}°</option>`
        ).join('');
        
        container.innerHTML = `
          <div style="
            background: rgba(20, 20, 40, 0.92);
            border: 1px solid rgba(255, 170, 0, 0.4);
            border-radius: 8px;
            padding: 10px 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: #ddd;
            min-width: 180px;
            backdrop-filter: blur(8px);
          ">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="color: #ffaa00; font-weight: 700; font-size: 12px;">🌐 VOACAP Heatmap</span>
              <button class="voacap-minimize-btn" style="
                background: none; border: none; color: #888; font-size: 10px;
                cursor: pointer; padding: 2px 4px;
              ">▼</button>
            </div>
            <div class="voacap-panel-content">
              <div style="margin-bottom: 6px;">
                <label style="color: #888; font-size: 10px;">Band</label>
                <select id="voacap-band-select" style="
                  width: 100%; margin-top: 2px; padding: 4px;
                  background: rgba(0,0,0,0.5); color: #fff;
                  border: 1px solid #555; border-radius: 4px;
                  font-family: 'JetBrains Mono', monospace; font-size: 11px;
                ">${bandOptions}</select>
              </div>
              <div style="margin-bottom: 8px;">
                <label style="color: #888; font-size: 10px;">Grid Resolution</label>
                <select id="voacap-grid-select" style="
                  width: 100%; margin-top: 2px; padding: 4px;
                  background: rgba(0,0,0,0.5); color: #fff;
                  border: 1px solid #555; border-radius: 4px;
                  font-family: 'JetBrains Mono', monospace; font-size: 11px;
                ">${gridOptions}</select>
              </div>
              <div style="
                display: flex; justify-content: space-between; align-items: center;
                background: rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 6px;
              ">
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(180,0,0,0.8); border-radius: 2px;"></span>
                <span style="color: #888; font-size: 9px;">Poor</span>
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(180,180,0,0.8); border-radius: 2px;"></span>
                <span style="color: #888; font-size: 9px;">Fair</span>
                <span style="display: inline-block; width: 12px; height: 12px; background: rgba(0,180,0,0.8); border-radius: 2px;"></span>
                <span style="color: #888; font-size: 9px;">Good</span>
              </div>
              <div id="voacap-status" style="color: #666; font-size: 9px; margin-top: 6px; text-align: center;">
                ${loading ? 'Loading...' : data ? `${data.mode || 'SSB'} ${data.power || 100}W | SFI: ${data.solarData?.sfi} K: ${data.solarData?.kIndex}` : 'Ready'}
              </div>
            </div>
          </div>
        `;
        
        return container;
      }
    });
    
    controlRef.current = new VOACAPControl();
    map.addControl(controlRef.current);
    
    // Wire up event handlers after DOM is ready
    setTimeout(() => {
      const container = controlRef.current?._container;
      if (!container) return;
      
      // Apply saved position
      const saved = localStorage.getItem('voacap-heatmap-position');
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
      
      makeDraggable(container, 'voacap-heatmap-position');
      addMinimizeToggle(container, 'voacap-heatmap-position');
      
      const bandSelect = document.getElementById('voacap-band-select');
      const gridSelect = document.getElementById('voacap-grid-select');
      
      if (bandSelect) {
        bandSelect.addEventListener('change', (e) => {
          const val = parseInt(e.target.value);
          setSelectedBand(val);
          localStorage.setItem('voacap-heatmap-band', val);
        });
      }
      if (gridSelect) {
        gridSelect.addEventListener('change', (e) => {
          const val = parseInt(e.target.value);
          setGridSize(val);
          localStorage.setItem('voacap-heatmap-grid', val);
        });
      }
    }, 150);
    
  }, [enabled, map]);
  
  // Update status text
  useEffect(() => {
    const statusEl = document.getElementById('voacap-status');
    if (statusEl && enabled) {
      if (loading) {
        statusEl.textContent = 'Loading...';
      } else if (data) {
        statusEl.textContent = `${data.mode || 'SSB'} ${data.power || 100}W | SFI: ${data.solarData?.sfi} K: ${data.solarData?.kIndex}`;
      }
    }
  }, [loading, data, enabled]);
  
  // Render heatmap rectangles on the map
  useEffect(() => {
    if (!map || !enabled) return;
    
    // Clear old layers
    layersRef.current.forEach(layer => {
      try { map.removeLayer(layer); } catch (e) {}
    });
    layersRef.current = [];
    
    if (!data?.cells?.length) return;
    
    const half = (data.gridSize || 10) / 2;
    const newLayers = [];
    
    data.cells.forEach(cell => {
      const color = reliabilityColor(cell.r);
      const band = BANDS[selectedBand];
      
      // Create rectangles in 3 world copies for dateline support
      for (const offset of [-360, 0, 360]) {
        const bounds = [
          [cell.lat - half, cell.lon - half + offset],
          [cell.lat + half, cell.lon + half + offset]
        ];
        
        const rect = L.rectangle(bounds, {
          color: 'transparent',
          fillColor: color,
          fillOpacity: opacity,
          weight: 0,
          interactive: false,
          bubblingMouseEvents: true
        });
        
        rect.addTo(map);
        newLayers.push(rect);
      }
    });
    
    layersRef.current = newLayers;
    
    return () => {
      newLayers.forEach(layer => {
        try { map.removeLayer(layer); } catch (e) {}
      });
    };
  }, [map, enabled, data, opacity, selectedBand]);
  
  // Cleanup on disable
  useEffect(() => {
    if (!enabled && map) {
      if (controlRef.current) {
        try { map.removeControl(controlRef.current); } catch (e) {}
        controlRef.current = null;
      }
      layersRef.current.forEach(layer => {
        try { map.removeLayer(layer); } catch (e) {}
      });
      layersRef.current = [];
    }
  }, [enabled, map]);
  
  return { data, loading, selectedBand };
}

// Quick haversine for popup display (no need for full precision)
function haversineApprox(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// Format distance using global units preference from config
function formatDistanceApprox(km) {
  try {
    const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
    if (cfg.units === 'metric') return `${km.toLocaleString()} km`;
  } catch (e) {}
  return `${Math.round(km * 0.621371).toLocaleString()} mi`;
}
