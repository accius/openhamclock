import { ContestPanel } from '@components/ContestPanel.jsx';
import { mockContests } from '@/stories/fixtures.js';

export default {
  title: 'Components/ContestPanel',
  component: ContestPanel
};

export const Default = () => (
  <div style={{ height: 260 }}>
    <ContestPanel data={mockContests} loading={false} />
  </div>
);
