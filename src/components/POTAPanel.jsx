/**
 * POTAPanel Component
 * Displays Parks on the Air activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const mapDefs = {
  name: 'POTA',
  icon: L.divIcon({
    // green triangle
    className: '',
    html: `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid #44cc44;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14],
  }),
  shape: '▲',
  color: '#44cc44', // green label background and callsign foreground for popup
};
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
  filters,
  onOpenFilters,
  filteredData,
}) => {
  return (
    <ActivatePanel
      name={mapDefs.name}
      shade={mapDefs.color}
      shape={mapDefs.shape}
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
      filters={filters}
      onOpenFilters={onOpenFilters}
      filteredData={filteredData}
    />
  );
};

export default POTAPanel;
