/**
 * SOTAPanel Component
 * Displays Summits on the Air activations with ON/OFF toggle
 */
import React from 'react';
import CallsignLink from './CallsignLink.jsx';

export const SOTAPanel = ({ data, loading, showOnMap, onToggleMap, onSpotClick }) => {
  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px',
        fontSize: '11px'
      }}>
        <span>⛰ SOTA ACTIVATORS {data?.length > 0 ? `(${data.length})` : ''}</span>
        <button
          onClick={onToggleMap}
          title={showOnMap ? 'Hide SOTA activators on map' : 'Show SOTA activators on map'}
          style={{
            background: showOnMap ? 'rgba(255, 150, 50, 0.3)' : 'rgba(100, 100, 100, 0.3)',
            border: `1px solid ${showOnMap ? '#ff9632' : '#666'}`,
            color: showOnMap ? '#ff9632' : '#888',
            padding: '1px 6px',
            borderRadius: '3px',
            fontSize: '9px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer'
          }}
        >
          ⊞ Map {showOnMap ? 'ON' : 'OFF'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : data && data.length > 0 ? (
          <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
            {data.map((spot, i) => (
              <div
                key={`${spot.call}-${spot.ref}-${i}`}
                onClick={() => onSpotClick?.(spot)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '62px 50px 58px 1fr',
                  gap: '4px',
                  padding: '3px 0',
                  borderBottom: i < data.length - 1 ? '1px solid var(--border-color)' : 'none',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#ff9632', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <CallsignLink call={spot.call} color="#ff9632" fontWeight="600" />
                </span>
                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={spot.summit ? `${spot.ref} — ${spot.summit}${spot.points ? ` (${spot.points}pt)` : ''}` : spot.ref}
                >
                  {spot.ref}
                </span>
                <span style={{ color: 'var(--accent-cyan)', textAlign: 'right' }}>
                  {spot.freq}
                </span>
                <span style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '9px' }}>
                  {spot.time}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No SOTA spots
          </div>
        )}
      </div>
    </div>
  );
};

export default SOTAPanel;
