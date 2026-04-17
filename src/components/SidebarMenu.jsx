/**
 * SidebarMenu — Left sidebar navigation with three visibility modes:
 *   1. Hidden  — fully off-screen, a thin edge strip triggers reveal on hover
 *   2. Icons   — collapsed 40px icon strip, hover expands to show labels
 *   3. Pinned  — always expanded with labels visible
 *
 * In dockable layout mode, also shows layout lock/reset controls,
 * replacing the separate "Layout" dockable panel.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconGear, IconExpand, IconShrink } from './Icons.jsx';
import DonateButton from './DonateButton.jsx';

const COLLAPSED_WIDTH = 40;
const EXPANDED_WIDTH = 180;
const HOVER_DELAY = 150;
const EDGE_TRIGGER_WIDTH = 6; // Invisible hover strip when fully hidden

// Visibility modes
const MODE_HIDDEN = 'hidden'; // Off-screen, edge-trigger to reveal
const MODE_ICONS = 'icons'; // Collapsed icon strip
const MODE_PINNED = 'pinned'; // Always expanded with labels

export default function SidebarMenu({
  onSettingsClick,
  onFullscreenToggle,
  isFullscreen,
  onUpdateClick,
  showUpdateButton,
  updateInProgress,
  breakpoint = 'desktop',
  version,
  // Dockable layout props
  isDockable = false,
  layoutLocked = false,
  onToggleLayoutLock,
  onResetLayout,
}) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_sidebarMode') || MODE_ICONS;
    } catch {
      return MODE_ICONS;
    }
  });
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimeout = useRef(null);
  const hideTimeout = useRef(null);
  const isMobile = breakpoint === 'mobile';

  const { t } = useTranslation();

  // Sidebar menu items — each maps to a settings tab
  const MENU_ITEMS = useMemo(
    () => [
      { id: 'station', icon: '📻', label: t('station.settings.tab.title.station') },
      { id: 'integrations', icon: '🔌', label: t('station.settings.tab.title.integrations') },
      { id: 'display', icon: '🎨', label: t('station.settings.tab.title.display') },
      { id: 'layers', icon: '🗺️', label: t('station.settings.tab.title.mapLayers') },
      { id: 'satellites', icon: '🛰️', label: t('station.settings.tab.title.satellites') },
      { id: 'profiles', icon: '👤', label: t('station.settings.tab.title.profiles') },
      { id: 'community', icon: '🌐', label: t('station.settings.tab.title.community') },
      { id: 'alerts', icon: '🔔', label: t('station.settings.tab.title.alerts') },
      { id: 'rig-bridge', icon: '📻', label: t('station.settings.tab.title.rig-bridge') },
    ],
    [t],
  );

  // Persist mode
  useEffect(() => {
    if (isMobile) return; // no-op on mobile but hook still runs
    try {
      localStorage.setItem('openhamclock_sidebarMode', mode);
    } catch {}
    // Notify App.jsx of width change
    window.dispatchEvent(new CustomEvent('sidebar-mode-change', { detail: { mode } }));
  }, [mode, isMobile]);

  const isExpanded = mode === MODE_PINNED || hoverExpanded;
  const isVisible = mode !== MODE_HIDDEN || hoverExpanded;

  // Compute rendered width
  const currentWidth = !isVisible ? 0 : isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hideTimeout.current);
    if (mode === MODE_PINNED) return;
    hoverTimeout.current = setTimeout(() => setHoverExpanded(true), HOVER_DELAY);
  }, [mode]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeout.current);
    if (mode === MODE_PINNED) return;
    hideTimeout.current = setTimeout(() => setHoverExpanded(false), 100);
  }, [mode]);

  // Edge trigger for hidden mode — invisible strip at left edge
  const handleEdgeEnter = useCallback(() => {
    if (mode !== MODE_HIDDEN) return;
    hoverTimeout.current = setTimeout(() => setHoverExpanded(true), HOVER_DELAY);
  }, [mode]);

  const cycleMode = useCallback(() => {
    setMode((prev) => {
      if (prev === MODE_HIDDEN) return MODE_ICONS;
      if (prev === MODE_ICONS) return MODE_PINNED;
      return MODE_HIDDEN;
    });
    setHoverExpanded(false);
  }, []);

  // Don't render sidebar on mobile — placed after all hooks to keep hook count stable
  if (isMobile) return null;

  const modeIcon = mode === MODE_HIDDEN ? '◀' : mode === MODE_ICONS ? '☰' : '📌';
  const modeTitle =
    mode === MODE_HIDDEN ? 'Show icon bar' : mode === MODE_ICONS ? 'Pin sidebar open' : 'Hide sidebar completely';

  // Shared button style generator
  const actionBtnStyle = (active = false) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: isExpanded ? 'flex-start' : 'center',
    width: '100%',
    padding: '8px',
    background: active ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-tertiary)',
    border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border-color)'}`,
    borderRadius: '4px',
    color: active ? 'var(--accent-green)' : 'var(--text-secondary)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  });

  return (
    <>
      {/* Edge trigger strip — only when fully hidden */}
      {mode === MODE_HIDDEN && !hoverExpanded && (
        <div
          onMouseEnter={handleEdgeEnter}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            width: EDGE_TRIGGER_WIDTH,
            zIndex: 10000,
            cursor: 'e-resize',
          }}
        />
      )}

      {/* Sidebar panel */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: isVisible ? (isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH) : 0,
          background: 'var(--bg-panel)',
          borderRight: isVisible ? '1px solid var(--border-color)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 9999,
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          fontFamily: 'JetBrains Mono, monospace',
          boxShadow: hoverExpanded && mode !== MODE_PINNED ? '4px 0 16px rgba(0,0,0,0.3)' : 'none',
        }}
      >
        {/* Top bar — mode toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isExpanded ? 'space-between' : 'center',
            padding: '8px',
            borderBottom: '1px solid var(--border-color)',
            minHeight: '44px',
          }}
        >
          {isExpanded && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: '700',
                color: 'var(--accent-amber)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                fontFamily: 'Orbitron, monospace',
              }}
            >
              MENU
            </span>
          )}
          <button
            onClick={cycleMode}
            title={modeTitle}
            tabIndex={isVisible ? 0 : -1}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: mode === MODE_PINNED ? 'var(--accent-amber)' : 'var(--text-muted)',
              fontSize: '16px',
              padding: '4px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {modeIcon}
          </button>
        </div>

        {/* Menu items */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onSettingsClick(item.id)}
              title={item.label}
              tabIndex={isVisible ? 0 : -1}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: isExpanded ? '10px 12px' : '10px 0',
                justifyContent: isExpanded ? 'flex-start' : 'center',
                background: 'none',
                border: 'none',
                borderRadius: '0',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                transition: 'background 0.15s ease',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: '18px', flexShrink: 0, width: '24px', textAlign: 'center' }}>{item.icon}</span>
              {isExpanded && <span>{item.label}</span>}
            </button>
          ))}
        </div>

        {/* Dockable layout controls — only in dockable mode */}
        {isDockable && (
          <div
            style={{
              borderTop: '1px solid var(--border-color)',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {/* Layout Lock */}
            <button
              onClick={onToggleLayoutLock}
              title={layoutLocked ? 'Unlock layout — allow drag, resize, close' : 'Lock layout — prevent changes'}
              tabIndex={isVisible ? 0 : -1}
              style={{
                ...actionBtnStyle(layoutLocked),
                background: layoutLocked ? 'rgba(255, 170, 0, 0.15)' : 'var(--bg-tertiary)',
                border: `1px solid ${layoutLocked ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                color: layoutLocked ? 'var(--accent-amber)' : 'var(--text-secondary)',
              }}
            >
              <span style={{ fontSize: '14px', flexShrink: 0 }}>{layoutLocked ? '🔒' : '🔓'}</span>
              {isExpanded && (layoutLocked ? 'Locked' : 'Unlocked')}
            </button>

            {/* Reset Layout */}
            <button
              onClick={onResetLayout}
              disabled={layoutLocked}
              title={layoutLocked ? 'Unlock layout to reset' : 'Reset panel layout to default'}
              tabIndex={isVisible ? 0 : -1}
              style={{
                ...actionBtnStyle(false),
                opacity: layoutLocked ? 0.4 : 1,
                cursor: layoutLocked ? 'not-allowed' : 'pointer',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ flexShrink: 0 }}
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              {isExpanded && 'Reset Layout'}
            </button>
          </div>
        )}

        {/* Bottom actions */}
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {/* Update button */}
          {showUpdateButton && (
            <button
              onClick={onUpdateClick}
              disabled={updateInProgress}
              title={updateInProgress ? 'Update in progress...' : 'Run update now'}
              tabIndex={isVisible ? 0 : -1}
              style={{
                ...actionBtnStyle(updateInProgress),
                cursor: updateInProgress ? 'wait' : 'pointer',
              }}
            >
              <span style={{ fontSize: '16px', flexShrink: 0 }}>🔄</span>
              {isExpanded && (updateInProgress ? 'Updating...' : 'Update')}
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={onFullscreenToggle}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            tabIndex={isVisible ? 0 : -1}
            style={actionBtnStyle(isFullscreen)}
          >
            {isFullscreen ? <IconShrink size={14} /> : <IconExpand size={14} />}
            {isExpanded && (isFullscreen ? 'Exit Full' : 'Fullscreen')}
          </button>

          {/* Donate */}
          {!isFullscreen && (
            <DonateButton compact={!isExpanded} fontSize="12px" padding="8px" tabIndex={isVisible ? 0 : -1} />
          )}

          {/* Settings (quick access) */}
          <button
            onClick={() => onSettingsClick()}
            title="Open Settings"
            tabIndex={isVisible ? 0 : -1}
            style={actionBtnStyle(false)}
          >
            <IconGear size={14} />
            {isExpanded && 'Settings'}
          </button>

          {/* Version */}
          {version && isExpanded && (
            <div
              onClick={() => window.dispatchEvent(new Event('openhamclock-show-whatsnew'))}
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                textAlign: 'center',
                cursor: 'pointer',
                padding: '4px 0 2px',
              }}
              title="What's new in this version"
            >
              v{version}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Export constants so App.jsx can compute sidebar width
SidebarMenu.COLLAPSED_WIDTH = COLLAPSED_WIDTH;
SidebarMenu.EXPANDED_WIDTH = EXPANDED_WIDTH;
SidebarMenu.MODE_HIDDEN = MODE_HIDDEN;
SidebarMenu.MODE_ICONS = MODE_ICONS;
SidebarMenu.MODE_PINNED = MODE_PINNED;
