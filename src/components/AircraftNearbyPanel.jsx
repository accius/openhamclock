/**
 * AircraftNearbyPanel — live aircraft within a selectable radius of the DE
 * location, sorted nearest-first: flight, type, altitude, speed, heading,
 * distance and bearing. Client-side filter over the /api/aircraft world
 * snapshot (adsb.lol via the server's shared 60 s cache) — no new upstream
 * traffic. Companion to the Air Traffic layout's map overlays.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { calculateDistance, calculateBearing } from '../utils/geo.js';
import { formatBearing, useBearingMode } from '../utils/bearing.js';

const POLL_MS = 60 * 1000;
const RADIUS_OPTIONS_KM = [50, 100, 250, 500];
const RADIUS_KEY = 'ohc_aircraft_radius';
const MAX_ROWS = 40;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const altLabel = (ft) => {
  if (ft == null) return '—';
  return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString()} ft`;
};

export const AircraftNearbyPanel = ({ config }) => {
  const lat = config?.location?.lat ?? null;
  const lon = config?.location?.lon ?? null;
  const useMiles = (config?.allUnits?.dist ?? 'metric') === 'imperial';

  const [radiusKm, setRadiusKm] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(RADIUS_KEY));
      return RADIUS_OPTIONS_KM.includes(stored) ? stored : 250;
    } catch {
      return 250;
    }
  });
  const [aircraft, setAircraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    if (lat == null || lon == null) {
      setLoading(false);
      return undefined;
    }
    const fetchAircraft = async () => {
      try {
        const response = await apiFetch('/api/aircraft');
        if (response?.ok) {
          const payload = await response.json();
          setAircraft(Array.isArray(payload.aircraft) ? payload.aircraft : []);
        }
      } catch (err) {
        console.error('Aircraft nearby error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAircraft();
    fetchRef.current = fetchAircraft;
    const id = setInterval(fetchAircraft, POLL_MS);
    return () => clearInterval(id);
  }, [lat, lon]);

  const changeRadius = (km) => {
    setRadiusKm(km);
    try {
      localStorage.setItem(RADIUS_KEY, String(km));
    } catch {}
  };

  const dist = (km) => (useMiles ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`);
  const bearingMode = useBearingMode();

  const nearby = (aircraft || [])
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => ({
      ...p,
      km: calculateDistance(lat, lon, p.lat, p.lon),
      bearing: calculateBearing(lat, lon, p.lat, p.lon),
    }))
    .filter((p) => p.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_ROWS);

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>AIRCRAFT NEARBY</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {nearby.length > 0 && (
            <span
              style={{
                background: 'rgba(127, 212, 255, 0.15)',
                color: 'var(--accent-blue)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: 700,
                border: '1px solid var(--accent-blue)',
              }}
            >
              {nearby.length}
            </span>
          )}
          <select
            value={radiusKm}
            onChange={(e) => changeRadius(Number(e.target.value))}
            aria-label="Search radius"
            style={{
              padding: '2px 4px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '9px',
            }}
          >
            {RADIUS_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {useMiles ? `${Math.round(km * 0.621371)} mi` : `${km} km`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {lat == null ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your location in Settings → Station
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : nearby.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No aircraft within {dist(radiusKm)}
          </div>
        ) : (
          nearby.map((p) => (
            <div
              key={p.id || `${p.lat}-${p.lon}`}
              style={{
                padding: '4px 6px',
                marginBottom: '3px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.03)',
                opacity: p.onGround ? 0.55 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
                <span
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {p.call || p.registration || p.id}
                  {p.type && <span style={{ color: 'var(--accent-purple)', fontWeight: 400 }}> {p.type}</span>}
                  {p.onGround && <span style={{ color: 'var(--text-muted)', fontSize: '8px' }}> GND</span>}
                </span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, flexShrink: 0 }}>
                  {dist(p.km)} {compass(p.bearing)} {formatBearing(p.bearing, lat, lon, bearingMode)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--text-muted)',
                  marginTop: '1px',
                  gap: '6px',
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.operator || p.desc || '—'}
                </span>
                <span style={{ flexShrink: 0 }}>
                  {altLabel(p.alt_ft)}
                  {p.speed_kn != null && <span> · {Math.round(p.speed_kn)} kn</span>}
                  {p.heading != null && <span> · {compass(p.heading)}</span>}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}
      >
        ADS-B: adsb.lol
      </div>
    </div>
  );
};

export default AircraftNearbyPanel;
