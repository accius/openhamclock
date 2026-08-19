/**
 * Satellite telemetry derivation.
 *
 * Unit conversion, pass timing and visibility classification for the satellite
 * info window, kept separate from any renderer. The Leaflet layer builds its
 * window as an HTML string and the 3D globe renders a React panel; sharing the
 * derivation means the two can differ in presentation without ever disagreeing
 * about the numbers.
 */

const KM_TO_MILES = 0.621371;

/** hh:mm:ss countdown, zero-padded, matching the Leaflet window's format. */
export function formatSecsFromNow(secsFromNow) {
  if (!Number.isFinite(secsFromNow)) return '';
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  if (secsFromNow > 3600) {
    return `${pad(secsFromNow / 3600)}:${pad((secsFromNow % 3600) / 60)}:${pad(secsFromNow % 60)}`;
  }
  if (secsFromNow > 60) return `00:${pad(secsFromNow / 60)}:${pad(secsFromNow % 60)}`;
  return `00:00:${pad(secsFromNow)}`;
}

/**
 * Next upcoming (or currently running) pass, from the parallel start/end arrays
 * the satellite hook emits. Returns seconds from now, or nulls when no pass is
 * known.
 */
export function nextPassTiming(sat, now = new Date()) {
  const starts = Array.isArray(sat?.nextPassStartTimes) ? sat.nextPassStartTimes : [];
  const ends = Array.isArray(sat?.nextPassEndTimes) ? sat.nextPassEndTimes : [];

  let startsIn = null;
  let endsIn = null;

  starts.forEach((startTime, i) => {
    const start = new Date(startTime).getTime();
    const end = new Date(ends[i]).getTime();
    const secsToStart = Number.isFinite(start) ? Math.floor((start - now) / 1000) : null;
    const secsToEnd = Number.isFinite(end) ? Math.floor((end - now) / 1000) : null;
    // First pass that has not finished yet wins.
    if (secsToEnd > 0 && startsIn === null) {
      startsIn = secsToStart;
      endsIn = secsToEnd;
    }
  });

  return { startsIn, endsIn };
}

/**
 * Everything the info window needs about one satellite, already converted and
 * formatted for display.
 *
 * @param {object} sat       - entry from the useSatellites hook
 * @param {object} allUnits  - app unit preferences ({ dist: 'metric' | 'imperial' })
 * @param {Date}   [now]     - injectable for tests
 */
export function deriveSatelliteTelemetry(sat, allUnits, now = new Date()) {
  const s = sat ?? {};
  const isMetric = allUnits?.dist === 'metric';
  const factor = isMetric ? 1 : KM_TO_MILES;
  const distUnit = isMetric ? 'km' : 'miles';
  const speedUnit = isMetric ? 'km/h' : 'mph';
  const rangeRateUnit = isMetric ? 'km/s' : 'miles/s';

  const isVisible = s.isVisible === true;
  const isAboveHorizon = Number.isFinite(s.elevation) && s.elevation >= 0;

  const alt = Number.isFinite(s.alt) ? Math.round(s.alt * factor) : null;
  const speed = Number.isFinite(s.speedKmH) ? Math.round(s.speedKmH * factor) : null;
  const { startsIn, endsIn } = nextPassTiming(s, now);

  return {
    name: s.name || '',
    isVisible,
    // Above the horizon but below the configured minimum elevation is a
    // meaningfully different state from below the horizon entirely.
    status: isVisible ? 'visible' : isAboveHorizon ? 'belowMinElev' : 'belowHorizon',
    lat: Number.isFinite(s.lat) ? s.lat.toFixed(2) : '',
    lon: Number.isFinite(s.lon) ? s.lon.toFixed(2) : '',
    altitude: alt !== null ? `${alt.toLocaleString()} ${distUnit}` : 'N/A',
    speed: speed !== null ? `${speed.toLocaleString()} ${speedUnit}` : 'N/A',
    azEl:
      Number.isFinite(s.azimuth) && Number.isFinite(s.elevation)
        ? `${Math.round(s.azimuth)}° / ${Math.round(s.elevation)}°`
        : '',
    range: Number.isFinite(s.range) ? `${Math.round(s.range * factor)} ${distUnit}` : '',
    rangeRate: Number.isFinite(s.rangeRate) ? `${(s.rangeRate * factor).toFixed(2)} ${rangeRateUnit}` : '',
    dopplerFactor: Number.isFinite(s.dopplerFactor) ? s.dopplerFactor.toFixed(7) : '',
    nextPass: startsIn !== null ? formatSecsFromNow(startsIn) : '',
    endingIn: endsIn !== null ? formatSecsFromNow(endsIn) : '',
    mode: s.mode || 'N/A',
    downlink: s.downlink || '',
    uplink: s.uplink || '',
    tone: s.tone || '',
    notes: s.notes || '',
    omm: s.omm || null,
  };
}

export default { deriveSatelliteTelemetry, nextPassTiming, formatSecsFromNow };
