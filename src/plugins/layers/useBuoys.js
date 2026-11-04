/**
 * 🛟 NDBC buoys layer — latest marine observations from every reporting
 * NDBC / partner station (/api/ndbc/latest?all=1, server-cached 15 min).
 * Dots are coloured by significant wave height; click for wind, waves,
 * pressure and temperatures. Shares its poll with the Marine panel.
 */
import i18n from '../../lang/i18n';
import { useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { useNDBCAllBuoys } from '../../hooks/useNDBCBuoys.js';
import { buoyPopupRows, waveColor, hasMarineData } from '../../utils/marine.js';

export const metadata = {
  id: 'ndbc-buoys',
  name: i18n.t('plugins.layers.ndbcBuoys.name'),
  description: i18n.t('plugins.layers.ndbcBuoys.description'),
  icon: '🛟',
  category: 'weather',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

function popupHtml(station, units) {
  const rows = buoyPopupRows(station, units)
    .map(
      ([k, v]) => `<tr><td style="white-space:nowrap;padding-right:8px;"><b>${esc(k)}:</b></td><td>${esc(v)}</td></tr>`,
    )
    .join('');
  const color = waveColor(station.wvht);
  return `
    <div style="font-family: var(--font-mono); min-width: 220px; max-width: 320px;">
      <div style="font-size: 13px; font-weight: bold; color: ${color}; margin-bottom: 6px;">🛟 ${esc(station.id)}</div>
      ${station.name ? `<div style="font-size: 11px; margin-bottom: 6px; color: var(--text-secondary);">${esc(station.name)}</div>` : ''}
      <table style="font-size: 11px; width: 100%; line-height: 1.4;">${rows}</table>
      <div style="margin-top: 6px; display:flex; gap:10px; align-items:center;">
        <button type="button" data-buoy-dx="1" style="background:var(--bg-tertiary);color:var(--accent-green);border:1px solid var(--accent-green);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">🎯 Set as DX</button>
        <a href="https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(String(station.id).toLowerCase())}" target="_blank" rel="noopener" style="color: var(--accent-cyan); font-size: 11px;">NDBC page →</a>
      </div>
    </div>`;
}

export function useLayer({
  enabled = false,
  opacity = 0.9,
  map = null,
  onDXChange = null,
  allUnits = null,
  lowMemoryMode = false,
}) {
  const { stations } = useNDBCAllBuoys(enabled);
  const groupRef = useRef(null);
  const rendererRef = useRef(null);
  const onDXRef = useRef(onDXChange);
  onDXRef.current = onDXChange;
  const units = allUnits?.dist || 'metric';

  useEffect(() => {
    if (!map || typeof L === 'undefined') return undefined;
    if (groupRef.current) {
      try {
        map.removeLayer(groupRef.current);
      } catch (e) {}
      groupRef.current = null;
    }
    if (!enabled || !stations.length) return undefined;

    // One canvas renderer per map instance — ~900 SVG circles would be slow
    if (!rendererRef.current || rendererRef.current._map !== map) {
      rendererRef.current = L.canvas({ padding: 0.5 });
    }
    const renderer = rendererRef.current;
    const group = L.layerGroup();
    const max = lowMemoryMode ? 250 : 1500;
    let n = 0;

    for (const s of stations) {
      if (!hasMarineData(s)) continue;
      if (n++ >= max) break;
      const color = waveColor(s.wvht);
      const marker = L.circleMarker([s.lat, s.lon], {
        renderer,
        radius: s.wvht != null ? 5 : 4,
        color: '#0b1f33',
        weight: 1,
        fillColor: color,
        fillOpacity: opacity,
        opacity,
      })
        .bindTooltip(
          `${esc(s.id)}${s.wvht != null ? ` · ${s.wvht} m` : ''}${s.wspd != null ? ` · ${Math.round(s.wspd * 1.944)} kt` : ''}`,
          { direction: 'top', offset: [0, -4] },
        )
        .bindPopup(popupHtml(s, units), { maxWidth: 340 });
      marker.on('popupopen', (e) => {
        const btn = e.popup.getElement()?.querySelector('[data-buoy-dx]');
        if (btn) {
          btn.addEventListener('click', () => {
            onDXRef.current?.({ lat: s.lat, lon: s.lon });
            marker.closePopup();
          });
        }
      });
      marker.addTo(group);
    }

    group.addTo(map);
    groupRef.current = group;
    return () => {
      try {
        map.removeLayer(group);
      } catch (e) {}
      if (groupRef.current === group) groupRef.current = null;
    };
  }, [map, enabled, stations, opacity, units, lowMemoryMode]);

  return { stationCount: stations.length };
}
