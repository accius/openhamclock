/**
 * Marine observation formatting shared by the Marine panel and the NDBC
 * buoys map layer. NDBC reports SI units (m/s, m, s, hPa, °C); mariners
 * read wind in knots, so wind is always shown in knots with the user's
 * distance unit deciding metres vs feet for waves and °C vs °F.
 */

const MS_TO_KT = 1.943844;
const M_TO_FT = 3.28084;

export const msToKt = (ms) => (Number.isFinite(ms) ? Math.round(ms * MS_TO_KT) : null);

export function formatWave(m, units = 'metric') {
  if (!Number.isFinite(m)) return '—';
  return units === 'imperial' ? `${(m * M_TO_FT).toFixed(1)} ft` : `${m.toFixed(1)} m`;
}

export function formatTemp(c, units = 'metric') {
  if (!Number.isFinite(c)) return '—';
  return units === 'imperial' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${c.toFixed(1)}°C`;
}

export function formatWindObs(station) {
  if (!station || !Number.isFinite(station.wspd)) return '—';
  const dir = Number.isFinite(station.wdir) ? `${String(Math.round(station.wdir)).padStart(3, '0')}° ` : '';
  const gust = Number.isFinite(station.gst) ? ` G${msToKt(station.gst)}` : '';
  return `${dir}${msToKt(station.wspd)} kt${gust}`;
}

export function formatPressure(station) {
  if (!station || !Number.isFinite(station.pres)) return '—';
  const tend = Number.isFinite(station.ptdy) ? ` (${station.ptdy > 0 ? '+' : ''}${station.ptdy.toFixed(1)}/3h)` : '';
  return `${station.pres.toFixed(1)} hPa${tend}`;
}

export function formatWaves(station, units = 'metric') {
  if (!station || !Number.isFinite(station.wvht)) return '—';
  const period = Number.isFinite(station.dpd) ? ` @ ${Math.round(station.dpd)} s` : '';
  const dir = Number.isFinite(station.mwd) ? ` from ${String(Math.round(station.mwd)).padStart(3, '0')}°` : '';
  return `${formatWave(station.wvht, units)}${period}${dir}`;
}

/** Observation age like "25 min" / "3 h". */
export function formatObsAge(iso, now = Date.now()) {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** Stations with nothing but a position/time are not worth a marker. */
export function hasMarineData(s) {
  return !!s && [s.wspd, s.wvht, s.pres, s.atmp, s.wtmp].some((v) => Number.isFinite(v));
}

/** Colour by significant wave height (sea-state ramp); grey-blue when unknown. */
export function waveColor(wvht) {
  if (!Number.isFinite(wvht)) return '#7fa7c9';
  if (wvht < 1) return '#4ade80';
  if (wvht < 2.5) return '#facc15';
  if (wvht < 4) return '#fb923c';
  return '#ef4444';
}

/** [label, value] rows for a popup/list. */
export function buoyPopupRows(station, units = 'metric', now = Date.now()) {
  const rows = [];
  const age = formatObsAge(station.time, now);
  if (age) rows.push(['Observed', `${age} ago`]);
  rows.push(['Wind', formatWindObs(station)]);
  rows.push(['Waves', formatWaves(station, units)]);
  if (Number.isFinite(station.apd)) rows.push(['Avg period', `${station.apd.toFixed(1)} s`]);
  rows.push(['Pressure', formatPressure(station)]);
  rows.push(['Air temp', formatTemp(station.atmp, units)]);
  rows.push(['Water temp', formatTemp(station.wtmp, units)]);
  if (Number.isFinite(station.dewp)) rows.push(['Dew point', formatTemp(station.dewp, units)]);
  if (Number.isFinite(station.vis)) rows.push(['Visibility', `${station.vis} nmi`]);
  return rows;
}
