/**
 * PotaSotaPanel Component
 * Tabbed panel that switches between POTA, WWFF and SOTA views.
 * Used in Classic and Modern layouts. In Dockable layout, each is a separate panel.
 */
import React, { useState } from 'react';
import { POTAPanel } from './POTAPanel.jsx';
import { WWFFPanel } from './WWFFPanel.jsx';
import { SOTAPanel } from './SOTAPanel.jsx';

const TABS = ['pota', 'sota'];

export const PotaSotaPanel = ({
  potaData, potaLoading, showPOTA, onTogglePOTA,
  wwffData, wwffLoading, showWWFF, onToggleWWFF,
  sotaData, sotaLoading, showSOTA, onToggleSOTA
}) => {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_potaSotaTab');
      return TABS.includes(saved) ? saved : 'pota';
    } catch { return 'pota'; }
  });

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    try { localStorage.setItem('openhamclock_potaSotaTab', tab); } catch {}
  };

  const tabStyle = (tab) => ({
    flex: 1,
    padding: '3px 0',
    background: activeTab === tab ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: 'none',
    borderBottom: activeTab === tab 
      ? `2px solid ${tab === 'pota' ? '#44cc44' : '#ff9632'}` 
      : '2px solid transparent',
    color: activeTab === tab 
      ? (tab === 'pota' ? '#44cc44' : '#ff9632')
      : '#666',
    fontSize: '10px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: activeTab === tab ? '700' : '400',
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ 
        display: 'flex', 
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0
      }}>
        <button style={tabStyle('pota')} onClick={() => handleTabChange('pota')}>
          ▲ POTA {potaData?.length > 0 ? `(${potaData.length})` : ''}
        </button>
        <button style={tabStyle('wwff')} onClick={() => handleTabChange('wwff')}>
          ▲ WWFF {wwffData?.length > 0 ? `(${wwffData.length})` : ''}
        </button>
        <button style={tabStyle('sota')} onClick={() => handleTabChange('sota')}>
          ⛰ SOTA {sotaData?.length > 0 ? `(${sotaData.length})` : ''}
        </button>
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'pota' ? (
          <POTAPanel
            data={potaData}
            loading={potaLoading}
            showOnMap={showPOTA}
            onToggleMap={onTogglePOTA}
          />
        ) : activeTab === 'sota' ? (
          <SOTAPanel
            data={sotaData}
            loading={sotaLoading}
            showOnMap={showSOTA}
            onToggleMap={onToggleSOTA}
          />
        ) : (
          <WWFFPanel
            data={wwffData}
            loading={wwffLoading}
            showOnMap={showWWFF}
            onToggleMap={onToggleWWFF}
          />
        )}
      </div>
    </div>
  );
};

export default PotaSotaPanel;
