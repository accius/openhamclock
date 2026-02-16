/**
 * WWFFPanel Component
 * Displays Parks on the Air activations with ON/OFF toggle
 */
import React from 'react';
import CallsignLink from './CallsignLink.jsx';

export const WWFFPanel = ({
  data,
  loading,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
}) => {
  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '6px',
        fontSize: '11px'
      }}>
        <span>▲ WWFF ACTIVATORS {data?.length > 0 ? `(${data.length})` : ''}</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={onToggleMap}
            title={showOnMap ? 'Hide WWFF activators on map' : 'Show WWFF activators on map'}
            style={{
              background: showOnMap ? 'rgba(68, 204, 68, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showOnMap ? '#a3f3a3' : '#666'}`,
              color: showOnMap ? '#a3f3a3' : '#888',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '9px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer'
            }}
          >
            ⊞ Map {showOnMap ? 'ON' : 'OFF'}
          </button>

          {typeof onToggleLabelsOnMap === 'function' && (
            <button
              onClick={onToggleLabelsOnMap}
              title={showLabelsOnMap ? 'Hide WWFF callsigns on map' : 'Show WWFF callsigns on map'}
              style={{
                background: showLabelsOnMap ? 'rgba(255, 170, 0, 0.22)' : 'rgba(100, 100, 100, 0.3)',
                border: `1px solid ${showLabelsOnMap ? '#ffaa00' : '#666'}`,
                color: showLabelsOnMap ? '#ffaa00' : '#888',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                fontFamily: 'JetBrains Mono',
                cursor: 'pointer'
              }}
            >
              ⊞ Calls {showLabelsOnMap ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
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
                style={{ 
                  display: 'grid',
                  gridTemplateColumns: '62px 62px 58px 1fr',
                  gap: '4px',
                  padding: '3px 0',
                  borderBottom: i < data.length - 1 ? '1px solid var(--border-color)' : 'none'
                }}
              >
                <span style={{ color: '#44cc44', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <CallsignLink call={spot.call} color="#44cc44" fontWeight="600" />
                </span>
                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            No WWFF spots
          </div>
        )}
      </div>
    </div>
  );
};

export default WWFFPanel;
