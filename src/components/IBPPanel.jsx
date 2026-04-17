/**
 * IBPPanel — International Beacon Project live schedule
 *
 * Shows which NCDXF/IARU beacon is transmitting on each of the 5 IBP bands
 * right now, with a per-slot countdown and bearing/distance from the
 * operator's QTH.  The schedule is fully deterministic; no network calls.
 */
import { useTranslation } from 'react-i18next';
import { useIBP } from '../hooks/useIBP';
import { useIBPRBN } from '../hooks/useIBPRBN';
import { useRig } from '../contexts/RigContext';
import { formatDistance } from '../utils/geo';
import { DEFAULT_BAND_COLORS } from '../utils/bandColors';
import { SLOT_SECONDS } from '../utils/ibp';

/** Format a bearing in degrees as a compact cardinal+degrees string. */
const formatBearing = (deg) => {
  if (deg == null) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const card = dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return `${card} ${Math.round(deg)}°`;
};

export const IBPPanel = ({ deLat = null, deLon = null, units = 'metric' }) => {
  const { t } = useTranslation();
  const { schedule, secondsLeft, cycleSecondsLeft, slotProgress } = useIBP(deLat, deLon);
  const { enabled: rigEnabled, tuneTo } = useRig();
  const rbnData = useIBPRBN();

  const hasQTH = deLat != null && deLon != null;

  return (
    <div className="panel" style={{ padding: '12px' }}>
      {/* Header */}
      <div
        className="panel-header"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}
      >
        <span>{t('ibp.title')}</span>
        <span
          title={t('ibp.cycleCountdown.tooltip', { secs: cycleSecondsLeft })}
          style={{
            fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--text-muted)',
          }}
        >
          {t('ibp.cycleCountdown', { secs: String(cycleSecondsLeft).padStart(3, ' ') })}
        </span>
      </div>

      {/* Slot progress bar */}
      <div
        title={t('ibp.slotProgress.tooltip', { secs: secondsLeft })}
        style={{
          height: '3px',
          background: 'var(--border-color)',
          borderRadius: '2px',
          marginBottom: '10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${slotProgress * 100}%`,
            background: 'var(--accent-blue)',
            borderRadius: '2px',
            transition: 'width 0.9s linear',
          }}
        />
      </div>

      {/* Band rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {schedule.map(({ band, beacon, bearing, distanceKm }) => {
          const bandColor = DEFAULT_BAND_COLORS[band.label] ?? 'var(--text-muted)';
          const rbn = rbnData.get(beacon.callsign);

          return (
            <div
              key={band.mhz}
              onClick={rigEnabled ? () => tuneTo(band.mhz, 'CW') : undefined}
              title={rigEnabled ? t('ibp.tune', { mhz: band.mhz.toFixed(3) }) : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: hasQTH ? '52px 1fr auto' : '52px 1fr',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 8px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                borderLeft: `3px solid ${bandColor}`,
                cursor: rigEnabled ? 'pointer' : 'default',
              }}
            >
              {/* Band label + frequency */}
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: bandColor,
                    fontFamily: 'JetBrains Mono, monospace',
                    lineHeight: 1.2,
                  }}
                >
                  {band.label}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {band.mhz.toFixed(3)}
                </div>
              </div>

              {/* Callsign + location */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '700',
                    color: 'var(--text-primary)',
                    fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {beacon.callsign}
                </div>
                <div
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {beacon.location}
                </div>
                {rbn && (
                  <div
                    title={t('ibp.rbn.tooltip', { count: rbn.count, snr: rbn.maxSNR ?? '?' })}
                    style={{
                      fontSize: '9px',
                      color: 'var(--accent-green, #4caf50)',
                      fontFamily: 'JetBrains Mono, monospace',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('ibp.rbn.heard', {
                      count: rbn.count,
                      snr: rbn.maxSNR != null ? (rbn.maxSNR >= 0 ? `+${rbn.maxSNR}` : `${rbn.maxSNR}`) : '?',
                    })}
                  </div>
                )}
              </div>

              {/* Bearing + distance (only when QTH is known) */}
              {hasQTH && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      fontFamily: 'JetBrains Mono, monospace',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatBearing(bearing)}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDistance(distanceKm, units)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: '8px',
          fontSize: '9px',
          color: 'var(--text-muted)',
          textAlign: 'right',
        }}
      >
        {t('ibp.footer')}
      </div>
    </div>
  );
};

export default IBPPanel;
