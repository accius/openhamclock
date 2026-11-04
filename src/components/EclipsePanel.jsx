/**
 * EclipsePanel Component
 * Next solar and lunar eclipses: type, date/time of greatest eclipse (UTC),
 * where on Earth it is visible, and for the DE location whether it can be
 * seen — local maximum time and obscuration for solar eclipses, whether the
 * Moon is up during the umbral phase for lunar ones. A small Sun/Moon glyph
 * draws the eclipse type. Everything is computed (utils/eclipses.js) from
 * the Meeus canon plus the bundled 2026–2040 visibility table.
 */
import { useMemo, useState, useEffect } from 'react';
import { upcomingEclipses, ECLIPSE_TABLE_SOURCE } from '../utils/eclipses.js';

const TYPE_COLORS = {
  total: '#ef4444',
  hybrid: '#ff9632',
  annular: '#fbbf24',
  partial: 'var(--accent-cyan)',
  penumbral: 'var(--text-muted)',
};

const fmtUTC = (d) => {
  if (!d) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}z`;
};
const fmtHM = (d) =>
  d ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z` : '—';

const daysUntil = (d, now) => {
  const days = (d.getTime() - now) / 86400000;
  if (days < -0.5) return 'past';
  if (days < 1) return 'TODAY';
  if (days < 60) return `in ${Math.round(days)} d`;
  if (days < 730) return `in ${Math.round(days / 30.44)} mo`;
  return `in ${(days / 365.25).toFixed(1)} y`;
};

/** Sun/Moon glyph: solar = dark disk over a bright one; lunar = Moon in the shadow. */
const EclipseGlyph = ({ kind, type, size = 30 }) => {
  const r = size / 2 - 2;
  const c = size / 2;
  if (kind === 'solar') {
    const offset = type === 'partial' ? r * 0.55 : 0;
    const moonR = type === 'annular' ? r * 0.82 : type === 'hybrid' ? r * 0.97 : r * 1.02;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r + 1.5} fill="none" stroke="#fbbf24" strokeOpacity="0.35" strokeWidth="1" />
        <circle cx={c} cy={c} r={r} fill="#fbbf24" />
        <circle cx={c - offset} cy={c - offset * 0.3} r={moonR} fill="var(--bg-panel, #111)" />
      </svg>
    );
  }
  // Lunar: Earth's umbra (big dark red disk) with the Moon partly/fully inside
  const umbraR = r * 1.35;
  const moonR = r * 0.55;
  const offset = type === 'total' ? 0 : type === 'partial' ? umbraR * 0.75 : umbraR * 1.25;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c - r * 0.5} cy={c} r={umbraR} fill="rgba(239, 68, 68, 0.18)" />
      <circle cx={c - r * 0.5} cy={c} r={umbraR} fill="none" stroke="#ef4444" strokeOpacity="0.4" strokeWidth="1" />
      <circle cx={c - r * 0.5 + offset} cy={c} r={moonR} fill={type === 'total' ? '#b45309' : '#cbd5e1'} />
    </svg>
  );
};

const LocalLine = ({ e }) => {
  const l = e.local;
  if (!l) return <span style={{ color: 'var(--text-muted)' }}>set DE for local visibility</span>;
  if (e.kind === 'solar') {
    if (!l.visible) return <span style={{ color: 'var(--text-muted)' }}>not visible from DE</span>;
    const pct = Math.round(l.obscuration * 100);
    return (
      <span style={{ color: pct >= 90 ? '#ef4444' : pct >= 30 ? '#fbbf24' : '#4ade80' }}>
        DE: {l.localType === 'total' ? 'TOTAL' : l.localType === 'annular' ? 'ANNULAR' : `${pct}% obscured`} · max{' '}
        {fmtHM(l.maxTime)} · sun {Math.round(l.sunEl)}° el
        {l.start && l.end ? ` · ${fmtHM(l.start)}–${fmtHM(l.end)}` : ''}
      </span>
    );
  }
  if (!l.visible) return <span style={{ color: 'var(--text-muted)' }}>Moon below horizon from DE</span>;
  return (
    <span style={{ color: '#4ade80' }}>
      DE: visible{l.coverage === 'part' ? ' (part)' : ''} · Moon {Math.round(l.elAtMax)}° el at max · {fmtHM(l.start)}–
      {fmtHM(l.end)}
    </span>
  );
};

const EclipseRow = ({ e, now, featured }) => (
  <div
    style={{
      display: 'flex',
      gap: '8px',
      padding: featured ? '6px' : '4px 6px',
      marginBottom: '3px',
      borderRadius: '4px',
      background: featured ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${featured ? 'var(--border-color)' : 'transparent'}`,
      alignItems: 'flex-start',
    }}
  >
    <EclipseGlyph kind={e.kind} type={e.type} size={featured ? 34 : 22} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ color: TYPE_COLORS[e.type] || 'var(--text-primary)', fontWeight: 700, fontSize: '10px' }}>
          {e.type.toUpperCase()} {e.kind.toUpperCase()}
        </span>
        <span style={{ color: 'var(--text-primary)', fontSize: '10px' }}>{fmtUTC(e.time)}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--accent-amber)', fontSize: '9px', fontWeight: 600 }}>
          {daysUntil(e.time, now)}
        </span>
      </div>
      {featured && (
        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.35 }}>
          {e.visibility || 'Visibility region not in table'}
          {e.magnitude != null && (
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}
              · mag {e.magnitude.toFixed(3)} · γ {e.gamma.toFixed(3)}
            </span>
          )}
        </div>
      )}
      <div style={{ fontSize: '9px', marginTop: '2px' }}>
        <LocalLine e={e} />
      </div>
    </div>
  </div>
);

export const EclipsePanel = ({ deLat, deLon }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const lat = Number.isFinite(deLat) ? Math.round(deLat * 100) / 100 : null;
  const lon = Number.isFinite(deLon) ? Math.round(deLon * 100) / 100 : null;
  const list = useMemo(() => upcomingEclipses(new Date(now), { lat, lon, limit: 10 }), [now, lat, lon]);
  const nextSolar = list.find((e) => e.kind === 'solar');
  const nextLunar = list.find((e) => e.kind === 'lunar');
  const rest = list.filter((e) => e !== nextSolar && e !== nextLunar);

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
        <span>🌘 ECLIPSES</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>times UTC</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {nextSolar && <EclipseRow e={nextSolar} now={now} featured />}
        {nextLunar && <EclipseRow e={nextLunar} now={now} featured />}
        {rest.length > 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', margin: '6px 0 3px', fontWeight: 700 }}>
            FOLLOWING
          </div>
        )}
        {rest.map((e) => (
          <EclipseRow key={`${e.kind}-${e.date}`} e={e} now={now} />
        ))}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No eclipses computed
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}
        title={ECLIPSE_TABLE_SOURCE}
      >
        Meeus canon · NASA GSFC table · DE estimate ±5 %
      </div>
    </div>
  );
};

export default EclipsePanel;
