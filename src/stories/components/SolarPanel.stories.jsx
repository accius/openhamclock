import { SolarPanel } from '@components/SolarPanel.jsx';
import { mockSolarIndices } from '@/stories/fixtures.js';

export default {
  title: 'Components/SolarPanel',
  component: SolarPanel
};

export const Default = () => (
  <SolarPanel solarIndices={mockSolarIndices} />
);
