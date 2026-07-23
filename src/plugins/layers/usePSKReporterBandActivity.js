import { useEffect, useRef, useState } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { DEFAULT_BAND_COLORS } from '../../utils/bandColors.js';
import { addMinimizeToggle } from './addMinimizeToggle.js';
import { makeDraggable } from './makeDraggable.js';

/**
 * PSK Reporter Band Activity Overlay
 *
 * Shows a compact horizontal bar chart of spot counts per HF band.
 * Receives live data from usePSKReporter via 'psk-band-activity-changed' event,
 * which already filters by the user's time window (ohc_psk_age).
 *
 * Data source: usePSKReporter hook (txReports + rxReports)
 * Update: real-time via event (no polling needed)
 */

export const metadata = {
  id: 'psk-band-activity',
  name: 'PSKR Band Activity',
  description: 'Spot counts per HF band from PSKReporter',
  icon: '📡',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.85,
  version: '1.0.0',
};

const BAND_ORDER = [
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '10m',
  '8m',
  '6m',
  '4m',
  '2m',
  '70cm',
];

export function useLayer({ enabled = false, map = null }) {
  const [bandCounts, setBandCounts] = useState([]); // [[band, count], ...]
  const [pskAge, setPskAge] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_psk_age')) || 15;
    } catch {
      return 15;
    }
  });
  const [totalSpots, setTotalSpots] = useState(0);

  const controlRef = useRef(null);
  const updateTimeoutRef = useRef(null);
  const latestRef = useRef({ total: 0, age: 15 });

  // Read time window from localStorage and listen for changes
  useEffect(() => {
    const sync = () => {
      try {
        const v = parseInt(localStorage.getItem('ohc_psk_age'));
        if (Number.isFinite(v) && v > 0) setPskAge(v);
      } catch {}
    };
    window.addEventListener('ohc-psk-age-changed', sync);
    return () => {
      window.removeEventListener('ohc-psk-age-changed', sync);
    };
  }, []);

  // Listen for band activity data from usePSKReporter
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      const { bands, total } = e.detail || {};
      if (bands) setBandCounts(bands);
      if (total !== undefined) setTotalSpots(total);
    };

    window.addEventListener('psk-band-activity-changed', handler);
    return () => {
      window.removeEventListener('psk-band-activity-changed', handler);
    };
  }, [enabled]);

  // Update the panel content when data changes (no recreation)
  useEffect(() => {
    if (!enabled) return;
    updateTimeoutRef.current = setTimeout(() => {
      const container = controlRef.current?.getContainer() || document.querySelector('.psk-band-activity');
      if (!container) return;

      const maxCount = bandCounts.length > 0 ? bandCounts[0][1] : 0;
      const countsMap = new Map(bandCounts);

      const rows = BAND_ORDER.map((band) => {
        const count = countsMap.get(band) || 0;
        const active = count > 0;
        const color = DEFAULT_BAND_COLORS[band] || '#888888';
        const barWidth = maxCount > 0 ? Math.max((count / maxCount) * 100, 1.5) : 0;
        return `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;font-family:var(--font-mono);${active ? '' : 'opacity:0.4;'}">
            <span style="width:32px;text-align:right;font-weight:700;color:${active ? 'var(--text-primary)' : 'var(--text-muted)'};">${esc(band)}</span>
            <div style="flex:1;background:var(--bg-tertiary);border-radius:2px;height:12px;overflow:hidden;">
              <div style="width:${barWidth}%;height:100%;background:${color};border-radius:2px;"></div>
            </div>
            <span style="width:32px;text-align:right;color:${active ? 'var(--text-secondary)' : 'var(--text-muted)'};min-width:32px;">${count}</span>
          </div>
        `;
      }).join('');

      // Inject into psk-band-content (our unique content div)
      let contentTarget = container.querySelector('.psk-band-content');
      if (!contentTarget) {
        contentTarget = document.createElement('div');
        contentTarget.className = 'psk-band-content';
        container.insertBefore(contentTarget, container.querySelector('.psk-band-footer'));
      }
      contentTarget.innerHTML = `<div style="padding:0 12px;">${rows}</div>`;
    }, 30);

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    };
  }, [enabled, bandCounts, totalSpots]);

  // Keep ref in sync with state (so footer creation reads latest values)
  useEffect(() => {
    latestRef.current = { total: totalSpots, age: pskAge };
  }, [totalSpots, pskAge]);

  // Update footer independently (runs on totalSpots or pskAge change)
  useEffect(() => {
    if (!enabled) return;
    const footer = document.querySelector('.psk-band-activity .psk-band-footer');
    if (footer) {
      const span = footer.querySelector('#psk-band-footer-text');
      if (span) span.textContent = `Total: ${totalSpots} · Last ${pskAge} min`;
    }
  }, [enabled, totalSpots, pskAge]);

  // Create the control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const panelWrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'psk-band-activity', panelWrapper);
        div.style.cssText = 'min-width: 180px; max-width: 240px;';
        div.innerHTML = `
          <div class="floating-panel-header">📡 PSKR Band Activity</div>
          <div class="psk-band-content"></div>
          <div class="psk-band-footer" style="margin-top:6px;padding:8px 12px 4px;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);text-align:center">
            <hr style="border:none;border-top:1px solid var(--border-color);margin:0 0 4px;">
            <span id="psk-band-footer-text">Total: 0 · Last ${latestRef.current.age} min</span>
          </div>
        `;

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        return panelWrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    // Make draggable and minimizable
    setTimeout(() => {
      const container = document.querySelector('.psk-band-activity');
      if (container) {
        const saved = localStorage.getItem('psk-band-activity-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch {}
        }

        makeDraggable(container, 'psk-band-activity-position', { snap: 5 });
        addMinimizeToggle(container, 'psk-band-activity-position', {
          contentClassName: 'psk-panel-content',
          buttonClassName: 'psk-minimize-btn',
        });
      }
    }, 150);

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [enabled, map]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled) {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    }
  }, [enabled, map]);

  return null;
}
