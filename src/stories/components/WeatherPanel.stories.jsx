import { WeatherPanel } from '@components/WeatherPanel.jsx';

export default {
  title: 'Components/WeatherPanel',
  component: WeatherPanel
};

export const Default = () => (
  <WeatherPanel
    location={{ lat: 40.015, lon: -105.2705 }}
    tempUnit="F"
    onTempUnitChange={() => {}}
  />
);
