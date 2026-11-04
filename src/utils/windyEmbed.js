/**
 * Windy.com embed URL builder for the Windy panel.
 * Docs: https://www.windy.com/widgets (embed2 parameters).
 */

export const WINDY_OVERLAYS = [
  { id: 'wind', label: 'Wind' },
  { id: 'rain', label: 'Rain' },
  { id: 'clouds', label: 'Clouds' },
  { id: 'temp', label: 'Temperature' },
  { id: 'pressure', label: 'Pressure' },
  { id: 'waves', label: 'Waves' },
];

export const DEFAULT_WINDY_OVERLAY = 'wind';
export const WINDY_ZOOM_MIN = 3;
export const WINDY_ZOOM_MAX = 11;

export function isWindyOverlay(id) {
  return WINDY_OVERLAYS.some((o) => o.id === id);
}

/**
 * Build the iframe src.
 * @param {{lat:number, lon:number, overlay?:string, zoom?:number, units?:'metric'|'imperial', marker?:boolean}} opts
 */
export function buildWindyEmbedUrl({
  lat,
  lon,
  overlay = DEFAULT_WINDY_OVERLAY,
  zoom = 5,
  units = 'metric',
  marker = true,
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const z = Math.max(WINDY_ZOOM_MIN, Math.min(WINDY_ZOOM_MAX, Math.round(zoom)));
  const ov = isWindyOverlay(overlay) ? overlay : DEFAULT_WINDY_OVERLAY;
  const imperial = units === 'imperial';
  const params = new URLSearchParams({
    type: 'map',
    location: 'coordinates',
    metricRain: imperial ? 'in' : 'mm',
    metricTemp: imperial ? '°F' : '°C',
    metricWind: imperial ? 'mph' : 'kt',
    zoom: String(z),
    overlay: ov,
    product: 'ecmwf',
    level: 'surface',
    lat: lat.toFixed(3),
    lon: lon.toFixed(3),
    detailLat: lat.toFixed(3),
    detailLon: lon.toFixed(3),
    detail: 'false',
    marker: marker ? 'true' : 'false',
    message: 'true',
    calendar: 'now',
    pressure: 'false',
  });
  return `https://embed.windy.com/embed.html?${params.toString()}`;
}

export default buildWindyEmbedUrl;
