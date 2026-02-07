import { BandConditionsPanel } from '@components/BandConditionsPanel.jsx';
import { mockBandConditions } from '@/stories/fixtures.js';

export default {
  title: 'Components/BandConditionsPanel',
  component: BandConditionsPanel
};

export const Default = () => (
  <BandConditionsPanel data={mockBandConditions.data} loading={false} />
);
