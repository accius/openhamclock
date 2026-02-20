/**
 * POTAPanel Component
 * Displays Parks on the Air activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const POTAPanel = ({
  data,
  loading,
  lastUpdated,
  lastChecked,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
  onSpotClick,
  onHoverSpot,
}) => {
  return (
    <ActivatePanel
      name={'POTA'}
      shade={'#44cc44'}
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

export default POTAPanel;
