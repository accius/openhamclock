/**
 * SatelliteAutomationControls — the Doppler-tune and rotator-track switches
 * for one satellite, with live corrected/nominal frequency readouts.
 *
 * Shared by the Satellite Passes panel and the 3D telemetry window. State is
 * the automation store; the hooks in DockableApp do the actual tuning and
 * turning, so this component only flips switches and shows what they report.
 */
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import {
  useSatAutomation,
  setDopplerEnabled,
  setRotatorMode,
  rememberTransmitter,
  setAutomationSat,
} from '../utils/satAutomationStore.js';
import { formatHz, pickTransmitter, transmitterKey, transmitterLabel } from '../utils/doppler.js';

const btn = (active, color = 'var(--accent-cyan)') => ({
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  cursor: 'pointer',
  background: active ? color : 'transparent',
  border: `1px solid ${active ? color : 'var(--border-color)'}`,
  color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
});

const selectStyle = {
  flex: 1,
  minWidth: 0,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '2px 4px',
};

export default function SatelliteAutomationControls({ sat, rotatorAvailable, compact = false }) {
  const { t } = useTranslation();
  const auto = useSatAutomation();
  const rig = useRig();

  if (!sat?.name) return null;
  // DockableApp publishes whether any rotator backend is up; callers may override.
  const rotatorOk = rotatorAvailable ?? !!auto.rotatorAvailable;
  const isThisSat = auto.satName === sat.name;
  const dopplerOn = auto.doppler && isThisSat;
  const trackOn = auto.rotatorMode === 'sat' && isThisSat;
  const txList = sat.transmitters?.length ? sat.transmitters : sat.relayTransmitters || [];
  const picked = pickTransmitter(txList, auto.transmitterBySat?.[sat.name]);
  const live = dopplerOn ? auto.dopplerLive : null;
  const target = trackOn ? auto.rotatorTarget : null;

  const toggleDoppler = () => {
    if (dopplerOn) setDopplerEnabled(false);
    else setDopplerEnabled(true, sat.name);
  };
  const toggleTrack = () => {
    if (trackOn) setRotatorMode('off');
    else setRotatorMode('sat', sat.name);
  };

  const canDoppler = !!rig?.enabled && txList.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: compact ? '4px 0' : '6px',
        border: compact ? 'none' : '1px solid var(--border-color)',
        borderRadius: 4,
        background: compact ? 'transparent' : 'var(--bg-tertiary)',
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={toggleDoppler}
          disabled={!canDoppler}
          aria-pressed={dopplerOn}
          aria-label={t('satAuto.dopplerToggleAria', { sat: sat.name })}
          title={
            !rig?.enabled
              ? t('satAuto.needsRig')
              : txList.length === 0
                ? t('satAuto.noTransmitters')
                : t('satAuto.dopplerTitle')
          }
          style={{ ...btn(dopplerOn), opacity: canDoppler ? 1 : 0.45, cursor: canDoppler ? 'pointer' : 'not-allowed' }}
        >
          {t('satAuto.doppler')} {dopplerOn ? 'ON' : 'OFF'}
        </button>
        {rotatorOk && (
          <button
            type="button"
            onClick={toggleTrack}
            aria-pressed={trackOn}
            aria-label={t('satAuto.trackToggleAria', { sat: sat.name })}
            title={t('satAuto.trackTitle')}
            style={btn(trackOn, 'var(--accent-amber)')}
          >
            {t('satAuto.track')} {trackOn ? 'ON' : 'OFF'}
          </button>
        )}
        {!isThisSat && (auto.doppler || auto.rotatorMode === 'sat') && auto.satName && (
          <button
            type="button"
            onClick={() => setAutomationSat(sat.name)}
            title={t('satAuto.switchTo', { sat: sat.name })}
            style={btn(false)}
          >
            ↪ {auto.satName}
          </button>
        )}
      </div>

      {txList.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label htmlFor={`sat-tx-${sat.name}`} style={{ color: 'var(--text-muted)' }}>
            TX
          </label>
          <select
            id={`sat-tx-${sat.name}`}
            value={picked ? transmitterKey(picked, txList.indexOf(picked)) : ''}
            onChange={(e) => rememberTransmitter(sat.name, e.target.value)}
            aria-label={t('satAuto.transmitterAria', { sat: sat.name })}
            style={selectStyle}
          >
            {txList.map((tx, i) => (
              <option key={transmitterKey(tx, i)} value={transmitterKey(tx, i)}>
                {transmitterLabel(tx)}
              </option>
            ))}
          </select>
        </div>
      )}

      {live && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '1px 8px', alignItems: 'baseline' }}>
          <span style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{t('satAuto.corrected')}</span>
          <span style={{ color: 'var(--text-muted)' }}>{t('satAuto.nominal')}</span>
          <span style={{ color: 'var(--text-muted)' }}>RX ↓</span>
          <span style={{ color: live.active ? 'var(--accent-green)' : 'var(--text-primary)', fontWeight: 700 }}>
            {formatHz(live.downlinkCorrectedHz)}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{formatHz(live.downlinkNominalHz)}</span>
          {live.uplinkNominalHz && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>TX ↑</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatHz(live.uplinkCorrectedHz)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatHz(live.uplinkNominalHz)}</span>
            </>
          )}
          <span style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 9 }}>
            {live.mode ? `${live.mode} · ` : ''}
            {live.rangeRateKmS != null
              ? `${live.rangeRateKmS >= 0 ? '+' : ''}${live.rangeRateKmS.toFixed(2)} km/s · `
              : ''}
            {live.phase === 'preposition'
              ? t('satAuto.phasePreposition')
              : live.phase === 'tracking'
                ? t('satAuto.phaseTracking')
                : live.reason === 'rig-disabled'
                  ? t('satAuto.needsRig')
                  : t('satAuto.phaseIdle')}
            {live.uplinkNominalHz ? ` · ${t('satAuto.uplinkManual')}` : ''}
          </span>
        </div>
      )}

      {target && (
        <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>
          {t('satAuto.rotatorTarget')}:{' '}
          {Number.isFinite(target.az) ? (
            <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>
              {String(Math.round(target.az)).padStart(3, '0')}° / {Math.round(target.el ?? 0)}°
            </span>
          ) : (
            '—'
          )}
          {target.flip ? ` · ${t('satAuto.flip')}` : ''}
          {' · '}
          {target.phase === 'preposition'
            ? t('satAuto.phasePreposition')
            : target.phase === 'tracking'
              ? t('satAuto.phaseTracking')
              : t('satAuto.phaseIdle')}
          {!target.rotatorAvailable ? ` · ${t('satAuto.rotatorOffline')}` : ''}
        </div>
      )}
    </div>
  );
}
