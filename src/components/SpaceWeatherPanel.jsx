/**
 * SpaceWeatherPanel Component
 * Displays solar flux, K-index, and sunspot number
 */
import React from 'react';

export const SpaceWeatherPanel = ({ data, loading }) => {
  const getKIndexColor = (kIndex) => {
    const k = parseInt(kIndex);
    if (isNaN(k)) return 'var(--text-muted)';
    if (k >= 5) return 'var(--accent-red)';
    if (k >= 4) return 'var(--accent-amber)';
    return 'var(--accent-green)';
  };

  return (
    <div className="panel" style={{ padding: '12px' }}>
      <div className="panel-header">☼ SPACE WEATHER</div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <div className="loading-spinner" />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>SFI</div>
            <div
              style={{
                fontSize: '24px',
                fontWeight: '700',
                color: 'var(--accent-amber)',
                fontFamily: 'Orbitron, monospace',
              }}
            >
              {data?.solarFlux || '--'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>K-INDEX</div>
            <div
              style={{
                fontSize: '24px',
                fontWeight: '700',
                color: getKIndexColor(data?.kIndex),
                fontFamily: 'Orbitron, monospace',
              }}
            >
              {data?.kIndex || '--'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>SSN</div>
            <div
              style={{
                fontSize: '24px',
                fontWeight: '700',
                color: 'var(--accent-cyan)',
                fontFamily: 'Orbitron, monospace',
              }}
            >
              {data?.sunspotNumber || '--'}
            </div>
          </div>
        </div>
      )}
      {data?.conditions && (
        <div
          style={{
            textAlign: 'center',
            marginTop: '12px',
            padding: '6px',
            background:
              data.conditions === 'GOOD'
                ? 'rgba(0, 255, 136, 0.1)'
                : data.conditions === 'FAIR'
                  ? 'rgba(255, 180, 50, 0.1)'
                  : data.conditions === 'POOR'
                    ? 'rgba(255, 68, 102, 0.1)'
                    : 'transparent',
            borderRadius: '4px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color:
                data.conditions === 'GOOD'
                  ? 'var(--accent-green)'
                  : data.conditions === 'FAIR'
                    ? 'var(--accent-amber)'
                    : data.conditions === 'POOR'
                      ? 'var(--accent-red)'
                      : 'var(--text-muted)',
            }}
          >
            CONDITIONS: {data.conditions}
          </span>
        </div>
      )}
    </div>
  );
};

export default SpaceWeatherPanel;
