/**
 * RepeatersPanel — nearest repeaters to the DE station, from the open
 * hearham.com directory (proxied + distance-filtered by /api/repeaters).
 * Handy for travel: set DE to where you are and the list follows.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/apiFetch';
import { formatBearing, useBearingMode } from '../utils/bearing.js';
import { fetchWithPackFallback } from '../utils/offlinePackStore.js';
import { relocateRepeaters, formatAsOf } from '../utils/offlinePackManifest.js';

const RADIUS_OPTIONS_KM = [25, 50, 100, 200, 500];
const RADIUS_KEY = 'ohc_repeaters_radius';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export const RepeatersPanel = ({ config }) => {
  const lat = config?.location?.lat ?? null;
  const lon = config?.location?.lon ?? null;
  const useMiles = (config?.allUnits?.dist ?? 'metric') === 'imperial';
  const bearingMode = useBearingMode();
  const { t } = useTranslation();

  const [radiusKm, setRadiusKm] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(RADIUS_KEY));
      return RADIUS_OPTIONS_KM.includes(stored) ? stored : 100;
    } catch {
      return 100;
    }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when the list is a last-known copy (offline): its timestamp
  const [asOf, setAsOf] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    if (lat == null || lon == null) {
      setLoading(false);
      return undefined;
    }
    const fetchRepeaters = async () => {
      setLoading(true);
      try {
        // Offline: the worker's cached answer or an offline area pack
        // snapshot (taken at 200 km, re-centred on DE and cut to radius).
        const r = await fetchWithPackFallback(
          apiFetch,
          `/api/repeaters?lat=${lat}&lon=${lon}&radius=${radiusKm}`,
          undefined,
          { kind: 'repeaters', lat, lon },
        );
        if (r?.source === 'live') {
          setData(r.data);
          setAsOf(null);
        } else if (r?.source === 'cache' || r?.source === 'pack') {
          const list =
            r.source === 'pack' ? relocateRepeaters(r.data?.repeaters, lat, lon, radiusKm) : r.data?.repeaters;
          setData({ ...r.data, repeaters: list || [] });
          setAsOf(r.fetchedAt || null);
        }
      } catch (err) {
        console.error('Repeaters error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRepeaters();
    fetchRef.current = fetchRepeaters;
    return undefined;
  }, [lat, lon, radiusKm]);

  const changeRadius = (km) => {
    setRadiusKm(km);
    try {
      localStorage.setItem(RADIUS_KEY, String(km));
    } catch {}
  };

  const dist = (km) => (useMiles ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`);
  const offsetLabel = (mhz) => (mhz === 0 ? 'simplex' : `${mhz > 0 ? '+' : ''}${mhz.toFixed(1)}`);

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
        <span>REPEATERS</span>
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

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {lat == null ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your location in Settings → Station
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data?.repeaters?.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No repeaters within {dist(radiusKm)} — try a wider radius
          </div>
        ) : (
          data.repeaters.map((r, i) => (
            <div
              key={`${r.callsign}-${r.mhz}-${i}`}
              style={{
                padding: '4px 6px',
                marginBottom: '3px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.03)',
                opacity: r.operational ? 1 : 0.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {r.callsign || '—'}
                  {!r.operational && <span style={{ color: '#ef4444', fontSize: '8px' }}> OFF-AIR</span>}
                </span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  {r.mhz.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--text-muted)',
                  marginTop: '1px',
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {offsetLabel(r.offsetMhz)}
                  {r.tone && <span> · {r.tone}</span>}
                  {r.mode && r.mode !== 'FM' && <span style={{ color: 'var(--accent-purple)' }}> · {r.mode}</span>}
                  {r.city && <span> · {r.city}</span>}
                </span>
                <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                  {dist(r.km)} {compass(r.bearing)} {formatBearing(r.bearing, lat, lon, bearingMode)}
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
        {asOf && (
          <span style={{ color: 'var(--accent-amber)', marginRight: '6px' }}>
            {t('offlinePacks.asOfOffline', { defaultValue: 'Offline — as of {{time}}', time: formatAsOf(asOf) })} ·
          </span>
        )}
        Directory: hearham.com
      </div>
    </div>
  );
};

export default RepeatersPanel;
