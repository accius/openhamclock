/**
 * 🌀 Tropical cyclones layer — active storms from NHC (Atlantic / E+C
 * Pacific) and JTWC (W Pacific, Indian Ocean, southern hemisphere) via
 * /api/tropical/storms. Hurricane symbol scaled and coloured by category,
 * official forecast track with hour/intensity points, cone of uncertainty
 * (NHC) or 34 kt danger swath (JTWC), and JTWC best-track history.
 *
 * Works on the flat (Mercator) and azimuthal Leaflet maps. Shares its poll
 * with the Tropical panel through sharedFetcher.
 */
import i18n from '../../lang/i18n';
import { useEffect, useRef } from 'react';
import { esc, sanitizeUrl } from '../../utils/escapeHtml.js';
import { useTropicalStorms } from '../../hooks/useTropicalStorms.js';
import {
  categoryColor,
  markerSize,
  hurricaneSvg,
  formatWind,
  formatMovement,
  formatPosition,
  basinName,
  formatValidAt,
} from '../../utils/tropical.js';

export const metadata = {
  id: 'tropical-cyclones',
  name: i18n.t('plugins.layers.tropicalCyclones.name'),
  description: i18n.t('plugins.layers.tropicalCyclones.description'),
  icon: '🌀',
  category: 'hazards',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.0.0',
};

