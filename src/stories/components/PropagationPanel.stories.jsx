import { PropagationPanel } from '@components/PropagationPanel.jsx';
import { mockPropagation, mockBandConditions } from '@/stories/fixtures.js';

export default {
  title: 'Components/PropagationPanel',
  component: PropagationPanel
};

export const Default = () => (
  <PropagationPanel
    propagation={mockPropagation}
    loading={false}
    bandConditions={mockBandConditions}
  />
);
