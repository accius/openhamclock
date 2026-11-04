/**
 * aprsInternet — this viewer's internet APRS (APRS-IS) settings.
 *
 * The server keeps one APRS-IS connection whose filter is the union of the
 * areas its viewers ask for. Each browser asks for a circle around its own
 * station location (radius chosen here) or, with internet APRS off, for
 * local RF stations only. Stored per browser in localStorage.
 */
import { calculateDistance } from './geo.js';
import { DEFAULT_CONFIG } from './config.js';

export const INTERNET_KEY = 'openhamclock_aprsInternet';
/** Radius presets (km). The server clamps any radius to 10–1000 km. */
export const RADIUS_OPTIONS_KM = [50, 100, 250, 500, 1000];
export const DEFAULT_RADIUS_KM = 250;
export const DEFAULT_INTERNET = { enabled: true, radiusKm: DEFAULT_RADIUS_KM };

export function readInternetSettings(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(INTERNET_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_INTERNET };
    return {
      enabled: parsed.enabled !== false,
      radiusKm: RADIUS_OPTIONS_KM.includes(parsed.radiusKm) ? parsed.radiusKm : DEFAULT_RADIUS_KM,
    };
  } catch {
    return { ...DEFAULT_INTERNET };
  }
}

export function writeInternetSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(INTERNET_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

// Station location as numbers, or null when unset: 0,0, or still the
// built-in default (Boulder), which would hand an unconfigured viewer
// Boulder's stations.
function stationLocation(loc) {
  const lat = Number(loc?.lat);
  const lon = Number(loc?.lon);
  if (loc?.lat == null || loc?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  const def = DEFAULT_CONFIG.location;
  if (lat === def.lat && lon === def.lon) return null;
  return { lat, lon };
}

/**
 * The area this viewer asks for: { lat, lon, radius } around the station
 * location, or null (internet off, or no usable location yet). Rounded to
 * 0.01° (~1 km) so a rover's GPS updates don't change the request (and
 * re-arm the poll) every few metres; the server rounds coarser still.
 */
export function viewerArea(settings, location) {
  const loc = stationLocation(location);
  if (!settings?.enabled || !loc) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { lat: r2(loc.lat), lon: r2(loc.lon), radius: settings.radiusKm };
}

/** Query string for GET /api/aprs/stations. */
export function stationsUrl(settings, location) {
  if (!settings?.enabled) return '/api/aprs/stations?internet=0';
  const area = viewerArea(settings, location);
  if (!area) return '/api/aprs/stations';
  return `/api/aprs/stations?lat=${area.lat}&lon=${area.lon}&radius=${area.radius}`;
}

/**
 * Should a retained internet station still be shown? Off → none; with an
 * area → only inside it (stations kept from a wider radius or an old
 * location fall away at once instead of after the dwell).
 */
export function showInternetStation(station, settings, location) {
  if (!settings?.enabled) return false;
  const area = viewerArea(settings, location);
  if (!area) return true;
  if (station?.lat == null || station?.lon == null) return false;
  return calculateDistance(area.lat, area.lon, station.lat, station.lon) <= area.radius;
}
