/**
 * SOTAPanel Component
 * Displays Summits on the Air activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

export const mapDefs = {
  name: 'SOTA',
  icon: L.divIcon({
    //orange diamond
    className: '',
    html: `<span style="display:inline-block;width:12px;height:12px;background:#ff9632;transform:rotate(45deg);border:1px solid rgba(0,0,0,0.4);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }),
  shape: '◆',
  color: '#ff9632', // orange label background and callsign foreground for popup
};

export const SOTAPanel = ({
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

export default SOTAPanel;
