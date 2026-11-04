/**
 * MapCursorReadout — the flat map's cursor info strip: lat/lon, Maidenhead
 * grid, distance/bearing from DE, and the nearest city (population) when one
 * is within ~100 km. Listens to Leaflet mousemove on the given map and sits
 * in the map's top-right corner, under the projection/style toggles and clear
 * of the band legend and news ticker along the bottom (the azimuthal
 * projection has its own cursor tooltip, which carries the same city text).
 */
import { useEffect, useState } from 'react';
import { latLonToMaidenhead, calculateDistance, calculateBearing, formatDistance } from '../utils/geo.js';
import { nearestCity, formatPopulation } from '../utils/nearestCity.js';

export const CITY_RADIUS_KM = 100;

/** Pure text builder (tested): "42.4°, -71.1° FN42 · 123 km 045° · Boston (650k) 12 km" */
export function cursorReadoutText({ lat, lon, deLat = null, deLon = null, units = 'metric' }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const nlon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const parts = [`${lat.toFixed(1)}°, ${nlon.toFixed(1)}°`, latLonToMaidenhead({ lat, lon: nlon }, 4)];
  if (Number.isFinite(deLat) && Number.isFinite(deLon)) {
    const km = calculateDistance(deLat, deLon, lat, nlon);
    const brg = Math.round(calculateBearing(deLat, deLon, lat, nlon));
    parts.push(`${formatDistance(km, units)} ${String(brg).padStart(3, '0')}°`);
  }
  const city = nearestCity(lat, nlon, CITY_RADIUS_KM);
  if (city) {
    const dist = city.km < 5 ? '' : ` ${formatDistance(city.km, units)}`;
    parts.push(`${city.name} (${formatPopulation(city.population)})${dist}`);
  }
  return parts.join(' · ');
}

export const MapCursorReadout = ({ map, deLocation = null, units = 'metric', hidden = false }) => {
  const [text, setText] = useState('');
  const deLat = deLocation?.lat ?? null;
  const deLon = deLocation?.lon ?? null;

  useEffect(() => {
    if (!map || typeof map.on !== 'function') return undefined;
    let raf = 0;
    let last = null;
    const onMove = (e) => {
      last = e.latlng;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!last) return;
        setText(cursorReadoutText({ lat: last.lat, lon: last.lng, deLat, deLon, units }));
      });
    };
    const onOut = () => {
      last = null;
      setText('');
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      try {
        map.off('mousemove', onMove);
        map.off('mouseout', onOut);
      } catch {}
    };
  }, [map, deLat, deLon, units]);

  if (hidden || !text) return null;
  return (
    <div
      aria-live="off"
      style={{
        position: 'absolute',
        top: '46px',
        right: '10px',
        zIndex: 1000,
        pointerEvents: 'none',
        background: 'rgba(0, 0, 0, 0.72)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '2px 7px',
        color: 'var(--accent-cyan)',
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100% - 16px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
};

export default MapCursorReadout;
