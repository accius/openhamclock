import { useEffect } from 'react';
import { getBandColorForBand } from '../../utils/bandColors.js';
import { esc } from '../../utils/escapeHtml.js';
import { getGreatCirclePoints, replicatePath, replicatePoint } from '../../utils/geo.js';
import { MAX_LOGBOOK_LINES, useLogbookMapPoints } from '../../utils/logbookMap.js';

/**
 * Logbook QSOs layer
 *
 * Plots the native logbook's QSOs: a dot per worked location in the band's
 * color (same palette as DX cluster spots) and a great-circle line from DE.
 * It follows the Logbook panel's band / mode / search filter (published via
 * logbookStore's view filter), so the map shows what the table lists. The
 * panel's map button toggles this layer.
 *
 * Position: the logged grid square when there is one, else the DXCC entity's
 * position from cty.dat (approximate — drawn as a hollow dot and marked as
 * such in the popup).
 *
 * QSOs at the same position on the same band share one dot and one line, so a
 * large log stays drawable; the popup lists the calls. Everything goes on a
 * canvas renderer for the same reason. Placement, grouping and filtering live
 * in utils/logbookMap.js, shared with the 3D globe's painter.
 */

export const metadata = {
  id: 'logbook-qsos',
  name: 'plugins.layers.logbookQsos.name',
  description: 'plugins.layers.logbookQsos.description',
  icon: '📓',
  category: 'amateur',
  defaultEnabled: false,
  defaultOpacity: 0.8,
  version: '1.0.0',
};

/** QSOs listed per dot popup before "+N more". */
const POPUP_ROWS = 10;
const ARC_POINTS = 32;

const fmtDate = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '');
const fmtTime = (t) => (t && t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : t || '');

const popupHtml = (point) => {
  const rows = [...point.qsos]
    .sort((a, b) => `${b.qso_date || ''}${b.time_on || ''}`.localeCompare(`${a.qso_date || ''}${a.time_on || ''}`))
    .slice(0, POPUP_ROWS)
    .map(
      (q) =>
        `<tr><td style="padding-right:6px;"><b>${esc(q.call)}</b></td>` +
        `<td style="padding-right:6px;">${esc(fmtDate(q.qso_date))} ${esc(fmtTime(q.time_on))}</td>` +
        `<td>${esc(q.mode || '')}</td></tr>`,
    )
    .join('');
  const more = point.qsos.length - POPUP_ROWS;
  const where = point.approx ? `${esc(point.place)} (country position)` : esc(point.place);
  return (
    `<div style="font-family: var(--font-mono); font-size: 11px;">` +
    `<div style="margin-bottom:4px;"><b>${where}</b>${point.band ? ` · ${esc(point.band)}` : ''}` +
    ` · ${point.qsos.length} QSO${point.qsos.length === 1 ? '' : 's'}</div>` +
    `<table style="border-collapse:collapse;">${rows}</table>` +
    (more > 0 ? `<div style="opacity:0.7;margin-top:2px;">+${more} more</div>` : '') +
    `</div>`
  );
};

export function useLayer({ enabled = false, opacity = 0.8, map = null, deLat = null, deLon = null }) {
  const points = useLogbookMapPoints(enabled);

  useEffect(() => {
    if (!map || typeof L === 'undefined' || !enabled || !points.length) return;

    // The azimuthal projection is periodic in longitude: draw one copy only.
    const isAzimuthal = map.options?.crs?.code === 'AzimuthalEquidistant';
    const renderer = L.canvas({ padding: 0.5 });
    const layers = [];
    // Lines only while they stay readable (see MAX_LOGBOOK_LINES).
    const drawLines = Number.isFinite(deLat) && Number.isFinite(deLon) && points.length <= MAX_LOGBOOK_LINES;

    for (const p of points) {
      const color = getBandColorForBand(p.band);

      if (drawLines) {
        const arc = getGreatCirclePoints(deLat, deLon, p.lat, p.lon, ARC_POINTS);
        for (const seg of isAzimuthal ? [arc] : replicatePath(arc)) {
          if (seg.length < 2) continue;
          layers.push(L.polyline(seg, { renderer, color, weight: 1, opacity: opacity * 0.5, interactive: false }));
        }
      }

      const html = popupHtml(p);
      for (const latlng of isAzimuthal ? [[p.lat, p.lon]] : replicatePoint(p.lat, p.lon)) {
        const dot = L.circleMarker(latlng, {
          renderer,
          radius: p.qsos.length > 1 ? 5 : 4,
          color,
          weight: 1.5,
          opacity,
          fillColor: color,
          // Hollow dot = country position, not a logged grid square.
          fillOpacity: p.approx ? 0.15 : Math.min(1, opacity * 0.85),
        });
        dot.bindPopup(html);
        layers.push(dot);
      }
    }

    layers.forEach((layer) => layer.addTo(map));
    return () => {
      layers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {
          // already removed
        }
      });
    };
  }, [enabled, map, points, opacity, deLat, deLon]);

  return null;
}
