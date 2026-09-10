/**
 * callLabel — the callsign pill drawn next to a plotted station.
 *
 * Same visual language as the DX Cluster spot labels in WorldMap (mono
 * font, coloured pill, dark border), so a QSO layer's contacts read like the
 * spot pills a user already knows — just in the layer's own colour. Anchored
 * to the upper-right of the dot so it never covers the marker itself.
 */
import { esc } from '../../utils/escapeHtml.js';

/**
 * Build a non-interactive Leaflet marker carrying a callsign pill.
 * @param {object} L        Leaflet global
 * @param {[number, number]} latlng
 * @param {string} text     callsign (escaped here)
 * @param {string} color    pill background (already sanitised by the caller)
 * @param {{ opacity?: number, zIndexOffset?: number, textColor?: string }} [opts]
 */
export function makeCallLabel(L, latlng, text, color, { opacity = 1, zIndexOffset = 500, textColor = '#000' } = {}) {
  const html =
    `<span style="display:inline-block;background:${color};color:${textColor};padding:2px 5px;` +
    `border-radius:3px;font-family:var(--font-mono);font-size:11px;font-weight:700;white-space:nowrap;` +
    `border:1px solid rgba(0,0,0,0.5);box-shadow:0 1px 2px rgba(0,0,0,0.3);line-height:1.1;` +
    `opacity:${Math.max(0, Math.min(1, opacity))};">${esc(text)}</span>`;
  const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [-8, 8] });
  return L.marker(latlng, { icon, interactive: false, keyboard: false, zIndexOffset });
}
