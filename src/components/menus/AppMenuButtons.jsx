import DonateButton from '../DonateButton';
import { IconGear, IconExpand, IconShrink } from '../Icons';

export default function AppMenuButtons({
  config,
  showUpdateButton,
  updateInProgress,
  onUpdateClick,
  onSettingsClick,
  onFullscreenToggle,
  isFullscreen,
  className = 'menu-button-container',
}) {
  return (
    <div className={className}>
      <DonateButton className="menu-button" />

      {showUpdateButton && (
        <button onClick={onUpdateClick} disabled={updateInProgress} className="menu-button">
          {updateInProgress ? 'UPDATING...' : 'UPDATE OHC'}
        </button>
      )}

      <button onClick={onSettingsClick} className="menu-button">
        <IconGear size={12} />
        OHC Settings
      </button>

      <button onClick={onFullscreenToggle} className="menu-button">
        {isFullscreen ? <IconShrink size={12} /> : <IconExpand size={12} />}
        {isFullscreen ? ' Exit Fullscreen' : ' Enter Fullscreen'}
      </button>
    </div>
  );
}
