import { DXpeditionPanel } from '@components/DXpeditionPanel.jsx';
import { mockDXpeditions } from '@/stories/fixtures.js';

export default {
  title: 'Components/DXpeditionPanel',
  component: DXpeditionPanel
};

export const Default = () => (
  <div style={{ height: 180 }}>
    <DXpeditionPanel data={mockDXpeditions} loading={false} />
  </div>
);
