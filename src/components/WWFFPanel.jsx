/**
 * WWFFPanel Component
 * Displays Parks on the Air activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const mapDefs = {
  name: 'WWFF',
  icon: L.divIcon({
    // light green inverted triangle
    className: '',
    html: `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:14px solid #a3f3a3;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 0],
  }),
  shape: '▼',
  color: '#a3f3a3', // light green label background and callsign foreground for popup
};
export const WWFFPanel = ({
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
      mapDefs={mapDefs}
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

export default WWFFPanel;
