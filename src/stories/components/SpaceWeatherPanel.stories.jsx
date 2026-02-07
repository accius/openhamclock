import { SpaceWeatherPanel } from '@components/SpaceWeatherPanel.jsx';
import { mockSpaceWeather } from '@/stories/fixtures.js';

export default {
  title: 'Components/SpaceWeatherPanel',
  component: SpaceWeatherPanel
};

export const Default = () => (
  <SpaceWeatherPanel data={mockSpaceWeather.data} loading={false} />
);
