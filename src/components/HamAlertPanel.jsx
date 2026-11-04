/**
 * HamAlertPanel — your HamAlert triggers as a live spot list.
 *
 * Alerts arrive from the Rig Bridge `hamalert` plugin (local stream or
 * cloud relay) and/or a self-hosted server with HAMALERT_USER/PASS set
 * (see hooks/useHamAlert.js). Rows: age, call, frequency, mode, source,
 * comment. Click a row to set the DX target / tune the rig — the same
 * handler the DX Cluster panel uses. CLR empties the list.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getReadableBandColorForFreq } from '../utils/bandColors.js';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { spotIota } from '../utils/iota.js';

const SOURCE_LABELS = {
  sota: 'SOTA',
  pota: 'POTA',
  wwff: 'WWFF',
  pskreporter: 'PSKR',
  rbn: 'RBN',
  wsprnet: 'WSPR',
  cluster: 'DXC',
  dxworld: 'DXW',
  iota: 'IOTA',
};

function ageLabel(ts, now) {
  if (!ts) return '';
  const min = Math.max(0, Math.floor((now - ts) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export const HamAlertPanel = ({
  alerts = [],
  onClear,
  onSpotClick,
  onHoverSpot,
  configured = false,
  serverEnabled = null,
  bridgeActive = false,
  error = null,
  isLocalInstall = false,
}) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  const sourceLabel = (configured && bridgeActive && 'Rig Bridge') || (serverEnabled && 'server') || null;

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
        <span>
          🔔 {t('hamalert.title', { defaultValue: 'HAMALERT' })}{' '}
          {configured && (
            <span style={{ color: 'var(--accent-green)', fontSize: '9px', fontWeight: '400' }}>
              ● {t('hamalert.live', { defaultValue: 'live' })}
              {sourceLabel ? ` · ${sourceLabel}` : ''}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: '400' }}>{alerts.length}</span>
          <button
            type="button"
            onClick={onClear}
            disabled={!alerts.length}
            title={t('hamalert.clear', { defaultValue: 'Clear all alerts' })}
            aria-label={t('hamalert.clear', { defaultValue: 'Clear all alerts' })}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: alerts.length ? 'var(--text-secondary)' : 'var(--text-muted)',
              cursor: alerts.length ? 'pointer' : 'default',
              fontSize: '9px',
              padding: '1px 6px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            CLR
          </button>
        </span>
      </div>

      {error && (
        <div style={{ fontSize: '10px', color: 'var(--accent-red, #f44)', marginBottom: '4px' }} role="alert">
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        {alerts.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 4px', lineHeight: 1.5 }}>
            {configured
              ? t('hamalert.waiting', {
                  defaultValue: 'Connected — waiting for your HamAlert triggers to fire.',
                })
              : t('hamalert.notConfigured', {
                  defaultValue:
                    'No HamAlert feed yet. Enable the HamAlert plugin in Rig Bridge (Plugins tab) with your hamalert.org username and password; self-hosted servers can instead set HAMALERT_USER / HAMALERT_PASS in .env.',
                })}
            {!configured && !isLocalInstall && (
              <div style={{ marginTop: '6px', fontSize: '10px' }}>
                {t('hamalert.hostedHint', {
                  defaultValue: 'On openhamclock.com the feed comes through Rig Bridge Cloud Relay.',
                })}
              </div>
            )}
          </div>
        ) : (
          <div role="table" aria-label={t('hamalert.title', { defaultValue: 'HamAlert alerts' })}>
            <div className="visually-hidden" role="row">
              <span role="columnheader">Age</span>
              <span role="columnheader">Frequency</span>
              <span role="columnheader">Callsign</span>
              <span role="columnheader">Mode</span>
              <span role="columnheader">Source</span>
              <span role="columnheader">Comment</span>
            </div>
            {alerts.map((a, i) => {
              const freqMHz = parseFloat(a.freq) || (a.freqKhz ? a.freqKhz / 1000 : 0);
              const color = getReadableBandColorForFreq(freqMHz);
              const spot = { ...a, freq: a.freq, mode: a.mode || null, source: 'HamAlert' };
              const iota = spotIota(a);
              return (
                <div
                  key={`${a.call}-${a.freqKhz}-${a.time}-${i}`}
                  role="row"
                  tabIndex={0}
                  onMouseEnter={() => onHoverSpot?.(spot)}
                  onMouseLeave={() => onHoverSpot?.(null)}
                  onClick={() => onSpotClick?.(spot)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSpotClick?.(spot);
                    }
                  }}
                  title={a.comment || a.raw || ''}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '30px 58px 1fr auto auto',
                    gap: '5px',
                    alignItems: 'center',
                    padding: '4px 5px',
                    borderRadius: '3px',
                    marginBottom: '2px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span role="cell" style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
                    {ageLabel(a.timestamp, now)}
                  </span>
                  <span role="cell" style={{ color, fontWeight: '600' }}>
                    {freqMHz ? freqMHz.toFixed(3) : '?'}
                  </span>
                  <span role="cell" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <CallsignLink
                      call={a.call}
                      color="var(--text-primary)"
                      fontWeight="700"
                      onPopup={showPopup}
                      spot={freqMHz > 0 ? { freq: freqMHz * 1000, mode: a.mode || null } : undefined}
                    />
                    {iota && (
                      <span
                        style={{ marginLeft: '4px', color: 'var(--accent-cyan)', fontSize: '8px', fontWeight: '700' }}
                      >
                        {iota}
                      </span>
                    )}
                    {a.comment && (
                      <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '9px' }}>
                        {a.comment}
                      </span>
                    )}
                  </span>
                  <span role="cell" style={{ color: 'var(--text-secondary)', fontSize: '9px', minWidth: '26px' }}>
                    {a.mode || '—'}
                  </span>
                  <span
                    role="cell"
                    style={{
                      fontSize: '8px',
                      color: 'var(--accent-amber)',
                      border: '1px solid var(--accent-amber)',
                      borderRadius: '2px',
                      padding: '0 3px',
                      opacity: a.source ? 0.9 : 0.35,
                      minWidth: '28px',
                      textAlign: 'center',
                    }}
                  >
                    {a.source ? SOURCE_LABELS[a.source] || a.source.toUpperCase().slice(0, 6) : 'HA'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HamAlertPanel;
