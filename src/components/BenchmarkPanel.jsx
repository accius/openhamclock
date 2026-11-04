/**
 * BenchmarkPanel — "Station benchmark": your RBN signal reports versus the
 * median of stations within R km, matched per skimmer / band / UTC hour so
 * propagation cancels out. Per-band bars of (you − neighbours) dB with
 * sample counts, a per-day trend sparkline per band, and a plain-language
 * explanation line. RBN only — PSK Reporter "my spots" carry no SNR here.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBenchmark } from '../hooks/useBenchmark.js';
import { getReadableBandColorForBand } from '../utils/bandColors.js';

const RADII = [100, 300, 600, 1000];
const LS_KEY = 'ohc_benchmark_radius';
const RANGE_DB = 20;

const readRadius = () => {
  try {
    const v = parseInt(localStorage.getItem(LS_KEY), 10);
    return RADII.includes(v) ? v : 300;
  } catch {
    return 300;
  }
};

const diffColor = (d) => (d >= 3 ? '#4ade80' : d <= -3 ? '#ef4444' : 'var(--accent-amber)');

const Trend = ({ days, color }) => {
  if (!days || days.length < 2) return <span style={{ color: 'var(--text-muted)', fontSize: '8px' }}>—</span>;
  const W = 70;
  const H = 18;
  const vals = days.map((d) => d.diffDb);
  const lo = Math.min(-RANGE_DB / 2, ...vals);
  const hi = Math.max(RANGE_DB / 2, ...vals);
  const x = (i) => (i / (days.length - 1)) * (W - 2) + 1;
  const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 2) - 1;
  return (
    <svg width={W} height={H} aria-hidden="true">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-color)" strokeWidth="1" />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  );
};

export const BenchmarkPanel = ({ config }) => {
  const { t } = useTranslation();
  const [radiusKm, setRadiusKm] = useState(readRadius);
  const callsign = (config?.callsign || '').toUpperCase();
  const { data, loading, error, ready } = useBenchmark({
    callsign,
    lat: config?.location?.lat,
    lon: config?.location?.lon,
    radiusKm,
  });

  const pickRadius = (r) => {
    setRadiusKm(r);
    try {
      localStorage.setItem(LS_KEY, String(r));
    } catch {}
  };

  const bands = data?.bands || [];

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
        <span>{t('benchmark.title')}</span>
        <div style={{ display: 'flex', gap: '3px' }} role="group" aria-label={t('benchmark.radius')}>
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRadius(r)}
              aria-pressed={radiusKm === r}
              aria-label={`${t('benchmark.radius')} ${r} km`}
              style={{
                background: radiusKm === r ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                color: radiusKm === r ? '#000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '9px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!ready ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {t('benchmark.needCallsign')}
          </div>
        ) : loading && !data ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : error && !data ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {t('benchmark.error')}
          </div>
        ) : (
          <>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: '8px' }}>
              {data?.explanation}
            </div>

            {bands.length > 0 && (
              <div
                role="table"
                aria-label={t('benchmark.title')}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr 46px 70px',
                  gap: '4px 6px',
                  alignItems: 'center',
                }}
              >
                <div style={{ color: 'var(--text-muted)' }}>{t('benchmark.band')}</div>
                <div style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>−{RANGE_DB}</span>
                  <span>{t('benchmark.youMinusNeighbours')}</span>
                  <span>+{RANGE_DB}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', textAlign: 'right' }}>dB</div>
                <div style={{ color: 'var(--text-muted)' }}>{t('benchmark.trend')}</div>
                {bands.map((b) => {
                  const clamped = Math.max(-RANGE_DB, Math.min(RANGE_DB, b.diffDb));
                  const pct = (Math.abs(clamped) / RANGE_DB) * 50;
                  const color = diffColor(b.diffDb);
                  const title = t('benchmark.barTooltip', {
                    band: b.band,
                    diff: `${b.diffDb > 0 ? '+' : ''}${b.diffDb}`,
                    samples: b.samples,
                    neighbours: b.neighbourSamples,
                    best: `${b.bestDiffDb > 0 ? '+' : ''}${b.bestDiffDb}`,
                  });
                  return (
                    <div key={b.band} role="row" style={{ display: 'contents' }} title={title}>
                      <div role="cell" style={{ color: getReadableBandColorForBand(b.band), fontWeight: 700 }}>
                        {b.band}
                      </div>
                      <div
                        role="cell"
                        aria-label={title}
                        style={{
                          position: 'relative',
                          height: '12px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '2px',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: 0,
                            bottom: 0,
                            width: '1px',
                            background: 'var(--border-color)',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            top: '2px',
                            bottom: '2px',
                            left: clamped >= 0 ? '50%' : `${50 - pct}%`,
                            width: `${pct}%`,
                            background: color,
                            borderRadius: '2px',
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div role="cell" style={{ color, fontWeight: 700, textAlign: 'right' }}>
                        {b.diffDb > 0 ? '+' : ''}
                        {b.diffDb}
                        <div style={{ color: 'var(--text-muted)', fontSize: '8px', fontWeight: 400 }}>
                          n={b.samples}
                        </div>
                      </div>
                      <div role="cell">
                        <Trend days={b.days} color={color} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          fontSize: '9px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '2px',
          gap: '6px',
        }}
      >
        <span>{t('benchmark.footer')}</span>
        {data?.store && (
          <span title={t('benchmark.storeTooltip')}>
            {data.neighbours} nbr · {data.store.located}/{data.store.stations} located
          </span>
        )}
      </div>
    </div>
  );
};

export default BenchmarkPanel;
