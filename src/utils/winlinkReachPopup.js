/**
 * Reachability line for a Winlink gateway's Leaflet popup — shared by the
 * Winlink Gateways layer and the EmComm layout's gateway markers so both
 * say the same thing. `t` is an i18next t function.
 */
import { esc } from './escapeHtml.js';
import { STATUS_COLORS, reachColorKey } from './winlinkReach.js';

function line(color, text) {
  return `<div style="margin-bottom:4px;color:${color};font-weight:600;">${esc(text)}</div>`;
}

export function reachPopupLine(entry, t) {
  if (!entry) return '';
  const color = STATUS_COLORS[reachColorKey(entry)];
  let html = '';
  if (entry.status === 'offair') {
    html = line(color, t('winlinkReach.status.offair', { defaultValue: 'Off the air' }));
  } else if (entry.kind === 'packet') {
    const label = {
      los: t('winlinkReach.los.los', { defaultValue: 'Line of sight' }),
      extended: t('winlinkReach.los.extended', { defaultValue: 'Needs height / good antenna' }),
      beyond: t('winlinkReach.los.beyond', { defaultValue: 'Beyond line of sight' }),
    }[entry.los];
    html = label ? line(color, label) : '';
  } else {
    const status = {
      good: t('winlinkReach.status.good', { defaultValue: 'Good' }),
      marginal: t('winlinkReach.status.marginal', { defaultValue: 'Marginal' }),
      closed: t('winlinkReach.status.closed', { defaultValue: 'Closed' }),
    }[entry.status];
    if (status) {
      const rel = Number.isFinite(entry.reliability) ? ` · ${entry.reliability}%` : '';
      const snr = Number.isFinite(entry.snrMargin) ? ` · ${entry.snrMargin >= 0 ? '+' : ''}${entry.snrMargin} dB` : '';
      const where = entry.freqHz ? ` · ${(entry.freqHz / 1e6).toFixed(3)} ${entry.modeLabel || ''}` : '';
      html = line(color, status + rel + snr + where);
    }
  }
  if (entry.hoursUnknown) {
    html += `<div style="margin-bottom:4px;color:var(--text-muted);font-size:10px;">${esc(
      t('winlinkReach.hoursUnknownShort', {
        defaultValue: 'Hours unknown ("{{text}}") — may be off the air now',
        text: entry.hoursText || '',
      }),
    )}</div>`;
  }
  return html;
}
