/**
 * WWBOTAPanel Component
 * Displays World Wide BOTA (Bunker On The Air) activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const WWBOTAPanel = ({
  data,
  loading,
  lastUpdated,
  connected,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
  onSpotClick,
  onHoverSpot,
}) => {
  return (
    <ActivatePanel
      name={'WWBOTA'}
      shade={'#8b7fff'}
      data={data}
      loading={loading}
      lastUpdated={lastUpdated}
      connected={connected}
      showOnMap={showOnMap}
      onToggleMap={onToggleMap}
      showLabelsOnMap={showLabelsOnMap}
      onToggleLabelsOnMap={onToggleLabelsOnMap}
      onSpotClick={onSpotClick}
      onHoverSpot={onHoverSpot}
    />
  );
};

export default WWBOTAPanel;
