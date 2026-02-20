/**
 * DXFilterManager Component
 * Filter modal with tabs for Zones, Bands, Modes, Watchlist, Exclude, Settings
 */
import React, { useState } from 'react';

export const DXFilterManager = ({ filters, onFilterChange, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('zones');
  const [newWatchlistCall, setNewWatchlistCall] = useState('');
  const [newDXExcludeCall, setNewDXExcludeCall] = useState('');
  const [newDEExcludeCall, setNewDEExcludeCall] = useState('');

  if (!isOpen) return null;

  const continents = [
    { code: 'NA', name: 'North America' },
    { code: 'SA', name: 'South America' },
    { code: 'EU', name: 'Europe' },
    { code: 'AF', name: 'Africa' },
    { code: 'AS', name: 'Asia' },
    { code: 'OC', name: 'Oceania' },
    { code: 'AN', name: 'Antarctica' },
  ];

  const bands = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '11m', '10m', '6m', '2m', '70cm'];
  const modes = ['CW', 'SSB', 'FT8', 'FT4', 'RTTY', 'PSK', 'JT65', 'JS8', 'SSTV', 'AM', 'FM'];

  // noinspection DuplicatedCode
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

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters?.continents?.length) count += filters.continents.length;
    if (filters?.cqZones?.length) count += filters.cqZones.length;
    if (filters?.ituZones?.length) count += filters.ituZones.length;
    if (filters?.bands?.length) count += filters.bands.length;
    if (filters?.modes?.length) count += filters.modes.length;
    if (filters?.watchlist?.length) count += filters.watchlist.length;

    /* excludes */
    if (filters?.excludeContinents?.length) count += filters.excludeContinents.length;
    if (filters?.excludeCqZones?.length) count += filters.excludeCqZones.length;
    if (filters?.excludeItuZones?.length) count += filters.excludeItuZones.length;
    if (filters?.excludeDXCallList?.length) count += filters.excludeDXCallList.length;
    if (filters?.excludeDECallList?.length) count += filters.excludeDECallList.length;
    return count;
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

  const zoneButtonStyle = (selected) => ({
    width: '36px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: selected ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
    border: `1px solid ${selected ? 'var(--accent-amber)' : 'var(--border-color)'}`,
    borderRadius: '4px',
    color: selected ? '#000' : 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: selected ? '600' : '400',
  });

  const addToWatchlist = () => {
    if (newWatchlistCall.trim()) {
      const current = filters?.watchlist || [];
      if (!current.includes(newWatchlistCall.toUpperCase())) {
        onFilterChange({ ...filters, watchlist: [...current, newWatchlistCall.toUpperCase()] });
      }
      setNewWatchlistCall('');
    }
  };

  const addToDXExcludeCalls = () => {
    if (newDXExcludeCall.trim()) {
      const current = filters?.excludeDXCallList || [];
      if (!current.includes(newDXExcludeCall.toUpperCase())) {
        onFilterChange({ ...filters, excludeDXCallList: [...current, newDXExcludeCall.toUpperCase()] });
      }
      setNewDXExcludeCall('');
    }
  };

  const addToDEExcludeCalls = () => {
    if (newDEExcludeCall.trim()) {
      const current = filters?.excludeDECallList || [];
      if (!current.includes(newDEExcludeCall.toUpperCase())) {
        onFilterChange({ ...filters, excludeDECallList: [...current, newDEExcludeCall.toUpperCase()] });
      }
      setNewDEExcludeCall('');
    }
  };

  const renderZonesTab = () => (
    <div>
      {/* Continents */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Spotter (DE) Continent
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Shows spots FROM these continents reporting DX OUTSIDE these continents
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {continents.map((c) => (
            <button
              key={c.code}
              onClick={() => toggleArrayItem('continents', c.code)}
              style={chipStyle(filters?.continents?.includes(c.code))}
            >
              {c.code} - {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* CQ Zones */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            Spotter (DE) CQ Zones
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() =>
                selectAll(
                  'cqZones',
                  Array.from({ length: 40 }, (_, i) => i + 1),
                )
              }
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
              onClick={() => clearFilter('cqZones')}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '4px' }}>
          {Array.from({ length: 40 }, (_, i) => i + 1).map((zone) => (
            <button
              key={zone}
              onClick={() => toggleArrayItem('cqZones', zone)}
              style={zoneButtonStyle(filters?.cqZones?.includes(zone))}
            >
              {zone}
            </button>
          ))}
        </div>
      </div>

      {/* ITU Zones */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
            Spotter (DE) ITU Zones
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() =>
                selectAll(
                  'ituZones',
                  Array.from({ length: 90 }, (_, i) => i + 1),
                )
              }
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
              onClick={() => clearFilter('ituZones')}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '4px' }}>
          {Array.from({ length: 90 }, (_, i) => i + 1).map((zone) => (
            <button
              key={zone}
              onClick={() => toggleArrayItem('ituZones', zone)}
              style={zoneButtonStyle(filters?.ituZones?.includes(zone))}
            >
              {zone}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderBandsTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
          Include HF/VHF/UHF Bands
        </span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => selectAll('bands', bands)}
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
        {bands.map((band) => (
          <button
            key={band}
            onClick={() => toggleArrayItem('bands', band)}
            style={chipStyle(filters?.bands?.includes(band))}
          >
            {band}
          </button>
        ))}
      </div>
    </div>
  );

  const renderModesTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
          Include Operating Modes
        </span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => selectAll('modes', modes)}
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
        {modes.map((mode) => (
          <button
            key={mode}
            onClick={() => toggleArrayItem('modes', mode)}
            style={chipStyle(filters?.modes?.includes(mode))}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  );

  const renderWatchlistTab = () => (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
          Watchlist - Highlight these Spot (DX) callsigns
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newWatchlistCall}
            onChange={(e) => setNewWatchlistCall(e.target.value.toUpperCase())}
            onKeyPress={(e) => e.key === 'Enter' && addToWatchlist()}
            placeholder="Enter callsign..."
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
            onClick={addToWatchlist}
            style={{
              padding: '8px 16px',
              background: 'var(--accent-cyan)',
              border: 'none',
              borderRadius: '4px',
              color: '#000',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Add
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {(filters?.watchlist || []).map((call) => (
          <div key={call} style={{ ...chipStyle(true), display: 'flex', alignItems: 'center', gap: '8px' }}>
            {call}
            <button
              onClick={() => toggleArrayItem('watchlist', call)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-red)',
                cursor: 'pointer',
                padding: 0,
                fontSize: '14px',
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '16px' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={filters?.watchlistOnly || false}
            onChange={(e) => onFilterChange({ ...filters, watchlistOnly: e.target.checked || undefined })}
          />
          Show only watchlist callsigns
        </label>
      </div>
    </div>
  );

  const renderExcludeTab = () => (
    <div>
      {/* Exclude DX (spot) Continents */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '10px' }}>
          Exclude Spots (DX) by Continent
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {continents.map((c) => (
            <button
              key={c.code}
              onClick={() => toggleArrayItem('excludeContinents', c.code)}
              style={chipStyle(filters?.excludeContinents?.includes(c.code))}
            >
              {c.code} - {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Exclude DX (spot) CQ Zones */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
            }}
          >
            Exclude Spots (DX) by CQ Zone
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() =>
                selectAll(
                  'excludeCqZones',
                  Array.from({ length: 40 }, (_, i) => i + 1),
                )
              }
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
              onClick={() => clearFilter('excludeCqZones')}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '4px' }}>
          {Array.from({ length: 40 }, (_, i) => i + 1).map((zone) => (
            <button
              key={zone}
              onClick={() => toggleArrayItem('excludeCqZones', zone)}
              style={zoneButtonStyle(filters?.excludeCqZones?.includes(zone))}
            >
              {zone}
            </button>
          ))}
        </div>
      </div>

      {/* Exclude DX (spot) ITU Zones */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
            }}
          >
            Exclude Spots (DX) by ITU Zone
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() =>
                selectAll(
                  'excludeItuZones',
                  Array.from({ length: 90 }, (_, i) => i + 1),
                )
              }
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
              onClick={() => clearFilter('excludeItuZones')}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '4px' }}>
          {Array.from({ length: 90 }, (_, i) => i + 1).map((zone) => (
            <button
              key={zone}
              onClick={() => toggleArrayItem('excludeItuZones', zone)}
              style={zoneButtonStyle(filters?.excludeItuZones?.includes(zone))}
            >
              {zone}
            </button>
          ))}
        </div>
      </div>

      {/* Exclude DX (spot) callsigns */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Exclude Spot (DX) Callsigns - Hide callsigns beginning with:
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newDXExcludeCall}
              onChange={(e) => setNewDXExcludeCall(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && addToDXExcludeCalls()}
              placeholder="Enter callsign..."
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
              onClick={addToDXExcludeCalls}
              style={{
                padding: '8px 16px',
                background: 'var(--accent-red)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {(filters?.excludeDXCallList || []).map((call) => (
            <div
              key={call}
              style={{
                ...chipStyle(false),
                background: 'rgba(255, 68, 68, 0.2)',
                borderColor: 'var(--accent-red)',
                color: 'var(--accent-red)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {call}
              <button
                onClick={() => toggleArrayItem('excludeDXCallList', call)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-red)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '14px',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Exclude DE (spotter) callsigns */}
      <div>
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Exclude Spotter (DE) Callsigns - Hide callsigns beginning with:
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newDEExcludeCall}
              onChange={(e) => setNewDEExcludeCall(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && addToDEExcludeCalls()}
              placeholder="Enter callsign..."
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
              onClick={addToDEExcludeCalls}
              style={{
                padding: '8px 16px',
                background: 'var(--accent-red)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {(filters?.excludeDECallList || []).map((call) => (
            <div
              key={call}
              style={{
                ...chipStyle(false),
                background: 'rgba(255, 68, 68, 0.2)',
                borderColor: 'var(--accent-red)',
                color: 'var(--accent-red)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {call}
              <button
                onClick={() => toggleArrayItem('excludeDECallList', call)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-red)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '14px',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSettingsTab = () => {
    const retentionMinutes = filters?.spotRetentionMinutes || 30;

    return (
      <div>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Spot Retention Time
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            How long to keep DX spots on the map before they expire. Shorter times show only the most recent activity.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <input
              type="range"
              min="5"
              max="30"
              step="5"
              value={retentionMinutes}
              onChange={(e) => onFilterChange({ ...filters, spotRetentionMinutes: parseInt(e.target.value) })}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <div
              style={{
                minWidth: '80px',
                textAlign: 'center',
                padding: '8px 12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                fontFamily: 'JetBrains Mono',
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--accent-cyan)',
              }}
            >
              {retentionMinutes} min
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '8px',
              fontSize: '11px',
              color: 'var(--text-muted)',
            }}
          >
            <span>5 min (freshest)</span>
            <span>30 min (default)</span>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Quick Presets
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[5, 10, 15, 20, 30].map((mins) => (
              <button
                key={mins}
                onClick={() => onFilterChange({ ...filters, spotRetentionMinutes: mins })}
                style={{
                  padding: '8px 16px',
                  background: retentionMinutes === mins ? 'rgba(0, 221, 255, 0.2)' : 'var(--bg-tertiary)',
                  border: `1px solid ${retentionMinutes === mins ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                  borderRadius: '4px',
                  color: retentionMinutes === mins ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono',
                }}
              >
                {mins} min
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          width: '700px',
          maxHeight: '95vh',
          display: 'flex',
          flexDirection: 'column',
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
            <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent-cyan)' }}>⊘ DX Cluster Filters</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {getActiveFilterCount()} filters active
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={clearAllFilters}
              style={{
                padding: '8px 16px',
                background: 'rgba(255, 68, 102, 0.2)',
                border: '1px solid var(--accent-red)',
                borderRadius: '6px',
                color: 'var(--accent-red)',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Clear All
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
          <button onClick={() => setActiveTab('zones')} style={tabStyle(activeTab === 'zones')}>
            Zones
          </button>
          <button onClick={() => setActiveTab('bands')} style={tabStyle(activeTab === 'bands')}>
            Bands
          </button>
          <button onClick={() => setActiveTab('modes')} style={tabStyle(activeTab === 'modes')}>
            Modes
          </button>
          <button onClick={() => setActiveTab('watchlist')} style={tabStyle(activeTab === 'watchlist')}>
            Watchlist
          </button>
          <button onClick={() => setActiveTab('exclude')} style={tabStyle(activeTab === 'exclude')}>
            Exclude
          </button>
          <button onClick={() => setActiveTab('settings')} style={tabStyle(activeTab === 'settings')}>
            ⊙ Settings
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'zones' && renderZonesTab()}
          {activeTab === 'bands' && renderBandsTab()}
          {activeTab === 'modes' && renderModesTab()}
          {activeTab === 'watchlist' && renderWatchlistTab()}
          {activeTab === 'exclude' && renderExcludeTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </div>
      </div>
    </div>
  );
};

export default DXFilterManager;
