/**
 * SOTAPanel Component
 * Displays Summits on the Air activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const SOTAPanel = ({
  data,
  loading,
  lastUpdated,
  lastChecked,
  showOnMap,
  onToggleMap,
  showLabelsOnMap,
  onToggleLabelsOnMap = true,
  onSpotClick,
  onHoverSpot,
}) => {
  return (
    <ActivatePanel
      name={'SOTA'}
      shade={'#ff9632'}
      data={data}
      loading={loading}
      lastUpdated={lastUpdated}
      lastChecked={lastChecked}
      showOnMap={showOnMap}
      onToggleMap={onToggleMap}
      showLabelsOnMap={showLabelsOnMap}
      onToggleLabelsOnMap={onToggleLabelsOnMap}
      onSpotClick={onSpotClick}
      onHoverSpot={onHoverSpot}
    />
  );
};

export default SOTAPanel;
