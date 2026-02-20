/**
 * PSKFilterManager Component
 * Filter modal for PSKReporter spots - Bands, Grids, Modes
 */
import React, { useState } from 'react';

const BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];
const MODES = [
  '-FT8',
  'CONTESTI',
  'CW',
  'CWU',
  'DFCW-90',
  'DOMINO',
  'ECHO',
  'FREEDV',
  'FSK441',
  'FSQ',
  'FST4',
  'FST4W',
  'FST4W-90',
  'FT4',
  'FT8',
  'HELL',
  'HFDL',
  'JT',
  'JT4',
  'JT65',
  'JT65B',
  'JT9',
  'JTMS',
  'JS8',
  'LZ3CB',
  'MFSK16',
  'MFSK22',
  'MFSK32',
  'MSK144',
  'NULL',
  'OLIVIA',
  'OLIVIA 1',
  'OLIVIA 3',
  'OLIVIA 4',
  'OLIVIA 8',
  'OPERA',
  'PI4',
  'PKT',
  'POCSAG',
  'PSK',
  'PSK31',
  'PSK32',
  'PSK63',
  'Q65',
  'Q65-30A',
  'Q65A',
  'Q65B',
  'Q65D',
  'ROS',
  'RTTY',
  'RTTY 45',
  'SIM31',
  'SIM63',
  'SSB',
  'SSTV',
  'THOR-M',
  'THOR11',
  'THOR22',
  'THOR32',
  'THRB',
  'VARAC',
  'WSPR',
];

// Common grid field prefixes by region
const GRID_REGIONS = [
  { name: 'North America East', grids: ['FN', 'FM', 'EN', 'EM', 'DN', 'DM'] },
  { name: 'North America West', grids: ['CN', 'CM', 'DM', 'DN', 'BN', 'BM'] },
  { name: 'Europe', grids: ['JO', 'JN', 'IO', 'IN', 'KO', 'KN', 'LO', 'LN'] },
  { name: 'South America', grids: ['GG', 'GH', 'GI', 'FG', 'FH', 'FI', 'FF', 'FE'] },
  { name: 'Asia', grids: ['PM', 'PL', 'OM', 'OL', 'QL', 'QM', 'NM', 'NL'] },
  { name: 'Oceania', grids: ['QF', 'QG', 'PF', 'PG', 'RF', 'RG', 'OF', 'OG'] },
  { name: 'Africa', grids: ['KH', 'KG', 'JH', 'JG', 'IH', 'IG'] },
];

