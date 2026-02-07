import { POTAPanel } from '@components/POTAPanel.jsx';
import { mockPOTASpots } from '@/stories/fixtures.js';

export default {
  title: 'Components/POTAPanel',
  component: POTAPanel
};

export const Default = () => (
  <div style={{ height: 180 }}>
    <POTAPanel
      data={mockPOTASpots}
      loading={false}
      showOnMap={true}
      onToggleMap={() => {}}
    />
  </div>
);
