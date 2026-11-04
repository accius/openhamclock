/**
 * SWPCAlertsPanel Component
 * Recent NOAA SWPC space weather alerts/watches/warnings with severity chips
 * (R = radio blackout, S = solar radiation, G = geomagnetic storm),
 * relative timestamps and expandable message text.
 * Data arrives via the useSWPCAlerts hook (auto-refreshes every 5 minutes).
 */
import { useState, useEffect } from 'react';
import { SCALE_BANDS, scaleColor as noaaScaleColor } from '../utils/noaaScales.js';

// Scale chip color by level: 1–2 yellow/orange, 3+ red
const scaleColor = (level) => {
  if (level >= 3) return '#ef4444';
  if (level === 2) return '#ff9632';
  return '#fbbf24';
};

const typeColor = (type) => {
  switch (type) {
    case 'ALERT':
      return '#ef4444';
    case 'WARNING':
    case 'EXTENDED WARNING':
      return '#ff9632';
    case 'WATCH':
      return '#fbbf24';
    case 'SUMMARY':
      return 'var(--accent-cyan)';
    default:
      return 'var(--text-secondary)';
  }
};

const relativeTime = (iso, now) => {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** Current NOAA R/S/G levels as three tiny chips (from the NOAA Scales feed). */
const ScalesSummary = ({ now }) => {
  if (!now) return null;
  return (
    <span
      style={{ display: 'inline-flex', gap: '3px' }}
      title="Current NOAA scales: R radio blackout · S solar radiation · G geomagnetic"
    >
      {SCALE_BANDS.map((band) => {
        const level = now[band]?.level;
        return (
          <span
            key={band}
            style={{
              background: level != null ? noaaScaleColor(level) : 'var(--bg-tertiary)',
              color: level != null ? '#000' : 'var(--text-muted)',
              padding: '1px 4px',
              borderRadius: '3px',
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {band}
            {level ?? '–'}
          </span>
        );
      })}
    </span>
  );
};

export const SWPCAlertsPanel = ({ data, loading, error, scales }) => {
  const [expanded, setExpanded] = useState(null); // productId-serial key of expanded alert
  const [now, setNow] = useState(() => Date.now());

  // Keep relative timestamps fresh
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const alerts = Array.isArray(data) ? data : [];
  const severeCount = alerts.filter((a) => (a.scale?.level ?? 0) >= 2).length;

  return (
    <div
      className="panel"
      style={{
        padding: '8px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
        <span>🚨 SPACE WX ALERTS</span>
        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          <ScalesSummary now={scales?.now} />
          {severeCount > 0 && (
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: '700',
                border: '1px solid #ef4444',
              }}
            >
              {severeCount} ≥ LVL 2
            </span>
          )}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : alerts.length > 0 ? (
          <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
            {alerts.map((alert) => {
              const key = `${alert.productId}-${alert.serial}`;
              const isOpen = expanded === key;
              const level = alert.scale?.level ?? 0;
              return (
                <div
                  key={key}
                  style={{
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background:
                      level >= 3
                        ? 'rgba(239, 68, 68, 0.15)'
                        : level === 2
                          ? 'rgba(255, 150, 50, 0.1)'
                          : 'rgba(255,255,255,0.03)',
                    border: level >= 3 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    title={isOpen ? 'Collapse message' : 'Expand message'}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    {alert.scale && (
                      <span
                        style={{
                          background: scaleColor(level),
                          color: '#000',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontSize: '9px',
                          fontWeight: '700',
                          flexShrink: 0,
                        }}
                      >
                        {alert.scale.band}
                        {alert.scale.level}
                      </span>
                    )}
                    <span
                      style={{
                        color: typeColor(alert.type),
                        fontWeight: '700',
                        fontSize: '9px',
                        flexShrink: 0,
                      }}
                    >
                      {alert.type}
                    </span>
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: '600',
                        flex: 1,
                        whiteSpace: isOpen ? 'normal' : 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {alert.title || alert.productId}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '9px', flexShrink: 0 }}>
                      {relativeTime(alert.issueTime, now)}
                    </span>
                  </button>
                  {isOpen && (
                    <pre
                      style={{
                        marginTop: '5px',
                        padding: '6px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'var(--text-secondary)',
                        fontSize: '9px',
                        lineHeight: '1.4',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {alert.message}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error ? 'SWPC alerts unavailable' : 'No recent space weather alerts'}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
        <a
          href="https://www.swpc.noaa.gov/products/alerts-watches-and-warnings"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          NOAA SWPC
        </a>
      </div>
    </div>
  );
};

export default SWPCAlertsPanel;