export const PSKFilterManager = ({ filters, onFilterChange, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('bands');
  const [customGrid, setCustomGrid] = useState('');

  if (!isOpen) return null;

  const toggleArrayItem = (key, item) => {
    const current = filters[key] || [];
    const newArray = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
    onFilterChange({ ...filters, [key]: newArray.length ? newArray : undefined });
  };

  const selectAll = (key, items) => {
    onFilterChange({ ...filters, [key]: [...items] });
  };

  const clearFilter = (key) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onFilterChange(newFilters);
  };

  const clearAllFilters = () => {
    onFilterChange({});
  };

  const addCustomGrid = () => {
    if (customGrid.trim() && customGrid.length >= 2) {
      const grid = customGrid.toUpperCase().substring(0, 2);
      const current = filters?.grids || [];
      if (!current.includes(grid)) {
        onFilterChange({ ...filters, grids: [...current, grid] });
      }
      setCustomGrid('');
    }
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters?.bands?.length) count += filters.bands.length;
    if (filters?.grids?.length) count += filters.grids.length;
    if (filters?.modes?.length) count += filters.modes.length;
    if (filters?.direction && filters.direction !== 'both') count += 1;
    return count;
  };

  const renderMapTab = () => {
    const direction = filters?.direction || 'both';
    const options = [
      { value: 'both', label: 'Both TX & RX', desc: 'Show all PSKReporter spots on the map' },
      { value: 'tx', label: 'TX Only — Who Hears Me', desc: 'Stations that reported hearing your signal' },
      { value: 'rx', label: 'RX Only — Who I Hear', desc: 'Stations you are hearing (via WSJT-X)' },
    ];

    return (
      <div>
        <div style={{ marginBottom: '15px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Map Direction Filter</span>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Useful when WSJT-X is also enabled — avoids duplicate plots for the same stations.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFilterChange({ ...filters, direction: opt.value === 'both' ? undefined : opt.value })}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '12px 16px',
                background: direction === opt.value ? 'rgba(255, 170, 0, 0.15)' : 'var(--bg-tertiary)',
                border: direction === opt.value ? '2px solid var(--accent-amber)' : '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: '600', color: direction === opt.value ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                {direction === opt.value ? '● ' : '○ '}{opt.label}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.desc}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: '16px', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Map Legend:</strong>
          <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
            <span>━━ TX (solid line, ● circle)</span>
            <span>╌╌ RX (dashed line, ◆ diamond)</span>
          </div>
        </div>
      </div>
    );
  };

  const tabStyle = (active) => ({
    padding: '8px 16px',
    background: active ? 'var(--accent-amber)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent-amber)' : '2px solid transparent',
    color: active ? '#000' : 'var(--text-muted)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: active ? '600' : '400',
  });

  const chipStyle = (selected) => ({
    padding: '6px 12px',
    background: selected ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
    border: `1px solid ${selected ? 'var(--accent-amber)' : 'var(--border-color)'}`,
    borderRadius: '4px',
    color: selected ? '#000' : 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: selected ? '600' : '400',
  });

  const renderBandsTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Filter by Band</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => selectAll('bands', BANDS)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-cyan)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Select All
          </button>
          <button
            onClick={() => clearFilter('bands')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-red)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {BANDS.map((band) => (
          <button
            key={band}
            onClick={() => toggleArrayItem('bands', band)}
            style={chipStyle(filters?.bands?.includes(band))}
          >
            {band}
          </button>
        ))}
      </div>
      <div style={{ marginTop: '15px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {filters?.bands?.length ? `Showing only: ${filters.bands.join(', ')}` : 'Showing all bands (no filter)'}
      </div>
    </div>
  );

  const renderGridsTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Filter by Grid Square</span>
        <button
          onClick={() => clearFilter('grids')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-red)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Clear All
        </button>
      </div>

      {/* Custom grid input */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Add grid (e.g. FN)"
          value={customGrid}
          onChange={(e) => setCustomGrid(e.target.value.toUpperCase())}
          maxLength={2}
          onKeyPress={(e) => e.key === 'Enter' && addCustomGrid()}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontFamily: 'JetBrains Mono',
          }}
        />
        <button
          onClick={addCustomGrid}
          style={{
            padding: '8px 16px',
            background: 'var(--accent-cyan)',
            border: 'none',
            borderRadius: '4px',
            color: '#000',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          Add
        </button>
      </div>

      {/* Selected grids */}
      {filters?.grids?.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Active Grid Filters:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {filters.grids.map((grid) => (
              <button
                key={grid}
                onClick={() => toggleArrayItem('grids', grid)}
                style={{
                  ...chipStyle(true),
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {grid}
                <span style={{ color: 'var(--accent-red)', fontWeight: '700' }}>×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick select by region */}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>Quick Select by Region:</div>
      {GRID_REGIONS.map((region) => (
        <div key={region.name} style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{region.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {region.grids.map((grid) => (
              <button
                key={grid}
                onClick={() => toggleArrayItem('grids', grid)}
                style={{
                  ...chipStyle(filters?.grids?.includes(grid)),
                  padding: '4px 8px',
                  fontSize: '11px',
                }}
              >
                {grid}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderModesTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Filter by Mode</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => selectAll('modes', MODES)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-cyan)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Select All
          </button>
          <button
            onClick={() => clearFilter('modes')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-red)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => toggleArrayItem('modes', mode)}
            style={chipStyle(filters?.modes?.includes(mode))}
          >
            {mode}
          </button>
        ))}
      </div>
      <div style={{ marginTop: '15px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {filters?.modes?.length ? `Showing only: ${filters.modes.join(', ')}` : 'Showing all modes (no filter)'}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          width: '500px',
          maxWidth: '95vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>⌇ PSKReporter Filters</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {getActiveFilterCount()} filter{getActiveFilterCount() !== 1 ? 's' : ''} active
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '24px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button onClick={() => setActiveTab('bands')} style={tabStyle(activeTab === 'bands')}>
            Bands {filters?.bands?.length ? `(${filters.bands.length})` : ''}
          </button>
          <button onClick={() => setActiveTab('grids')} style={tabStyle(activeTab === 'grids')}>
            Grids {filters?.grids?.length ? `(${filters.grids.length})` : ''}
          </button>
          <button onClick={() => setActiveTab('modes')} style={tabStyle(activeTab === 'modes')}>
            Modes {filters?.modes?.length ? `(${filters.modes.length})` : ''}
          </button>
          <button onClick={() => setActiveTab('map')} style={tabStyle(activeTab === 'map')}>
            Map {filters?.direction && filters.direction !== 'both' ? '(1)' : ''}
          </button>
        </div>

        {/* Tab Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px',
          }}
        >
          {activeTab === 'bands' && renderBandsTab()}
          {activeTab === 'grids' && renderGridsTab()}
          {activeTab === 'modes' && renderModesTab()}
          {activeTab === 'map' && renderMapTab()}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button
            onClick={clearAllFilters}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--accent-red)',
              borderRadius: '4px',
              color: 'var(--accent-red)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Clear All Filters
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 24px',
              background: 'var(--accent-cyan)',
              border: 'none',
              borderRadius: '4px',
              color: '#000',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default PSKFilterManager;