function popupHtml(storm, units) {
  const color = categoryColor(storm.category?.code);
  const updated = storm.lastUpdate ? new Date(storm.lastUpdate).toUTCString().replace(':00 GMT', 'Z') : '—';
  const fc = (storm.forecast || [])
    .filter((f) => f.hour > 0)
    .slice(0, 8)
    .map(
      (f) =>
        `<tr><td>+${f.hour}h</td><td>${esc(formatValidAt(f.validAt))}</td><td>${esc(formatPosition(f.lat, f.lon))}</td><td style="text-align:right">${f.windKt != null ? `${f.windKt} kt` : '—'}</td></tr>`,
    )
    .join('');
  return `
    <div style="font-family: var(--font-mono); min-width: 240px; max-width: 340px;">
      <div style="font-size: 14px; font-weight: bold; color: ${color}; margin-bottom: 6px; display:flex; align-items:center; gap:6px;">
        ${hurricaneSvg({ size: 18, color, southern: storm.lat < 0 })}
        ${esc(storm.classificationLabel || storm.category?.label || '')} ${esc(storm.name)}
      </div>
      <table style="font-size: 11px; width: 100%; line-height: 1.4;">
        <tr><td><b>Category:</b></td><td>${esc(storm.category?.label || '—')}</td></tr>
        <tr><td><b>Basin:</b></td><td>${esc(basinName(storm.basin))} · ${esc(storm.source)}${storm.designation ? ` ${esc(storm.designation)}` : ''}</td></tr>
        <tr><td><b>Position:</b></td><td>${esc(formatPosition(storm.lat, storm.lon))}</td></tr>
        <tr><td><b>Max wind:</b></td><td>${esc(formatWind(storm.windKt, units))}${storm.gustKt ? ` · gusts ${storm.gustKt} kt` : ''}</td></tr>
        <tr><td><b>Pressure:</b></td><td>${storm.pressureMb != null ? `${storm.pressureMb} mb` : '—'}</td></tr>
        <tr><td><b>Movement:</b></td><td>${esc(formatMovement(storm, units))}</td></tr>
        <tr><td><b>Updated:</b></td><td>${esc(updated)}${storm.advisoryNum != null ? ` · adv #${storm.advisoryNum}` : ''}</td></tr>
      </table>
      ${
        fc
          ? `<div style="margin-top:6px;font-size:10px;color:var(--text-secondary)"><b>Forecast</b>
             <table style="width:100%;font-size:10px;line-height:1.3">${fc}</table></div>`
          : ''
      }
      <div style="margin-top: 6px; display:flex; gap:10px; align-items:center;">
        <button type="button" data-tropical-dx="1" style="background:var(--bg-tertiary);color:var(--accent-green);border:1px solid var(--accent-green);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">🎯 Set as DX</button>
        ${storm.advisoryUrl ? `<a href="${sanitizeUrl(storm.advisoryUrl)}" target="_blank" rel="noopener" style="color: var(--accent-cyan); font-size: 11px;">Advisory →</a>` : ''}
        ${storm.graphicsUrl ? `<a href="${sanitizeUrl(storm.graphicsUrl)}" target="_blank" rel="noopener" style="color: var(--accent-cyan); font-size: 11px;">Graphics →</a>` : ''}
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
  const { storms } = useTropicalStorms(enabled);
  const groupRef = useRef(null);
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
    if (!enabled || !storms.length) return undefined;

    const group = L.layerGroup();
    const maxStorms = lowMemoryMode ? 8 : 40;

    for (const storm of storms.slice(0, maxStorms)) {
      if (!Number.isFinite(storm.lat) || !Number.isFinite(storm.lon)) continue;
      const code = storm.category?.code;
      const color = categoryColor(code);

      // Cone of uncertainty / danger swath
      if (Array.isArray(storm.cone) && storm.cone.length > 3 && !lowMemoryMode) {
        L.polygon(storm.cone, {
          color,
          weight: 1,
          opacity: opacity * 0.7,
          fillColor: color,
          fillOpacity: opacity * 0.12,
          dashArray: '4 4',
          interactive: false,
        }).addTo(group);
      }

      // Past positions (JTWC best track)
      if (Array.isArray(storm.bestTrack) && storm.bestTrack.length > 1 && !lowMemoryMode) {
        L.polyline(
          storm.bestTrack.map((p) => [p.lat, p.lon]),
          { color: '#cccccc', weight: 1.5, opacity: opacity * 0.6, dashArray: '2 5', interactive: false },
        ).addTo(group);
      }

      // Forecast track
      if (Array.isArray(storm.track) && storm.track.length > 1) {
        L.polyline(storm.track, { color: '#ffffff', weight: 3, opacity: opacity * 0.5, interactive: false }).addTo(
          group,
        );
        L.polyline(storm.track, { color, weight: 2, opacity, dashArray: '6 4', interactive: false }).addTo(group);
      }

      // Forecast points with hour/intensity tooltips
      for (const f of storm.forecast || []) {
        if (!(f.hour > 0) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
        const fColor = categoryColor(
          f.windKt == null
            ? code
            : f.windKt < 34
              ? 'TD'
              : f.windKt < 64
                ? 'TS'
                : f.windKt < 83
                  ? '1'
                  : f.windKt < 96
                    ? '2'
                    : f.windKt < 113
                      ? '3'
                      : f.windKt < 137
                        ? '4'
                        : '5',
        );
        L.circleMarker([f.lat, f.lon], {
          radius: 4,
          color: '#111',
          weight: 1,
          fillColor: fColor,
          fillOpacity: opacity,
          opacity,
        })
          .bindTooltip(
            `+${f.hour} h · ${f.windKt != null ? `${f.windKt} kt` : '—'}${f.validAt ? ` · ${esc(formatValidAt(f.validAt))}` : ''}`,
            {
              direction: 'top',
              offset: [0, -4],
              className: 'tropical-forecast-tooltip',
            },
          )
          .addTo(group);
      }

      // Current position — hurricane symbol scaled by category
      const size = markerSize(code);
      const icon = L.divIcon({
        className: 'tropical-cyclone-icon',
        html: `<div style="width:${size}px;height:${size}px;filter:drop-shadow(0 0 3px rgba(0,0,0,0.7));">${hurricaneSvg({ size, color, southern: storm.lat < 0 })}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
      });
      const marker = L.marker([storm.lat, storm.lon], { icon, opacity, zIndexOffset: 9500 })
        .bindTooltip(`${esc(storm.name)} · ${esc(storm.category?.label || '')}`, {
          direction: 'top',
          offset: [0, -size / 2],
        })
        .bindPopup(popupHtml(storm, units), { maxWidth: 360 });
      marker.on('popupopen', (e) => {
        const btn = e.popup.getElement()?.querySelector('[data-tropical-dx]');
        if (btn) {
          btn.addEventListener('click', () => {
            onDXRef.current?.({ lat: storm.lat, lon: storm.lon });
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
  }, [map, enabled, storms, opacity, units, lowMemoryMode]);

  return { stormCount: storms.length };
}
