/**
 * APRSPanel Component
 * Displays real-time APRS station positions with watchlist group management.
 * Supports tagging callsigns into named groups for EmComm and public service tracking.
 */
import React, { useState, useMemo, useCallback } from 'react';
import CallsignLink from './CallsignLink.jsx';
import { getBandColor } from '../utils/bandColors.js';

const APRSPanel = ({
  aprsData,
  showOnMap,
  onToggleMap,
  onSpotClick,
  onHoverSpot,
}) => {
  const {
    filteredStations = [],
    stations = [],
    connected,
    aprsEnabled,
    loading,
    lastUpdate,
    watchlist = { groups: {}, activeGroup: 'all' },
    allWatchlistCalls = new Set(),
    addGroup,
    removeGroup,
    addCallToGroup,
    removeCallFromGroup,
    setActiveGroup,
  } = aprsData || {};

  const [search, setSearch] = useState('');
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addCallInput, setAddCallInput] = useState('');
  const [addCallTarget, setAddCallTarget] = useState('');

  // Search filter
  const displayStations = useMemo(() => {
    if (!search.trim()) return filteredStations;
    const q = search.toUpperCase();
    return filteredStations.filter(
      (s) =>
        s.call?.includes(q) || s.ssid?.includes(q) || s.comment?.toUpperCase().includes(q),
    );
  }, [filteredStations, search]);

  const groupNames = Object.keys(watchlist.groups);

  const handleAddGroup = useCallback(() => {
    if (newGroupName.trim()) {
      addGroup(newGroupName.trim());
      setNewGroupName('');
    }
  }, [newGroupName, addGroup]);

  const handleAddCall = useCallback(() => {
    if (addCallInput.trim() && addCallTarget) {
      addCallToGroup(addCallTarget, addCallInput.trim());
      setAddCallInput('');
    }
  }, [addCallInput, addCallTarget, addCallToGroup]);

  const formatAge = (minutes) =>
    minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;

  if (!aprsEnabled) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
        <div style={{ fontSize: '24px', marginBottom: '10px' }}>📍</div>
        <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>APRS Not Enabled</div>
        <div>Add <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>APRS_ENABLED=true</code> to your .env file and restart the server.</div>
        <div style={{ marginTop: '10px', fontSize: '11px' }}>
          Optional: Set <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>APRS_FILTER=r/{'{lat}'}/{'{lon}'}/500</code> to limit to 500km radius around your station.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '12px' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px', borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>📍</span>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>APRS</span>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
            display: 'inline-block',
          }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {displayStations.length}/{stations.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setShowGroupManager(!showGroupManager)}
            title="Manage watchlist groups"
            style={{
              background: showGroupManager ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px', padding: '3px 8px', fontSize: '11px',
              color: showGroupManager ? '#000' : 'var(--text-secondary)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            👥 Groups
          </button>
          <button
            onClick={onToggleMap}
            style={{
              background: showOnMap ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px', padding: '3px 8px', fontSize: '11px',
              color: showOnMap ? '#000' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {showOnMap ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Group filter tabs */}
      <div style={{
        display: 'flex', gap: '4px', padding: '4px 8px', flexWrap: 'wrap',
        borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
      }}>
        {[
          { key: 'all', label: `All (${stations.length})` },
          ...(allWatchlistCalls.size > 0 ? [{ key: 'watchlist', label: `★ Watchlist` }] : []),
          ...groupNames.map((g) => ({ key: g, label: `${g} (${watchlist.groups[g].length})` })),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveGroup(tab.key)}
            style={{
              padding: '3px 8px', fontSize: '10px', borderRadius: '3px',
              border: watchlist.activeGroup === tab.key ? '1px solid var(--accent-amber)' : '1px solid var(--border-color)',
              background: watchlist.activeGroup === tab.key ? 'var(--accent-amber)' : 'transparent',
              color: watchlist.activeGroup === tab.key ? '#000' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: watchlist.activeGroup === tab.key ? '600' : '400',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Group manager */}
      {showGroupManager && (
        <div style={{
          padding: '8px', borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
        }}>
          <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px', fontSize: '11px' }}>
            Watchlist Groups
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Tag callsigns into groups for EmComm, nets, or public service events.
          </div>

          {/* Create group */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
              placeholder="New group name..."
              style={{
                flex: 1, padding: '4px 6px', fontSize: '11px',
                background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                borderRadius: '3px', color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleAddGroup}
              style={{
                padding: '4px 10px', fontSize: '11px', background: 'var(--accent-cyan)',
                border: 'none', borderRadius: '3px', color: '#000', cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: '600',
              }}
            >
              + Create
            </button>
          </div>

          {/* Add call to group */}
          {groupNames.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              <input
                value={addCallInput}
                onChange={(e) => setAddCallInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCall()}
                placeholder="Callsign..."
                style={{
                  width: '90px', padding: '4px 6px', fontSize: '11px',
                  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                  borderRadius: '3px', color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <select
                value={addCallTarget}
                onChange={(e) => setAddCallTarget(e.target.value)}
                style={{
                  flex: 1, padding: '4px', fontSize: '11px',
                  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                  borderRadius: '3px', color: 'var(--text-primary)', fontFamily: 'inherit',
                }}
              >
                <option value="">Select group...</option>
                {groupNames.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <button
                onClick={handleAddCall}
                disabled={!addCallInput.trim() || !addCallTarget}
                style={{
                  padding: '4px 10px', fontSize: '11px',
                  background: addCallInput.trim() && addCallTarget ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                  border: 'none', borderRadius: '3px',
                  color: addCallInput.trim() && addCallTarget ? '#000' : 'var(--text-muted)',
                  cursor: addCallInput.trim() && addCallTarget ? 'pointer' : 'default',
                  fontFamily: 'inherit', fontWeight: '600',
                }}
              >
                + Add
              </button>
            </div>
          )}

          {/* Group list with members */}
          {groupNames.map((g) => (
            <div key={g} style={{
              padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '11px' }}>{g}</span>
                <button
                  onClick={() => removeGroup(g)}
                  style={{
                    background: 'none', border: 'none', color: '#ef4444',
                    fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Delete
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {(watchlist.groups[g] || []).map((call) => (
                  <span
                    key={call}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '3px',
                      padding: '2px 6px', fontSize: '10px', borderRadius: '3px',
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {call}
                    <span
                      onClick={() => removeCallFromGroup(g, call)}
                      style={{ cursor: 'pointer', color: '#ef4444', fontWeight: '700' }}
                    >
                      ×
                    </span>
                  </span>
                ))}
                {(watchlist.groups[g] || []).length === 0 && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No callsigns yet
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Quick search..."
          style={{
            width: '100%', padding: '5px 8px', fontSize: '11px',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
            borderRadius: '4px', color: 'var(--text-primary)', fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Station list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : displayStations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            {stations.length === 0 ? 'No APRS stations heard yet' : 'No stations match filter'}
          </div>
        ) : (
          displayStations.map((station, i) => {
            const isWatched = allWatchlistCalls.has(station.call) || allWatchlistCalls.has(station.ssid);

            return (
              <div
                key={`${station.ssid}-${i}`}
                onMouseEnter={() => onHoverSpot?.({ call: station.call, lat: station.lat, lon: station.lon })}
                onMouseLeave={() => onHoverSpot?.(null)}
                onClick={() => onSpotClick?.({ call: station.call, lat: station.lat, lon: station.lon })}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '4px',
                  padding: '5px 6px',
                  borderRadius: '3px',
                  marginBottom: '2px',
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderLeft: isWatched ? '2px solid var(--accent-amber)' : '2px solid transparent',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isWatched && <span style={{ fontSize: '10px' }}>★</span>}
                    <CallsignLink call={station.ssid || station.call} color="var(--text-primary)" fontWeight="700" />
                  </div>
                  {station.comment && (
                    <div style={{
                      color: 'var(--text-muted)', fontSize: '10px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      maxWidth: '180px',
                    }}>
                      {station.comment}
                    </div>
                  )}
                </div>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                  fontSize: '10px', color: 'var(--text-muted)',
                }}>
                  <span>{formatAge(station.age)}</span>
                  {station.speed > 0 && <span>{station.speed} kt</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default APRSPanel;
