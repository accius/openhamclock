/**
 * PlanetsPanel Component
 * Where the planets are from DE right now: azimuth, elevation, next rise
 * and set, distance — Sun and Moon first, then Mercury through Neptune.
 * Bodies above the horizon are highlighted; elongation from the Sun hints
 * whether an inner planet is a morning or evening object. Computed locally
 * once a minute by utils/planets.js (Keplerian elements, ~1′ accuracy).
 */
import { useState, useEffect, useMemo } from 'react';
import { planetTable } from '../utils/planets.js';

const AU_KM = 149597870.7;
const SYMBOLS = {
  Sun: '☉',
  Moon: '☾',
  Mercury: '☿',
  Venus: '♀',
  Mars: '♂',
  Jupiter: '♃',
  Saturn: '♄',
  Uranus: '♅',
  Neptune: '♆',
};
const COLORS = {
  Sun: '#fbbf24',
  Moon: '#cbd5e1',
  Mercury: '#a8a29e',
  Venus: '#fde68a',
  Mars: '#f87171',
  Jupiter: '#fdba74',
  Saturn: '#fcd34d',
  Uranus: '#67e8f9',
  Neptune: '#60a5fa',
};

const fmtTime = (d, use12Hour, timeZone) => {
  if (!d) return '—';
  try {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !!use12Hour,
      timeZone: timeZone || undefined,
    });
  } catch {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: !!use12Hour });
  }
};

const fmtDistance = (row) => {
  if (row.name === 'Moon') return `${Math.round(row.distanceKm / 1000)}k km`;
  if (row.name === 'Sun') return `${row.distanceAU.toFixed(3)} AU`;
  return `${row.distanceAU.toFixed(2)} AU`;
};

const compass = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

export const PlanetsPanel = ({ deLat, deLon, use12Hour, timeZone }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const hasLocation = Number.isFinite(deLat) && Number.isFinite(deLon);
  const rows = useMemo(() => (hasLocation ? planetTable(now, deLat, deLon) : []), [now, deLat, deLon, hasLocation]);
  const upCount = rows.filter((r) => r.el > 0).length;

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
        <span>🪐 PLANETS</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>
          {hasLocation ? `${upCount} above horizon` : 'no DE location'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {!hasLocation ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your DE location to see planet positions
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '8px', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 0' }}>Body</th>
                <th style={{ fontWeight: 400 }}>Az</th>
                <th style={{ fontWeight: 400 }}>El</th>
                <th style={{ fontWeight: 400 }}>Rise</th>
                <th style={{ fontWeight: 400 }}>Set</th>
                <th style={{ fontWeight: 400 }}>Dist</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const up = r.el > 0;
                return (
                  <tr
                    key={r.name}
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      textAlign: 'right',
                      background: up ? 'rgba(74, 222, 128, 0.06)' : 'transparent',
                      color: up ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                    title={
                      r.elongation != null
                        ? `${r.name}: elongation ${r.elongation.toFixed(0)}° ${r.elongationDir === 'E' ? 'east (evening)' : 'west (morning)'} of the Sun · RA ${(r.ra / 15).toFixed(2)}h Dec ${r.dec.toFixed(1)}°`
                        : `${r.name}: RA ${(r.ra / 15).toFixed(2)}h Dec ${r.dec.toFixed(1)}°`
                    }
                  >
                    <td style={{ textAlign: 'left', padding: '3px 0', whiteSpace: 'nowrap' }}>
                      <span style={{ color: COLORS[r.name], fontSize: '12px', marginRight: '4px' }}>
                        {SYMBOLS[r.name]}
                      </span>
                      <span style={{ fontWeight: up ? 600 : 400 }}>{r.name}</span>
                      {r.elongation != null && r.elongation < 20 && r.name !== 'Moon' && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '8px', marginLeft: '3px' }}>near Sun</span>
                      )}
                    </td>
                    <td style={{ padding: '3px 0 3px 4px', whiteSpace: 'nowrap' }}>
                      {Math.round(r.az)}°
                      <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}> {compass(r.az)}</span>
                    </td>
                    <td
                      style={{
                        padding: '3px 0 3px 4px',
                        color: up ? '#4ade80' : undefined,
                        fontWeight: up ? 600 : 400,
                      }}
                    >
                      {r.el > 0 ? '+' : ''}
                      {r.el.toFixed(0)}°
                    </td>
                    <td style={{ padding: '3px 0 3px 4px', whiteSpace: 'nowrap' }}>
                      {r.alwaysUp ? 'up' : r.alwaysDown ? '—' : fmtTime(r.rise, use12Hour, timeZone)}
                    </td>
                    <td style={{ padding: '3px 0 3px 4px', whiteSpace: 'nowrap' }}>
                      {r.alwaysUp ? 'all day' : r.alwaysDown ? 'down' : fmtTime(r.set, use12Hour, timeZone)}
                    </td>
                    <td style={{ padding: '3px 0 3px 4px', whiteSpace: 'nowrap', fontSize: '9px' }}>
                      {fmtDistance(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        Rise/set are the next ones · local time · 1 AU = {Math.round(AU_KM / 1e6)}M km
      </div>
    </div>
  );
};

export default PlanetsPanel;
