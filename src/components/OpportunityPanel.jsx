/**
 * OpportunityPanel — ranked "worth working right now" list.
 *
 * Each row: frequency/mode, callsign, need badges (NEW DXCC / BAND / ZONE /
 * GRID / STATE), predicted P.533 reliability DE→spot (or the band-opening
 * fallback), spot age and spotter count. Click → the shared spot handler
 * (tune rig + set DX + map focus); 📓+ → log-from-spot prefill. Data and
 * scoring come from useOpportunities / utils/opportunityScore.js.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReadableBandColorForFreq } from '../utils/bandColors.js';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { requestLogQso } from '../services/logbookStore.js';
import { registerOpportunityConsumer } from '../hooks/useOpportunities.js';
import { NEED_LABELS } from '../utils/opportunityScore.js';

const NEED_STYLE = {
  dxcc: { color: '#ff4444', bg: 'rgba(255, 68, 68, 0.15)' },
  band: { color: '#ff8844', bg: 'rgba(255, 136, 68, 0.12)' },
  zone: { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)' },
  grid: { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)' },
  state: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)' },
};

const relColor = (rel) =>
  rel == null ? 'var(--text-muted)' : rel >= 60 ? '#4ade80' : rel >= 30 ? '#fbbf24' : '#ef4444';

const ageLabel = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'now' : `${m}m`;
};

export const OpportunityPanel = ({ opportunities, onSpotClick }) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();
  const [, setNow] = useState(Date.now());
  const { rows = [], hasLog = false, engine = 'idle', candidateCount = 0 } = opportunities || {};

  // Announce ourselves so predictions run only while the panel is open.
  useEffect(() => registerOpportunityConsumer(), []);
  useEffect(() => {
    const t0 = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t0);
  }, []);

  const toSpot = (r) => ({
    call: r.call,
    freq: r.freq,
    freqMHz: r.freq,
    mode: r.mode || undefined,
    lat: Number.isFinite(r.lat) ? r.lat : undefined,
    lon: Number.isFinite(r.lon) ? r.lon : undefined,
    dxGrid: r.grid || undefined,
    source: 'Opportunities',
  });

  const engineNote =
    engine === 'p533'
      ? t('opportunities.engine.p533')
      : engine === 'unavailable'
        ? t('opportunities.engine.unavailable')
        : t('opportunities.engine.idle');

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
        <span>{t('opportunities.title')}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }} title={engineNote}>
          {t('opportunities.candidates', { count: candidateCount })}
        </span>
      </div>

      {!hasLog && (
        <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '6px', lineHeight: 1.4 }}>
          {t('opportunities.noLog')}
        </div>
      )}

      <div
        role="table"
        aria-label={t('opportunities.title')}
        style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}
      >
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {t('opportunities.empty')}
          </div>
        ) : (
          rows.map((r, i) => {
            const color = getReadableBandColorForFreq(r.freq);
            return (
              <div
                key={r.key}
                role="row"
                tabIndex={0}
                onClick={() => onSpotClick?.(toSpot(r))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSpotClick?.(toSpot(r));
                  }
                }}
                title={t('opportunities.rowTooltip', {
                  score: r.score.toFixed(1),
                  spotters: r.spotters,
                  rel: r.reliability != null ? `${r.reliability}%` : t('opportunities.relFallback'),
                })}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '58px 1fr auto auto auto',
                  gap: '6px',
                  alignItems: 'center',
                  padding: '4px 6px',
                  borderRadius: '3px',
                  marginBottom: '2px',
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  cursor: 'pointer',
                  borderLeft: `2px solid ${r.needs?.length ? NEED_STYLE[r.needs[0]].color : 'transparent'}`,
                }}
              >
                <div role="cell" style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {r.freq != null ? r.freq.toFixed(3) : r.band}
                  {r.mode && <div style={{ color: 'var(--text-muted)', fontSize: '8px' }}>{r.mode}</div>}
                </div>
                <div role="cell" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  <CallsignLink
                    call={r.call}
                    color="var(--text-primary)"
                    fontWeight="700"
                    onPopup={showPopup}
                    location={{ grid: r.grid, lat: r.lat, lon: r.lon }}
                    spot={r.freq ? { freq: r.freq * 1000, mode: r.mode ?? null } : undefined}
                  />
                  {(r.needs || []).map((n) => (
                    <span
                      key={n}
                      title={NEED_LABELS[n]}
                      style={{
                        marginLeft: '4px',
                        padding: '0 3px',
                        fontSize: '8px',
                        fontWeight: 700,
                        letterSpacing: '0.4px',
                        color: NEED_STYLE[n].color,
                        background: NEED_STYLE[n].bg,
                        border: `1px solid ${NEED_STYLE[n].color}`,
                        borderRadius: '2px',
                        verticalAlign: 'middle',
                      }}
                    >
                      {NEED_LABELS[n]}
                    </span>
                  ))}
                  {r.entity && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '8px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.entity}
                      {r.zone ? ` · Z${r.zone}` : ''}
                      {r.ref ? ` · ${r.ref}` : ''}
                    </div>
                  )}
                </div>
                <div
                  role="cell"
                  style={{ color: relColor(r.reliability), fontWeight: 700, minWidth: '34px', textAlign: 'right' }}
                  title={r.reliability != null ? t('opportunities.relTooltip') : t('opportunities.relFallback')}
                >
                  {r.reliability != null ? `${r.reliability}%` : `~${Math.round(r.openingScore * 100)}%`}
                </div>
                <div role="cell" style={{ color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ageLabel(r.ageMs)}
                  <div style={{ fontSize: '8px' }}>
                    {r.spotters}
                    {r.spotters === 1 ? ' spot' : ' spots'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestLogQso({
                      call: r.call,
                      freq: r.freq || undefined,
                      mode: r.mode || undefined,
                      gridsquare: r.grid || undefined,
                    });
                  }}
                  title={t('logbook.logFromSpotTooltip', {
                    defaultValue: 'Log a QSO with {{call}} in your logbook',
                    call: r.call,
                  })}
                  aria-label={t('logbook.logFromSpotTooltip', {
                    defaultValue: 'Log a QSO with {{call}} in your logbook',
                    call: r.call,
                  })}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: '10px',
                    cursor: 'pointer',
                    opacity: 0.6,
                  }}
                >
                  📓+
                </button>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          fontSize: '9px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '6px',
          paddingTop: '2px',
        }}
      >
        <span>{t('opportunities.footer')}</span>
        <span>{engineNote}</span>
      </div>
    </div>
  );
};

export default OpportunityPanel;
