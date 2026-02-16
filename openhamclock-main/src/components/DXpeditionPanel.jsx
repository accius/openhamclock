/**
 * DXpeditionPanel Component
 * Shows active and upcoming DXpeditions (compact version)
 */
import React from 'react';
import CallsignLink from './CallsignLink.jsx';

export const DXpeditionPanel = ({ data, loading }) => {
  const getStatusStyle = (expedition) => {
    if (expedition.isActive) {
      return { bg: 'rgba(0, 255, 136, 0.15)', border: 'var(--accent-green)', color: 'var(--accent-green)' };
    }
    if (expedition.isUpcoming) {
      return { bg: 'rgba(0, 170, 255, 0.15)', border: 'var(--accent-cyan)', color: 'var(--accent-cyan)' };
    }
    return { bg: 'var(--bg-tertiary)', border: 'var(--border-color)', color: 'var(--text-muted)' };
  };

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '6px',
        fontSize: '11px'
      }}>
        <span>⊕ DXPEDITIONS</span>
        {data && (
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
            {data.active > 0 && <span style={{ color: 'var(--accent-green)' }}>{data.active} active</span>}
          </span>
        )}
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : data?.dxpeditions?.length > 0 ? (
          data.dxpeditions.slice(0, 4).map((exp, idx) => {
            const style = getStatusStyle(exp);
            return (
              <div key={idx} style={{ 
                padding: '4px 6px',
                marginBottom: '3px',
                background: style.bg,
                borderLeft: `2px solid ${style.border}`,
                borderRadius: '3px',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CallsignLink call={exp.callsign} color="var(--accent-amber)" fontWeight="700" />
                  <span style={{ color: style.color, fontSize: '9px' }}>
                    {exp.isActive ? '● NOW' : 'SOON'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {exp.entity}
                </div>
              </div>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No DXpeditions
          </div>
        )}
      </div>
    </div>
  );
};

export default DXpeditionPanel;
