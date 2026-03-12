import { useEffect } from 'react';
import { useAppMenu } from '../../contexts/AppMenuContext';
import AppMenuButtons from './AppMenuButtons';

export default function AppMenu({
  config,
  showUpdateButton,
  updateInProgress,
  onUpdateClick,
  onSettingsClick,
  onFullscreenToggle,
  isFullscreen,
}) {
  const { menuOpen, closeMenu } = useAppMenu();

  // ESC key closes menu
  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, closeMenu]);

  if (!menuOpen) return null;

  return (
    <div
      className="header-menu-container"
      onClick={closeMenu}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(1px)',
      }}
    >
      <div
        className="header-menu"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: '0',
          top: '0',
          margin: '3em',
          padding: '1em',
        }}
      >
        <button onClick={closeMenu} className="close-x">
          ✕
        </button>

        <img src="/img/ohc-logo-254x114.png" alt="Open Ham Clock logo" className="header-menu-logo" />
        <p className="version-information">
          <span onClick={() => window.dispatchEvent(new Event('openhamclock-show-whatsnew'))}>
            v{config.version} ℹ️
          </span>
        </p>

        <AppMenuButtons
          className="header-menu-button-container"
          config={config}
          showUpdateButton={showUpdateButton}
          updateInProgress={updateInProgress}
          onUpdateClick={onUpdateClick}
          onSettingsClick={onSettingsClick}
          onFullscreenToggle={onFullscreenToggle}
          isFullscreen={isFullscreen}
        />
      </div>
    </div>
  );
}
