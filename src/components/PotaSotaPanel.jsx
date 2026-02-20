/**
 * PotaSotaPanel Component
 * Tabbed panel that switches between POTA, WWFF and SOTA views.
 * Used in Classic and Modern layouts. In Dockable layout, each is a separate panel.
 */
import React, { useState } from 'react';
import { POTAPanel } from './POTAPanel.jsx';
import { WWFFPanel } from './WWFFPanel.jsx';
import { SOTAPanel } from './SOTAPanel.jsx';

const TABS = ['pota', 'wwff', 'sota'];

export const PotaSotaPanel = ({
  potaData,
  potaLoading,
  potaLastUpdated,
  potaLastChecked,
  showPOTA,
  onTogglePOTA,
  wwffData,
  wwffLoading,
  wwffLastUpdated,
  wwffLastChecked,
  showWWFF,
  onToggleWWFF,
  sotaData,
  sotaLoading,
  sotaLastUpdated,
  sotaLastChecked,
  showSOTA,
  onToggleSOTA,
  onPOTASpotClick,
  onWWFFSpotClick,
  onSOTASpotClick,
}) => {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_potaSotaTab');
      return TABS.includes(saved) ? saved : 'pota';
    } catch {
      return 'pota';
    }
  });

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('openhamclock_potaSotaTab', tab);
    } catch {}
  };

  const tabStyle = (tab) => ({
    flex: 1,
    padding: '3px 0',
    background: activeTab === tab ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: 'none',
    borderBottom: activeTab === tab ? `2px solid ${tab === 'pota' ? '#44cc44' : '#ff9632'}` : '2px solid transparent',
    color: activeTab === tab ? (tab === 'pota' ? '#44cc44' : '#ff9632') : '#666',
    fontSize: '10px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: activeTab === tab ? '700' : '400',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  });

  const potaStaleMin = potaLastUpdated ? Math.floor((Date.now() - potaLastUpdated) / 60000) : null;
  const sotaStaleMin = sotaLastUpdated ? Math.floor((Date.now() - sotaLastUpdated) / 60000) : null;
  const wwffStaleMin = wwffLastUpdated ? Math.floor((Date.now() - wwffLastUpdated) / 60000) : null;

  const staleWarning = (minutes) => {
    if (minutes === null || minutes < 5) return '';
    return ` ⚠${minutes}m`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <button style={tabStyle('pota')} onClick={() => handleTabChange('pota')}>
          ▲ POTA {potaData?.length > 0 ? `(${potaData.length})` : ''}
          {potaStaleMin >= 5 && (
            <span style={{ color: potaStaleMin >= 10 ? '#ff4444' : '#ffaa00' }}>{staleWarning(potaStaleMin)}</span>
          )}
        </button>
        <button style={tabStyle('wwff')} onClick={() => handleTabChange('wwff')}>
          ▲ WWFF {wwffData?.length > 0 ? `(${wwffData.length})` : ''}
          {wwffStaleMin >= 5 && (
            <span style={{ color: wwffStaleMin >= 10 ? '#ff4444' : '#ffaa00' }}>{staleWarning(wwffStaleMin)}</span>
          )}
        </button>
        <button style={tabStyle('sota')} onClick={() => handleTabChange('sota')}>
          ⛰ SOTA {sotaData?.length > 0 ? `(${sotaData.length})` : ''}
          {sotaStaleMin >= 5 && (
            <span style={{ color: sotaStaleMin >= 10 ? '#ff4444' : '#ffaa00' }}>{staleWarning(sotaStaleMin)}</span>
          )}
        </button>
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'pota' ? (
          <POTAPanel
            data={potaData}
            loading={potaLoading}
            lastUpdated={potaLastUpdated}
            lastChecked={potaLastChecked}
            showOnMap={showPOTA}
            onToggleMap={onTogglePOTA}
            onSpotClick={onPOTASpotClick}
          />
        ) : activeTab === 'sota' ? (
          <SOTAPanel
            data={sotaData}
            loading={sotaLoading}
            lastUpdated={sotaLastUpdated}
            lastChecked={sotaLastChecked}
            showOnMap={showSOTA}
            onToggleMap={onToggleSOTA}
            onSpotClick={onSOTASpotClick}
          />
        ) : (
          <WWFFPanel
            data={wwffData}
            loading={wwffLoading}
            lastUpdated={wwffLastUpdated}
            lastChecked={wwffLastChecked}
            showOnMap={showWWFF}
            onToggleMap={onToggleWWFF}
            onSpotClick={onWWFFSpotClick}
          />
        )}
      </div>
    </div>
  );
};

export default PotaSotaPanel;
