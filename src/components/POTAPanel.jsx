/**
 * POTAPanel Component
 * Displays Parks on the Air activations with ON/OFF toggle
 */
import React from 'react';
import { detectMode } from '../utils/callsign.js';
import { useRig } from '../contexts/RigContext.jsx';
import CallsignLink from './CallsignLink.jsx';

export const POTAPanel = ({
  data,
  loading,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
}) => {
  const { tuneTo, tuneEnabled } = useRig();
  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px',
        fontSize: '11px'
      }}>
        <span>▲ POTA ACTIVATORS {data?.length > 0 ? `(${data.length})` : ''}</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={onToggleMap}
            title={showOnMap ? 'Hide POTA activators on map' : 'Show POTA activators on map'}
            style={{
              background: showOnMap ? 'rgba(68, 204, 68, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showOnMap ? '#44cc44' : '#666'}`,
              color: showOnMap ? '#44cc44' : '#888',
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
              title={showLabelsOnMap ? 'Hide POTA callsigns on map' : 'Show POTA callsigns on map'}
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
                  gridTemplateColumns: '62px 50px 58px 1fr',
                  gap: '4px',
                  padding: '3px 0',
                  borderBottom: i < data.length - 1 ? '1px solid var(--border-color)' : 'none',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  if (spot.freq) {
                    const freqVal = parseFloat(spot.freq);
                    let freqHz = freqVal;
                    if (freqVal < 1000) freqHz = freqVal * 1000000;
                    else if (freqVal < 100000) freqHz = freqVal * 1000;

                    const mode = spot.mode || detectMode(spot.locationDesc || spot.comment || '');
                    tuneTo(freqHz, mode);
                  }
                }}
              >
                <span style={{ color: '#44cc44', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <CallsignLink call={spot.call} color="#44cc44" fontWeight="600" />
                </span>
                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {spot.locationDesc || spot.ref}
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
            No POTA spots
          </div>
        )}
      </div>
    </div>
  );
};

export default POTAPanel;
