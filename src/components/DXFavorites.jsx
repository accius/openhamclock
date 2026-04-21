/**
 * DXFavorites Component
 * Star button that opens a dropdown of saved DX grid square locations.
 * Stores favorites in localStorage as openhamclock_dxFavorites.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { parseGridSquare, calculateGridSquare } from '../utils/geo.js';
import { syncAllSettingsToServer } from '../utils';

const STORAGE_KEY = 'openhamclock_dxFavorites';
const MAX_FAVORITES = 10;

function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveFavorites(favs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
    syncAllSettingsToServer();
  } catch (e) {}
}

const DROPDOWN_MIN_WIDTH = 220;
const VIEWPORT_EDGE_PADDING = 8;

export function DXFavorites({ dxLocation, dxGrid, onDXChange, dxLocked }) {
  const [favorites, setFavorites] = useState(loadFavorites);
  const [isOpen, setIsOpen] = useState(false);
  const [editingName, setEditingName] = useState(null); // index being renamed
  const [nameValue, setNameValue] = useState('');
  // When the button sits too close to the left edge of the viewport, a
  // right-edge-anchored dropdown overflows off-screen. Flip to left-anchored
  // in that case so the list stays visible and clickable on narrow layouts.
  const [alignRight, setAlignRight] = useState(true);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const btnRect = buttonRef.current.getBoundingClientRect();
    setAlignRight(btnRect.right - VIEWPORT_EDGE_PADDING >= DROPDOWN_MIN_WIDTH);
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false);
        setEditingName(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const persistAndSet = useCallback((newFavs) => {
    setFavorites(newFavs);
    saveFavorites(newFavs);
  }, []);

  const addCurrent = () => {
    if (!dxLocation || favorites.length >= MAX_FAVORITES) return;
    const grid = dxGrid || calculateGridSquare(dxLocation.lat, dxLocation.lon);
    // Don't add duplicates (same grid)
    if (favorites.some((f) => f.grid === grid)) return;
    const newFav = {
      name: grid,
      grid,
      lat: dxLocation.lat,
      lon: dxLocation.lon,
    };
    persistAndSet([...favorites, newFav]);
  };

  const removeFavorite = (index) => {
    const newFavs = favorites.filter((_, i) => i !== index);
    persistAndSet(newFavs);
    if (editingName === index) setEditingName(null);
  };

  const selectFavorite = (fav) => {
    if (dxLocked) return;
    onDXChange({ lat: fav.lat, lon: fav.lon });
    setIsOpen(false);
  };

  const startRename = (index) => {
    setEditingName(index);
    setNameValue(favorites[index].name);
  };

  const commitRename = () => {
    if (editingName === null) return;
    const trimmed = nameValue.trim();
    if (trimmed) {
      const newFavs = [...favorites];
      newFavs[editingName] = { ...newFavs[editingName], name: trimmed };
      persistAndSet(newFavs);
    }
    setEditingName(null);
  };

  const hasFavorites = favorites.length > 0;
  const currentGrid = dxGrid || (dxLocation ? calculateGridSquare(dxLocation.lat, dxLocation.lon) : '');
  const isCurrentSaved = favorites.some((f) => f.grid === currentGrid);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        title={hasFavorites ? 'DX Favorites' : 'Save DX location as favorite'}
        style={{
          background: isOpen ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
          color: isOpen ? '#000' : hasFavorites ? 'var(--accent-amber)' : 'var(--text-muted)',
          border: '1px solid ' + (isOpen ? 'var(--accent-amber)' : 'var(--border-color)'),
          borderRadius: '4px',
          padding: '4px 8px',
          fontSize: '12px',
          cursor: 'pointer',
          lineHeight: 1,
          flex: '0 0 auto',
        }}
      >
        {isCurrentSaved ? '★' : '☆'}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            right: alignRight ? 0 : 'auto',
            left: alignRight ? 'auto' : 0,
            marginTop: '4px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '8px 0',
            minWidth: `${DROPDOWN_MIN_WIDTH}px`,
            maxWidth: `calc(100vw - ${VIEWPORT_EDGE_PADDING * 2}px)`,
            maxHeight: '320px',
            overflowY: 'auto',
            zIndex: 9999,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '4px 12px 8px',
              fontSize: '11px',
              fontWeight: '700',
              color: 'var(--accent-amber)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '4px',
            }}
          >
            DX Favorites
          </div>

          {/* Favorites list */}
          {favorites.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
              No favorites saved yet.
            </div>
          ) : (
            favorites.map((fav, i) => (
              <div
                key={`${fav.grid}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  cursor: dxLocked ? 'not-allowed' : 'pointer',
                  background: fav.grid === currentGrid ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (fav.grid !== currentGrid) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    fav.grid === currentGrid ? 'rgba(0, 255, 136, 0.1)' : 'transparent';
                }}
              >
                {/* Grid square */}
                <span
                  onClick={() => selectFavorite(fav)}
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: fav.grid === currentGrid ? 'var(--accent-green)' : 'var(--text-primary)',
                    flex: '0 0 auto',
                    minWidth: '58px',
                  }}
                >
                  {fav.grid}
                </span>

                {/* Name (editable on double-click) */}
                {editingName === i ? (
                  <input
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    onBlur={commitRename}
                    autoFocus
                    style={{
                      flex: 1,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--accent-cyan)',
                      borderRadius: '3px',
                      color: 'var(--text-primary)',
                      fontSize: '11px',
                      padding: '2px 4px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <span
                    onClick={() => selectFavorite(fav)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(i);
                    }}
                    title="Double-click to rename"
                    style={{
                      flex: 1,
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fav.name !== fav.grid ? fav.name : ''}
                  </span>
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(i);
                  }}
                  title="Remove favorite"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: '12px',
                    lineHeight: 1,
                    flex: '0 0 auto',
                    opacity: 0.5,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.color = 'var(--accent-red)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.5';
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}

          {/* Add Current button */}
          {!isCurrentSaved && favorites.length < MAX_FAVORITES && (
            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '4px', padding: '8px 12px 4px' }}>
              <button
                onClick={addCurrent}
                style={{
                  width: '100%',
                  background: 'rgba(0, 221, 255, 0.1)',
                  border: '1px solid var(--accent-cyan)',
                  borderRadius: '4px',
                  color: 'var(--accent-cyan)',
                  padding: '6px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                + Add Current ({currentGrid})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DXFavorites;
