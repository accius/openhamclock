import { DXClusterPanel } from '@components/DXClusterPanel.jsx';
import { mockDXClusterSpots } from '@/stories/fixtures.js';

export default {
  title: 'Components/DXClusterPanel',
  component: DXClusterPanel
};

export const Default = () => (
  <div style={{ height: 320 }}>
    <DXClusterPanel
      data={mockDXClusterSpots}
      loading={false}
      totalSpots={120}
      filters={{ bands: ['20m'] }}
      onFilterChange={() => {}}
      onOpenFilters={() => {}}
      onHoverSpot={() => {}}
      hoveredSpot={null}
      showOnMap={true}
      onToggleMap={() => {}}
    />
  </div>
);
