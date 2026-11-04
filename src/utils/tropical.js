/**
 * Tropical cyclone presentation helpers shared by the Tropical panel and the
 * tropical-cyclones map layer: category colours (data-driven, so hardcoded
 * on purpose), marker sizing, the standard hurricane symbol as inline SVG,
 * and unit formatting.
 */

/** Colour per category code ('TD','TS','1'..'5','?') — NHC-style ramp. */
export const CATEGORY_COLORS = {
  '?': '#9ca3af',
  TD: '#5ebaff',
  TS: '#00faf4',
  1: '#ffffcc',
  2: '#ffe775',
  3: '#ffc140',
  4: '#ff8f20',
  5: '#ff6060',
};

export function categoryColor(code) {
  return CATEGORY_COLORS[code] || CATEGORY_COLORS['?'];
}

/** Marker diameter in px: depressions small, Cat 5 big. */
export function markerSize(code) {
  const base = { '?': 18, TD: 18, TS: 22, 1: 26, 2: 28, 3: 30, 4: 34, 5: 38 };
  return base[code] || 18;
}

/** Short badge text for a storm. */
export function categoryBadge(storm) {
  const code = storm?.category?.code;
  if (code === 'TD' || code === 'TS' || code === '?') return code === '?' ? '—' : code;
  return `CAT ${code}`;
}

/**
 * The meteorological tropical-cyclone symbol: a disc with two trailing
 * spiral arms. Northern-hemisphere storms spin counter-clockwise (arms
 * trail clockwise); southern-hemisphere storms are mirrored.
 */
export function hurricaneSvg({ size = 24, color = '#fff', southern = false, stroke = 'rgba(0,0,0,0.6)' } = {}) {
  const flip = southern ? 'transform="scale(-1,1) translate(-24,0)"' : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
    `<g ${flip}>` +
    `<path d="M12 2c3.5 0 6.2 1.6 7.6 4.5-1.6-1.2-3.2-1.7-4.6-1.5 2.1 1.1 3.3 3.3 3 6.6-.4 4.4-3.2 7.9-7.9 10.4 1.7-1.6 2.7-3.3 3-5.1-2.3 1.3-4.6 1.3-6.8-.1C3.4 15.4 2.6 11.6 4.1 7.9c.4 2 1.3 3.5 2.6 4.3-.6-2.4-.1-4.6 1.5-6.6C9.3 4 10.5 2.8 12 2z" ` +
    `fill="${color}" stroke="${stroke}" stroke-width="0.8"/>` +
    `<circle cx="12" cy="12" r="2.6" fill="${stroke}"/>` +
    `</g></svg>`
  );
}

const KT_TO_KMH = 1.852;
const KT_TO_MPH = 1.15078;

/** "55 kt (102 km/h)" or "(63 mph)". */
export function formatWind(kt, units = 'metric') {
  if (!Number.isFinite(kt)) return '—';
  const conv = units === 'imperial' ? `${Math.round(kt * KT_TO_MPH)} mph` : `${Math.round(kt * KT_TO_KMH)} km/h`;
  return `${kt} kt (${conv})`;
}

export function formatMovement(storm, units = 'metric') {
  if (!storm || storm.movementKt == null) return storm?.movementText || '—';
  const spd =
    units === 'imperial'
      ? `${Math.round(storm.movementKt * KT_TO_MPH)} mph`
      : `${Math.round(storm.movementKt * KT_TO_KMH)} km/h`;
  const dir = storm.movementText || (storm.movementDeg != null ? `${Math.round(storm.movementDeg)}°` : '');
  return `${dir} ${storm.movementKt} kt (${spd})`.trim();
}

/** "11.9°N 100.0°W" */
export function formatPosition(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;
}

export const BASIN_NAMES = {
  AL: 'Atlantic',
  EP: 'E. Pacific',
  CP: 'C. Pacific',
  WP: 'W. Pacific',
  IO: 'Indian Ocean',
  SH: 'S. Hemisphere',
};

export function basinName(code) {
  return BASIN_NAMES[code] || code || '';
}

/** Sort: strongest first, then most recent. */
export function sortStorms(storms) {
  return [...(storms || [])].sort(
    (a, b) => (b.windKt ?? -1) - (a.windKt ?? -1) || (b.lastUpdate || '').localeCompare(a.lastUpdate || ''),
  );
}

/** Forecast valid time for display: ISO → "Thu 06Z"; free text passes through. */
export function formatValidAt(validAt) {
  if (!validAt) return '';
  const d = new Date(validAt);
  if (/^\d{4}-\d{2}-\d{2}T/.test(validAt) && !Number.isNaN(d.getTime())) {
    const day = d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return `${day} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
  }
  return validAt.replace(/^\s*\d{1,2}:\d{2}\s*[AP]M\s*\w+\s*/i, '');
}
