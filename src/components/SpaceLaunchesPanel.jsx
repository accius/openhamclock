/**
 * SpaceLaunchesPanel Component
 * Upcoming orbital launches (Launch Library 2 via the server's 30-minute
 * cache): name, provider, pad and a live T-0 countdown. Click a row to set
 * the DX target to the launch pad — handy for satellite operators waiting
 * on a rideshare, and for anyone who likes a countdown on the shack wall.
 * A map-layer toggle shows the pads as markers (launch-sites layer).
 */
import { useState, useEffect, useMemo } from 'react';
import { useSpaceLaunches } from '../hooks/useSpaceLaunches.js';
import { calculateBearing, calculateDistance, formatDistance } from '../utils/geo.js';

const STATUS_COLORS = {
  Go: '#4ade80',
  TBC: '#fbbf24',
  TBD: 'var(--text-muted)',
  Success: 'var(--accent-cyan)',
  Failure: '#ef4444',
  'Partial Failure': '#ff9632',
  'In Flight': '#4ade80',
  Hold: '#fbbf24',
};

/** "T-2d 04:13:22" / "T+00:03:10" countdown text. */
export const formatCountdown = (netIso, now) => {
  const ms = Date.parse(netIso) - now;
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? 'T+' : 'T-';
  let s = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${sign}${days > 0 ? `${days}d ` : ''}${p(h)}:${p(m)}:${p(s)}`;
};

const fmtNet = (iso, precision) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  const day = `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  if (precision && /MONTH|QUARTER|YEAR|HALF|WEEK/i.test(precision)) return `${day} (${precision})`;
  if (precision && /DAY/i.test(precision)) return `${day} (day)`;
  return `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}z`;
};

const MAP_LAYER_ID = 'launch-sites';

const readLayerOn = () => {
  try {
    const live = window.hamclockLayerControls?.layers?.find((l) => l.id === MAP_LAYER_ID);
    if (live) return !!live.enabled;
    const saved = JSON.parse(localStorage.getItem('openhamclock_mapSettings') || '{}');
    return !!saved?.layers?.[MAP_LAYER_ID]?.enabled;
  } catch {
    return false;
  }
};

/** Mirror of the launch-sites map layer, toggled through the shared layer bridge. */
const useLaunchLayerToggle = () => {
  const [on, setOn] = useState(readLayerOn);
  useEffect(() => {
    const onToggle = (e) => {
      if (e.detail?.id === MAP_LAYER_ID) setOn(!!e.detail.enabled);
    };
    window.addEventListener('openhamclock-layer-toggle', onToggle);
    return () => window.removeEventListener('openhamclock-layer-toggle', onToggle);
  }, []);
  const toggle = () => {
    const ctl = window.hamclockLayerControls;
    if (!ctl?.toggleLayer) return;
    const next = !readLayerOn();
    ctl.toggleLayer(MAP_LAYER_ID, next);
    setOn(next);
  };
  return [on, toggle];
};

export const SpaceLaunchesPanel = ({ deLocation, units, onSetDX, dxLocked }) => {
  const { launches, data, loading, error } = useSpaceLaunches(true);
  const [showOnMap, onToggleMap] = useLaunchLayerToggle();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deLat = deLocation?.lat;
  const deLon = deLocation?.lon;
  const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);

  // Hide launches that are more than 6 h in the past (LL2 keeps "upcoming"
  // entries around until the status settles).
  const visible = useMemo(() => launches.filter((l) => Date.parse(l.net) > now - 6 * 3600e3), [launches, now]);

  const handleClick = (l) => {
    if (l.lat == null || l.lon == null || typeof onSetDX !== 'function') return;
    onSetDX({ lat: l.lat, lon: l.lon, callsign: null, label: l.pad });
  };

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
        <span>🚀 SPACE LAUNCHES</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {data?.stale && <span style={{ color: '#fbbf24', fontSize: '9px', fontWeight: 400 }}>stale</span>}
          {typeof onToggleMap === 'function' && (
            <button
              type="button"
              onClick={onToggleMap}
              aria-label={showOnMap ? 'Hide launch sites on map' : 'Show launch sites on map'}
              aria-pressed={!!showOnMap}
              title="Launch sites map layer"
              style={{
                background: showOnMap ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: showOnMap ? '#000' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '3px',
                padding: '1px 6px',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              MAP
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error ? 'Launch schedule unavailable' : 'No upcoming launches'}
          </div>
        ) : (
          <div style={{ fontSize: '10px' }}>
            {visible.map((l, i) => {
              const ms = Date.parse(l.net) - now;
              const soon = ms > 0 && ms < 2 * 3600e3;
              const live = ms <= 0;
              const hasPad = l.lat != null && l.lon != null;
              const dist =
                hasDE && hasPad ? formatDistance(calculateDistance(deLat, deLon, l.lat, l.lon), units) : null;
              const brg = hasDE && hasPad ? Math.round(calculateBearing(deLat, deLon, l.lat, l.lon)) : null;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => handleClick(l)}
                  disabled={!hasPad || dxLocked}
                  aria-label={`${l.name}, ${hasPad ? 'set DX to ' + (l.pad || 'launch pad') : 'pad location unknown'}`}
                  title={
                    hasPad
                      ? dxLocked
                        ? 'DX is locked'
                        : `Set DX to ${l.pad || 'pad'}${l.location ? ` (${l.location})` : ''}`
                      : 'Pad location unknown'
                  }
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background: i === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${live ? 'rgba(74, 222, 128, 0.4)' : soon ? 'rgba(251, 191, 36, 0.4)' : 'transparent'}`,
                    cursor: hasPad && !dxLocked ? 'pointer' : 'default',
                    color: 'inherit',
                    font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {l.name}
                    </span>
                    <span
                      style={{
                        color: live ? '#4ade80' : soon ? '#fbbf24' : 'var(--accent-amber)',
                        fontWeight: 700,
                        fontSize: i === 0 ? '12px' : '10px',
                        flexShrink: 0,
                      }}
                    >
                      {formatCountdown(l.net, now)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      marginTop: '2px',
                      color: 'var(--text-muted)',
                      fontSize: '9px',
                      flexWrap: 'wrap',
                    }}
                  >
                    {l.status && (
                      <span style={{ color: STATUS_COLORS[l.status] || 'var(--text-muted)', fontWeight: 700 }}>
                        {l.status.toUpperCase()}
                      </span>
                    )}
                    <span>{l.provider || '—'}</span>
                    <span>· {fmtNet(l.net, l.netPrecision)}</span>
                    {l.probability != null && <span>· {l.probability}% go</span>}
                  </div>
                  <div
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '9px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {l.pad || 'Pad TBD'}
                    {l.location ? ` · ${l.location}` : ''}
                    {dist ? ` · ${dist} @ ${brg}°` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
        <a
          href="https://thespacedevs.com/llapi"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          Launch Library 2 · click a row to set DX
        </a>
      </div>
    </div>
  );
};

export default SpaceLaunchesPanel;
